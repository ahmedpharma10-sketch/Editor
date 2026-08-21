/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Binds entities to the assets their `src` names. The document is
// synchronous and only leaves requests behind (LoadRequest for a source
// outside the library, GenerationRequest for a `generate.*` declaration);
// this system consumes them each frame, starts the async work, and stamps
// AssetId when the asset lands. Loads go through the world's library;
// generations through the world's Ai — deduplication (a spec whose hash
// already produced a library asset binds to it, identical inflight specs
// share one run) is the Ai implementation's contract (see GenAi). A request
// the world cannot serve yet — no library, no Ai — is left in place for a
// frame that can. In offline mode the started work joins FramePromises, so
// the encoder's barrier waits for the binding before it samples a frame.

import { Ai, FramePromises, GenerationRequest, Library, LoadRequest, PendingSource } from '../traits';
import { bindAsset } from '../actions/assets';

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
	}
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
