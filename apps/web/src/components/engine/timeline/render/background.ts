/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hasComponent } from "bitecs";
import { getCurrentResolution, getCurrentScrollX, framesToPixels } from "../utils";
import { assert } from "@/utils";
import { DEFAULT_DURATION_FRAMES } from "../../constants";

import type { EngineWorld } from "../../api/world";
import type { TimelineContext } from "../world";
import { clearComponent } from "../../api/events";

export function renderBackground(world: EngineWorld, timeline: TimelineContext) {
  const canvas = timeline.canvas!;
  const ctx = timeline.ctx!;
  const pointer = timeline.pointer!;

  const scrollX = getCurrentScrollX(world);
  const resolution = getCurrentResolution(world);
  const scene = world.selection.scene;

  const c = world.components;

  // Handle marquee selection
  {
    const { clicked, dragging } = pointer
      .scope('canvas')
      .region(0, 0, canvas.width, canvas.height);

    if (clicked) {
      clearComponent(world, c.Selected, false);
    }

    if (dragging) {
      assert(pointer.position, 'Mouse position must be set');
      assert(pointer.position?.state != 'idle', 'Mouse position must be pressing');

      const x = Math.min(pointer.position.currentX, pointer.position.initialX);
      const y = Math.min(pointer.position.currentY, pointer.position.initialY);
      const width = Math.abs(pointer.position.currentX - pointer.position.initialX);
      const height = Math.abs(pointer.position.currentY - pointer.position.initialY);

      if (!timeline.marquee) {
        clearComponent(world, c.Selected, false);
      }

      timeline.marquee = { x, y, width, height };
    } else if (timeline.marquee) {
      timeline.marquee = undefined;
    }
  }

  // Draw workarea background
  if (scene !== null && hasComponent(world, scene, c.Trim)) {
    const start = c.Trim.start[scene] ?? 0;
    const stopFrame = c.Trim.end[scene] ?? DEFAULT_DURATION_FRAMES;
    ctx.save();

    ctx.translate(-(scrollX * resolution), 0);

    const inPx = framesToPixels(world, start);
    const outPx = framesToPixels(world, stopFrame);

    ctx.fillStyle = timeline.colors.background.default;
    ctx.fillRect(inPx, 0, outPx - inPx, canvas.height);

    ctx.restore();
  }
}
