/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Playhead control. Where the playhead is and whether it is moving are not
// part of the composition — nothing rendered or exported depends on them —
// so these write the traits themselves and nothing reaches the file, the
// same reason the canvas toggles Playback rather than going through an
// editor. `playbackSystem` advances the playhead from here while playing.

import { store } from '../world/store';
import { AudioEngine, Computed, FrameRate, Playback } from '../traits';

import type { Entity, World } from 'koota';

/**
 * Moves `scene`'s playhead to `frame` — a seek, which is what a scrub of the
 * ruler or a click in the timeline comes to. Both mirrors of the playhead are
 * written: the seconds are what audio is scheduled against and what the next
 * advance carries on from, the frames what everything comparing nodes works
 * in. Frames before the start of the scene do not exist; past its end they
 * do, since a scene is as long as what is in it and dropping a clip out there
 * is how it gets longer.
 */
export function setPlayhead(world: World, scene: Entity, frame: number): void {
	const computed = store(world, Computed);
	const fps = world.get(FrameRate)?.value ?? 30;
	const eid = scene.id();

	const clamped = Math.max(0, Math.round(frame));

	computed.localTime[eid] = clamped;
	computed.localTimeInSeconds[eid] = clamped / fps;
}

/**
 * Starts or stops `scene` at 1x. The audio context is gated until it has seen
 * a gesture and a play is one, so it is resumed here rather than at every
 * call site that can start playback.
 */
export function togglePlayback(world: World, scene: Entity): void {
	const playback = scene.get(Playback);
	if (!playback) return;

	scene.set(Playback, { playing: !playback.playing, speed: 1 });

	const context = world.get(AudioEngine)?.context;
	if (context instanceof AudioContext) void context.resume();
}
