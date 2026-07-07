/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Not, Or, query } from 'bitecs';
import { PaintType, ChildOf, createEntity, addComponent, appendChild, removeComponent, setComponent } from "@/components/engine";
import { loadAsset, uploadAsset } from "@/components/engine";
import { useEngine } from "@/context/engine";
import { trpc } from "@/lib/trpc";
import { toast } from "somoto";

import type { EngineWorld } from "@/components/engine";

/**
 * For a given shape entity, find the first image fill and its index.
 */
function findImageFill(world: EngineWorld, eid: number): number | null {
  const c = world.components;

  for (const fid of query(world, [c.Paint, ChildOf(eid), Not(c.Deleted), Not(c.Hidden)])) {
    if (c.Paint[fid] === PaintType.IMAGE) {
      return fid;
    }
  }
  return null;
}

export function useRemoveBackground() {
  const { world } = useEngine();
  const c = world.components;

  const generate = async () => {
    const nodes = [...query(world, [c.Selected, Or(c.Geometry, c.Group)])];

    for (const nid of nodes) {
      const fid = findImageFill(world, nid);
      if (!fid) continue;

      const assetId = world.components.AssetId[fid];
      if (!assetId) continue;

      const asset = world.assets.get(assetId);
      if (!asset) continue;

      try {
        // Show shimmer
        addComponent(world, nid, world.components.Generating);

        // Upload asset and call API
        const fileRef = await uploadAsset(world, assetId);
        if (!fileRef) throw new Error("Failed to upload asset");

        const { url, generationId } = await trpc.removeBackground.mutate({ image: fileRef });

        // Load result as new asset
        const newAsset = await loadAsset(world, url, {
          name: asset.name + " (Background removed)",
          generationId,
        });

        addComponent(world, fid, c.Hidden);

        const newFid = createEntity(world);
        setComponent(world, newFid, c.Paint, PaintType.IMAGE);
        setComponent(world, newFid, c.AssetId, newAsset.id);
        appendChild(world, newFid, nid);
      } catch (err) {
        console.error("Background removal failed:", err);
        toast.error("Failed to remove background");
      } finally {
        removeComponent(world, nid, c.Generating);
      }
    }
  };

  return { generate };
}
