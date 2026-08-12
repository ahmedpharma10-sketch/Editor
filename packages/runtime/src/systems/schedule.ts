/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Deterministic system order for one frame, shared by the realtime tick and
// the capture loop (which sets Time/playheads explicitly, runs this, then
// awaits FramePromises before sampling). The app's tick wraps this with its
// browser-only systems (input before, HUD/dom sync after).

import { playbackSystem } from './playback';
import { motionSystem } from './motion';
import { transformSystem } from './transform';
import { renderSystem } from './render';

import type { World } from 'koota';

export function runSystems(world: World): void {
	playbackSystem(world);
	motionSystem(world);
	transformSystem(world);
	renderSystem(world);
}
