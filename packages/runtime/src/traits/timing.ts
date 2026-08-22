/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from 'koota';

import { TransitionType } from '../constants';

// The authored time of a node, in the vocabulary the JSX uses. One trait per
// value, all frames, because a clip rarely says more than one of these things:
// they are separate answers to separate questions, and absence is the answer
// most nodes give. `resolveTimeRange` in actions/timing.ts fills the gaps.
//
// Start/End place the node on its parent's timeline. Absent Start is 0 (begin
// with the parent), absent End is the source's natural duration, or 16s for a
// node with no source. Scenes and groups without an End fit their children.
export const Start = trait({ value: 0 });
export const End = trait({ value: 0 });

// SourceIn/SourceOut pick the slice of the node's own source that plays there.
// Absent SourceIn is 0 (from the top), absent SourceOut is the natural end.
export const SourceIn = trait({ value: 0 });
export const SourceOut = trait({ value: 0 });

// Frames per second a frames-directory source is played at, which is the only
// thing that says how long it lasts: a folder of pictures has a count, not a
// duration. Absent means the rate the library gave the asset. Nothing for
// encoded media to read — a video file carries its own rate — and unrelated to
// PlaybackRate, which retimes whatever the source's natural speed turns out to
// be; this is what that speed is.
export const SourceFrameRate = trait({ value: 0 });

// Speed multiplier for the node's local time (1 = normal). Scales the source
// window against the timeline window: at 2, twice the source frames fit into
// the same stretch of timeline.
export const PlaybackRate = trait({ value: 1 });

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
