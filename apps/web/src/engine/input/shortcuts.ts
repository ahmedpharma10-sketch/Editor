/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Keyboard commands on the canvas: what a key press does, as opposed to the
 * held keys that modify a gesture. The DOM listener only records (see
 * `Keys`); the shortcut system runs once a frame and, when a key was just
 * pressed, matches what is held against the table below and runs the action.
 * Space is the exception the table cannot hold — it is also the pan
 * modifier, so what it does depends on where the pointer is and on whether
 * the camera moved while it was down; see `playbackShortcut`.
 */

import { Computed, getActiveEntity, getCameraMatrix, getEntityChildren, getParentEntity, getSelection, isGroupLike, Position, Selected, store, togglePlayback } from '@diffusionstudio/runtime';

import { getDocumentEditor } from '../editor';
import { splitAtPlayhead } from '../split';
import { Keys, Pointer } from '../traits';
import { editTransform } from './interactions';

import type { TransformWrite } from './interactions';
import type { CameraMatrix } from '@diffusionstudio/runtime';
import type { World } from 'koota';

type Shortcut = {
	keys: string[];
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
 * snapping. Measured from where the node is drawn rather than from the prop,
 * and written to the position track as well as the prop, so nudging an
 * animated node moves it from where its keyframes put it (a drag does the
 * same; see `editTransform`).
 */
export function nudgeSelection(world: World, dx: number, dy: number): void {
	const editor = getDocumentEditor(world);
	const computed = store(world, Computed);

	for (const entity of getSelection(world)) {
		if (!entity.has(Position)) continue;
		const eid = entity.id();

		const writes: TransformWrite[] = [];
		if (dx) writes.push(['x', Math.round((computed.positionX[eid] ?? 0) + dx)]);
		if (dy) writes.push(['y', Math.round((computed.positionY[eid] ?? 0) + dy)]);
		editTransform(world, editor, entity, writes);
	}
}

const nudge = (dx: number, dy: number) => (world: World): void => nudgeSelection(world, dx, dy);

/**
 * The camera as it stood when space went down over the stage; null when
 * space is up, or when the press was one that cannot turn into a pan.
 */
let spaceCamera: CameraMatrix | null = null;

function toggleActivePlayback(world: World): void {
	const scene = getActiveEntity(world);
	if (scene) togglePlayback(world, scene);
}

function onSpacePressed(world: World): void {
	if (world.get(Pointer)?.over) {
		spaceCamera = getCameraMatrix(world);
	} else {
		spaceCamera = null;
		toggleActivePlayback(world);
	}
}

function onSpaceLifted(world: World): void {
	const camera = getCameraMatrix(world);
	if (spaceCamera?.every((value, index) => value === camera[index])) {
		toggleActivePlayback(world);
	}
	spaceCamera = null;
}

const PRESSED_SHORTCUTS: readonly Shortcut[] = [
	{ keys: ['backspace'], action: deleteSelection },
	{ keys: ['delete'], action: deleteSelection },
	{ keys: ['d', 'mod'], action: duplicateSelection },
	{ keys: ['b', 'mod'], action: splitAtPlayhead },
	{ keys: ['c', 'mod'], action: copySelection },
	{ keys: ['v', 'mod'], action: pasteSelection },
	{ keys: ['arrowleft', '!shift'], action: nudge(-NUDGE, 0) },
	{ keys: ['arrowright', '!shift'], action: nudge(NUDGE, 0) },
	{ keys: ['arrowup', '!shift'], action: nudge(0, -NUDGE) },
	{ keys: ['arrowdown', '!shift'], action: nudge(0, NUDGE) },
	{ keys: ['arrowleft', 'shift'], action: nudge(-NUDGE_FAST, 0) },
	{ keys: ['arrowright', 'shift'], action: nudge(NUDGE_FAST, 0) },
	{ keys: ['arrowup', 'shift'], action: nudge(0, -NUDGE_FAST) },
	{ keys: ['arrowdown', 'shift'], action: nudge(0, NUDGE_FAST) },
	{ keys: [' '], action: onSpacePressed },
];

const LIFTED_SHORTCUTS: readonly Shortcut[] = [
	{ keys: [' '], action: onSpaceLifted },
];

/**
 * Whether `moved` — the keys that went down, or up, this frame — spells the
 * shortcut: one of its keys has to be the one that moved, the rest have to
 * be held, and a '!' key has to be up. The key that moved is matched
 * against `moved` rather than `held` because a lift takes it out of `held`,
 * and a tap shorter than a frame is over before the frame runs.
 */
function matches(shortcut: Shortcut, moved: Set<string>, held: Set<string>): boolean {
	let triggered = false;

	for (const key of shortcut.keys) {
		if (key.startsWith('!')) {
			if (held.has(key.slice(1))) return false;
		} else if (moved.has(key)) {
			triggered = true;
		} else if (!held.has(key)) {
			return false;
		}
	}

	return triggered;
}

/** On a frame with a fresh press or release, runs the shortcut it spells. */
export function shortcutSystem(world: World): void {
	const keys = world.get(Keys);
	if (!keys) return;

	if (keys.pressed.size) {
		PRESSED_SHORTCUTS.find(shortcut => matches(shortcut, keys.pressed, keys.held))?.action(world);
	}

	if (keys.lifted.size) {
		LIFTED_SHORTCUTS.find(shortcut => matches(shortcut, keys.lifted, keys.held))?.action(world);
	}
}
