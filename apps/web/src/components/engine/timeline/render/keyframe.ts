/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { KEYFRAME_TRACK_HEIGHT } from "../config";
import { getRelativeViewport, pixelsToFrames, framesToPixels, getClipTransform } from "../utils";
import { hasComponent } from "bitecs";
import { addComponent, clearComponent, removeComponent, setComponent } from "../../api/events";

import type { EngineWorld } from "../../api/world";
import type { TimelineContext } from "../world";

const KEYFRAME_COLOR = '#9E9E9E';
const KEYFRAME_SIZE = 8;
const KEYFRAME_HALF_SIZE = KEYFRAME_SIZE / 2;
const KEYFRAME_HITBOX_PADDING = 2;
const KEYFRAME_HITBOX_SIZE = KEYFRAME_SIZE + KEYFRAME_HITBOX_PADDING * 2;
const KEYFRAME_HITBOX_HALF_SIZE = KEYFRAME_HITBOX_SIZE / 2;

export function renderKeyframeTrack(
  world: EngineWorld,
  timeline: TimelineContext,
  trackEid: number,
  clipEid: number | null,
) {
  if (!clipEid) return;

  const ctx = timeline.ctx!;
  const pointer = timeline.pointer!;

  const c = world.components;
  const keyframeEids = c.Cache.keyframes[trackEid];
  if (!keyframeEids?.length) return;

  const transform = getClipTransform(world, timeline);
  if (!transform) return;

  const [vpl, vpr] = getRelativeViewport(world, timeline);
  const delay = c.Computed.delay[clipEid] ?? 0;
  const playbackRate = c.PlaybackRate[clipEid] ?? 1;
  const rowCenterY = KEYFRAME_TRACK_HEIGHT / 2;
  const firstFrame = c.Keyframe.time[keyframeEids[0]];
  const lastFrame = c.Keyframe.time[keyframeEids[keyframeEids.length - 1]];

  ctx.save();
  ctx.setTransform(transform);
  ctx.lineWidth = 1;

  if (hasComponent(world, trackEid, c.Hovering)) {
    ctx.fillStyle = timeline.colors.background.muted;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(vpl, 0, vpr - vpl, KEYFRAME_TRACK_HEIGHT);
    ctx.globalAlpha = 1;
  }

  pointer.scope(String(trackEid));

  for (const kid of keyframeEids) {
    const kfTime = c.Keyframe.time[kid] ?? 0;
    const absoluteFrame = delay + kfTime / playbackRate;
    const x = framesToPixels(world, absoluteFrame);

    if (x + KEYFRAME_HITBOX_HALF_SIZE < vpl || x - KEYFRAME_HITBOX_HALF_SIZE > vpr) continue;

    const { intersectsMarquee, clicked, dragging } = pointer.region(
      x - KEYFRAME_HITBOX_HALF_SIZE,
      rowCenterY - KEYFRAME_HITBOX_HALF_SIZE,
      KEYFRAME_HITBOX_SIZE,
      KEYFRAME_HITBOX_SIZE,
      String(kid),
    );

    const isKeyframeSelected = hasComponent(world, kid, c.Selected);

    if (intersectsMarquee && !isKeyframeSelected) {
      addComponent(world, kid, c.Selected, false);
    }
    if (timeline.marquee && !intersectsMarquee && isKeyframeSelected) {
      removeComponent(world, kid, c.Selected, false);
    }

    if (clicked && pointer.shiftPressed) {
      addComponent(world, kid, c.Selected, false);
    }
    if (clicked && !pointer.shiftPressed) {
      clearComponent(world, c.Selected, false);
      addComponent(world, kid, c.Selected, false);
    }

    if (dragging && !hasComponent(world, kid, c.KeyframeDragOrigin)) {
      world.history.startTransaction('Move keyframes');
      setComponent(world, kid, c.KeyframeDragOrigin, { time: kfTime }, false);
    }

    if (hasComponent(world, kid, c.KeyframeDragOrigin) && pointer.position && pointer.position.state !== 'idle') {
      const target = c.KeyframeDragOrigin.time[kid] + pixelsToFrames(world, pointer.position.deltaX) * playbackRate;
      setComponent(world, kid, c.Keyframe, { time: target });
    }

    const keyframeColor = isKeyframeSelected ? timeline.colors.border.ring : KEYFRAME_COLOR;
    ctx.strokeStyle = keyframeColor;
    ctx.fillStyle = keyframeColor;
    ctx.beginPath();
    ctx.moveTo(x, rowCenterY - KEYFRAME_HALF_SIZE);
    ctx.lineTo(x + KEYFRAME_HALF_SIZE, rowCenterY);
    ctx.lineTo(x, rowCenterY + KEYFRAME_HALF_SIZE);
    ctx.lineTo(x - KEYFRAME_HALF_SIZE, rowCenterY);
    ctx.closePath();
    ctx.stroke();

    const isFirst = kfTime === firstFrame;
    const isLast = kfTime === lastFrame;

    if (!isFirst && !isLast) {
      ctx.fill();
    } else if (isFirst && isLast) {
      ctx.fill();
    } else if (isFirst) {
      ctx.beginPath();
      ctx.moveTo(x, rowCenterY - KEYFRAME_HALF_SIZE);
      ctx.lineTo(x + KEYFRAME_HALF_SIZE, rowCenterY);
      ctx.lineTo(x, rowCenterY + KEYFRAME_HALF_SIZE);
      ctx.closePath();
      ctx.fill();
    } else if (isLast) {
      ctx.beginPath();
      ctx.moveTo(x, rowCenterY - KEYFRAME_HALF_SIZE);
      ctx.lineTo(x - KEYFRAME_HALF_SIZE, rowCenterY);
      ctx.lineTo(x, rowCenterY + KEYFRAME_HALF_SIZE);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.restore();
}
