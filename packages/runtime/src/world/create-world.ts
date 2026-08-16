/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createWorld } from 'koota';

import { observeWorld } from './observers';
import {
	DocumentRoot,
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
	Assets,
	Folders,
	AssetIds,
	Mounts,
	FramePromises,
	HitRegions,
} from '../traits/world';

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
		Time,
		FrameRate,
		RenderSurface,
		AudioEngine,
		Fonts,
		Assets,
		Folders,
		AssetIds,
		Mounts,
		FramePromises,
		HitRegions,
	);

	// The document root all rendered entities hang off (see DocumentRoot);
	world.spawn(DocumentRoot, Camera, Background);

	// Cache upkeep, Computed mirrors, and time-range reactions.
	observeWorld(world);

	return world;
}

export type RuntimeWorld = ReturnType<typeof createRuntimeWorld>;
