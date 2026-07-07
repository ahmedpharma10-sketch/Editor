/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { GeometryType, createEntity, appendChild, setComponent, transcribeScene } from "@/components/engine";
import { useEngine } from "@/context/engine";
import { createSignal } from "solid-js";
import { toast } from "somoto";

import type { TranscribeStatus } from "@/components/engine";

export type AutoCaptionsStatus = TranscribeStatus | null;

export function useAutoCaptions() {
  const engine = useEngine();
  const world = engine.world;
  const c = world.components;

  const [status, setStatus] = createSignal<AutoCaptionsStatus>(null);

  const generate = async (sceneEid: number) => {
    try {
      const { asset, trim } = await transcribeScene(engine, sceneEid, setStatus);

      const eid = createEntity(world);
      setComponent(world, eid, c.Geometry, GeometryType.TEXT);
      setComponent(world, eid, c.Caption, {});
      setComponent(world, eid, c.AssetId, asset.id);
      setComponent(world, eid, c.Trim, trim);
      appendChild(world, eid, sceneEid);
    } catch (error) {
      console.error("Auto-captions failed:", error);
      toast.error("Failed to generate captions", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setStatus(null);
    }
  };

  return { generate, status };
}
