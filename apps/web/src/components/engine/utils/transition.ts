/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { EngineWorld } from '../api/world';

export type TransitionWindow = { start: number; end: number; midpointFrame: number };

/**
 * Compute the transition window between two adjacent clips.
 *
 * The left clip must have a Transition component.
 * Returns null if no transition is defined.
 */
export function getTransitionWindow(
	world: EngineWorld,
	leftEid: number,
	rightEid: number,
): TransitionWindow {
	const Transition = world.components.Transition;
	const Computed = world.components.Computed;

	const leftEnd = Computed.end[leftEid];
	const rightStart = Computed.start[rightEid];

	// Midpoint between the two clips, but never before the left clip ends
	const midpointFrame = Math.max(Math.floor((leftEnd + rightStart) / 2), leftEnd);

	const duration = Transition.duration[leftEid] ?? 1;
	const start = midpointFrame - duration / 2;
	const end = midpointFrame + duration / 2;

	return { start, end, midpointFrame };
}
