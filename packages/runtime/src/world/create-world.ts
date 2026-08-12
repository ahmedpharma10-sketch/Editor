/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createWorld } from 'koota';

import {
	Project,
	Mode,
	ActiveScene,
	Camera,
	Background,
	Time,
	FrameRate,
	RenderSurface,
	AudioEngine,
	Fonts,
	Mounts,
	FramePromises,
} from '../traits/world';
import {
	Anchor, Cache, Computed, Flip, LocalTransform, WorldBounds, WorldTransform,
} from '../traits';

/**
 * World with the headless runtime singletons attached. The host injects its
 * surfaces after creation (world.set(RenderSurface, ...) and
 * world.set(AudioEngine, ...)); the editor app layers its own world traits on
 * top (input, history, persistence, asset stores).
 */
export function createRuntimeWorld(projectId: string) {
	const world = createWorld(
		Project({ id: projectId }),
		Mode,
		ActiveScene,
		Camera,
		Background,
		Time,
		FrameRate,
		RenderSurface,
		AudioEngine,
		Fonts,
		Mounts,
		FramePromises,
	);

	// koota registers a trait's store on first add/query; getStore alone
	// throws. Prime the stores the per-frame systems write through getStore
	// (bitecs-style, without the trait necessarily being on the entity) so
	// they run safely on a fresh world.
	world.spawn(Anchor, Cache, Computed, Flip, LocalTransform, WorldBounds, WorldTransform).destroy();

	return world;
}

export type RuntimeWorld = ReturnType<typeof createRuntimeWorld>;
