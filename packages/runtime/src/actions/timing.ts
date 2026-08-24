/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Time-range recomputation after structural or asset changes (was part of
// api/utils.ts). Computed is derived state (store writes, no events); the
// Delay/Trim time traits fire change events, so edits go through entity.set.

import { store } from '../world/store';
import { DEFAULT_DURATION_FRAMES } from '../constants';
import {
	Geometry, Group, AdjustmentLayer, Paint, Caption, Cache, Computed,
	Delay, Trim, PlaybackRate, CaptionDecoderHandle,
} from '../traits';
import { isGroupLike } from '../queries/predicates';
import { getParentNode } from '../queries/hierarchy';
import { findAssetDuration, getSourceFrameAt, isPaintEntity } from '../utils/time';

import type { Entity, World } from 'koota';
import type { Ignorable, TimeTrait } from '../utils/time';

/**
 * The trait's value, or undefined when the node doesn't carry it. `ignore`
 * reads one trait as absent: koota fires onRemove before it clears the trait,
 * so a removal handler has to recompute against the value that is going away
 * (the same reason rebuildCaches takes an exclude).
 */
function stored(entity: Entity, trait: TimeTrait, ignore?: Ignorable): number | undefined {
	return trait === ignore ? undefined : entity.get(trait)?.value;
}

/** The node's Trim, with the same `ignore` reading as `stored`. */
function storedTrim(entity: Entity, ignore?: Ignorable) {
	return Trim === ignore ? undefined : entity.get(Trim);
}

/**
 * Where the node's source window closes, in source frames. Each bound is
 * optional and each one caps the window, so when more than one is present the
 * shortest wins rather than one silently overriding another: a trim past the
 * source runs out of frames. With no bound at all the node runs for its whole
 * source, or 16s when it has no source (a shape or a text has nothing to run
 * out of, so its asset length is a default rather than a cap).
 */
function resolveSourceOut(
	world: World,
	entity: Entity,
	trimStart: number,
	trimEnd: number | null,
	ignore?: Ignorable,
): number {
	const assetDuration = findAssetDuration(world, entity, ignore);

	let out = trimEnd ?? Infinity;

	if (assetDuration !== null) out = Math.min(out, assetDuration);

	if (out === Infinity) out = DEFAULT_DURATION_FRAMES;

	return Math.max(trimStart, out);
}

/**
 * Resolve one node's time traits into its absolute bounds, origin, and rate.
 *
 * Delay is parent-relative and Trim is in the node's own source frames;
 * Computed is absolute, so everything comparing two nodes works in one space.
 * The origin places source frame 0, which is what every descendant is
 * measured against.
 */
export function recomputeEntityTimeRange(world: World, entity: Entity, ignore?: Ignorable): void {
	const computed = store(world, Computed);
	const eid = entity.id();

	const parent = getParentNode(entity);
	const parentOrigin = parent !== null ? (computed.origin[parent.id()] ?? 0) : 0;

	const delay = stored(entity, Delay, ignore) ?? 0;
	const playbackRate = stored(entity, PlaybackRate, ignore) || 1;
	const trim = storedTrim(entity, ignore);

	// Bounds land on frame boundaries, since everything comparing nodes works
	// in whole frames, while the origin keeps its fraction so audio scheduled
	// against it doesn't inherit a half-frame of slip.
	const origin = parentOrigin + delay;
	const trimStart = trim?.start ?? 0;
	const start = Math.round(origin + trimStart / playbackRate);

	computed.origin[eid] = origin;
	computed.playbackRate[eid] = playbackRate;

	// A container with no trimmed end of its own spans whatever its children span.
	if (fitsChildren(entity, ignore)) {
		const children = entity.get(Cache)?.children ?? [];
		let fitStart = start;
		let fitEnd = start + DEFAULT_DURATION_FRAMES;

		if (children.length > 0) {
			let minStart = Infinity;
			let maxEnd = -Infinity;
			for (const child of children) {
				const cs = computed.start[child.id()] ?? start;
				const ce = computed.end[child.id()] ?? start;
				if (cs < minStart) minStart = cs;
				if (ce > maxEnd) maxEnd = ce;
			}
			fitStart = minStart;
			fitEnd = maxEnd;
		}

		computed.start[eid] = fitStart;
		computed.end[eid] = fitEnd;
		computed.duration[eid] = fitEnd - fitStart;
		return;
	}

	const sourceOut = resolveSourceOut(world, entity, trimStart, trim?.end ?? null, ignore);
	const end = Math.max(start, Math.round(origin + sourceOut / playbackRate));

	computed.start[eid] = start;
	computed.end[eid] = end;
	computed.duration[eid] = end - start;
}

/**
 * Recompute an entity and every descendant node. Use when something that moves
 * the entity's origin or changes its rate has changed; every child below is
 * placed against that origin and has to be re-derived.
 */
export function propagateTimeRangeDown(world: World, entity: Entity, ignore?: Ignorable): void {
	recomputeEntityTimeRange(world, entity, ignore);
	for (const child of entity.get(Cache)?.children ?? []) {
		propagateTimeRangeDown(world, child);
	}
	for (const mask of entity.get(Cache)?.masks ?? []) {
		propagateTimeRangeDown(world, mask);
	}
	recomputeEntityTimeRange(world, entity, ignore);
}

/**
 * Walk upward recomputing any ancestor whose bounds depend on its children
 * (group-like without a trimmed end). Call with the entity that changed.
 */
export function bubbleTimeRangeUp(world: World, child: Entity): void {
	const entity = getParentNode(child);
	if (entity === null) return;

	if (!fitsChildren(entity)) return;

	recomputeEntityTimeRange(world, entity);
	bubbleTimeRangeUp(world, entity);
}

/** Whether the node takes its bounds from its children rather than trimming them. */
export function fitsChildren(entity: Entity, ignore?: Ignorable): boolean {
	if (!isGroupLike(entity)) return false;
	return (storedTrim(entity, ignore)?.end ?? null) === null;
}

/**
 * Pin whatever the node currently spans as a trimmed end, so it keeps that
 * span once the thing it was derived from is gone. Used when a paint is removed:
 * without this the geometry silently falls back to the 16s default after losing
 * its asset source. A node whose trim already closes is left alone.
 */
export function pinTrimToCurrentBounds(world: World, entity: Entity): void {
	if ((entity.get(Trim)?.end ?? null) !== null) return;

	const computed = store(world, Computed);
	const eid = entity.id();
	const origin = computed.origin[eid] ?? 0;
	const playbackRate = computed.playbackRate[eid] || 1;
	const end = computed.end[eid] ?? 0;

	entity.add(Trim);
	entity.set(Trim, { end: (end - origin) * playbackRate });
}

/**
 * Move the node's in point to `frame` (scene time), keeping the rest of the
 * clip where it is: the origin stays put and the trim opens later, so the
 * frames left visible still line up with the timeline.
 */
export function trimEntityIn(world: World, entity: Entity, frame: number): void {
	// The out point is only implied while the trim is open-ended; pin it
	// before moving the head, or the tail would follow along.
	pinTrimToCurrentBounds(world, entity);

	entity.add(Trim);
	entity.set(Trim, { start: getSourceFrameAt(entity, frame) });
}

/** Move the node's out point to `frame` (scene time): the trim closes there. */
export function trimEntityOut(_world: World, entity: Entity, frame: number): void {
	entity.add(Trim);
	entity.set(Trim, { end: getSourceFrameAt(entity, frame) });
}

/**
 * Re-derive the time range when what an entity plays changes: a new asset id,
 * or a new rate to play a frames directory at.
 *
 * `ignore`: the trait is on its way off the entity (koota fires onRemove
 * before clearing it), so recompute as if it were already gone.
 */
export function reactToAssetChange(world: World, entity: Entity, ignore?: Ignorable) {
	if (isPaintEntity(entity)) {
		reactToPaintChange(world, entity);
	} else if (entity.has(Caption)) {
		// Re-pointed transcript: drop the decoder so it re-resolves with the
		// new asset.
		if (entity.has(CaptionDecoderHandle)) {
			entity.get(CaptionDecoderHandle)?.dispose();
			entity.set(CaptionDecoderHandle, null);
		}
	} else if (entity.has(Geometry)) {
		// A geometry's own asset backs its intrinsic paint (a video's footage)
		// or, on an audio clip, its recording: a new one is a new source length.
		recomputeEntityTimeRange(world, entity, ignore);
		bubbleTimeRangeUp(world, entity);
	}
}

/**
 * Recompute the parent geometry against its new source and bubble the new
 * bounds up. Nothing else needs fixing up: the asset length is one of the
 * caps resolveSourceOut takes, so a shorter source shortens the clip on its
 * own and a longer one gives back whatever the trim still allows.
 */
export function reactToPaintChange(world: World, paint: Entity) {
	// A geometry's own Paint is its intrinsic paint: the geometry is the clip.
	const entity = paint.has(Geometry) ? paint : getParentNode(paint);
	if (entity === null || !entity.has(Geometry)) return;

	recomputeEntityTimeRange(world, entity);
	bubbleTimeRangeUp(world, entity);
}

/**
 * Recompute a geometry's bounds and bubble. Used when something other than its
 * own time traits shifts its duration (e.g. the intrinsic media its own
 * asset id names).
 */
export function reactToGeometryDurationChange(world: World, entity: Entity) {
	if (!entity.has(Geometry)) return;

	recomputeEntityTimeRange(world, entity);
	bubbleTimeRangeUp(world, entity);
}

export function reactToChildAttached(world: World, child: Entity) {
	if (child.has(Geometry) || child.has(Group) || child.has(AdjustmentLayer)) {
		propagateTimeRangeDown(world, child);
		bubbleTimeRangeUp(world, child);
		return;
	}

	if (child.has(Paint)) {
		reactToPaintChange(world, child);
	}
}

/**
 * ChildOf onRemove hook (covers the user-facing "remove" path). Mirror of
 * reactToChildAttached: if the dying entity is a geometry the parent group's
 * bounds may shrink; if it's a paint the parent geometry may lose its asset
 * source and needs its current span pinned.
 */
export function reactToChildDetached(world: World, child: Entity) {
	if (child.has(Geometry) || child.has(Group) || child.has(AdjustmentLayer)) {
		bubbleTimeRangeUp(world, child);
		return;
	}

	if (child.has(Paint)) {
		const parent = getParentNode(child);
		if (parent === null || !parent.has(Geometry)) return;
		// Pin the current duration before recomputing; otherwise the geometry
		// would silently fall back to the 16s default after losing its paint.
		pinTrimToCurrentBounds(world, parent);
	}
}
