/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The app's GenAi: `generate.*` declarations made real against this
// project's library and the dapi backend. Attached to the world as the `Ai`
// trait, which is what the runtime's asset system (and `ai.generate.image`
// callers) resolve through. A declaration resolves to an asset by content —
// the same spec is the same asset, in this session and the next, since the
// finished file lands in the library under `generated/` with the spec's key
// in the manifest.

import { getAssetSpec, isAssetRef, parseSource } from "@diffusionstudio/jsx";
import {
  Ai, AssetId, Audio, GenAi, getAssetFile, getEntityTree, Hidden, Muted,
  Paint, PaintType, Project, Source,
} from "@diffusionstudio/runtime";
import { createEncoder } from "@diffusionstudio/encoder";
import { assetName, GENERATED_DIR } from "@diffusionstudio/assets";
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
import type { Entity, World } from "koota";

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

/** Creates the project's GenAi over `library` and attaches it as the world's Ai. */
export function attachAi(world: World, library: AssetLibrary): EditorGenAi {
  const ai = new EditorGenAi(library, world.get(Project)?.id ?? "project");
  world.set(Ai, ai);
  return ai;
}

export class EditorGenAi extends GenAi {
  private readonly library: AssetLibrary;
  /** Prefixes upload keys, so referenced assets land project-unique in the bucket. */
  private readonly projectId: string;

  /**
   * Declarations already resolved, keyed by ref identity — a ref consumed by
   * several elements resolves (and validates) once. A failed one is
   * forgotten, so a remount tries again.
   */
  private readonly memo = new Map<AssetRef, Promise<Asset>>();
  /** In-flight generations and transcriptions keyed by `generationKey`. */
  private readonly inflight = new Map<string, Promise<Asset>>();

  public constructor(library: AssetLibrary, projectId: string) {
    super();
    this.library = library;
    this.projectId = projectId;
  }

  /** Identical concurrent declarations collapse to one request. */
  public resolve(ref: AssetRef): Promise<Asset> {
    assert(isAssetRef(ref), "Not a generate.* declaration");

    let promise = this.memo.get(ref);
    if (!promise) {
      promise = this.generateFromRef(ref);
      promise.catch(() => this.memo.delete(ref));
      this.memo.set(ref, promise);
    }
    return promise;
  }

  /**
   * Transcribes the scene's audible mix for a `<captions>` element (see the
   * runtime's asset system). Cached by scene id + seed: the same pair is the
   * same transcript asset across sessions (the transcript lands in the
   * library under `generated/` with that key in the manifest), and a new
   * seed transcribes the scene again.
   */
  public async transcribe(world: World, scene: Entity, seed: number): Promise<Asset> {
    const key = transcriptKey(scene, seed);

    const cached = this.library.list().find((asset) => asset.generation?.key === key);
    if (cached) return cached;

    const running = this.inflight.get(key);
    if (running) return await running;

    const promise = this.runTranscription(world, scene, key);
    this.inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }

  /** Encodes the scene's audio, transcribes it, and stores the transcript. */
  private async runTranscription(world: World, scene: Entity, key: string): Promise<Asset> {
    assert(sceneHasAudio(world, scene), "No audio found. Add an audio or video clip to the scene to generate captions.");

    const encoder = await createEncoder(world, {
      scene,
      format: "ogg",
      video: { enabled: false },
      audio: { enabled: true, codec: "opus", sampleRate: 24000 },
    });
    const result = await encoder.render();
    assert(result.type === "success" && result.data !== undefined, "Failed to encode the scene audio");

    const uploadId = crypto.randomUUID();
    const audioFile = new File([result.data], `${uploadId}.ogg`, { type: "audio/ogg" });
    const fileRef = await uploadBlob(audioFile, uploadId);
    assert(fileRef, "Failed to upload the scene audio for transcription");

    const { results: transcript } = await trpc.transcribe.mutate({ audio: fileRef });
    assert(
      transcript.length > 0 && transcript.some((segment) => segment.words.length > 0),
      "No speech detected. The audio does not appear to contain recognizable speech.",
    );

    const blob = new Blob([JSON.stringify(transcript)], { type: "application/json" });
    return this.library.store(blob, {
      name: `${this.nextCaptionsName()}.json`,
      folder: GENERATED_DIR,
      generation: { key },
    });
  }

