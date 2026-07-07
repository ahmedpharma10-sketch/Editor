/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useEngine } from "@/context/engine";
import { trpc } from "@/lib/trpc";
import { track } from "@/lib/analytics";
import { ASPECT_RATIO_DIMENSIONS, findEmptyPlacement, recordGeneration, ensureGenerationFolder } from "@/utils/genai";

import { GeometryType, PaintType, createEntity, deleteEntity, addComponent, appendChild, removeComponent, setComponent, resizeEntity } from "@/components/engine";
import { loadAsset, uploadAsset } from "@/components/engine";
import { assert } from "@/utils";

import type { VideoGenerationConfig } from "@/components/engine/db";

export function useGenerateVideo() {
  const { world } = useEngine();
  const c = world.components;

  const generate = async (config: VideoGenerationConfig) => {
    let eid: number | undefined;
    const startedAt = performance.now();
    try {
      track('generation_started', {
        mode: 'video',
        model: config.model,
        aspect_ratio: config.aspectRatio,
        duration: config.duration,
        generate_audio: config.generateAudio,
        has_start_frame: !!config.startFrameImageId,
        has_end_frame: !!config.endFrameImageId,
        prompt_length: config.prompt.length,
      });

      const dims = ASPECT_RATIO_DIMENSIONS[config.aspectRatio] ?? { width: 1920, height: 1080 };
      const placement = findEmptyPlacement(world, dims.width, dims.height, 40);

      // In-flight placeholder is transient UI — build it untracked so it never
      // reaches the undo stack. The whole generation is recorded as one step below.
      world.history.untrack(() => {
        eid = createEntity(world);
        setComponent(world, eid, c.Geometry, GeometryType.RECT);
        setComponent(world, eid, c.Position, {
          x: Math.round(placement.x - dims.width / 2),
          y: Math.round(placement.y - dims.height / 2),
        });
        resizeEntity(world, eid, {
          width: dims.width,
          height: dims.height,
        });
        setComponent(world, eid, c.KeepAspectRatio, {
          width: dims.width,
          height: dims.height,
        });
        addComponent(world, eid, c.Generating);
      });

      const [startFrame, endFrame] = await Promise.all([
        config.startFrameImageId ? uploadAsset(world, config.startFrameImageId) : undefined,
        config.endFrameImageId ? uploadAsset(world, config.endFrameImageId) : undefined,
      ]);

      const { results, name, generationId } = await trpc.generateVideo.mutate({
        model: config.model,
        prompt: config.prompt,
        aspectRatio: config.aspectRatio,
        duration: config.duration,
        generateAudio: config.generateAudio,
        startFrame: startFrame ?? undefined,
        endFrame: endFrame ?? undefined,
      });

      assert(results.length > 0, "No results returned from the model");
      const folderId = await ensureGenerationFolder(world, name, results.length);
      const asset = await loadAsset(world, results[0].url, { name, generationId, folderId });

      world.history.untrack(() => {
        setComponent(world, eid!, c.Name, name);
        removeComponent(world, eid!, c.Generating);

        const fid = createEntity(world);
        setComponent(world, fid, c.Paint, PaintType.VIDEO);
        setComponent(world, fid, c.AssetId, asset.id);
        appendChild(world, fid, eid!);

        setComponent(world, eid!, c.Playback, {});
      });

      recordGeneration(world, 'Generate video', [eid!]);

      track('generation_completed', {
        mode: 'video',
        model: config.model,
        aspect_ratio: config.aspectRatio,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    } catch (err) {
      if (eid !== undefined) world.history.untrack(() => deleteEntity(world, eid!));
      console.error(err);
      track('generation_failed', {
        mode: 'video',
        model: config.model,
        duration_ms: Math.round(performance.now() - startedAt),
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      });
      throw err;
    }
  };

  return { generate } as const;
}
