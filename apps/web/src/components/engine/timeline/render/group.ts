/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { framesToPixels } from "../utils";
import { CLIP_CORNER_RADIUS } from "../config";

import type { EngineWorld } from "../../api/world";
import type { TimelineContext } from "../world";

export function renderGroup(world: EngineWorld, timeline: TimelineContext, eid: number) {
  const ctx = timeline.ctx!;
  const c = world.components;

  const children = c.Cache.children[eid];
  if (children.length === 0) return;

  const layerHeight = timeline.currentLayerHeight;
  const start = c.Computed.start[eid];
  const end = c.Computed.end[eid];
  const clipLeft = framesToPixels(world, start);
  const clipRight = framesToPixels(world, end);

  const childY = 20;
  const childHeight = layerHeight - childY;
  if (childHeight < 12) return;

  ctx.save();

  // Clip to the group clip bounds
  ctx.beginPath();
  ctx.roundRect(clipLeft, 0, clipRight - clipLeft, layerHeight, CLIP_CORNER_RADIUS);
  ctx.clip();

  for (const childEid of children) {
    const childStart = Math.max(start, c.Computed.start[childEid]);
    const childEnd = Math.min(end, c.Computed.end[childEid]);
    const childLeft = framesToPixels(world, childStart);
    const childWidth = framesToPixels(world, childEnd) - childLeft;
    if (childWidth < 2) continue;

    ctx.beginPath();
    ctx.roundRect(childLeft, childY, childWidth, childHeight, CLIP_CORNER_RADIUS);
    ctx.fillStyle = timeline.colors.clip.group.primary;
    ctx.fill();
  }

  ctx.restore();
}
