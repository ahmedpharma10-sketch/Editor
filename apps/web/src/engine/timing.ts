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
	Start,
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
 * Writes the scene's work area from a frame range of this project, or takes
 * it off with `null`. The file spells it in seconds like every other time,
 * and `false` is the value the writer drops the attribute for.
 */
export function editWorkarea(world: World, scene: Entity, range: [start: number, end: number] | null): void {
	const fps = world.get(FrameRate)?.value ?? 30;
	getDocumentEditor(world).editProperty(
		scene,
		'workarea',
		range ? [framesToSeconds(range[0], fps), framesToSeconds(range[1], fps)] : false,
	);
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

/**
 * Moves the node so it starts at scene frame `frame`, keeping everything else
 * about it: the same stretch of its source plays, for the same length, only
 * later or earlier.
 *
 * Start and End are both parent-relative — a node's length is `end - start` —
 * so a move is both of them by the same amount. Writing only the start would
 * leave the end where it was and stretch the clip, which is a trim.
 *
 * A container that takes its bounds from its children authors no End, and so
 * only its start moves: its children are placed against its origin, and they
 * all travel with it.
 */
export function moveEntityTo(world: World, entity: Entity, frame: number): void {
	const start = frame - getTimelineOrigin(entity);
	const delta = start - (entity.get(Start)?.value ?? 0);
	if (delta === 0) return;

	// Before the start, which moves the origin the end would then be read
	// against — both are worked out from what the node says now.
	const end = entity.get(End)?.value;
	if (end !== undefined) editTime(world, entity, 'end', end + delta);

	editTime(world, entity, 'start', start);
}
