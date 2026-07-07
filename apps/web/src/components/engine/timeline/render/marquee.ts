/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { EngineWorld } from "../../api/world";
import type { TimelineContext } from "../world";

export function renderMarquee(_world: EngineWorld, timeline: TimelineContext) {
  const ctx = timeline.ctx!;

  if (timeline.marquee) {
    const { x, y, width, height } = timeline.marquee;

    ctx.save();

    ctx.fillStyle = timeline.colors.border.ring;
    ctx.strokeStyle = timeline.colors.border.ring;
    ctx.lineWidth = 1;

    ctx.globalAlpha = 0.2;
    ctx.fillRect(x, y, width, height);

    ctx.globalAlpha = 1;
    ctx.strokeRect(x, y, width, height);

    ctx.restore();
  }
}
