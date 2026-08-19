/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// `generate.*` declarations in a project's JSX, made real: the asset
// library's generator (see `attachLibrary`). A declaration resolves to an
// asset by content — the same spec is the same asset, in this session and
// the next, since the finished file lands in the library under
// `generated/` with the spec's key in the manifest.

import { getAssetSpec, isAssetRef } from "@diffusionstudio/jsx";
import { getAssetFile } from "@diffusionstudio/runtime";
import { GENERATED_DIR } from "@diffusionstudio/assets";
import {
  PROMPT_INPUT_AUDIO_MODEL_OPTIONS,
  PROMPT_INPUT_IMAGE_MODEL_OPTIONS,
  PROMPT_INPUT_VIDEO_MODEL_OPTIONS,
  PROMPT_INPUT_VOICE_OPTIONS,
} from "@/components/genai/config";
import { assert } from "@/utils";
import { uploadBlob } from "@/components/engine";
import { trpc } from "@/lib/trpc";

import type { AspectRatio, AssetInput, AssetRef, AssetSpecInput } from "@diffusionstudio/jsx";
import type { Asset, AssetLibrary } from "@diffusionstudio/assets";

const memo: GenerationMemo = new Map();
const inflight: Inflight = new Map();

/**
 * A library's `generate` option for the project `projectId` (which prefixes
 * upload keys). Identical concurrent declarations collapse to one request.
 */
export function generateAsset(ref: object, library: AssetLibrary, projectId: string): Promise<Asset> {
  assert(isAssetRef(ref), "Not a generate.* declaration");

  return resolveGeneratedAsset({ library, projectId, memo, inflight }, ref);
}

/** What one generation run has to hand: the library it fills and its caches. */
type Generation = { library: AssetLibrary; projectId: string; memo: GenerationMemo; inflight: Inflight };

// The UI offers a fixed set of voices on a fixed model (see prompt-input.tsx).
const VOICE_MODEL = "elevenlabs-v3";

/**
 * A spec with defaults applied and every `AssetInput` reduced to an asset id.
 * Field order is fixed, so `JSON.stringify` of it is a stable `generationKey`.
 */
type ResolvedSpec =
  | { type: "image"; model: string; prompt: string; aspectRatio: AspectRatio; seed?: number; refIds: string[] }
  | { type: "video"; model: string; prompt: string; aspectRatio: AspectRatio; duration: number; audio: boolean; seed?: number; startFrameId?: string; endFrameId?: string }
  | { type: "voice"; model: string; prompt: string; voice: string }
  | { type: "audio"; model: string; prompt: string; duration?: number };

/**
 * Declarations already resolved, keyed by ref identity — a ref consumed by
 * several elements resolves (and validates) once. A failed one is forgotten,
 * so a remount tries again.
 */
type GenerationMemo = Map<AssetRef, Promise<Asset>>;

/** In-flight generations keyed by `generationKey`. */
type Inflight = Map<string, Promise<Asset>>;

function resolveGeneratedAsset(gen: Generation, ref: AssetRef): Promise<Asset> {
  let promise = gen.memo.get(ref);
  if (!promise) {
    promise = generateFromRef(gen, ref);
    promise.catch(() => gen.memo.delete(ref));
    gen.memo.set(ref, promise);
  }
  return promise;
}

function resolveInput(gen: Generation, input: AssetInput): Promise<Asset> {
  return isAssetRef(input) ? resolveGeneratedAsset(gen, input) : gen.library.resolve(input);
}

async function generateFromRef(gen: Generation, ref: AssetRef): Promise<Asset> {
  const resolved = await resolveSpec(gen, getAssetSpec(ref));
  const generationKey = JSON.stringify(resolved);

  const cached = gen.library.list().find((asset) => asset.generation?.key === generationKey);
  if (cached) return cached;

  const running = gen.inflight.get(generationKey);
  if (running) return await running;

  const promise = runGeneration(gen, resolved, generationKey);
  gen.inflight.set(generationKey, promise);
  try {
    return await promise;
  } finally {
    gen.inflight.delete(generationKey);
  }
}

