/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { KNOB_PATH } from "../paths";
import { getCurrentScrollX, getCurrentResolution, getCurrentFrame, framesToPixels } from "../utils";
import { RULER_HEIGHT } from "../config";

import type { EngineWorld } from "../../api/world";
import type { TimelineContext } from "../world";

// Rounded-rect knob shown while the timeline is minimized
const PILL_TOP = 8;
const PILL_HEIGHT = 19;
const PILL_PADDING_X = 4;
const PILL_RADIUS = 9;
const PILL_CHAR_WIDTH = 6;

// Critically-damped spring state for gradient width
const GRADIENT_PX_PER_VELOCITY = 25;
const GRADIENT_RESPONSE_TIME = 0.15;
const GRADIENT_MAX_WIDTH = 150;
let gradientWidthValue = 0;
let gradientWidthVelocity = 0;
let lastSampledFrame = 0;
let lastFrameTimestamp = 0;

export function renderPlayhead(world: EngineWorld, timeline: TimelineContext) {
  const ctx = timeline.ctx!;
  const canvas = timeline.canvas!;

  const currentTime = getCurrentFrame(world);
  const scrollX = getCurrentScrollX(world);
  const resolution = getCurrentResolution(world);

  ctx.save();

  const x = framesToPixels(world, currentTime);

  ctx.translate(-(scrollX * resolution), 0);
  ctx.translate(x, 0);

  if (timeline.minimized) {
    renderMinimizedPlayhead(timeline, currentTime);
    ctx.restore();
    return;
  }

  // Draw knob
  {
    ctx.save();

    ctx.translate(-5, 2);

    ctx.fillStyle = timeline.colors.border.ring;
    ctx.strokeStyle = timeline.colors.border.darker;
    ctx.lineWidth = 2;
    ctx.stroke(KNOB_PATH);
    ctx.fill(KNOB_PATH);

    ctx.restore();
  }

  // Draw playhead line
  {
    ctx.translate(0, RULER_HEIGHT);

    // Critically-damped spring on signed gradient width, driven by measured playhead velocity.
    // Sign carries direction; magnitude reflects actual motion (handles play/pause, scrub, speed change).
    const now = performance.now();
    const realDt = lastFrameTimestamp ? (now - lastFrameTimestamp) / 1000 : 0;
    lastFrameTimestamp = now;

    const fps = world.frameRate;
    const deltaSeconds = (currentTime - lastSampledFrame) / fps;
    const measuredVelocity = realDt > 0 ? deltaSeconds / realDt : 0;
    lastSampledFrame = currentTime;

    let target = GRADIENT_PX_PER_VELOCITY * measuredVelocity;
    if (target > GRADIENT_MAX_WIDTH) {
      target = GRADIENT_MAX_WIDTH;
    } else if (target < -GRADIENT_MAX_WIDTH) {
      target = -GRADIENT_MAX_WIDTH;
    }

    // Closed-form critically-damped spring step — unconditionally stable for any dt.
    if (realDt > 0) {
      const omega = 2 / GRADIENT_RESPONSE_TIME;
      const dt = Math.min(realDt, 0.25);
      const decay = Math.exp(-omega * dt);
      const error = gradientWidthValue - target;
      const b = gradientWidthVelocity + omega * error;
      gradientWidthValue = target + (error + b * dt) * decay;
      gradientWidthVelocity = (gradientWidthVelocity - omega * b * dt) * decay;
    }

    const absWidth = Math.abs(gradientWidthValue);
    if (absWidth > 0.5) {
      const reverse = gradientWidthValue < 0;
      const startX = reverse ? absWidth : -absWidth;

      const gradient = ctx.createLinearGradient(startX, 0, 0, 0);
      gradient.addColorStop(0, timeline.colors.border.ring + '00');
      gradient.addColorStop(1, timeline.colors.border.ring);

      ctx.fillStyle = gradient;
      ctx.globalAlpha = 0.16;
      ctx.fillRect(reverse ? 0 : -absWidth, 0, absWidth, canvas.height);
      ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, canvas.height);
    ctx.closePath();

    ctx.strokeStyle = timeline.colors.border.darker;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.strokeStyle = timeline.colors.border.ring;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();
}

function renderMinimizedPlayhead(timeline: TimelineContext, currentTime: number) {
  const ctx = timeline.ctx!;

  const label = `${Math.round(currentTime)}`;

  ctx.font = '400 10px JetBrains Mono';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const width = label.length * PILL_CHAR_WIDTH + PILL_PADDING_X * 2;

  ctx.beginPath();
  ctx.moveTo(0, PILL_TOP + PILL_HEIGHT);
  ctx.lineTo(0, RULER_HEIGHT);

  ctx.strokeStyle = timeline.colors.border.input;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.strokeStyle = timeline.colors.border.ring;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.roundRect(-width / 2, PILL_TOP, width, PILL_HEIGHT, PILL_RADIUS);

  ctx.fillStyle = timeline.colors.border.ring;
  ctx.strokeStyle = timeline.colors.border.darker;
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'white';
  ctx.fillText(label, 0, PILL_TOP + PILL_HEIGHT / 2 + 0.5);
}
