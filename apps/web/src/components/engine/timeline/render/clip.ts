/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { assert, clamp } from "@/utils";
import { binarySearchTextLength, getCurrentFrame, getRelativeViewport, pixelsToFrames, framesToPixels } from "../utils";
import { secondsToFrames, computeTrimEnd, computeTrimStart } from "../../utils";
import { CLIP_BREAKPOINTS, CLIP_CORNER_RADIUS, CLIP_FONT, CLIP_LABEL_HEIGHT, CLIP_LABEL_X, CLIP_LABEL_Y } from "../config";
import { renderImageThumbnails } from "./image";
import { renderAudioWaveform } from "./audio";
import { renderVideoThumbnails } from "./video";
import { getParentEntity, isAdjustmentLayer, isCaption, isGroup, isMask, isScene, isText } from "../../api";
import { renderCaption } from "./caption";
import { hasComponent, Not, Or, query } from "bitecs";
import { addComponent, clearComponent, removeComponent, setComponent } from "../../api/events";
import { resolveSequentialOverlaps } from "../../api/overlap";
import { renderGroup } from "./group";

import type { EngineWorld } from "../../api/world";
import type { TimelineContext } from "../world";
import type { Asset } from "../../db";
import { ChildOf } from "../../components";

const TRIM_AREA_WIDTH = 10;