async function resolveSpec(gen: Generation, spec: AssetSpecInput): Promise<ResolvedSpec> {
  switch (spec.type) {
    case "image": {
      const refs = await Promise.all((spec.refs ?? []).map((ref) => resolveInput(gen, ref)));
      return {
        type: "image",
        model: spec.model ?? PROMPT_INPUT_IMAGE_MODEL_OPTIONS[0].id,
        prompt: spec.prompt,
        aspectRatio: spec.aspectRatio ?? "16:9",
        seed: spec.seed,
        refIds: refs.map((asset) => asset.id),
      };
    }
    case "video": {
      const [startFrame, endFrame] = await Promise.all([
        spec.startFrame !== undefined ? resolveInput(gen, spec.startFrame) : undefined,
        spec.endFrame !== undefined ? resolveInput(gen, spec.endFrame) : undefined,
      ]);
      const resolved = {
        type: "video",
        model: spec.model ?? PROMPT_INPUT_VIDEO_MODEL_OPTIONS[0].id,
        prompt: spec.prompt,
        aspectRatio: spec.aspectRatio ?? "16:9",
        duration: spec.duration ?? 5,
        audio: spec.audio ?? false,
        seed: spec.seed,
        startFrameId: startFrame?.id,
        endFrameId: endFrame?.id,
      } satisfies ResolvedSpec;
      checkVideoConstraints(resolved);
      return resolved;
    }
    case "voice": {
      return {
        type: "voice",
        model: VOICE_MODEL,
        prompt: spec.prompt,
        voice: spec.voice ?? PROMPT_INPUT_VOICE_OPTIONS[0].value,
      };
    }
    case "audio": {
      return {
        type: "audio",
        model: spec.model ?? PROMPT_INPUT_AUDIO_MODEL_OPTIONS[0].id,
        prompt: spec.prompt,
        duration: spec.duration,
      };
    }
  }
}

/**
 *  Per-model constraints (`dapi models video`); unknown models are left to the server.
 */
function checkVideoConstraints(spec: Extract<ResolvedSpec, { type: "video" }>): void {
  const model = PROMPT_INPUT_VIDEO_MODEL_OPTIONS.find((option) => option.id === spec.model);
  if (!model) return;

  assert(model.aspectRatios.includes(spec.aspectRatio), `${spec.model} does not support aspect ratio ${spec.aspectRatio}`);
  assert(model.durations.includes(`${spec.duration}s`), `${spec.model} does not support a duration of ${spec.duration}s`);
  assert(!spec.audio || model.features.includes("audio"), `${spec.model} does not support audio generation`);
  assert(spec.endFrameId === undefined || model.features.includes("end-frame"), `${spec.model} does not support an end frame`);
}

/** Runs a generation and stores its first result under `generated/`. */
async function runGeneration(gen: Generation, spec: ResolvedSpec, generationKey: string): Promise<Asset> {
  const { name, results, generationId } = await requestGeneration(gen, spec);
  assert(results.length > 0, "No results returned from the model");

  const url = results[0].url;
  const response = await fetch(url);
  assert(response.ok, `Failed to fetch the generated asset: ${response.status}`);
  const blob = await response.blob();
  const extension = url.split(/[?#]/)[0].split(".").pop();
  const fileName = extension && extension.length <= 5 ? `${name}.${extension}` : name;

  return gen.library.store(blob, { name: fileName, folder: GENERATED_DIR, generation: { key: generationKey, id: generationId } });
}

function requestGeneration(gen: Generation, spec: ResolvedSpec) {
  switch (spec.type) {
    case "image": {
      return (async () => {
        const images = spec.refIds.length > 0
          ? await Promise.all(spec.refIds.map((id) => uploadInput(gen, id)))
          : undefined;

        return await trpc.generateImage.mutate({
          model: spec.model,
          prompt: spec.prompt,
          aspectRatio: spec.aspectRatio,
          count: 1,
          seed: spec.seed,
          images,
        });
      })();
    }
    case "video": {
      return (async () => {
        const [startFrame, endFrame] = await Promise.all([
          spec.startFrameId ? uploadInput(gen, spec.startFrameId) : undefined,
          spec.endFrameId ? uploadInput(gen, spec.endFrameId) : undefined,
        ]);

        return await trpc.generateVideo.mutate({
          model: spec.model,
          prompt: spec.prompt,
          aspectRatio: spec.aspectRatio,
          duration: spec.duration,
          generateAudio: spec.audio,
          seed: spec.seed,
          startFrame,
          endFrame,
        });
      })();
    }
    case "voice": {
      return trpc.textToSpeech.mutate({
        model: spec.model,
        prompt: spec.prompt,
        voice: spec.voice,
      });
    }
    case "audio": {
      return trpc.generateSound.mutate({
        model: spec.model,
        prompt: spec.prompt,
        duration: spec.duration,
      });
    }
  }
}

/** Uploads a referenced asset for the model to read; the bucket key is project-unique. */
async function uploadInput(gen: Generation, assetId: string) {
  const asset = gen.library.get(assetId);
  assert(asset, `Referenced asset ${assetId} not found`);
  const uploaded = await uploadBlob(await getAssetFile(asset), `${gen.projectId}-${assetId}`);
  assert(uploaded, `Failed to upload referenced asset ${assetId}`);
  return uploaded;
}
