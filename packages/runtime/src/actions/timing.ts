/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Time-range recomputation after structural or asset changes (was part of
// api/utils.ts). Computed is derived state (store writes, no events); the
// authored time traits fire change events, so edits go through entity.set.

import { store } from '../world/store';
import { DEFAULT_DURATION_FRAMES } from '../constants';
import {
	Geometry, Group, AdjustmentLayer, Paint, Caption, Cache, Computed,
	Start, End, SourceIn, SourceOut, PlaybackRate, CaptionDecoderHandle,
} from '../traits';
import { isGroupLike } from '../queries/predicates';
import { getParentNode } from '../queries/hierarchy';
import { findAssetDuration, getSourceFrameAt, getTimelineOrigin, isPaintEntity } from '../utils/time';

import type { Entity, World } from 'koota';
import type { Ignorable, TimeTrait } from '../utils/time';

/**
 * The authored value, or undefined when the node doesn't carry it. `ignore`
 * reads one trait as absent: koota fires onRemove before it clears the trait,
 * so a removal handler has to recompute against the value that is going away
 * (the same reason rebuildCaches takes an exclude).
 */
function authored(entity: Entity, trait: TimeTrait, ignore?: Ignorable): number | undefined {
	return trait === ignore ? undefined : entity.get(trait)?.value;
}

/**
 * How long the node lasts on its parent's timeline, in frames, from whichever
 * of the authored traits it carries.
 *
 * Each bound is optional and each one caps the duration, so when more than one
 * is present the shortest wins rather than one silently overriding another: an
 * End past the source runs out of frames, a SourceOut past the asset does too.
 * Source-side spans divide by the rate to become timeline frames. With no bound
 * at all the node runs for its whole source, or 16s when it has no source (a
 * shape or a text has nothing to run out of, so its asset length is a default
 * rather than a cap).
 */
function resolveDuration(
	world: World,
	entity: Entity,
	start: number,
	sourceIn: number,
	ignore?: Ignorable,
): number {
	const playbackRate = authored(entity, PlaybackRate, ignore) || 1;
	const assetDuration = findAssetDuration(world, entity, ignore);

	let duration = Infinity;

	const end = authored(entity, End, ignore);
	if (end !== undefined) duration = end - start;

	const sourceOut = authored(entity, SourceOut, ignore);
	if (sourceOut !== undefined) {
		duration = Math.min(duration, (sourceOut - sourceIn) / playbackRate);
	}

	if (assetDuration !== null) {
		duration = Math.min(duration, (assetDuration - sourceIn) / playbackRate);
	}

	if (duration === Infinity) {
		duration = (DEFAULT_DURATION_FRAMES - sourceIn) / playbackRate;
	}

	return Math.max(0, duration);
}

/**
 * Resolve one node's authored time into its absolute bounds, origin, and rate.
 *
 * Authored values are parent-relative; Computed is absolute, so everything
 * comparing two nodes works in one space. The rate places source frame 0, which
 * is the origin every descendant is measured against.
 */
export function recomputeEntityTimeRange(world: World, entity: Entity, ignore?: Ignorable): void {
	const computed = store(world, Computed);
	const eid = entity.id();

	const parent = getParentNode(entity);
	const parentOrigin = parent !== null ? (computed.origin[parent.id()] ?? 0) : 0;

	const authoredStart = authored(entity, Start, ignore) ?? 0;
	const sourceIn = authored(entity, SourceIn, ignore) ?? 0;
	const playbackRate = authored(entity, PlaybackRate, ignore) || 1;

	// Bounds land on frame boundaries, since everything comparing nodes works
	// in whole frames, while the origin keeps its fraction so audio scheduled
	// against it doesn't inherit a half-frame of slip.
	const origin = parentOrigin + authoredStart - sourceIn / playbackRate;
	const start = Math.round(parentOrigin + authoredStart);

	computed.origin[eid] = origin;
	computed.playbackRate[eid] = playbackRate;

	// A container with no End of its own spans whatever its children span.
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

	const end = start + Math.round(resolveDuration(world, entity, authoredStart, sourceIn, ignore));

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
 * (group-like without an explicit end). Call with the entity that changed.
 */
export function bubbleTimeRangeUp(world: World, child: Entity): void {
	const entity = getParentNode(child);
	if (entity === null) return;

	if (!fitsChildren(entity)) return;

	recomputeEntityTimeRange(world, entity);
	bubbleTimeRangeUp(world, entity);
}

/** Whether the node takes its bounds from its children rather than authoring them. */
export function fitsChildren(entity: Entity, ignore?: Ignorable): boolean {
	return isGroupLike(entity) && authored(entity, End, ignore) === undefined;
}

/**
 * Pin whatever the node currently spans as an authored End, so it keeps that
 * span once the thing it was derived from is gone. Used when a paint is removed:
 * without this the geometry silently falls back to the 16s default after losing
 * its asset source. A node that already authors an End is left alone.
 */
export function pinEndToCurrentBounds(world: World, entity: Entity): void {
	if (entity.has(End)) return;

	const end = store(world, Computed).end[entity.id()] ?? 0;

	entity.add(End({ value: end - getTimelineOrigin(entity) }));
}

/**
 * Move the node's in point to `frame` (scene time), keeping the rest of the
 * clip where it is: the source rolls forward by as much as the head lost, so
 * the frames left visible still line up with the timeline.
 */
export function trimEntityIn(world: World, entity: Entity, frame: number): void {
	// The out point is only implied while the node has no authored End; pin it
	// before moving the head, or the tail would follow along.
	pinEndToCurrentBounds(world, entity);

	const start = frame - getTimelineOrigin(entity);
	const source = getSourceFrameAt(entity, frame);

	entity.add(Start);
	entity.set(Start, { value: start });
	entity.add(SourceIn);
	entity.set(SourceIn, { value: source });
}

/**
 * Move the node's out point to `frame` (scene time). The source window follows
 * only if the node authors one: otherwise the End alone says where the clip
 * runs out, and leaving SourceOut absent keeps it that way.
 */
export function trimEntityOut(_world: World, entity: Entity, frame: number): void {
	const end = frame - getTimelineOrigin(entity);
	const source = getSourceFrameAt(entity, frame);

	if (entity.has(SourceOut)) {
		entity.set(SourceOut, { value: source });
	}

	entity.add(End);
	entity.set(End, { value: end });
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
 * bounds up. Nothing authored needs fixing up: the asset length is one of the
 * caps resolveDuration takes, so a shorter source shortens the clip on its own
 * and a longer one gives back whatever the authored bounds still allow.
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
 * own authored time shifts its duration (e.g. the intrinsic media its own
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
		pinEndToCurrentBounds(world, parent);
	}
}
