/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { addEntity, removeEntity } from "bitecs";
import { DEFAULT_DURATION_FRAMES } from "../constants";
import { addComponent } from "./events";
import { getEntityTree } from "./query";

import type { EngineWorld } from "./world";


export function createEntity(world: EngineWorld) {
  const c = world.components;
  let eid!: number;

  world.history.push({
    label: 'creating new entity',
    execute: () => (eid = addEntity(world)),
    reverse: () => (removeEntity(world, eid)),
  })

  addComponent(world, eid, c.Computed, false);

  c.Computed.positionX[eid] = 0;
  c.Computed.positionY[eid] = 0;
  c.Computed.offsetX[eid] = 0;
  c.Computed.offsetY[eid] = 0;
  c.Computed.originX[eid] = 0;
  c.Computed.originY[eid] = 0;
  c.Computed.rotation[eid] = 0;
  c.Computed.scaleX[eid] = 1;
  c.Computed.scaleY[eid] = 1;
  c.Computed.skewX[eid] = 0;
  c.Computed.skewY[eid] = 0;
  c.Computed.opacity[eid] = 1;
  c.Computed.color[eid] = 0;
  c.Computed.blur[eid] = 0;
  c.Computed.volume[eid] = 0;
  c.Computed.value[eid] = 0;
  c.Computed.strokeWidth[eid] = 1;
  c.Computed.cornerRadius[eid] = 0;
  c.Computed.cornerRadiusTopLeft[eid] = 0;
  c.Computed.cornerRadiusTopRight[eid] = 0;
  c.Computed.cornerRadiusBottomRight[eid] = 0;
  c.Computed.cornerRadiusBottomLeft[eid] = 0;
  c.Computed.stopOffset[eid] = 0;
  c.Computed.stopColor[eid] = 0;
  c.Computed.stopOpacity[eid] = 1;
  c.Computed.width[eid] = 300;
  c.Computed.height[eid] = 300;
  c.Computed.start[eid] = 0;
  c.Computed.localTime[eid] = 0;
  c.Computed.localTimeInSeconds[eid] = 0;
  c.Computed.visibility[eid] = 1;
  c.Computed.end[eid] = DEFAULT_DURATION_FRAMES;
  c.Computed.duration[eid] = DEFAULT_DURATION_FRAMES;
  c.Computed.delay[eid] = 0;

  addComponent(world, eid, c.Cache, false);
  c.Cache.children[eid] = [];
  c.Cache.fills[eid] = [];
  c.Cache.shadows[eid] = [];
  c.Cache.strokes[eid] = [];
  c.Cache.effects[eid] = [];
  c.Cache.textRanges[eid] = [];
  c.Cache.masks[eid] = [];
  c.Cache.animations[eid] = [];
  c.Cache.keyframeTracks[eid] = [];

  return eid;
}

export function deleteEntity(world: EngineWorld, eid: number) {
  const c = world.components;
  // Tagging the whole subtree Deleted is one logical step. Nests under any
  // outer transaction (keyboard delete, ungroup, keyframe toggle, …).
  world.history.transaction('deleting entity', () => {
    for (const e of getEntityTree(world, eid)) {
      addComponent(world, e, c.Deleted);
    }
  });
}
