/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useEngine } from "@/context/engine";
import { trpc } from "@/lib/trpc";
import { track } from "@/lib/analytics";
import { ASPECT_RATIO_DIMENSIONS, findEmptyPlacement, recordGeneration, ensureGenerationFolder } from "@/utils/genai";
import { GeometryType, PaintType, createEntity, deleteEntity, addComponent, appendChild, removeComponent, setComponent, resizeEntity } from "@/components/engine";
import { loadAsset, uploadAssets } from "@/components/engine";

import type { ImageGenerationConfig } from "@/components/engine/db";

const IMAGE_GAP = 40;

export function useGenerateImage() {
  const { world } = useEngine();
  const c = world.components;

  const generate = async (config: ImageGenerationConfig) => {
    let placeholders: number[] = [];
    const startedAt = performance.now();
    try {
      track('generation_started', {
        mode: 'image',
        model: config.model,
        aspect_ratio: config.aspectRatio,
        count: config.count,
        prompt_length: config.prompt.length,
        reference_count: config.imageRefIds?.length ?? 0,
      });

      // 1. Find a slot for the whole batch, then place placeholder rectangles with the
      // Generating tag. In-flight placeholders are transient UI — build them untracked so
      // they never reach the undo stack. The whole batch is recorded as one step below.
      const dims = ASPECT_RATIO_DIMENSIONS[config.aspectRatio] ?? { width: 1920, height: 1080 };
      const totalWidth = config.count * dims.width + (config.count - 1) * IMAGE_GAP;
      const center = findEmptyPlacement(world, totalWidth, dims.height, IMAGE_GAP);

      world.history.untrack(() => {
        placeholders = Array.from({ length: config.count }).map(() => createEntity(world));

        for (const [index, eid] of placeholders.entries()) {
          // When generating multiple variants, offset each horizontally so they
          // don't stack on top of each other.
          const offsetX = index * (dims.width + IMAGE_GAP) - totalWidth / 2 + dims.width / 2;

          setComponent(world, eid, c.Geometry, GeometryType.RECT);
          setComponent(world, eid, c.Position, {
            x: Math.round(center.x + offsetX - dims.width / 2),
            y: Math.round(center.y - dims.height / 2),
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
        }
      });

      const { name, results, generationId } = await trpc.generateImage.mutate({
        model: config.model,
        prompt: config.prompt,
        aspectRatio: config.aspectRatio,
        count: config.count,
        images: await uploadAssets(world, config.imageRefIds),
      });

      // 2. Apply image fills and remove Generating tag
      const folderId = await ensureGenerationFolder(world, name, results.length);
      await Promise.all(
        results.map(async (result, i) => {
          const eid = placeholders[i];
          const imgName = results.length > 1 ? `${name} (${i + 1})` : name;
          const asset = await loadAsset(world, result.url, { name: imgName, generationId, folderId });

          world.history.untrack(() => {
            setComponent(world, eid, c.Name, imgName);

            const fid = createEntity(world);
            setComponent(world, fid, c.Paint, PaintType.IMAGE);
            setComponent(world, fid, c.AssetId, asset.id);
            appendChild(world, fid, eid);

            removeComponent(world, eid, c.Generating);
          });
        }),
      );

      recordGeneration(world, 'Generate image', placeholders);

      track('generation_completed', {
        mode: 'image',
        model: config.model,
        aspect_ratio: config.aspectRatio,
        count: results.length,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    } catch (err) {
      // On failure, delete the placeholders so the shimmer stops. Untracked —
      // a failed generation leaves no trace on the undo stack.
      world.history.untrack(() => {
        for (const eid of placeholders) {
          deleteEntity(world, eid);
        }
      });
      console.error(err);
      track('generation_failed', {
        mode: 'image',
        model: config.model,
        duration_ms: Math.round(performance.now() - startedAt),
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      });
      throw err;
    }
  };

  return { generate } as const;
}
