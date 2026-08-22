/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ToolType, ChildOf } from '../components';
import {
	copySelection,
	pasteClipboard,
	duplicateSelection,
	togglePlayback,
	shuttleForward,
	shuttleReverse,
	stopPlayback,
	splitAtPlayhead,
	groupSelection,
	ungroupSelection,
	frameSelection,
	isScene,
	isText,
	deleteEntity,
	switchActiveScene,
	reorderSelection,
	getParentEntity,
	isSequence,
} from '../api';
import {
	selectStageEntities,
	selectParentEntities,
	selectChildEntities,
} from '../selection';
import { SPACE_HOLD_DELAY_MS } from '../constants';
import { isInputTarget } from '@/utils';
import { query, None, hasComponent, Or, Not } from 'bitecs';
import { addComponent, clearComponent, removeComponent, setComponent } from '../api/events';

import type { EngineWorld } from '../api/world';
import type { Camera } from './camera-controller';

type KeyboardHandler = (e: KeyboardEvent) => void;

export function createKeyboardSystem(world: EngineWorld, camera: Camera) {
	const c = world.components;
	const history = world.history;

	let spaceHandTimer: number | undefined;
	let spaceDownCameraHash: string | undefined;
	let timelineFocused = false;

	const onTimelineEnter = () => { timelineFocused = true; };
	const onTimelineLeave = () => { timelineFocused = false; };

	const cameraHash = () =>
		`${world.camera.a},${world.camera.d},${world.camera.e},${world.camera.f}`;

	const moveSelection = (amount: number, axis: 'x' | 'y') => {
		world.history.transaction('Nudge', () => {
			for (const eid of query(world, [c.Selected, Or(c.Geometry, c.Group, c.AdjustmentLayer)])) {
				setComponent(world, eid, c.Position, { [axis]: (c.Position[axis][eid] ?? 0) + amount });
			}
		});
	};

	const seek = (deltaFrames: number) => {
		const sid = world.selection.scene;
		const fps = world.frameRate;
		if (sid === null) return;
		const next = c.Computed.localTime[sid] + deltaFrames;
		c.Computed.localTimeInSeconds[sid] = next / fps;
		c.Computed.localTime[sid] = next;
	};

	const deleteSelection = () => {
		const selection = [...query(world, [world.components.Selected])];
		const activeScene = world.selection.scene;

		// Tracks owning any selected keyframe — a track whose every keyframe is
		// deleted is empty and should go too (mirrors toggleKeyframeTrack).
		const keyframeTracks = new Set<number>();
		// Parents of any selected node — candidates for empty-sequence cleanup.
		const containers = new Set<number>();
		for (const eid of selection) {
			if (hasComponent(world, eid, c.Keyframe)) {
				const tid = getParentEntity(world, eid);
				if (tid !== null) keyframeTracks.add(tid);
			} else {
				const pid = getParentEntity(world, eid);
				if (pid !== null) containers.add(pid);
			}
		}

		world.history.transaction('Delete', () => {
			selection.forEach(eid => deleteEntity(world, eid));

			for (const tid of keyframeTracks) {
				if (query(world, [c.Keyframe, ChildOf(tid), Not(c.Deleted)]).length === 0) {
					deleteEntity(world, tid);
				}
			}

			// A sequence emptied by the deletion is dropped too, cascading to any
			// parent sequence it in turn empties.
			for (const start of containers) {
				let pid: number | null = start;
				while (pid !== null && !hasComponent(world, pid, c.Deleted) && isSequence(world, pid)) {
					if (query(world, [Or(c.Geometry, c.Group, c.AdjustmentLayer), ChildOf(pid), Not(c.Deleted)]).length > 0) break;
					const parent = getParentEntity(world, pid);
					deleteEntity(world, pid);
					pid = parent;
				}
			}
		});
		clearComponent(world, c.Selected, false);

		if (selection.find(eid => eid === activeScene)) {
			const children = query(world, [c.Geometry, None(ChildOf('*'), c.Deleted, c.Hidden)]);
			const nextScene = children.find((eid: number) => isScene(world, eid));
			switchActiveScene(world, nextScene ?? null);
		}
	};

	const handleSpaceDown = () => {
		if (!spaceDownCameraHash) {
			spaceDownCameraHash = cameraHash();
			if (timelineFocused) {
				togglePlayback(world);
			}
		}
		if (!spaceHandTimer) {
			spaceHandTimer = window.setTimeout(() => {
				world.selection.tool = ToolType.HAND;
				spaceHandTimer = undefined;
			}, SPACE_HOLD_DELAY_MS);
		}
	};

	const handleSpaceUp = () => {
		if (spaceHandTimer) {
			clearTimeout(spaceHandTimer);
			spaceHandTimer = undefined;
		}
		if (spaceDownCameraHash && !timelineFocused) {
			if (spaceDownCameraHash === cameraHash()) {
				togglePlayback(world);
			}
		}
		spaceDownCameraHash = undefined;
		world.selection.tool = ToolType.MOVE;
	};

	// ── Modifier key handlers ──

	const modUndo: KeyboardHandler = (e) => {
		e.preventDefault();
		if (e.shiftKey) {
			history.redo();
		} else {
			history.undo();
		}
	};

	const modCopy: KeyboardHandler = (e) => {
		if (!isInputTarget(e)) {
			e.preventDefault();
			copySelection(world);
		}
	};

	const modPaste: KeyboardHandler = (e) => {
		if (!isInputTarget(e)) {
			e.preventDefault();
			pasteClipboard(world);
		}
	};

	const modCut: KeyboardHandler = (e) => {
		if (!isInputTarget(e)) {
			e.preventDefault();
			copySelection(world);
			deleteSelection();
		}
	};

	const modDuplicate: KeyboardHandler = (e) => {
		if (!isInputTarget(e)) {
			e.preventDefault();
			duplicateSelection(world);
		}
	};

	const modSplit: KeyboardHandler = (e) => {
		if (!isInputTarget(e)) {
			e.preventDefault();
			splitAtPlayhead(world);
		}
	};

	const modBold: KeyboardHandler = (e) => {
		const eids = [...query(world, [c.Selected, c.Geometry])].filter(eid => isText(world, eid));
		if (eids.length === 0) {
			modSplit(e);
			return;
		}
		e.preventDefault();
		const allBold = eids.every((eid) => (c.TextStyle.fontWeight[eid] ?? '400') === '700');
		world.history.transaction('Toggle bold', () => {
			eids.forEach(eid => setComponent(world, eid, c.TextStyle, {
				fontWeight: allBold ? '400' : '700'
			}));
		});
	};

	const modHide: KeyboardHandler = (e) => {
		if (!e.shiftKey || isInputTarget(e)) return;
		e.preventDefault();

		const eids = query(world, [c.Selected, Or(c.Geometry, c.Group, c.AdjustmentLayer)]);
		const anyVisible = Array.from(eids).some((eid) => !hasComponent(world, eid, c.Hidden));

		world.history.transaction(anyVisible ? 'Hide' : 'Show', () => {
			if (anyVisible) {
				eids.forEach(eid => addComponent(world, eid, c.Hidden));
			} else {
				eids.forEach(eid => removeComponent(world, eid, c.Hidden));
			}
		});
	};

	const modGroup: KeyboardHandler = (e) => {
		if (isInputTarget(e)) return;
		e.preventDefault();
		if (e.altKey) {
			// Cmd/Ctrl+Alt+G — wrap the selection in a frame (scene) instead of a group.
			frameSelection(world);
		} else if (e.shiftKey) {
			ungroupSelection(world);
		} else {
			groupSelection(world);
		}
	};

	const modSequential: KeyboardHandler = (e) => {
		if (isInputTarget(e)) return;
		e.preventDefault();
		if (e.shiftKey) {
			ungroupSelection(world);
		} else {
			groupSelection(world, true);
		}
	};

	const modSelectAll: KeyboardHandler = (e) => {
		if (isInputTarget(e)) return;
		e.preventDefault();
		selectStageEntities(world);
	};

	const modZoomIn: KeyboardHandler = (e) => {
		e.preventDefault();
		camera.zoomBy(1.25);
	};

	const modZoomOut: KeyboardHandler = (e) => {
		e.preventDefault();
		camera.zoomBy(0.8);
	};

	const modZoomReset: KeyboardHandler = (e) => {
		e.preventDefault();
		camera.resetZoom();
	};

	const modZoomFit: KeyboardHandler = (e) => {
		if (isInputTarget(e)) return;
		e.preventDefault();
		camera.fitToActiveScene();
	};

	const modZoomSelection: KeyboardHandler = (e) => {
		if (isInputTarget(e)) return;
		e.preventDefault();
		camera.fitToSelection();
	};

	// ── Non-modifier key handlers ──
	const onSeekBackFrame: KeyboardHandler = () => seek(-1);
	const onSeekForwardFrame: KeyboardHandler = () => seek(1);
	const onSeekForwardSec: KeyboardHandler = () => seek(world.frameRate);
	const onSeekBackSec: KeyboardHandler = () => seek(-world.frameRate);
	const onMoveLeft: KeyboardHandler = (e) => moveSelection(e.shiftKey ? -10 : -1, 'x');
	const onMoveRight: KeyboardHandler = (e) => moveSelection(e.shiftKey ? 10 : 1, 'x');
	const onMoveUp: KeyboardHandler = (e) => moveSelection(e.shiftKey ? -10 : -1, 'y');
	const onMoveDown: KeyboardHandler = (e) => moveSelection(e.shiftKey ? 10 : 1, 'y');
	const onSpace: KeyboardHandler = (e) => {
		e.preventDefault();
		handleSpaceDown();
	};
	const onDelete: KeyboardHandler = (e) => {
		e.preventDefault();
		deleteSelection();
	};
	const onShuttleForward: KeyboardHandler = () => shuttleForward(world);
	const onShuttleReverse: KeyboardHandler = () => shuttleReverse(world);
	const onStopPlayback: KeyboardHandler = () => stopPlayback(world);
	const onToolMove: KeyboardHandler = () => (world.selection.tool = ToolType.MOVE);
	const onToolHand: KeyboardHandler = () => (world.selection.tool = ToolType.HAND);
	const onToolScene: KeyboardHandler = () => (world.selection.tool = ToolType.SCENE);
	const onToolText: KeyboardHandler = () => (world.selection.tool = ToolType.TEXT);
	const onToolRect: KeyboardHandler = () => (world.selection.tool = ToolType.RECT);
	const onSelectParent: KeyboardHandler = (e) => {
		e.preventDefault();
		selectParentEntities(world);
	};
	const onSelectChildren: KeyboardHandler = (e) => {
		e.preventDefault();
		selectChildEntities(world);
	};
	const onBringToFront: KeyboardHandler = (e) => {
		e.preventDefault();
		reorderSelection(world, 'front');
	};
	const onSendToBack: KeyboardHandler = (e) => {
		e.preventDefault();
		reorderSelection(world, 'back');
	};
	const onDeselect: KeyboardHandler = (e) => {
		e.preventDefault();
		clearComponent(world, c.Selected, false);
		const tool = world.selection.tool;
		if (tool === ToolType.MOVE || tool === ToolType.HAND) return;
		world.selection.tool = ToolType.MOVE;
	};

	// ── Keybinding tables ──

	const modBindings: Record<string, KeyboardHandler> = {
		'z': modUndo,
		'c': modCopy,
		'v': modPaste,
		'x': modCut,
		'd': modDuplicate,
		'b': modBold,
		'h': modHide,
		'g': modGroup,
		's': modSequential,
		'a': modSelectAll,
		'=': modZoomIn,
		'+': modZoomIn,
		'-': modZoomOut,
		'0': modZoomReset,
		'1': modZoomFit,
		'2': modZoomSelection,
	};

	const keyBindings: Record<string, KeyboardHandler> = {
		' ': onSpace,
		'arrowleft': onMoveLeft,
		'arrowright': onMoveRight,
		'arrowup': onMoveUp,
		'arrowdown': onMoveDown,
		'a': onSeekBackFrame,
		'd': onSeekForwardFrame,
		'w': onSeekForwardSec,
		's': onSeekBackSec,
		'backspace': onDelete,
		'delete': onDelete,
		'j': onShuttleReverse,
		'k': onStopPlayback,
		'l': onShuttleForward,
		'v': onToolMove,
		'h': onToolHand,
		'f': onToolScene,
		't': onToolText,
		'r': onToolRect,
		'\\': onSelectParent,
		'enter': onSelectChildren,
		'escape': onDeselect,
		']': onBringToFront,
		'[': onSendToBack,
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		const isMod = e.metaKey || e.ctrlKey;

		if (isMod) {
			// On macOS, holding Option rewrites e.key for letter keys (Opt+G → "©"),
			// so fall back to the layout's physical code when Alt is held.
			const key = e.altKey && /^Key[A-Z]$/.test(e.code)
				? e.code.slice(3).toLowerCase()
				: e.key.toLowerCase();
			modBindings[key]?.(e);
			return;
		}

		if (isInputTarget(e)) return;
		keyBindings[e.key.toLowerCase()]?.(e);
	};

	const handleKeyUp = (e: KeyboardEvent) => {
		if (e.key === ' ' && !isInputTarget(e)) {
			e.preventDefault();
			handleSpaceUp();
		}
	};

	function init() {
		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('keyup', handleKeyUp);

		const timelineCanvas = document.getElementById('timeline-canvas');
		timelineCanvas?.addEventListener('mouseenter', onTimelineEnter);
		timelineCanvas?.addEventListener('mouseleave', onTimelineLeave);
	}

	function dispose() {
		window.removeEventListener('keydown', handleKeyDown);
		window.removeEventListener('keyup', handleKeyUp);
		if (spaceHandTimer) clearTimeout(spaceHandTimer);

		const timelineCanvas = document.getElementById('timeline-canvas');
		timelineCanvas?.removeEventListener('mouseenter', onTimelineEnter);
		timelineCanvas?.removeEventListener('mouseleave', onTimelineLeave);
	}

	return { init, dispose };
}
