/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from 'koota';

import { TransitionType } from '../constants';

// Offset where the node starts inside its parent's timeline (frames).
export const Delay = trait({ value: 0 });

// Speed multiplier for the node's local time (1 = normal).
export const PlaybackRate = trait({ value: 1 });

// Explicit duration window in the clip's own local time. When present, the
// node has fixed bounds (workarea on scenes, trimmed source on media clips).
// When absent: scenes auto-fit to their children, other nodes have no
// inherent duration (the runtime adds Trim immediately on creation).
export const Trim = trait({ start: 0, end: 0 });

// Explicit playback/export window on a scene.
export const Workarea = trait({ start: 0, end: 0 });

// Playback state of an entity.
export const Playback = trait({
	playing: false,
	loop: false,
	speed: 1, // playback speed multiplier (negative = reverse)
});

// Tag marking a container whose direct children cannot overlap in time.
// Drag/trim of any direct child clamps at the neighbour's edge.
export const Sequential = trait();

// Transition between adjacent clips in a track. Stored on clip entities:
// describes the transition INTO this clip from the previous one.
export const Transition = trait({
	type: TransitionType.DISSOLVE as TransitionType,
	duration: 0, // frames
});

// Per-clip user-customized timeline row height (persisted).
export const ClipHeight = trait({ value: 0 });

// Tag: this clip's keyframe rows are expanded below the clip body (persisted).
export const Expanded = trait();