  private nextCaptionsName(): string {
    let max = 0;
    for (const asset of this.library.list()) {
      const match = assetName(asset).match(/^Captions (\d+)\.json$/);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `Captions ${max + 1}`;
  }

  private resolveInput(input: AssetInput): Promise<Asset> {
    return isAssetRef(input) ? this.resolve(input) : this.library.resolve(input);
  }

  private async generateFromRef(ref: AssetRef): Promise<Asset> {
    const resolved = await this.resolveSpec(getAssetSpec(ref));
    const generationKey = JSON.stringify(resolved);

    const cached = this.library.list().find((asset) => asset.generation?.key === generationKey);
    if (cached) return cached;

    const running = this.inflight.get(generationKey);
    if (running) return await running;

    const promise = this.runGeneration(resolved, generationKey);
    this.inflight.set(generationKey, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(generationKey);
    }
  }

  private async resolveSpec(spec: AssetSpecInput): Promise<ResolvedSpec> {
    switch (spec.type) {
      case "image": {
        const refs = await Promise.all((spec.refs ?? []).map((ref) => this.resolveInput(ref)));
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
          spec.startFrame !== undefined ? this.resolveInput(spec.startFrame) : undefined,
          spec.endFrame !== undefined ? this.resolveInput(spec.endFrame) : undefined,
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

  /** Runs a generation and stores its first result under `generated/`. */
  private async runGeneration(spec: ResolvedSpec, generationKey: string): Promise<Asset> {
    const { name, results, generationId } = await this.requestGeneration(spec);
    assert(results.length > 0, "No results returned from the model");

    const url = results[0].url;
    const response = await fetch(url);
    assert(response.ok, `Failed to fetch the generated asset: ${response.status}`);
    const blob = await response.blob();
    const extension = url.split(/[?#]/)[0].split(".").pop();
    const fileName = extension && extension.length <= 5 ? `${name}.${extension}` : name;

    return this.library.store(blob, { name: fileName, folder: GENERATED_DIR, generation: { key: generationKey, id: generationId } });
  }

  private requestGeneration(spec: ResolvedSpec) {
    switch (spec.type) {
      case "image": {
        return (async () => {
          const images = spec.refIds.length > 0
            ? await Promise.all(spec.refIds.map((id) => this.uploadInput(id)))
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
            spec.startFrameId ? this.uploadInput(spec.startFrameId) : undefined,
            spec.endFrameId ? this.uploadInput(spec.endFrameId) : undefined,
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
  private async uploadInput(assetId: string) {
    const asset = this.library.get(assetId);
    assert(asset, `Referenced asset ${assetId} not found`);
    const uploaded = await uploadBlob(await getAssetFile(asset), `${this.projectId}-${assetId}`);
    assert(uploaded, `Failed to upload referenced asset ${assetId}`);
    return uploaded;
  }
}

/**
 * The transcript cache key: scene id + seed. The scene's durable name is the
 * id in its source stamp (`<file>:<id>`, stamped once by the compiler — the
 * same identity the project config keys by); a scene without one falls back
 * to its entity id, which only holds within the session.
 */
function transcriptKey(scene: Entity, seed: number): string {
  const source = scene.get(Source)?.value;
  const locator = source ? parseSource(source)?.locator : undefined;
  const sceneId = typeof locator === "string" ? locator : source ?? String(scene.id());
  return `transcript:v1:${sceneId}:${seed}`;
}

/**
 * Whether anything in the scene contributes to its audible mix: an unmuted,
 * unhidden audio clip, video, or video paint with its asset bound.
 */
function sceneHasAudio(world: World, scene: Entity): boolean {
  for (const entity of getEntityTree(world, scene)) {
    if (entity.has(Hidden) || entity.has(Muted) || !entity.has(AssetId)) continue;
    if (entity.has(Audio) || entity.get(Paint)?.value === PaintType.VIDEO) return true;
  }
  return false;
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
