/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import { useEngine } from "@/context/engine";
import { trpc } from "@/lib/trpc";
import { track } from "@/lib/analytics";
import { findEmptyPlacement, recordGeneration, addWaveformFill, ensureGenerationFolder } from "@/utils/genai";
import { GeometryType, createEntity, deleteEntity, addComponent, removeComponent, setComponent, resizeEntity } from "@/components/engine";
import { loadAsset } from "@/components/engine";

import type { VoiceGenerationConfig } from "@/components/engine/db";

export function useGenerateVoice() {
  const { world } = useEngine();
  const c = world.components;


  const generate = async (config: VoiceGenerationConfig) => {
    let eid: number | undefined;
    const startedAt = performance.now();
    try {
      track('generation_started', {
        mode: 'voice',
        model: config.model,
        voice: config.voice,
        prompt_length: config.prompt.length,
      });

      const placement = findEmptyPlacement(world, 400, 100, 40);
      // In-flight placeholder is transient UI — build it untracked so it never
      // reaches the undo stack. The whole generation is recorded as one step below.
      world.history.untrack(() => {
        eid = createEntity(world);
        setComponent(world, eid, c.Geometry, GeometryType.RECT);
        addComponent(world, eid, c.Audio);
        setComponent(world, eid, c.Playback, {});
        setComponent(world, eid, c.Position, {
          x: Math.round(placement.x - 200),
          y: Math.round(placement.y - 50),
        });
        resizeEntity(world, eid, {
          width: 400,
          height: 100,
        });
        addComponent(world, eid, c.Generating);
      });

      const { results, name, generationId } = await trpc.textToSpeech.mutate({
        model: config.model,
        prompt: config.prompt,
        voice: config.voice,
      });

      if (results.length > 0) {
        const folderId = await ensureGenerationFolder(world, name, results.length);
        const asset = await loadAsset(world, results[0].url, { name, generationId, folderId });

        world.history.untrack(() => {
          setComponent(world, eid!, c.Name, name);
          setComponent(world, eid!, c.AssetId, asset.id);
          addWaveformFill(world, eid!, asset.id);
          removeComponent(world, eid!, c.Generating);
        });

        recordGeneration(world, 'Generate voice', [eid!]);
      }

      track('generation_completed', {
        mode: 'voice',
        model: config.model,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    } catch (err) {
      if (eid !== undefined) world.history.untrack(() => deleteEntity(world, eid!));
      console.error(err);
      track('generation_failed', {
        mode: 'voice',
        model: config.model,
        duration_ms: Math.round(performance.now() - startedAt),
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      });
      throw err;
    }
  };

  return { generate } as const;
}
