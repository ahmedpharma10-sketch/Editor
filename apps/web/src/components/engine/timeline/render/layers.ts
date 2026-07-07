/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { DEFAULT_CLIP_HEIGHT } from "../config";
import { getRelativeViewport, pixelsToFrames, getClipTransform, getNodeHeight, getSubtreeHeight } from "../utils";
import { clearAudioCache } from "./audio";
import { clearThumbnailCache } from "./video";
import { renderClip } from "./clip";
import { hasComponent, Not, Or, query } from "bitecs";
import { removeComponent, setComponent } from "../../api/events";
import { resolveSequentialOverlaps } from "../../api/overlap";
import { ChildOf } from "../../components";
import { renderKeyframeTrack } from "./keyframe";

import type { EngineWorld } from "../../api/world";
import type { TimelineNode } from "../../api/timeline-index";
import type { TimelineContext } from "../world";

const VIEWPORT_PADDING = 10; // 10 pixels

export function renderLayers(world: EngineWorld, timeline: TimelineContext) {
  const ctx = timeline.ctx!;

  const c = world.components;
  const scene = world.selection.scene;

  if (scene === null) return;

  ctx.save();

  const [left, right] = getRelativeViewport(world, timeline);
  const minFrame = pixelsToFrames(world, left - VIEWPORT_PADDING);
  const maxFrame = pixelsToFrames(world, right + VIEWPORT_PADDING);

  const dragging = isPointerDragging(timeline);

  const clipDragItems = [...query(world, [Or(c.Geometry, c.Group, c.AdjustmentLayer), c.ClipDragOrigin])];
  if (!dragging) {
    if (clipDragItems.length > 0) {
      for (const cid of clipDragItems) {
        removeComponent(world, cid, c.ClipDragOrigin, false);
      }
      resolveSequentialOverlaps(world, clipDragItems);
      world.history.commitTransaction();
    }
  } else {
    for (const cid of clipDragItems) {
      if (hasComponent(world, cid, c.Selected)) {
        // case multidrag — snapshot origin once per newly-tagged sibling so
        // subsequent frames keep applying target = origin + delta absolutely.
        for (const sid of query(world, [c.Selected, Or(c.Geometry, c.Group, c.AdjustmentLayer), Not(c.ClipDragOrigin)])) {
          setComponent(world, sid, c.ClipDragOrigin, {
            delay: c.Delay[sid] ?? 0,
            start: c.Computed.start[sid] ?? 0,
            end: c.Computed.end[sid] ?? 0,
          }, false);
        }
      }
    }
  }

  // Keyframe drag management
  const keyframeDragItems = [...query(world, [c.Keyframe, c.KeyframeDragOrigin])];
  if (!dragging) {
    if (keyframeDragItems.length > 0) {
      // Drag has ended — close the 'Move keyframes' transaction opened in
      // renderKeyframeTrack.
      for (const kid of keyframeDragItems) {
        removeComponent(world, kid, c.KeyframeDragOrigin, false);
      }
      world.history.commitTransaction();
    }
  } else {
    for (const kid of keyframeDragItems) {
      if (hasComponent(world, kid, c.Selected)) {
        // case multidrag — snapshot originFrame once per newly-tagged keyframe
        // so subsequent frames keep applying target = origin + delta absolutely.
        for (const skid of query(world, [c.Selected, c.Keyframe, Not(c.KeyframeDragOrigin)])) {
          setComponent(world, skid, c.KeyframeDragOrigin, { time: c.Keyframe.time[skid] ?? 0 }, false);
        }
      }
    }
  }

  timeline.currentLayerTop = 0;

  const renderNodes = (nodes: TimelineNode[], clipEid: number | null) => {
    for (const node of nodes) {
      if (node.kind === 'keyframe-track') {
        renderKeyframeTrack(world, timeline, node.eid, clipEid);
        timeline.currentLayerTop += getNodeHeight(world, node);
        continue;
      }

      if (node.kind === 'sub-item') {
        timeline.currentLayerTop += getNodeHeight(world, node);
        renderNodes(node.children, clipEid);
        continue;
      }

      const start = c.Computed.start[node.eid];
      const end = c.Computed.end[node.eid];

      if (end < minFrame || start > maxFrame) {
        clearThumbnailCache(node.eid);
        clearAudioCache(node.eid);
        timeline.currentLayerTop += getSubtreeHeight(world, node);
        continue;
      }

      // Don't render expanded children of a sequential container.
      if (clipEid === null || !hasComponent(world, clipEid, c.Sequential)) {
        renderLayer(world, timeline, node.eid);
      }

      timeline.currentLayerTop += getNodeHeight(world, node);
      renderNodes(node.children, node.eid);
    }
  }

  renderNodes(world.timelineIndex().layers, null);

  ctx.restore();
}

/**
 * Render one timeline row. For a regular clip, this is just renderClip with
 * the row's transform applied. For a GROUP, the row becomes a horizontal
 * track: the group itself isn't drawn, and each of its direct children is
 * rendered as a clip inside the group's row (sharing its transform and
 * row height).
 */
function renderLayer(world: EngineWorld, timeline: TimelineContext, layerEid: number) {
  const c = world.components;
  const ctx = timeline.ctx!;

  const transform = getClipTransform(world, timeline);
  if (!transform) return;
  ctx.setTransform(transform);

  timeline.currentLayerHeight = c.ClipHeight[layerEid] ?? DEFAULT_CLIP_HEIGHT;
  ctx.globalAlpha = hasComponent(world, layerEid, c.Hidden) ? 0.5 : 1;

  if (hasComponent(world, layerEid, c.Hovering)) {
    const [vpl, vpr] = getRelativeViewport(world, timeline);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = timeline.colors.background.accent;
    ctx.fillRect(vpl, 0, vpr - vpl, timeline.currentLayerHeight);
    ctx.globalAlpha = 1;
  }

  if (!hasComponent(world, layerEid, c.Sequential)) {
    timeline.currentClip = layerEid;
    renderClip(world, timeline, layerEid);
    return;
  }

  const deferred: number[] = [];
  for (const cid of query(world, [Or(c.Geometry, c.Group, c.AdjustmentLayer), ChildOf(layerEid), Not(c.Deleted)])) {
    if (hasComponent(world, cid, c.ClipDragOrigin) || hasComponent(world, cid, c.TrimDragOrigin)) {
      deferred.push(cid);
      continue;
    }
    timeline.currentClip = cid;
    renderClip(world, timeline, cid);
  }

  for (const cid of deferred) {
    timeline.currentClip = cid;
    renderClip(world, timeline, cid);
  }
}


function isPointerDragging(timeline: TimelineContext) {
  const pointer = timeline.pointer!;
  return !!pointer.position && pointer.position.state !== 'idle';
}
