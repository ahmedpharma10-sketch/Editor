/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ChildOf } from "@/components/engine/components";
import { getAllEntities, hasComponent, Not, Or, query } from "bitecs";

import type { Engine, EngineWorld } from "@/components/engine";
import type { Accessor } from "solid-js";

function selectedNodeIds(world: EngineWorld): number[] {
  const c = world.components;
  return [...query(world, [c.Selected, Or(c.Geometry, c.Group, c.AdjustmentLayer), Not(c.Deleted)])];
}

export function handleContextGet(engine: Accessor<Engine>) {
  return async () => {
    const { world } = engine();
    const c = world.components;

    const scenes = [...query(world, [c.Geometry, c.Scene, Not(ChildOf('*')), Not(c.Deleted)])];
    const entityCount = getAllEntities(world).filter((eid) => !hasComponent(world, eid, c.Deleted)).length;
    const activeSceneId = world.selection.scene !== null ? world.selection.scene : null;
    const currentFrame = activeSceneId !== null ? (c.Computed.localTime[activeSceneId] ?? 0) : 0;

    const fps = world.frameRate;
    const workarea =
      activeSceneId !== null && hasComponent(world, activeSceneId, c.Workarea)
        ? {
            start: (c.Workarea.start[activeSceneId] ?? 0) / fps,
            end: (c.Workarea.end[activeSceneId] ?? 0) / fps,
          }
        : null;

    const fontFamilies = [...new Set(["Inter", ...world.fonts.map((f) => f.family)])];
    const projectId = world.projectId;
    const selection = selectedNodeIds(world);

    return {
      projectId,
      entityCount,
      scenes,
      activeSceneId,
      currentFrame,
      workarea,
      fontFamilies,
      selection,
    };
  }
}
