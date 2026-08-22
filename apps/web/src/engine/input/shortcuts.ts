/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
import { Computed, getActiveEntity, getCameraMatrix, getEntityChildren, getParentEntity, getSelection, isGroupLike, Position, Selected, store, Time, togglePlayback, Tool, ToolType } from '@diffusionstudio/runtime';

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

/** How long space has to be held to read as a pan and not as a tap. */
const SPACE_HAND_DELAY = 200;

/**
 * The camera as it stood when space went down over the stage; null when
 * space is up, or when the press was one that cannot turn into a pan.
 */
let spaceCamera: CameraMatrix | null = null;

/**
 * The tool space borrowed the hand from, put back on release; null while
 * space does not hold the hand.
 */
let spaceTool: ToolType | null = null;

/**
 * When the space press went down, so a hold long enough to be a pan can be
 * told from a tap; null once the hand has taken over, or once space is up.
 */
let spacePressedAt: number | null = null;

/** Puts the hand in the toolbar for as long as space holds it. */
function takeHandTool(world: World): void {
	spacePressedAt = null;
	if (spaceTool !== null) return;
	spaceTool = world.get(Tool)?.value ?? ToolType.MOVE;
	world.set(Tool, { value: ToolType.HAND });
}

/** Gives back whatever tool space borrowed the hand from. */
function releaseHandTool(world: World): void {
	spacePressedAt = null;
	if (spaceTool === null) return;
	world.set(Tool, { value: spaceTool });
	spaceTool = null;
}

function toggleActivePlayback(world: World): void {
	const scene = getActiveEntity(world);
	if (scene) togglePlayback(world, scene);
}

function onSpacePressed(world: World): void {
	// The hand waits out the delay wherever the pointer is; what the pointer
	// decides is only when playback gets its toggle. Over the stage the press
	// could still become a pan, so playback waits for a release that left the
	// camera where it was; anywhere else it toggles here and now.
	spacePressedAt = world.get(Time)?.now ?? 0;

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
	releaseHandTool(world);
}

/**
 * What space does by being held rather than by moving, which the tables
 * cannot express: the hand takes over once the press outlasts
 * `SPACE_HAND_DELAY`, and a hold the window loses focus mid-way through
 * never sees a release (`held` is cleared without a lift), so the borrowed
 * tool goes back on the first frame the key is no longer down.
 */
function updateSpaceHold(world: World, held: Set<string>): void {
	if (!held.has(' ')) {
		spaceCamera = null;
		releaseHandTool(world);
		return;
	}

	if (spacePressedAt === null) return;
	if ((world.get(Time)?.now ?? 0) - spacePressedAt >= SPACE_HAND_DELAY) {
		takeHandTool(world);
	}
}

/**
 * Picks a tool. While space holds the hand the pick is what the release
 * goes back to, so the hand keeps the stage until the key is up.
 */
const selectTool = (value: ToolType) => (world: World): void => {
	if (spaceTool !== null) {
		spaceTool = value;
		return;
	}
	world.set(Tool, { value });
};

const PRESSED_SHORTCUTS: readonly Shortcut[] = [
	{ keys: ['backspace'], action: deleteSelection },
	{ keys: ['delete'], action: deleteSelection },
	{ keys: ['d', 'mod'], action: duplicateSelection },
	{ keys: ['b', 'mod'], action: splitAtPlayhead },
	{ keys: ['c', 'mod'], action: copySelection },
	{ keys: ['v', 'mod'], action: pasteSelection },
	{ keys: ['v', '!mod'], action: selectTool(ToolType.MOVE) },
	{ keys: ['h', '!mod'], action: selectTool(ToolType.HAND) },
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

	updateSpaceHold(world, keys.held);
}
