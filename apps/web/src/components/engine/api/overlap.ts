/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hasComponent, Not, Or, query } from 'bitecs';
import { computeTrimStart, computeTrimEnd } from '../utils';
import { cloneSubtree } from './serialize';
import { getParentEntity } from './base';
import { getEntityTree, isGroup } from './query';
import { ChildOf } from '../components';
import { setComponent } from './events';
import { deleteEntity } from './entities';

import type { EngineWorld } from './world';

/**
 * Enforce the "no two direct children overlap in time" invariant of a
 * Sequential container after a clip has been moved (dragged + released).
 *
 * For every dragged clip whose direct parent is Sequential, each conflicting
 * sibling is resolved against the dragged clip's [start, end) span using an
 * overwrite model:
 *   - fully covered      → removed
 *   - overlaps left edge → trimmed (out-point pulled back to the drop start)
 *   - overlaps right edge→ trimmed (in-point pushed to the drop end)
 *   - fully engulfs      → split into two halves around the dropped clip
 *
 * Group siblings are resolved recursively at the leaf level; their bounds
 * recompute from their remaining children, and an emptied group is removed.
 *
 * Call this while the move's history transaction is still open so the whole
 * resolution lands in the same undo step as the move.
 */
export function resolveSequentialOverlaps(world: EngineWorld, draggedEids: number[]): void {
  const c = world.components;
  if (draggedEids.length === 0) return;

  // Dragged clips never trim or remove each other.
  const ignore = new Set(draggedEids);

  for (const draggedEid of draggedEids) {
    const parentEid = getParentEntity(world, draggedEid);
    if (parentEid === null || !hasComponent(world, parentEid, c.Sequential)) continue;

    const occStart = c.Computed.start[draggedEid];
    const occEnd = c.Computed.end[draggedEid];
    if (occStart === undefined || occEnd === undefined || occEnd <= occStart) continue;

    // Snapshot the sibling list before mutating — resolution deletes, trims,
    // and clones, all of which change the live query result.
    const siblings = [...query(world, [Or(c.Geometry, c.Group), ChildOf(parentEid), Not(c.Deleted)])]
      .filter(sib => !ignore.has(sib));

    for (const sib of siblings) {
      resolveEntityOverlap(world, sib, occStart, occEnd, ignore);
    }
  }
}

/**
 * Enforce the no-overlap invariant on a *freshly created* Sequential container.
 *
 * resolveSequentialOverlaps has an authoritative set — the clips the user just
 * dragged. On creation there is none: every child is a peer that merely happened
 * to overlap on the canvas. We pick a deterministic precedence instead — earlier
 * clips win and keep their full extent; later clips yield, trimmed back to start
 * after the clip preceding them (fully-covered clips are removed).
 *
 * Children are processed in start-frame order with each one authoritative over
 * all later siblings. Because every authoritative pass trims *all* later
 * siblings uniformly, each clip's start stays monotonic by rank, so the "dropped
 * clip lands inside a sibling" split case from resolveEntityOverlap cannot arise
 * here — only edge trims and removals.
 *
 * Call inside the creation transaction so the resolution shares the group's
 * undo step.
 */
export function resolveNewSequenceOverlaps(world: EngineWorld, sequenceEid: number): void {
  const c = world.components;
  if (!hasComponent(world, sequenceEid, c.Sequential)) return;

  const children = [...query(world, [Or(c.Geometry, c.Group), ChildOf(sequenceEid), Not(c.Deleted)])]
    .sort((a, b) => (c.Computed.start[a] ?? 0) - (c.Computed.start[b] ?? 0));

  // No dragged clips to protect; group recursion has no leaves to skip.
  const ignore = new Set<number>();

  for (let i = 0; i < children.length; i++) {
    const eid = children[i];
    // An earlier authoritative clip may have removed or trimmed this one.
    if (hasComponent(world, eid, c.Deleted)) continue;
    const occStart = c.Computed.start[eid];
    const occEnd = c.Computed.end[eid];
    if (occStart === undefined || occEnd === undefined || occEnd <= occStart) continue;

    for (let j = i + 1; j < children.length; j++) {
      const sib = children[j];
      if (hasComponent(world, sib, c.Deleted)) continue;
      resolveEntityOverlap(world, sib, occStart, occEnd, ignore);
    }
  }
}

/**
 * Resolve a single entity against the occupied [occStart, occEnd) span.
 * Groups recurse to their children; leaf clips are trimmed, removed, or split.
 */
function resolveEntityOverlap(
  world: EngineWorld,
  eid: number,
  occStart: number,
  occEnd: number,
  ignore: Set<number>,
): void {
  const c = world.components;

  const start = c.Computed.start[eid];
  const end = c.Computed.end[eid];
  if (start === undefined || end === undefined) return;

  // No temporal overlap — nothing to do. Touching edges (end === occStart or
  // start === occEnd) are abutting, not overlapping.
  if (end <= occStart || start >= occEnd) return;

  // Plain groups (incl. nested Sequential containers) have no intrinsic trim;
  // resolve their leaves and let the group's bounds recompute from what's left.
  if (isGroup(world, eid)) {
    if (start >= occStart && end <= occEnd) {
      // Whole group sits inside the dropped span — remove it outright.
      deleteEntity(world, eid);
      return;
    }

    const children = [...query(world, [Or(c.Geometry, c.Group), ChildOf(eid), Not(c.Deleted)])]
      .filter(child => !ignore.has(child));
    for (const child of children) {
      resolveEntityOverlap(world, child, occStart, occEnd, ignore);
    }

    // If every child was removed, the group is now empty — drop it too.
    const remaining = query(world, [Or(c.Geometry, c.Group), ChildOf(eid), Not(c.Deleted)]);
    if (remaining.length === 0) deleteEntity(world, eid);
    return;
  }

  const startCovered = start >= occStart;
  const endCovered = end <= occEnd;

  if (startCovered && endCovered) {
    // Fully covered — remove it.
    deleteEntity(world, eid);
  } else if (!startCovered && endCovered) {
    // Overlaps the dropped clip's left edge: keep the left remainder by
    // pulling the out-point back to the drop start.
    setComponent(world, eid, c.Trim, { end: computeTrimEnd(world, eid, occStart) });
  } else if (startCovered && !endCovered) {
    // Overlaps the dropped clip's right edge: keep the right remainder by
    // pushing the in-point forward to the drop end.
    setComponent(world, eid, c.Trim, { start: computeTrimStart(world, eid, occEnd) });
  } else {
    // The dropped clip lands inside this one — split it into two halves around
    // the span. Clone first so the copy inherits the original (un-shrunk) trim,
    // then shrink the original to the left half and the copy to the right half.
    const copyTrimStart = computeTrimStart(world, eid, occEnd);
    const result = cloneSubtree(world, getEntityTree(world, eid));
    const copyEid = result.get(eid);

    setComponent(world, eid, c.Trim, { end: computeTrimEnd(world, eid, occStart) });
    if (copyEid !== undefined) {
      setComponent(world, copyEid, c.Trim, { start: copyTrimStart });
    }
  }
}
