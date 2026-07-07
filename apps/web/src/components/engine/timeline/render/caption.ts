/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { binarySearchTextLength, framesToPixels } from "../utils";
import { CaptionType } from "../../components";
import { isCaption } from "../../api";
import { CLIP_CORNER_RADIUS, CLIP_FONT, CLIP_BREAKPOINTS, CLIP_LABEL_HEIGHT } from "../config";
import { getClipStyle } from "./clip";
import { secondsToFrames } from "../../utils";

import type { EngineWorld } from "../../api/world";
import type { TimelineContext } from "../world";

const NAME_MAP: Record<CaptionType, string> = {
  [CaptionType.CLASSIC]: 'Classic',
  [CaptionType.CASCADE]: 'Cascade',
  [CaptionType.SPOTLIGHT]: 'Spotlight',
  [CaptionType.WHISPER]: 'Whisper',
  [CaptionType.PAPER]: 'Paper',
  [CaptionType.GUINEA]: 'Guinea',
  [CaptionType.STARK]: 'Stark',
} as const;

const GROUP_GAP = 2;
const GROUP_PADDING = 8;
const GROUP_PADDING_TOP = 12;

export function renderCaption(world: EngineWorld, timeline: TimelineContext, eid: number) {
  const ctx = timeline.ctx!;
  const c = world.components;

  if (!isCaption(world, eid)) return;

  const decoder = c.CaptionDecoder[eid];
  const groups = decoder?.groups;
  if (!groups?.length) return;

  const start = c.Computed.start[eid];
  const end = c.Computed.end[eid];
  const layerHeight = timeline.currentLayerHeight;

  const clipLeft = framesToPixels(world, start);
  const clipRight = framesToPixels(world, end);
  const delay = c.Computed.delay[eid];

  const style = getClipStyle(world, timeline, eid, null);

  ctx.save();

  // Clip to the caption clip bounds
  ctx.beginPath();
  ctx.roundRect(clipLeft, 0, clipRight - clipLeft, layerHeight, CLIP_CORNER_RADIUS);
  ctx.clip();

  for (const group of groups) {
    if (!group.length) continue;

    const groupStart = secondsToFrames(group[0]?.start) + delay;
    const groupEnd = secondsToFrames(group[group.length - 1]?.end) + delay;

    // Skip groups outside the clip range
    if (groupEnd < start || groupStart >= end) continue;

    const clampedStart = Math.max(groupStart, start);
    const clampedEnd = Math.min(groupEnd, end);
    const groupX = framesToPixels(world, clampedStart);
    const groupWidth = framesToPixels(world, clampedEnd) - groupX;
    const groupY = layerHeight < CLIP_BREAKPOINTS.sm ? GROUP_PADDING_TOP : CLIP_LABEL_HEIGHT;
    const groupHeight = layerHeight - groupY - 1;

    if (groupWidth < 2 || groupHeight < 4) continue;

    // Word group background
    ctx.beginPath();
    ctx.roundRect(groupX, groupY, groupWidth - GROUP_GAP, groupHeight, CLIP_CORNER_RADIUS);
    ctx.closePath();

    ctx.fillStyle = style.primary!;
    ctx.fill();

    // Word group text
    const groupText = group.map(w => w.text).join(' ');
    ctx.fontStretch = 'ultra-condensed';
    ctx.font = CLIP_FONT;
    ctx.fillStyle = style.foreground;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const text = binarySearchTextLength(ctx, groupText, groupWidth - GROUP_PADDING);
    if (text) {
      ctx.fillText(text, groupX + 4, groupY + Math.round(groupHeight / 2));
    }
  }

  // Let's assing the name of the clip here to avoid another branch in the main clip function
  {
    const type = c.Caption.type[eid] ?? CaptionType.CLASSIC;
    c.Name[eid] = NAME_MAP[type as CaptionType] + ' Captions';
  }

  ctx.restore();
}
