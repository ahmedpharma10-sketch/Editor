/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Cache upkeep after structural changes (was part of api/utils.ts). Cache and
// KeyframeTrack.target are derived state, so they are written through stores
// without change events; the app observes the authoring writes instead.

import { Not, Or } from 'koota';

import { store } from '../world/store';
import {
	ChildOf, Deleted, Cache,
	Geometry, Group, AdjustmentLayer, IsMask, Paint, Stroke, Shadow, Effect,
	TextRange, KeyframeTrack, Keyframe, Animation,
} from '../traits';
import { isDocument } from '../queries/predicates';
import { getParentNode } from '../queries/hierarchy';
import { sortByFrame, sortByItemIndex } from '../utils/sort';
import { resetAnimatedValues } from '../systems/motion';

import type { Entity, World } from 'koota';

/**
 * Refresh the parent's Cache lists that the attached/detached entity
 * participates in. Call after a ChildOf change with the affected parent.
 */
export function rebuildCaches(world: World, entity: Entity, parent: Entity | null) {
	if (parent === null || isDocument(parent)) return;
	if (!parent.has(Cache)) parent.add(Cache);

	const cache = store(world, Cache);
	const pid = parent.id();

	if (entity.has(Geometry) || entity.has(Group) || entity.has(AdjustmentLayer)) {
		cache.children[pid] = [...world.query(
			Or(Geometry, Group, AdjustmentLayer), ChildOf(parent), Not(IsMask), Not(Deleted),
		)].sort(sortByItemIndex);
	}

	if (entity.has(IsMask)) {
		cache.masks[pid] = [...world.query(Geometry, IsMask, ChildOf(parent), Not(Deleted))]
			.sort(sortByItemIndex);
	}

	if (entity.has(KeyframeTrack)) {
		const node = findClosestParentGeometry(parent);
		aggregateKeyframeTracks(world, node);
		resetAnimatedValues(world, node);
	}

	if (entity.has(Keyframe)) {
		cache.keyframes[pid] = [...world.query(Keyframe, ChildOf(parent), Not(Deleted))]
			.sort(sortByFrame);
	}

	if (entity.has(Animation)) {
		cache.animations[pid] = [...world.query(Animation, ChildOf(parent), Not(Deleted))]
			.sort(sortByItemIndex);
		resetAnimatedValues(world, parent);
	}

	if (entity.has(Paint)) {
		cache.fills[pid] = [...world.query(Paint, ChildOf(parent), Not(Deleted))]
			.sort(sortByItemIndex);
	}

	if (entity.has(Stroke)) {
		cache.strokes[pid] = [...world.query(Stroke, ChildOf(parent), Not(Deleted))]
			.sort(sortByItemIndex);
	}

	if (entity.has(Effect)) {
		cache.effects[pid] = [...world.query(Effect, ChildOf(parent), Not(Shadow), Not(Deleted))]
			.sort(sortByItemIndex);
	}

	if (entity.has(Shadow)) {
		cache.shadows[pid] = [...world.query(Shadow, ChildOf(parent), Not(Effect), Not(Deleted))]
			.sort(sortByItemIndex);
	}

	if (entity.has(TextRange)) {
		cache.textRanges[pid] = [...world.query(TextRange, ChildOf(parent), Not(Deleted))]
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
export function aggregateKeyframeTracks(world: World, node: Entity | null): void {
	if (node === null) return;
	if (!node.has(Cache)) node.add(Cache);

	const keyframeTrack = store(world, KeyframeTrack);
	const tracks: Entity[] = [];

	const walk = (entity: Entity) => {
		for (const child of world.query(ChildOf(entity), Not(Deleted))) {
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
