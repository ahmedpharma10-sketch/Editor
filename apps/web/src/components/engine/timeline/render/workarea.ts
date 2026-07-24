/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hasComponent } from "bitecs";
import { assert } from "@/utils";
import { IN_POINT_PATH, OUT_POINT_PATH } from "../paths";
import { framesToPixels, pixelsToFrames, getCurrentScrollX, getCurrentResolution } from "../utils";
import { RULER_HEIGHT } from "../config";
import { removeComponent, setComponent } from "../../api/events";

import type { EngineWorld } from "../../api/world";
import type { TimelineContext } from "../world";


let workareaDragStart: [number, number] = [0, 0];
// Tracks the open work-area drag transaction across frames so the whole drag
// (move / in-handle / out-handle) collapses into a single undo step.
let workareaTxOpen = false;

export function renderWorkarea(world: EngineWorld, timeline: TimelineContext) {
  const ctx = timeline.ctx!;
  const pointer = timeline.pointer!;

  // Set true by any of the three handle regions while it is being dragged.
  let anyDragging = false;
  const beginGesture = () => {
    anyDragging = true;
    if (!workareaTxOpen) {
      world.history.startTransaction('Adjust work area');
      workareaTxOpen = true;
    }
  };

  const scrollX = getCurrentScrollX(world);
  const resolution = getCurrentResolution(world);
  const sid = world.selection.scene;
  if (sid === null) return;
  const c = world.components;
  if (!hasComponent(world, sid, c.Workarea)) return;

  const start = c.Workarea.start[sid] ?? 0;
  const stopFrame = c.Workarea.end[sid] ?? 0;

  ctx.save();

  ctx.translate(-(scrollX * resolution), 0);

  const inPx = framesToPixels(world, start);
  const outPx = framesToPixels(world, stopFrame);

  const height = 10;
  const y = RULER_HEIGHT - height;

  {
    const { dragging, pressed, doubleClicked } = pointer
      .scope('workarea')
      .region(inPx, y, outPx - inPx, height);

    if (dragging) {
      assert(pointer.position, 'Mouse position must be set');
      assert(pointer.position?.state != 'idle', 'Mouse position must be pressing');

      beginGesture();

      const deltaFrames = pixelsToFrames(world, pointer.position.deltaX);

      setComponent(world, sid, c.Workarea, {
        start: workareaDragStart[0] + deltaFrames,
        end: workareaDragStart[1] + deltaFrames,
      });
    }

    if (pressed) {
      workareaDragStart = [start, stopFrame];
    }

    if (doubleClicked) {
      removeComponent(world, sid, c.Workarea);
    }

    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = 'rgba(100, 100, 100, 1)';
    ctx.fillRect(inPx, y, outPx - inPx, height);
    ctx.globalCompositeOperation = 'source-over';
  }
  {
    ctx.lineWidth = 1;
    ctx.fillStyle = timeline.colors.border.ring;
    ctx.strokeStyle = timeline.colors.border.darker;

    ctx.translate(inPx - 5, y);
    ctx.stroke(IN_POINT_PATH);
    ctx.fill(IN_POINT_PATH);

    const { dragging, pressed } = pointer.region(0, 0, 5, height);

    if (dragging) {
      assert(pointer.position, 'Mouse position must be set');
      assert(pointer.position?.state != 'idle', 'Mouse position must be pressing');

      beginGesture();

      const deltaFrames = pixelsToFrames(world, pointer.position.deltaX);

      setComponent(world, sid, c.Workarea, {
        start: workareaDragStart[0] + deltaFrames,
      });
    }

    if (pressed) {
      workareaDragStart = [start, stopFrame];
    }
  }
  {
    ctx.translate(outPx - inPx + 5, 0);
    ctx.stroke(OUT_POINT_PATH);
    ctx.fill(OUT_POINT_PATH);

    const { dragging, pressed } = pointer.region(0, 0, 5, height);

    if (dragging) {
      assert(pointer.position, 'Mouse position must be set');
      assert(pointer.position?.state != 'idle', 'Mouse position must be pressing');

      beginGesture();

      const deltaFrames = pixelsToFrames(world, pointer.position.deltaX);

      setComponent(world, sid, c.Workarea, {
        end: workareaDragStart[1] + deltaFrames,
      });
    }

    if (pressed) {
      workareaDragStart = [start, stopFrame];
    }
  }

  // No handle dragged this frame — close any open work-area transaction.
  if (workareaTxOpen && !anyDragging) {
    world.history.commitTransaction();
    workareaTxOpen = false;
  }

  ctx.restore();
}
