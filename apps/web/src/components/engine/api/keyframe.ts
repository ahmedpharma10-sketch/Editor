/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hasComponent, Not, query } from 'bitecs';
import { ChildOf } from '../components/relations';
import { getPropertyPaths, type PropertyPath } from '../systems/motion';
import { getNodeLocalFrame } from './query';
import { getParentEntity } from './base';
import { createEntity, deleteEntity } from './entities';
import { appendChild } from './hierarchy';
import { setComponent } from './events';

import type { EngineWorld } from './world';

/**
 * Find the KeyframeTrack entity (if any) for a (target, property) pair.
 */
export function findKeyframeTrackEntity(world: EngineWorld, target: number, property: string): number | null {
	const c = world.components;
	for (const tid of query(world, [c.KeyframeTrack, ChildOf(target), Not(c.Deleted)])) {
		if (c.KeyframeTrack.property[tid] === property) return tid;
	}
	return null;
}

/**
 * Collect all keyframe entities for a (target, property) pair.
 */
export function getKeyframeTrack(world: EngineWorld, target: number, property: string): number[] {
	const c = world.components;
	const tid = findKeyframeTrackEntity(world, target, property);
	if (tid === null) return [];
	return [...query(world, [c.Keyframe, ChildOf(tid), Not(c.Deleted)])];
}

/**
 * Find the target node for a given entity.
 */
export function findKeyframeTargetNode(world: EngineWorld, eid: number): number | null {
	const c = world.components;

	let current: number | null = eid;
	while (current) {
		if (hasComponent(world, current, c.Geometry) || hasComponent(world, current, c.Group) || hasComponent(world, current, c.AdjustmentLayer)) {
			return current;
		}
		current = getParentEntity(world, current);
	}

	return null;
}

/**
 * Get the KeyframeTrack entity for (target, property), creating one if missing.
 */
function ensureKeyframeTrackEntity(world: EngineWorld, target: number, property: PropertyPath): number {
	const c = world.components;
	const existing = findKeyframeTrackEntity(world, target, property);
	if (existing !== null) return existing;

	const tid = createEntity(world);
	setComponent(world, tid, c.KeyframeTrack, { property });
	appendChild(world, tid, target);
	return tid;
}

/**
 * Add a keyframe at the current local time for (target, property).
 * Reads the current value from the target. If a keyframe at this exact time
 * already exists, its value is overwritten.
 */
export function syncKeyframeTrack(world: EngineWorld, eid: number, property: PropertyPath) {
	const c = world.components;

	const worldProps = getPropertyPaths(world);
	const nodeEid = findKeyframeTargetNode(world, eid);
	if (nodeEid === null) return;

	const trackEid = findKeyframeTrackEntity(world, eid, property);
	if (trackEid === null) return;

	const localFrame = getNodeLocalFrame(world, nodeEid);
	const existingKfEid = query(world, [c.Keyframe, ChildOf(trackEid), Not(c.Deleted)])
		.find(kid => c.Keyframe.time[kid] === localFrame);

	const currentValue = worldProps[property].authored[eid] ?? 0;
	const isNumber = typeof currentValue === 'number';
	if (!isNumber) return;

	if (existingKfEid) {
		setComponent(world, existingKfEid, c.Keyframe, { value: currentValue });
	} else {
		const kfid = createEntity(world);
		setComponent(world, kfid, c.Keyframe, {
			time: localFrame,
			value: currentValue,
			easing: 'linear',
		});
		appendChild(world, kfid, trackEid);
	}
}

/**
 * Toggle a keyframe at the current local time for (target, property).
 * Creates the KeyframeTrack on first use; removes it when its last keyframe
 * is toggled off.
 */
export function toggleKeyframeTrack(world: EngineWorld, eid: number, property: PropertyPath) {
	const c = world.components;

	const worldProps = getPropertyPaths(world);
	const nodeEid = findKeyframeTargetNode(world, eid);
	if (nodeEid === null) return;

	const localFrame = getNodeLocalFrame(world, nodeEid);
	const trackEid = findKeyframeTrackEntity(world, eid, property);

	let trackKeyframes: number[] = [];
	if (trackEid !== null) {
		trackKeyframes = [...query(world, [c.Keyframe, ChildOf(trackEid), Not(c.Deleted)])];
	}

	const existingKfEid = trackKeyframes.find(kid => c.Keyframe.time[kid] === localFrame);

	const currentValue = worldProps[property].authored[eid] ?? 0;
	const isNumber = typeof currentValue === 'number';
	if (!isNumber) return;

	if (existingKfEid) {
		world.history.transaction('Remove keyframe', () => {
			deleteEntity(world, existingKfEid);
			// If that was the track's last keyframe, drop the track too.
			if (trackEid && trackKeyframes.length === 1) {
				deleteEntity(world, trackEid);
			}
		});
		return;
	}

	world.history.transaction('Add keyframe', () => {
		const track = ensureKeyframeTrackEntity(world, eid, property);
		const kfid = createEntity(world);
		setComponent(world, kfid, c.Keyframe, {
			time: localFrame,
			value: currentValue,
			easing: 'linear',
		});
		appendChild(world, kfid, track);
	});
}

export function removeKeyframeTrack(world: EngineWorld, eid: number, property: PropertyPath) {
	const c = world.components;
	const trackEid = findKeyframeTrackEntity(world, eid, property);
	if (trackEid === null) return;

	const keyframes = [...query(world, [c.Keyframe, ChildOf(trackEid), Not(c.Deleted)])];

	world.history.transaction('Remove keyframe track', () => {
		keyframes.forEach(kfEid => deleteEntity(world, kfEid));
		deleteEntity(world, trackEid);
	});
}
