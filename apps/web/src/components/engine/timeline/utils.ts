/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hasComponent } from "bitecs";
import { DEFAULT_CLIP_HEIGHT, DEFAULT_TIMELINE_RESOLUTION, KEYFRAME_TRACK_HEIGHT, RULER_HEIGHT, TIMELINE_PADDING_LEFT } from "./config";
import { addComponent } from "../api/events";

import type { TimelineContext } from "./world";
import type { EngineWorld } from "../api/world";
import type { TimelineNode } from "../api/timeline-index";

export function getCurrentFrame(world: EngineWorld) {
  const sid = world.selection.scene;
  if (sid === null) return 0;
  return world.components.Computed.localTime[sid];
}

export function setCurrentFrame(world: EngineWorld, frame: number) {
  const sid = world.selection.scene;
  const fps = world.frameRate;
  if (sid === null) return;
  const clamped = Math.max(0, frame);
  world.components.Computed.localTime[sid] = clamped;
  world.components.Computed.localTimeInSeconds[sid] = clamped / fps;
}

export function getCurrentResolution(world: EngineWorld) {
  const sid = world.selection.scene;
  if (sid === null) return DEFAULT_TIMELINE_RESOLUTION;
  return world.components.Timeline.resolution[sid] ?? DEFAULT_TIMELINE_RESOLUTION;
}


export function getCurrentScrollX(world: EngineWorld) {
  const sid = world.selection.scene;
  if (sid === null) return -TIMELINE_PADDING_LEFT / getCurrentResolution(world);
  return world.components.Timeline.scrollX[sid] ?? 0;
}

export function getCurrentScrollY(world: EngineWorld) {
  const sid = world.selection.scene;
  if (sid === null) return 0;
  return world.components.Timeline.scrollY[sid] ?? 0;
}

export function getRelativeViewport(world: EngineWorld, timeline: TimelineContext): [number, number] {
  const scrollX = getCurrentScrollX(world);
  const resolution = getCurrentResolution(world);
  const left = scrollX * resolution;

  const right = left + timeline.layout.width;
  return [left, right];
}


export function framesToPixels(world: EngineWorld, frames: number = 0) {
  const resolution = getCurrentResolution(world);
  return Math.floor(frames * resolution);
}

export function pixelsToFrames(world: EngineWorld, pixels: number) {
  const resolution = getCurrentResolution(world);
  return Math.round(pixels / resolution);
}

export function clientToWorldX(world: EngineWorld, timeline: TimelineContext, clientX: number) {
  const scrollX = getCurrentScrollX(world);
  const resolution = getCurrentResolution(world);
  return clientX - (timeline.layout?.left ?? 0) + scrollX * resolution;
}

export function clientToWorldY(world: EngineWorld, timeline: TimelineContext, clientY: number) {
  const scrollY = getCurrentScrollY(world);
  return clientY - (timeline.layout?.top ?? 0) + scrollY;
}

export function getClipTransform(world: EngineWorld, timeline: TimelineContext): DOMMatrix | undefined {
  const c = world.components;
  const sid = world.selection.scene ?? -1;
  const transform = c.Timeline.transform[sid];
  return transform?.translate(0, timeline.currentLayerTop);
}

export function getNodeHeight(world: EngineWorld, node: TimelineNode) {
  if (node.kind === 'geometry') {
    return world.components.ClipHeight[node.eid] ?? DEFAULT_CLIP_HEIGHT;
  }
  return KEYFRAME_TRACK_HEIGHT;
}

/**
 * Total height of a row plus all of its (expanded) descendant rows.
 */
export function getSubtreeHeight(world: EngineWorld, node: TimelineNode): number {
  let height = getNodeHeight(world, node);
  for (const child of node.children) {
    height += getSubtreeHeight(world, child);
  }
  return height;
}

export function updateTimelineTransform(world: EngineWorld) {
  const sid = world.selection.scene;
  if (sid === null) return;

  const c = world.components;

  if (!hasComponent(world, sid, c.Timeline)) {
    addComponent(world, sid, c.Timeline, false);
    c.Timeline.resolution[sid] = DEFAULT_TIMELINE_RESOLUTION;
    c.Timeline.scrollX[sid] = -TIMELINE_PADDING_LEFT / DEFAULT_TIMELINE_RESOLUTION;
    c.Timeline.scrollY[sid] = 0;
    c.Timeline.transform[sid] = new DOMMatrix();
  }

  const resolution = c.Timeline.resolution[sid];
  const scrollX = c.Timeline.scrollX[sid];
  const scrollY = c.Timeline.scrollY[sid];
  const dpr = window.devicePixelRatio;

  const transform = new DOMMatrix();
  transform.scaleSelf(dpr, dpr);
  transform.translateSelf(-(scrollX * resolution), -scrollY);
  transform.translateSelf(0, RULER_HEIGHT);
  c.Timeline.transform[sid] = transform;
}

const TEXT_WIDTH_CACHE: Map<string, number> = new Map();

// Widths measured before web fonts finish loading reflect the fallback font and
// will under-report once the real font swaps in, causing labels to overflow.
document?.fonts.addEventListener('loadingdone', () => TEXT_WIDTH_CACHE.clear());

export function binarySearchTextLength(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  cacheId: string = 'default'
): string | null {
  const getTextWidth = (text: string) => {
    const cacheKey = `${cacheId}-${text}`;

    if (TEXT_WIDTH_CACHE.has(cacheKey)) {
      return TEXT_WIDTH_CACHE.get(cacheKey)!;
    }

    const width = ctx.measureText(text).width;
    TEXT_WIDTH_CACHE.set(cacheKey, width);
    return width;
  }

  if (getTextWidth(text) > maxWidth) {
    const availableWidth = maxWidth - getTextWidth('...');

    if (availableWidth > 0) {
      // Binary search for optimal text length
      let start = 0;
      let end = text.length;
      let bestLength = 0;

      while (start <= end) {
        const mid = Math.floor((start + end) / 2);
        const testText = text.slice(0, mid);
        const testWidth = getTextWidth(testText);

        if (testWidth <= availableWidth) {
          bestLength = mid;
          start = mid + 1;
        } else {
          end = mid - 1;
        }
      }

      return bestLength > 0 ? text.slice(0, bestLength) + '...' : null;
    } else {
      return null;
    }
  }

  return text;
}
