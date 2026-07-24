/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { assert } from "@/utils";
import { RULER_INTERVALS } from "../constants";
import { RULER_HEIGHT, RULER_LABEL_Y, RULER_TICK_HEIGHT_MAJOR, RULER_TICK_HEIGHT_MINOR, TARGET_MAJOR_TICK_DISTANCE } from "../config";
import { pixelsToFrames, framesToPixels, getRelativeViewport, getCurrentScrollX, getCurrentResolution, setCurrentFrame } from "../utils";
import { setComponent } from "../../api/events";

import type { EngineWorld } from "../../api/world";
import type { TimelineContext } from "../world";

// Tracks the open 'Set work area' gesture transaction across frames so the
// whole shift-drag collapses into a single undo step.
let workareaTxOpen = false;

export function renderRuler(world: EngineWorld, timeline: TimelineContext) {
  const ctx = timeline.ctx!;
  const pointer = timeline.pointer!;

  const scrollX = getCurrentScrollX(world);
  const resolution = getCurrentResolution(world);

  const c = world.components;

  const fps = world.frameRate;
  const scene = world.selection.scene;

  ctx.save();

  ctx.translate(-(scrollX * resolution), 0);

  const layout = getRulerLayout(world);
  const [minX, maxX] = getRelativeViewport(world, timeline);

  const { dragging, clicked } = pointer
    .scope('ruler')
    .region(minX, 0, maxX - minX, RULER_HEIGHT);

  if (clicked || (dragging && !pointer.shiftPressed)) {
    assert(pointer.position, 'Mouse position must be set');

    const frame = pixelsToFrames(
      world,
      pointer.position.currentX + scrollX * resolution
    );

    if (scene !== null) {
      c.Playback.playing[scene] = 0;
    }
    setCurrentFrame(world, frame);
  }

  if (scene !== null && dragging && pointer.shiftPressed) {
    assert(pointer.position, 'Mouse position must be set');
    assert(pointer.position?.state != 'idle', 'Mouse position must be pressing');

    if (!workareaTxOpen) {
      world.history.startTransaction('Set work area');
      workareaTxOpen = true;
    }

    const newStart = pixelsToFrames(world, pointer.position.initialX + scrollX * resolution);
    const newStop = pixelsToFrames(world, pointer.position.currentX + scrollX * resolution);
    setComponent(world, scene, c.Workarea, { start: newStart, end: newStop });

    if (pointer.position.currentX > pointer.position.initialX) {
      setCurrentFrame(world, newStop);
    } else {
      setCurrentFrame(world, newStart);
    }
  } else if (workareaTxOpen) {
    // Shift-drag ended — close the gesture transaction.
    world.history.commitTransaction();
    workareaTxOpen = false;
  }

  const firstFrame = pixelsToFrames(world, minX);
  const lastFrame = pixelsToFrames(world, maxX);
  const frameInterval = Math.max(1, Math.round(layout.numerator / layout.denominator));

  const majorOffset = RULER_HEIGHT - RULER_TICK_HEIGHT_MAJOR;
  const minorOffset = RULER_HEIGHT - RULER_TICK_HEIGHT_MINOR;

  ctx.font = '300 10px JetBrains Mono';
  ctx.fillStyle = timeline.colors.ruler.text;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  const start = Math.floor(firstFrame / frameInterval) * frameInterval;
  for (let frame = start; frame <= lastFrame; frame += frameInterval) {
    const x = framesToPixels(world, frame);
    let y = minorOffset;

    if (frame % layout.numerator === 0) {
      y = majorOffset;
      const label = formatTickLabel(frame, fps);
      ctx.fillText(label, x, RULER_LABEL_Y);
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = timeline.colors.ruler.tick;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, RULER_HEIGHT);
    ctx.stroke();
  }

  ctx.restore();
}


function formatTickLabel(frame: number, fps: number) {
  if (frame === 0) {
    return '0';
  }

  if (frame % fps != 0) {
    // this means its in frames
    return `${frame}f`;
  }

  const minutes = Math.floor(Math.round(frame / fps) / 60).toString().padStart(2, '0');
  const seconds = Math.floor(Math.round(frame / fps) % 60).toString().padStart(2, '0');

  return `${minutes}:${seconds}`;
}

function getRulerLayout(world: EngineWorld) {
  let interval: typeof RULER_INTERVALS[number] | null = null;

  for (const value of RULER_INTERVALS) {
    if (!interval) {
      interval = value;
      continue;
    }

    const currentDistance = framesToPixels(world, interval.numerator);
    const currentDelta = Math.abs(currentDistance - TARGET_MAJOR_TICK_DISTANCE);

    const distance = framesToPixels(world, value.numerator);
    const delta = Math.abs(distance - TARGET_MAJOR_TICK_DISTANCE);


    if (delta < currentDelta) {
      interval = value;
    }
  }

  assert(interval, 'No ruler interval found');

  return interval;
}
