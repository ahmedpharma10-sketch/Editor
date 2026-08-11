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

/**
 * World with the headless runtime singletons attached. The host injects its
 * surfaces after creation (world.set(RenderSurface, ...) and
 * world.set(AudioEngine, ...)); the editor app layers its own world traits on
 * top (input, history, persistence, asset stores).
 */
export function createRuntimeWorld(projectId: string) {
	return createWorld(
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
}

export type RuntimeWorld = ReturnType<typeof createRuntimeWorld>;
