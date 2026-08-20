/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Where a node sits on the timeline, moved the way every editor change moves:
 * the document for the canvas, an edit for the file. The runtime has
 * `trimEntityIn`/`trimEntityOut`, which write the traits themselves — that
 * moves the clip on screen and nowhere else — so everything that trims a clip
 * (the inspector's fields, the timeline's handles, a split) goes through here
 * instead, and the file hears about it.
 */

import {
	Computed,
	End,
	FrameRate,
	SourceOut,
	framesToSeconds,
	getSourceFrameAt,
	getTimelineOrigin,
} from '@diffusionstudio/runtime';

import { getDocumentEditor } from './editor';

import type { Entity, World } from 'koota';

/** The time a node authors, in the vocabulary of the JSX rather than the traits'. */
export type TimeProp = 'start' | 'end' | 'sourceIn' | 'sourceOut';

/**
 * Writes a time prop from a frame count of this project; the file spells
 * times in seconds. `null` unsets it: the document drops the trait, and the
 * writer spells it as the attribute's absence (`false` is the one PropValue
 * it removes for). A `start` or `sourceIn` of 0 is unset too, since absence
 * is what 0 reads as on those.
 */
export function editTime(world: World, entity: Entity, name: TimeProp, frames: number | null): void {
	const unset = frames === null || (frames === 0 && (name === 'start' || name === 'sourceIn'));
	const fps = world.get(FrameRate)?.value ?? 30;
	getDocumentEditor(world).editProperty(entity, name, unset ? false : framesToSeconds(frames, fps));
}

/**
 * Moves the node's in point to scene frame `frame`, keeping the rest of the
 * clip where it is: the runtime's `trimEntityIn`, as edits. The out point is
 * only implied while the node authors no End, so it is pinned first, or the
 * tail would follow the head; then Start moves and SourceIn rolls forward by
 * as much as the head lost.
 */
export function trimIn(world: World, entity: Entity, frame: number): void {
	if (!entity.has(End)) {
		editTime(world, entity, 'end', (entity.get(Computed)?.end ?? 0) - getTimelineOrigin(entity));
	}
	// Both read the origin, which the Start write moves.
	const start = frame - getTimelineOrigin(entity);
	const source = getSourceFrameAt(entity, frame);
	editTime(world, entity, 'start', start);
	editTime(world, entity, 'sourceIn', source);
}

/**
 * Moves the node's out point to scene frame `frame` (the runtime's
 * `trimEntityOut`, as edits). The source window follows only when the node
 * authors one; otherwise End alone says where the clip runs out.
 */
export function trimOut(world: World, entity: Entity, frame: number): void {
	if (entity.has(SourceOut)) {
		editTime(world, entity, 'sourceOut', getSourceFrameAt(entity, frame));
	}
	editTime(world, entity, 'end', frame - getTimelineOrigin(entity));
}
