/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Ai, FramePromises, GenerationRequest, Library, LoadRequest, PendingSource, TranscriptionRequest } from '../traits';
import { bindAsset } from '../actions/assets';
import { getEntityTree, getSceneAncestor } from '../queries/hierarchy';

import type { Entity, World } from 'koota';
import type { Asset } from '@diffusionstudio/assets';

export function assetSystem(world: World): void {
	const library = world.get(Library);
	if (library) {
		for (const entity of world.query(LoadRequest)) {
			const source = entity.get(LoadRequest)!.value;
			entity.remove(LoadRequest);
			resolve(world, entity, source, library.resolve(source));
		}
	}

	const ai = world.get(Ai);
	if (ai) {
		for (const entity of world.query(GenerationRequest)) {
			const ref = entity.get(GenerationRequest)!.ref;
			entity.remove(GenerationRequest);
			if (ref === null) continue;
			resolve(world, entity, ref, ai.resolve(ref));
		}

		for (const entity of world.query(TranscriptionRequest)) {
			const scene = getSceneAncestor(entity);
			if (!scene || hasPendingSources(world, scene, entity)) continue;

			const seed = entity.get(TranscriptionRequest)!.seed;
			entity.remove(TranscriptionRequest);
			resolve(world, entity, `transcript:${scene.id()}:${seed}`, ai.transcribe(world, scene, seed));
		}
	}
}

/**
 * Whether anything in `scene`'s subtree (besides `except`, the requesting
 * element itself) is still waiting on a source: a request this system has
 * not consumed, or a resolution it started that has not landed.
 */
function hasPendingSources(world: World, scene: Entity, except: Entity): boolean {
	for (const entity of getEntityTree(world, scene)) {
		if (entity === except) continue;
		if (entity.has(LoadRequest) || entity.has(GenerationRequest) || entity.has(PendingSource)) {
			return true;
		}
	}
	return false;
}

/**
 * Tracks one started resolution: the entity remembers what it is waiting on
 * (PendingSource), so of overlapping resolutions only the latest binds, and
 * one that outlives its element (or its src) is dropped.
 */
function resolve(world: World, entity: Entity, value: unknown, promise: Promise<Asset>): void {
	entity.add(PendingSource);
	entity.set(PendingSource, { value });

	const done = promise.then(
		(asset) => {
			if (!current(entity, value)) return;
			entity.remove(PendingSource);
			bindAsset(entity, asset);
		},
		(error: unknown) => {
			if (!current(entity, value)) return;
			entity.remove(PendingSource);
			console.error('[runtime] could not resolve src:', error);
		},
	);

	world.get(FramePromises)?.list?.push(done);
}

function current(entity: Entity, value: unknown): boolean {
	return entity.isAlive() && entity.get(PendingSource)?.value === value;
}
