/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Cache upkeep after structural changes (was part of api/utils.ts). Cache and
// KeyframeTrack.target are derived state, so they are written through stores
// without change events; the app observes the authoring writes instead.

import { Not, Or } from 'koota';

import { store } from '../world/store';
import {
	ChildOf, Cache,
	Geometry, Group, AdjustmentLayer, IsMask, Paint, Stroke, Shadow, Effect,
	TextRange, KeyframeTrack, Keyframe, Animation,
} from '../traits';
import { isStage } from '../queries/predicates';
import { getParentNode } from '../queries/hierarchy';
import { sortByFrame, sortByItemIndex } from '../utils/sort';
import { resetAnimatedValues } from '../systems/motion';

import type { Entity, World } from 'koota';

/**
 * Refresh the parent's Cache lists that the attached/detached entity
 * participates in. Call after a ChildOf change with the affected parent.
 * `exclude` drops one entity from the fresh lists: koota fires relation
 * remove events while the departing child is still present in the old
 * parent's queries.
 */
export function rebuildCaches(world: World, entity: Entity, parent: Entity | null, exclude: Entity | null = null) {
	if (parent === null || isStage(parent)) return;
	if (!parent.has(Cache)) parent.add(Cache);

	const cache = store(world, Cache);
	const pid = parent.id();
	const collect = (...params: Parameters<World['query']>) =>
		[...world.query(...params)].filter(e => e !== exclude);

	if (entity.has(Geometry) || entity.has(Group) || entity.has(AdjustmentLayer)) {
		cache.children[pid] = collect(
			Or(Geometry, Group, AdjustmentLayer), ChildOf(parent), Not(IsMask),
		).sort(sortByItemIndex);
	}

	if (entity.has(IsMask)) {
		cache.masks[pid] = collect(Geometry, IsMask, ChildOf(parent))
			.sort(sortByItemIndex);
	}

	if (entity.has(KeyframeTrack)) {
		const node = findClosestParentGeometry(parent);
		aggregateKeyframeTracks(world, node, exclude);
		resetAnimatedValues(world, node);
	}

	if (entity.has(Keyframe)) {
		cache.keyframes[pid] = collect(Keyframe, ChildOf(parent))
			.sort(sortByFrame);
	}

	if (entity.has(Animation)) {
		cache.animations[pid] = collect(Animation, ChildOf(parent))
			.sort(sortByItemIndex);
		resetAnimatedValues(world, parent);
	}

	// A geometry carrying Paint is not a fill of its parent: that is its own
	// intrinsic paint (see getIntrinsicPaint).
	if (entity.has(Paint) && !entity.has(Geometry)) {
		cache.fills[pid] = collect(Paint, Not(Geometry), ChildOf(parent))
			.sort(sortByItemIndex);
	}

	if (entity.has(Stroke)) {
		cache.strokes[pid] = collect(Stroke, ChildOf(parent))
			.sort(sortByItemIndex);
	}

	if (entity.has(Effect)) {
		cache.effects[pid] = collect(Effect, ChildOf(parent), Not(Shadow))
			.sort(sortByItemIndex);
	}

	if (entity.has(Shadow)) {
		cache.shadows[pid] = collect(Shadow, ChildOf(parent), Not(Effect))
			.sort(sortByItemIndex);
	}

	if (entity.has(TextRange)) {
		cache.textRanges[pid] = collect(TextRange, ChildOf(parent))
			.sort(sortByItemIndex);
	}
}

/** Nearest self-or-ancestor node entity (geometry, group, adjustment layer). */
export function findClosestParentGeometry(entity: Entity): Entity | null {
	let current: Entity | null = entity;
	while (current) {
		if (current.has(Geometry) || current.has(Group) || current.has(AdjustmentLayer)) {
			return current;
		}
		current = getParentNode(current);
	}
	return null;
}

/**
 * Collect every KeyframeTrack under a node, stopping at nested nodes (each
 * enclosing node owns its own cache entry). Refreshes the denormalised
 * `target` field on each track so consumers iterating the cache can look up
 * the animated entity without walking ChildOf.
 */
export function aggregateKeyframeTracks(world: World, node: Entity | null, exclude: Entity | null = null): void {
	if (node === null) return;
	if (!node.has(Cache)) node.add(Cache);

	const keyframeTrack = store(world, KeyframeTrack);
	const tracks: Entity[] = [];

	const walk = (entity: Entity) => {
		for (const child of world.query(ChildOf(entity))) {
			if (child === exclude) continue;
			if (child.has(KeyframeTrack)) {
				keyframeTrack.target[child.id()] = getParentNode(child);
				tracks.push(child);
				continue;
			}
			// Stop at nested nodes; each owns its own cache entry.
			if (child.has(Geometry) || child.has(Group) || child.has(AdjustmentLayer)) continue;
			walk(child);
		}
	};

	walk(node);
	store(world, Cache).keyframeTracks[node.id()] = tracks;
}