export function renderClip(world: EngineWorld, timeline: TimelineContext, eid: number) {
  const ctx = timeline.ctx!;
  const pointer = timeline.pointer!;

  const c = world.components;
  const scene = world.selection.scene;

  if (scene === null) return;

  const start = c.Computed.start[eid];
  const end = c.Computed.end[eid];

  let clipLeft = framesToPixels(world, start);
  const clipRight = framesToPixels(world, end);
  const clipWidth = clipRight - clipLeft;
  // Plain text nodes label with their content; captions label with their name
  // (set by the caption renderer to "{preset} Captions").
  const label = isText(world, eid) && !isCaption(world, eid)
    ? (c.Chars[eid] ?? c.Name[eid] ?? '')
    : (c.Name[eid] ?? '');

  pointer.scope(String(eid));

  const assetId = findAssetId(world, eid);
  const asset = world.assets.get(assetId ?? '') ?? null;
  const style = getClipStyle(world, timeline, eid, asset);

  // Handle background interactions
  {
    const { clicked, dragging, intersectsMarquee } = pointer.region(clipLeft, 0, clipWidth, timeline.currentLayerHeight);
    const clipIsSelected = hasComponent(world, eid, c.Selected);

    if (intersectsMarquee && !clipIsSelected) {
      addComponent(world, eid, c.Selected, false);
    }

    if (timeline.marquee && !intersectsMarquee && clipIsSelected) {
      removeComponent(world, eid, c.Selected, false);
    }

    if (clicked && pointer.shiftPressed) {
      addComponent(world, eid, c.Selected, false);
    }

    if (clicked && !pointer.shiftPressed) {
      clearComponent(world, c.Selected, false);
      addComponent(world, eid, c.Selected, false);
    }

    // Starts the drag interaction. Snapshot the original local delay and
    // start/end frames once so subsequent frames apply target =
    // originDelay + offsetFrames absolutely. Start/end snapshots
    // are needed because groups' visual edges aren't derivable from delay.
    if (dragging && !hasComponent(world, eid, c.ClipDragOrigin)) {
      // Open the gesture transaction once, when the grabbed clip starts
      // dragging. Every per-frame Delay write accumulates into it;
      // it commits in renderLayers when the drag ends.
      world.history.startTransaction('Move clip');
      setComponent(world, eid, c.ClipDragOrigin, {
        delay: c.Delay[eid] ?? 0,
        start: c.Computed.start[eid] ?? 0,
        end: c.Computed.end[eid] ?? 0,
      }, false);
    }
  }

  // Apply the drag live: write the snapped delay every frame
  if (hasComponent(world, eid, c.ClipDragOrigin) && pointer.position?.state !== 'idle') {
    const dragX = pointer.position?.deltaX ?? 0;
    const originDelay = c.ClipDragOrigin.delay[eid] ?? 0;
    const offsetFrames = pixelsToFrames(world, dragX);
    const snapFrameDelta = findSnapFrameDelta(world, timeline, offsetFrames);
    const newDelay = originDelay + offsetFrames - snapFrameDelta;

    // this should recompute the start frame
    setComponent(world, eid, c.Delay, newDelay);

    clipLeft = framesToPixels(world, c.Computed.start[eid]);
  }

  // Draw the background of the clip
  {
    ctx.save();

    ctx.beginPath();
    ctx.roundRect(clipLeft, 0, clipWidth, timeline.currentLayerHeight, CLIP_CORNER_RADIUS);
    ctx.closePath();

    ctx.fillStyle = style.background;
    ctx.fill();

    ctx.restore();
  }

  if (isGroup(world, eid)) {
    renderGroup(world, timeline, eid);
  } else if (asset?.type === 'IMAGE' || asset?.type === 'SEQUENCE') {
    renderImageThumbnails(world, timeline, eid, { asset });
  } else if (asset?.type === 'AUDIO') {
    renderAudioWaveform(world, timeline, eid, {
      asset,
      color: timeline.colors.clip.audio.primary,
      offsetY: timeline.currentLayerHeight > CLIP_BREAKPOINTS.sm ? CLIP_LABEL_HEIGHT : 2,
      padding: 4,
    });
  } else if (asset?.type === 'VIDEO') {
    renderVideoThumbnails(world, timeline, eid, { asset });
  }

  if (isCaption(world, eid)) {
    renderCaption(world, timeline, eid);
  }

  // Render the label
  if (!(isCaption(world, eid) && timeline.currentLayerHeight < CLIP_BREAKPOINTS.sm)) {
    ctx.save();

    const [vpl] = getRelativeViewport(world, timeline);
    const labelX = Math.max(clipLeft, vpl);
    const labelMaxWidth = clipLeft + clipWidth - labelX - 2 * CLIP_LABEL_X;

    ctx.translate(labelX, 0);

    ctx.fillStyle = style.foreground;
    ctx.fontStretch = 'ultra-condensed';
    ctx.font = CLIP_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const transformedLabel = binarySearchTextLength(ctx, label, labelMaxWidth);

    if (transformedLabel) {
      const h = timeline.currentLayerHeight;
      const labelY = h >= CLIP_BREAKPOINTS.xs ? CLIP_LABEL_Y : h / 2;
      ctx.fillText(transformedLabel, CLIP_LABEL_X, labelY);
    }

    ctx.restore();
  }

  // Draw the border last so it sits above thumbnails, waveforms, and labels
  {
    ctx.save();

    ctx.beginPath();
    ctx.roundRect(clipLeft, 0, clipWidth, timeline.currentLayerHeight, CLIP_CORNER_RADIUS);
    ctx.closePath();

    ctx.clip();
    ctx.strokeStyle = hasComponent(world, eid, c.Selected)
      ? timeline.colors.border.ring
      : timeline.colors.border.darker;
    ctx.lineWidth = hasComponent(world, eid, c.Selected) ? 2 : 1;

    ctx.stroke();

    ctx.restore();
  }

  // Handle trim — groups derive their range from children and aren't directly trimmable.
  {
    const trimAreaWidth = Math.min(Math.max(clipWidth / 3, 3), clipWidth / 2, TRIM_AREA_WIDTH);
    const isTrimming = hasComponent(world, eid, c.TrimDragOrigin);

    const { hovering: hoveringLeft, dragging: draggingLeft } = pointer.region(
      clipLeft,
      0,
      trimAreaWidth,
      timeline.currentLayerHeight,
    );

    const { hovering: hoveringRight, dragging: draggingRight } = pointer.region(
      clipLeft + clipWidth - trimAreaWidth,
      0,
      trimAreaWidth,
      timeline.currentLayerHeight,
    );

    if (hoveringLeft || draggingLeft) {
      timeline.cursor = 'trim-right';
    } else if (hoveringRight || draggingRight) {
      timeline.cursor = 'trim-left';
    }

    const dragging = draggingLeft || draggingRight;

    if (dragging && !isTrimming) {
      world.history.startTransaction('Trim');
      setComponent(world, eid, c.TrimDragOrigin, {
        start: start,
        end: end,
      }, false);
    }

    if (dragging && hasComponent(world, eid, c.TrimDragOrigin)) {
      assert(pointer.position, 'Mouse position must be set');
      assert(pointer.position.state != 'idle', 'Mouse position must be pressing');

      const deltaFrames = pixelsToFrames(world, pointer.position.deltaX);
      const initialStart = c.TrimDragOrigin.start[eid];
      const initialEnd = c.TrimDragOrigin.end[eid];

      let minFrame: number;
      let maxFrame: number;

      // In the motion-graphics model each clip is its own layer, so trim
      // bounds are no longer constrained by neighboring clips — only by the
      // clip's own range and (below) the underlying asset duration.
      if (draggingLeft) {
        minFrame = 0;
        maxFrame = initialEnd - 1;
      } else {
        minFrame = initialStart + 1;
        maxFrame = Number.POSITIVE_INFINITY;
      }

      if (asset && (asset.type === 'AUDIO' || asset.type === 'VIDEO' || asset.type === 'SEQUENCE')) {
        const delay = c.Computed.delay[eid];
        const playbackRate = c.PlaybackRate[eid] ?? 1;
        const assetDuration = secondsToFrames(asset.duration);
        const assetEnd = delay + assetDuration / playbackRate;

        if (draggingLeft) {
          minFrame = Math.max(minFrame, delay);
        } else {
          maxFrame = Math.min(maxFrame, assetEnd);
        }
      }

      let newFrame: number;
      if (draggingLeft) {
        newFrame = initialStart + deltaFrames;
      } else {
        newFrame = initialEnd + deltaFrames;
      }

      const snapPoints = getSnapFrames(world, timeline);
      const matchedPoint = snapPoints.find(({ frame }) => {
        const distance = framesToPixels(world, Math.abs(frame - newFrame))
        const snapStart = distance < timeline.snapDistance;
        const inRange = frame > minFrame && frame < maxFrame;

        return inRange && snapStart;
      });

      if (matchedPoint) {
        newFrame = matchedPoint.frame;
        const pointX = framesToPixels(world, newFrame);
        timeline.snapX = pointX;
      }

      const clampedValue = clamp(newFrame, minFrame, maxFrame);
      const clampedTrimStart = computeTrimStart(world, eid, clampedValue);
      const clampedTrimEnd = computeTrimEnd(world, eid, clampedValue);

      if (draggingLeft) {
        setComponent(world, eid, c.Trim, { start: clampedTrimStart });
      } else {
        setComponent(world, eid, c.Trim, { end: clampedTrimEnd });
      }
    }

    if (!dragging && isTrimming) {
      resolveSequentialOverlaps(world, [eid]);
      removeComponent(world, eid, c.TrimDragOrigin, false);
      world.history.commitTransaction();
    }
  }
}

