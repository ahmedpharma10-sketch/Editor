/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hasComponent, Not, query } from "bitecs";
import { ChildOf } from "../components/relations";
import { sortByItemIndex } from "../utils/sort";
import { isSequence } from "./query";

import type { EngineWorld } from "./world";

export type TimelineNodeKind = 'geometry' | 'sub-item' | 'keyframe-track';

export type TimelineNode = {
  eid: number;
  kind: TimelineNodeKind;
  expanded: boolean;
  expandable: boolean;
  children: TimelineNode[];
};

export type TimelineIndexValue = {
  root: number | null;
  layers: TimelineNode[];
};

export function buildTimelineLayers(world: EngineWorld, parent: number): TimelineNode[] {
  const c = world.components;
  const sequence = isSequence(world, parent);

  const tracks: number[] = [];
  const geoms: number[] = [];
  const masks: number[] = [];
  const subitems: number[] = [];

  for (const cid of query(world, [ChildOf(parent), Not(c.Deleted)])) {
    if (hasComponent(world, cid, c.Keyframe)) continue;
    if (sequence && !hasKeyframes(world, cid)) continue;

    if (hasComponent(world, cid, c.KeyframeTrack)) {
      tracks.push(cid);
    } else if (hasComponent(world, cid, c.IsMask)) {
      masks.push(cid);
    } else if (hasComponent(world, cid, c.Geometry) || hasComponent(world, cid, c.Group) || hasComponent(world, cid, c.AdjustmentLayer)) {
      geoms.push(cid);
    } else {
      subitems.push(cid);
    }
  }

  const sort = sortByItemIndex(world);
  tracks.sort(sort).reverse();
  geoms.sort(sort).reverse();
  masks.sort(sort).reverse();
  subitems.sort(sort).reverse();

  const nodes: TimelineNode[] = [];

  for (const cid of tracks) {
    nodes.push({
      eid: cid,
      kind: 'keyframe-track',
      expanded: false,
      expandable: false,
      children: [],
    });
  }

  for (const cid of subitems) {
    const node = buildNode(world, cid, 'sub-item');
    if (node.expandable) {
      nodes.push(node);
    }
  }

  for (const cid of geoms) {
    nodes.push(buildNode(world, cid, 'geometry'));
  }

  for (const cid of masks) {
    nodes.push(buildNode(world, cid, 'geometry'));
  }

  return nodes;
}

/**
 * Build one row node. Expanded nodes get their subtree; collapsed ones stay
 * empty and only probe whether a subtree exists.
 */
function buildNode(world: EngineWorld, eid: number, kind: TimelineNodeKind): TimelineNode {
  const c = world.components;

  if (!hasComponent(world, eid, c.Expanded)) {
    return {
      eid,
      kind,
      expanded: false,
      expandable: isExpandable(world, eid),
      children: [],
    };
  }

  const children = buildTimelineLayers(world, eid);
  return {
    eid,
    kind,
    expanded: true,
    expandable: children.length > 0,
    children,
  };
}

/**
 * Early-exit probe: check if a layer could be expanded.
 */
function isExpandable(world: EngineWorld, parent: number): boolean {
  const c = world.components;
  const sequence = isSequence(world, parent);

  for (const cid of query(world, [ChildOf(parent), Not(c.Deleted)])) {
    if (hasComponent(world, cid, c.Keyframe)) continue;
    if (sequence && !hasKeyframes(world, cid)) continue;
    if (
      hasComponent(world, cid, c.IsMask) ||
      hasComponent(world, cid, c.Geometry) ||
      hasComponent(world, cid, c.Group) ||
      hasComponent(world, cid, c.AdjustmentLayer) ||
      hasComponent(world, cid, c.KeyframeTrack) ||
      isExpandable(world, cid)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Deep probe: does `eid`'s subtree contain a live KeyframeTrack? Tracks are
 * deleted with their last keyframe, so track presence implies keyframes.
 */
function hasKeyframes(world: EngineWorld, eid: number): boolean {
  const c = world.components;

  for (const cid of query(world, [ChildOf(eid), Not(c.Deleted)])) {
    if (hasComponent(world, cid, c.KeyframeTrack)) return true;
    if (hasKeyframes(world, cid)) return true;
  }

  return false;
}
