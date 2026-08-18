/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Keyboard commands on the canvas: what a key press does, as opposed to the
 * held keys that modify a gesture. The DOM listener only records (see
 * `Keys`); the shortcut system runs once a frame and, when a key was just
 * pressed, matches what is held against the table below and runs the action.
 */

import { getActiveEntity, getEntityChildren, getParentEntity, getSelection, isGroupLike, Position, Selected } from '@diffusionstudio/runtime';

import { getDocumentEditor } from '../editor';
import { Keys } from '../traits';

import type { World } from 'koota';

interface Shortcut {
	/**
	 * Keys to hold down for the shortcut to trigger. Joined with '+' to form a set of keys.
	 */
	key: string;
	mod?: boolean;
	shift?: boolean;
	alt?: boolean;
	action: (world: World) => void;
}

export function deleteSelection(world: World): void {
	const selected = [...world.query(Selected)];

	if (selected.length) {
		getDocumentEditor(world).remove(selected);
	}
};

export function duplicateSelection(world: World): void {
	const selected = [...world.query(Selected)];

	if (selected.length) {
		getDocumentEditor(world).duplicate(selected);
	}
}

export function copySelection(world: World): void {
	const selected = [...world.query(Selected)];

	if (selected.length) {
		getDocumentEditor(world).copy(selected);
	}
}

/**
 * Pastes where the selection points: into a selected container (a scene or
 * group, on top of its children), on top of a selected leaf in that leaf's
 * parent, or, with nothing selected, into the active scene. The editor keeps
 * a paste out of the sequence it was copied from.
 */
export function pasteSelection(world: World): void {
	const editor = getDocumentEditor(world);
	const [selected] = world.query(Selected);

	if (selected === undefined) {
		const active = getActiveEntity(world);
		if (active) editor.paste(active);
		return;
	}

	if (isGroupLike(selected)) {
		editor.paste(selected);
		return;
	}

	const parent = getParentEntity(selected);
	if (parent === null) return;
	const siblings = getEntityChildren(world, parent);
	editor.paste(parent, siblings[siblings.indexOf(selected) + 1]);
}

const NUDGE = 1;
const NUDGE_FAST = 10;

/**
 * Moves every selected node by `dx`, `dy` in its own parent's space, the same
 * `x`/`y` a drag writes, so a nudge is a drag of a known distance without the
 * snapping.
 */
export function nudgeSelection(world: World, dx: number, dy: number): void {
	const editor = getDocumentEditor(world);

	for (const entity of getSelection(world)) {
		const position = entity.get(Position);
		if (!position) continue;
		if (dx) editor.editProperty(entity, 'x', position.x + dx);
		if (dy) editor.editProperty(entity, 'y', position.y + dy);
	}
}

const nudge = (dx: number, dy: number) => (world: World): void => nudgeSelection(world, dx, dy);

const SHORTCUTS: readonly Shortcut[] = [
	{ key: 'backspace', action: deleteSelection },
	{ key: 'delete', action: deleteSelection },
	{ key: 'd', mod: true, action: duplicateSelection },
	{ key: 'c', mod: true, action: copySelection },
	{ key: 'v', mod: true, action: pasteSelection },
	{ key: 'arrowleft', action: nudge(-NUDGE, 0) },
	{ key: 'arrowright', action: nudge(NUDGE, 0) },
	{ key: 'arrowup', action: nudge(0, -NUDGE) },
	{ key: 'arrowdown', action: nudge(0, NUDGE) },
	{ key: 'arrowleft', shift: true, action: nudge(-NUDGE_FAST, 0) },
	{ key: 'arrowright', shift: true, action: nudge(NUDGE_FAST, 0) },
	{ key: 'arrowup', shift: true, action: nudge(0, -NUDGE_FAST) },
	{ key: 'arrowdown', shift: true, action: nudge(0, NUDGE_FAST) },
];

/**
 * On a frame with a fresh press, runs the shortcut the held keys spell, then
 * resets the frame's press and lift flags: it is the last reader of them.
 */
export function shortcutSystem(world: World): void {
	const keys = world.get(Keys);
	if (!keys?.justPressed) return;


	const shortcut = SHORTCUTS.find(
		(shortcut) =>
			shortcut.key.split('+').every(key => keys.held.has(key)) &&
			keys.held.has('mod') === !!shortcut.mod &&
			keys.held.has('shift') === !!shortcut.shift &&
			keys.held.has('alt') === !!shortcut.alt,
	);

	shortcut?.action(world);
}
