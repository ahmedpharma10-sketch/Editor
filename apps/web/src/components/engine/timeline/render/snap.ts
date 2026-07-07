/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { RULER_HEIGHT } from "../config";
import { getCurrentResolution, getCurrentScrollX } from "../utils";

import type { EngineWorld } from "../../api/world";
import type { TimelineContext } from "../world";

export function renderSnapPoints(world: EngineWorld, timeline: TimelineContext) {
  if (timeline.snapX == null) return;

  const ctx = timeline.ctx!;
  const canvas = timeline.canvas!;

  const scrollX = getCurrentScrollX(world);
  const resolution = getCurrentResolution(world);

  ctx.save();

  ctx.translate(-(scrollX * resolution), 0);

  const pointX = timeline.snapX;
  const height = canvas.height / window.devicePixelRatio;

  ctx.beginPath();
  ctx.moveTo(pointX, RULER_HEIGHT);
  ctx.lineTo(pointX, height);

  ctx.strokeStyle = timeline.colors.border.scrubber;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();

  timeline.snapX = null;
}