type ClipStyle = {
  background: string;
  foreground: string;
  primary?: string;
}

export function getClipStyle(
  world: EngineWorld,
  timeline: TimelineContext,
  eid: number,
  asset: Asset | null
): ClipStyle {
  // Captions are text-geometry too, so check the more-specific tag first.
  if (isCaption(world, eid)) {
    return timeline.colors.clip.caption;
  }

  if (isText(world, eid)) {
    return timeline.colors.clip.text;
  }

  if (isScene(world, eid)) {
    return timeline.colors.clip.scene;
  }

  if (isGroup(world, eid)) {
    return timeline.colors.clip.group;
  }

  if (isMask(world, eid)) {
    return timeline.colors.clip.mask;
  }

  if (isAdjustmentLayer(world, eid)) {
    return timeline.colors.clip.adjustment;
  }

  if (asset?.type == 'VIDEO') {
    return timeline.colors.clip.video;
  }
  if (asset?.type == 'IMAGE') {
    return timeline.colors.clip.image;
  }
  if (asset?.type == 'AUDIO') {
    return timeline.colors.clip.audio;
  }

  return timeline.colors.clip.shape;
}

function getSnapFrames(world: EngineWorld, timeline: TimelineContext) {
  const c = world.components;
  const scene = world.selection.scene;

  if (!timeline.snapping || scene === null) return [];

  // Any entity whose time range moves with — or is derived from — an active
  // drag/trim is a useless snap target. Walk ancestors (groups whose extents
  // come from their children) and descendants (children that shift along
  // with their dragged parent group) of every active item.
  const activeItems = [
    ...query(world, [Or(c.Geometry, c.Group, c.AdjustmentLayer), c.ClipDragOrigin]),
    ...query(world, [Or(c.Geometry, c.Group, c.AdjustmentLayer), c.TrimDragOrigin]),
  ];
  const excluded = new Set<number>();
  for (const item of activeItems) {
    let parent = getParentEntity(world, item);
    while (parent !== null && parent !== scene) {
      excluded.add(parent);
      parent = getParentEntity(world, parent);
    }
    for (const descendant of getSceneChildren(world, item)) {
      excluded.add(descendant);
    }
  }

  const availableClips = getSceneChildren(world, scene)
    .filter(cid => {
      if (hasComponent(world, cid, c.ClipDragOrigin)) return false;
      if (hasComponent(world, cid, c.TrimDragOrigin)) return false;
      if (hasComponent(world, cid, c.Selected)) return false;
      if (excluded.has(cid)) return false;
      return true;
    });

  const snapPoints = new Map<number, number | null>();
  snapPoints.set(0, null);
  snapPoints.set(getCurrentFrame(world), null);

  for (const cid of availableClips) {
    snapPoints.set(c.Computed.start[cid], cid);
    snapPoints.set(c.Computed.end[cid], cid);
  }

  return Array.from(snapPoints.entries()).map(([frame, clipEid]) => ({ frame, clipEid }));
}

