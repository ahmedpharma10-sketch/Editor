/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Ai, FramePromises, Generating, GenerationRequest, Library, LoadRequest, PendingSource, SourceError, TranscriptionRequest } from '../traits';
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
			if (ref === null || entity.has(SourceError)) continue;
			resolve(world, entity, ref, ai.resolve(ref), true);
		}

		for (const entity of world.query(TranscriptionRequest)) {
			const scene = getSceneAncestor(entity);
			if (!scene || hasPendingSources(world, scene, entity)) continue;

			const seed = entity.get(TranscriptionRequest)!.seed;
			entity.remove(TranscriptionRequest);
			if (entity.has(SourceError)) continue;
			resolve(world, entity, `transcript:${scene.id()}:${seed}`, ai.transcribe(world, scene, seed), true);
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
function resolve(world: World, entity: Entity, value: unknown, promise: Promise<Asset>, generating = false): void {
	entity.remove(SourceError);
	entity.add(PendingSource);
	entity.set(PendingSource, { value });
	if (generating) entity.add(Generating);

	const done = promise.then(
		(asset) => {
			if (!current(entity, value)) return;
			entity.remove(PendingSource, Generating);
			bindAsset(entity, asset);
		},
		(error: unknown) => {
			if (!current(entity, value)) return;
			entity.remove(PendingSource, Generating);
			entity.add(SourceError);
			entity.set(SourceError, { value: errorMessage(error), generated: generating });
			console.error('[runtime] could not resolve src:', error);
		},
	);

	world.get(FramePromises)?.list?.push(done);
}

/** What a rejection says, for an entity to carry and the host to show. */
function errorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.trim() || 'Something went wrong';
}

function current(entity: Entity, value: unknown): boolean {
	return entity.isAlive() && entity.get(PendingSource)?.value === value;
}
