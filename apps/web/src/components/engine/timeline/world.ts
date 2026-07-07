/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { COLORS } from "./constants";
import { DEFAULT_CLIP_HEIGHT } from "./config";

import type { CursorType } from "@/hooks/use-cursor";
import type { Pointer } from "./pointer";

export type Marquee = {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TimelineContext = ReturnType<typeof createTimelineContext>;

export function createTimelineContext() {
  return {
    colors: COLORS,
    snapping: true,
    snapDistance: 10,
    snapX: null as number | null,
    currentClip: null as number | null,
    currentLayerTop: 0,
    currentLayerHeight: DEFAULT_CLIP_HEIGHT,
    cursor: 'default' as CursorType,
    canvas: null as HTMLCanvasElement | null,
    ctx: null as CanvasRenderingContext2D | null,
    layout: new DOMRect(),
    pointer: null as Pointer | null,
    marquee: undefined as Marquee | undefined,
  };
}
