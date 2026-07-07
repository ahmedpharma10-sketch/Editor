/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Not, Or, query } from 'bitecs';
import { PaintType, ChildOf, createEntity, addComponent, appendChild, removeComponent, setComponent } from "@/components/engine";
import { loadAsset, uploadAsset } from "@/components/engine";
import { useEngine } from "@/context/engine";
import { trpc } from "@/lib/trpc";
import { assert } from "@/utils";
import { toast } from "somoto";

import type { EngineWorld } from "@/components/engine";

function findVideoFill(world: EngineWorld, eid: number): number | null {
  const c = world.components;

  for (const fid of query(world, [c.Paint, ChildOf(eid), Not(c.Deleted), Not(c.Hidden)])) {
    if (c.Paint[fid] === PaintType.VIDEO) {
      return fid;
    }
  }
  return null;
}

export function useAddAudioToVideo() {
  const { world } = useEngine();
  const c = world.components;

  const generate = async () => {
    const nodes = [...query(world, [c.Selected, Or(c.Geometry, c.Group)])];

    for (const nid of nodes) {
      const fid = findVideoFill(world, nid);
      if (!fid) continue;

      const assetId = c.AssetId[fid];
      if (!assetId) continue;

      const asset = world.assets.get(assetId);
      if (!asset) continue;

      try {
        addComponent(world, nid, c.Generating);

        const fileRef = await uploadAsset(world, assetId);
        if (!fileRef) throw new Error("Failed to upload asset");

        const { url, generationId } = await trpc.addAudioToVideo.mutate({ video: fileRef });

        const dot = asset.name.lastIndexOf(".");
        const name = dot > 0
          ? asset.name.slice(0, dot) + " (With audio)" + asset.name.slice(dot)
          : asset.name + " (With audio)";
        const newAsset = await loadAsset(world, url, { name, generationId });

        assert(newAsset.type === "VIDEO", "New asset is not a video");

        addComponent(world, fid, c.Hidden);

        const newFid = createEntity(world);
        setComponent(world, newFid, c.Paint, PaintType.VIDEO);
        setComponent(world, newFid, c.AssetId, newAsset.id);
        appendChild(world, newFid, nid);
      } catch (err) {
        console.error("Add audio failed:", err);
        toast.error("Failed to add audio to video");
      } finally {
        removeComponent(world, nid, c.Generating);
      }
    }
  };

  return { generate };
}
