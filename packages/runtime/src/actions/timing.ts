/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Time-range recomputation after structural or asset changes (was part of
// api/utils.ts). Computed is derived state (store writes, no events); Trim is
// authored, so trim edits go through entity.set and fire change events.

import { store } from '../world/store';
import { DEFAULT_DURATION_FRAMES } from '../constants';
import {
	Geometry, Group, Paint, Audio, Caption, Cache, Computed, Delay,
	PlaybackRate, Trim, CaptionDecoderHandle,
} from '../traits';
import { isGroupLike } from '../queries/predicates';
import { getParentNode } from '../queries/hierarchy';
import { findAssetDuration } from '../utils/time';

import type { Entity, World } from 'koota';

export function recomputeEntityTimeRange(world: World, entity: Entity): void {
	const computed = store(world, Computed);
	const eid = entity.id();

	const parent = getParentNode(entity);
	const parentDelay = parent !== null ? (computed.delay[parent.id()] ?? 0) : 0;
	const ownDelay = entity.get(Delay)?.value ?? 0;
	const accumulatedDelay = parentDelay + ownDelay;

	computed.delay[eid] = accumulatedDelay;

	const playbackRate = entity.get(PlaybackRate)?.value ?? 1;

	let start: number;
	let end: number;

	if (entity.has(Trim)) {
		const trim = entity.get(Trim)!;
		start = Math.round(accumulatedDelay + trim.start / playbackRate);
		end = Math.round(accumulatedDelay + trim.end / playbackRate);
	} else if (isGroupLike(entity)) {
		const children = entity.get(Cache)?.children ?? [];
		if (children.length === 0) {
			start = accumulatedDelay;
			end = accumulatedDelay + DEFAULT_DURATION_FRAMES;
		} else {
			let minStart = Infinity;
			let maxEnd = -Infinity;
			for (const child of children) {
				const cs = computed.start[child.id()] ?? accumulatedDelay;
				const ce = computed.end[child.id()] ?? accumulatedDelay;
				if (cs < minStart) minStart = cs;
				if (ce > maxEnd) maxEnd = ce;
			}
			start = minStart;
			end = maxEnd;
		}
	} else {
		const assetDuration = findAssetDuration(world, entity);
		const sourceDuration = assetDuration ?? DEFAULT_DURATION_FRAMES;
		start = accumulatedDelay;
		end = Math.round(accumulatedDelay + sourceDuration / playbackRate);
	}

	computed.start[eid] = start;
	computed.end[eid] = end;
	computed.duration[eid] = end - start;
}

/**
 * Recompute an entity and every descendant node. Use when something that
 * affects accumulated delay or playback rate changes; every child below
 * needs its delay refreshed.
 */
export function propagateTimeRangeDown(world: World, entity: Entity): void {
	recomputeEntityTimeRange(world, entity);
	for (const child of entity.get(Cache)?.children ?? []) {
		propagateTimeRangeDown(world, child);
	}
	for (const mask of entity.get(Cache)?.masks ?? []) {
		propagateTimeRangeDown(world, mask);
	}
	recomputeEntityTimeRange(world, entity);
}

/**
 * Walk upward recomputing any ancestor whose bounds depend on its children
 * (group-like without an explicit Trim). Call with the entity that changed.
 */
export function bubbleTimeRangeUp(world: World, child: Entity): void {
	const entity = getParentNode(child);
	if (entity === null) return;

	const dependsOnChildren = isGroupLike(entity) && !entity.has(Trim);
	if (!dependsOnChildren) return;

	recomputeEntityTimeRange(world, entity);
	bubbleTimeRangeUp(world, entity);
}

/**
 * Clamp a Trim's end so it never exceeds the entity's available asset
 * duration. Caller is responsible for triggering downstream recomputes.
 */
export function clampTrimToAssetDuration(world: World, entity: Entity): void {
	if (!entity.has(Trim)) return;

	const assetDuration = findAssetDuration(world, entity);
	if (!assetDuration) return;

	const trim = entity.get(Trim)!;
	if (trim.end > assetDuration) {
		entity.set(Trim, { end: assetDuration });
	}
}

/**
 * "Paint is removed" rule: if the geometry has no Trim, pin its current
 * computed duration as a fresh Trim so the entity does not silently fall
 * back to the 16s default after losing its asset source.
 */
export function pinTrimToCurrentDuration(world: World, entity: Entity): void {
	if (entity.has(Trim)) return;

	const playbackRate = entity.get(PlaybackRate)?.value ?? 1;
	const globalDuration = store(world, Computed).duration[entity.id()] ?? 0;
	const localDuration = Math.round(globalDuration * playbackRate);

	entity.add(Trim);
	entity.set(Trim, { start: 0, end: localDuration });
}

/**
 * Recompute trim when the asset id of an entity changes.
 */
export function reactToAssetChange(world: World, entity: Entity) {
	if (entity.has(Paint)) {
		reactToPaintChange(world, entity);
	} else if (entity.has(Audio)) {
		reactToGeometryDurationChange(world, entity);
	} else if (entity.has(Caption)) {
		// Re-pointed transcript: drop the decoder so it re-resolves with the
		// new asset.
		if (entity.has(CaptionDecoderHandle)) {
			entity.get(CaptionDecoderHandle)?.dispose();
			entity.set(CaptionDecoderHandle, null);
		}
	}
}

/**
 * Re-clamp the parent geometry's trim and bubble the new bounds up.
 */
export function reactToPaintChange(world: World, paint: Entity) {
	const entity = getParentNode(paint);
	if (entity === null || !entity.has(Geometry)) return;

	clampTrimToAssetDuration(world, entity);
	recomputeEntityTimeRange(world, entity);
	bubbleTimeRangeUp(world, entity);
}

/**
 * Recompute a geometry's bounds and bubble. Used when something other than
 * its own Trim/Delay shifts its duration (e.g. an attached asset id on an
 * Audio entity).
 */
export function reactToGeometryDurationChange(world: World, entity: Entity) {
	if (!entity.has(Geometry)) return;

	clampTrimToAssetDuration(world, entity);
	recomputeEntityTimeRange(world, entity);
	bubbleTimeRangeUp(world, entity);
}

export function reactToChildAttached(world: World, child: Entity) {
	if (child.has(Geometry) || child.has(Group)) {
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
 * source and needs a Trim pinned at its current duration.
 */
export function reactToChildDetached(world: World, child: Entity) {
	if (child.has(Geometry) || child.has(Group)) {
		bubbleTimeRangeUp(world, child);
		return;
	}

	if (child.has(Paint)) {
		const parent = getParentNode(child);
		if (parent === null || !parent.has(Geometry)) return;
		// Pin the current duration before recomputing; otherwise the geometry
		// would silently fall back to the 16s default after losing its paint.
		pinTrimToCurrentDuration(world, parent);
	}
}
