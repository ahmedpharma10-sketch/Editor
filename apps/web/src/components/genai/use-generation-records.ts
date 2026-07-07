/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createResource } from "solid-js";
import { hasComponent } from "bitecs";
import { PaintType } from "@/components/engine";
import { useEngine } from "@/context/engine";
import { supabase } from "@/lib/supabase";
import { generationConfigSchema, type GenerationConfig } from "@/components/engine/db";

import type { EngineWorld } from "@/components/engine";
import { useECS } from "@/context/ecs";

/**
 * The stored `usage_records.config` IS the server-side adapter input, which
 * shares its schema with the client's `GenerationConfig` — except that media
 * fields carry `fileRef`s with embedded `assetId`s instead of raw asset IDs.
 * This normalizes those fields so the object validates as a `GenerationConfig`.
 */
export function toClientConfig(stored: unknown): GenerationConfig | undefined {
  if (!stored || typeof stored !== "object") return undefined;
  const c = stored as Record<string, unknown> & {
    images?: Array<{ assetId?: string }>;
    startFrame?: { assetId?: string };
    endFrame?: { assetId?: string };
  };

  const candidate: Record<string, unknown> = { ...c };

  if (c.images) {
    const imageRefIds = c.images
      .map((r) => r.assetId)
      .filter((id): id is string => typeof id === "string");
    delete candidate.images;
    if (imageRefIds.length > 0) candidate.imageRefIds = imageRefIds;
  }
  if (c.startFrame?.assetId) {
    candidate.startFrameImageId = c.startFrame.assetId;
  }
  delete candidate.startFrame;
  if (c.endFrame?.assetId) {
    candidate.endFrameImageId = c.endFrame.assetId;
  }
  delete candidate.endFrame;

  const parsed = generationConfigSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function getNodeAssetId(world: EngineWorld, eid: number): string | undefined {
  const c = world.components;
  if (hasComponent(world, eid, c.Audio)) {
    return c.AssetId[eid];
  }
  for (const fid of c.Cache.fills[eid]) {
    if (hasComponent(world, fid, c.Hidden)) continue;
    if (c.Paint[fid] === PaintType.VIDEO || c.Paint[fid] === PaintType.IMAGE) {
      return c.AssetId[fid];
    }
  }
  return undefined;
}

export function useGenerationRecords() {
  const { selectedNodes } = useECS();
  const { world } = useEngine();

  const generationIds = createMemo(() => {
    const ids = new Set<string>();
    for (const eid of selectedNodes()) {
      const assetId = getNodeAssetId(world, eid);
      if (!assetId) {
        continue;
      }

      const asset = world.assets.get(assetId);
      if (asset?.generationId) {
        ids.add(asset.generationId);
      }
    }
    return [...ids];
  });

  const [records] = createResource(() => generationIds(), async (ids) => {
    if (ids.length === 0 || !supabase) return [];
    const { data, error } = await supabase
      .from("usage_records")
      .select("id,credits,config")
      .in("id", ids);

    if (error) {
      console.error("[credits] Failed to load usage records", error);
      return [];
    }

    return (data ?? []).map((row) => ({
      id: row.id as string,
      credits: (row.credits as number | null) ?? 0,
      config: row.config as unknown,
    }));
  },
  );

  const totalCredits = createMemo(() => {
    return (records() ?? []).reduce((sum, r) => sum + r.credits, 0);
  });

  const isGenerated = createMemo(() => generationIds().length > 0);

  const firstConfig = (): GenerationConfig | undefined => {
    const ids = generationIds();
    if (ids.length === 0) return undefined;
    const record = (records() ?? []).find((r) => r.id === ids[0]);
    return toClientConfig(record?.config);
  };

  return { isGenerated, totalCredits, firstConfig };
}