/**
 * Find the frame-space adjustment needed to snap the active drag to a
 * nearby reference point. Returns the signed frame delta (candidate edge -
 * snap point) the caller must subtract from its offsetFrames to land on the
 * snap target, or 0 if nothing is in range.
 *
 * Doing this in frame space (not pixel space) avoids a floor/round
 * round-trip that otherwise jitters the clip by ±1 frame near the snap
 * point at fractional resolutions.
 */
function findSnapFrameDelta(world: EngineWorld, timeline: TimelineContext, offsetFrames: number) {
  const c = world.components;

  // Candidates: each dragging item contributes its snapshotted start and end
  // frame shifted by the current drag offset. Using snapshots (rather than
  // reconstructing from delay + trim) keeps groups correct — their visual
  // edges come from children, not their own delay.
  const dragItems = query(world, [Or(c.Geometry, c.Group, c.AdjustmentLayer), c.ClipDragOrigin]);
  const snapCandidates = new Set<number>();
  for (const itemEid of dragItems) {
    const originStart = c.ClipDragOrigin.start[itemEid] ?? 0;
    const originEnd = c.ClipDragOrigin.end[itemEid] ?? 0;
    snapCandidates.add(originStart + offsetFrames);
    snapCandidates.add(originEnd + offsetFrames);
  }

  const snapPoints = getSnapFrames(world, timeline);

  let bestMatch: { snapFrame: number; frameDelta: number; pxDelta: number } | null = null;
  for (const point of snapPoints) {
    for (const candidate of snapCandidates) {
      const frameDelta = candidate - point.frame;
      const pxDelta = framesToPixels(world, frameDelta);
      if (Math.abs(pxDelta) >= timeline.snapDistance) continue;
      if (bestMatch && Math.abs(pxDelta) >= Math.abs(bestMatch.pxDelta)) continue;
      bestMatch = { snapFrame: point.frame, frameDelta, pxDelta };
    }
  }

  if (bestMatch) {
    timeline.snapX = framesToPixels(world, bestMatch.snapFrame);
    return bestMatch.frameDelta;
  }

  return 0;
}

function findAssetId(world: EngineWorld, entityEid: number) {
  const AssetId = world.components.AssetId;

  if (hasComponent(world, entityEid, AssetId) && AssetId[entityEid]) {
    return AssetId[entityEid];
  }

  for (const fill of world.components.Cache.fills[entityEid]) {
    if (hasComponent(world, fill, AssetId) && AssetId[fill]) {
      return AssetId[fill];
    };
  }

  return undefined;
}

function getSceneChildren(world: EngineWorld, eid: number): number[] {
  const tree: number[] = [];
  const c = world.components;

  const walk = (eid: number) => {
    for (const cid of query(world, [Or(c.Geometry, c.Group, c.AdjustmentLayer), ChildOf(eid), Not(c.Deleted)])) {
      tree.push(cid);
      walk(cid);
    }
  }
  walk(eid);

  return tree;
}
