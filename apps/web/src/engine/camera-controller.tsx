/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Input bindings for the stage camera. The camera's semantics live in the
// runtime (pan/zoom/focus actions); this file only translates DOM events into
// calls on them, which is why it stays app-side.

import { createEffect, createMemo, onCleanup } from 'solid-js';
import { useTrait, useWorld } from '@diffusionstudio/koota-solid';
import { panCamera, setCamera, zoomCameraAt, getCamera, RenderSurface } from '@diffusionstudio/runtime';

import type { JSX } from 'solid-js';
import type { World } from 'koota';

/** deltaY is in lines (deltaMode 1) or pages (deltaMode 2) on some devices. */
const DELTA_MODE_SCALE = [1, 16, 600];

/** Cap a single wheel notch so a coarse mouse wheel doesn't jump zoom levels. */
const MAX_ZOOM_DELTA = 50;

/** Wheel pixels → zoom exponent. Higher = faster ctrl/pinch zoom. */
const ZOOM_SENSITIVITY = 0.01;

const MIDDLE_BUTTON = 1;

function isEditable(target: EventTarget | null): boolean {
	if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
	return target instanceof HTMLElement && target.isContentEditable;
}

/**
 * Bind camera gestures to `canvas` and return a disposer. Pointer and wheel
 * events are canvas-scoped so the rest of the editor keeps its own scrolling;
 * the space-key modifier is tracked on the document (and window blur) because
 * a held key is global state the canvas never sees.
 */
function bindCameraInput(world: World, canvas: HTMLCanvasElement): () => void {
	let spaceHeld = false;
	let panning = false;
	let panPointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let startE = 0;
	let startF = 0;

	const updateCursor = (): void => {
		canvas.style.cursor = panning ? 'grabbing' : (spaceHeld ? 'grab' : '');
	};

	/** Pointer position in canvas CSS pixels. */
	const localPoint = (event: { clientX: number; clientY: number }): [x: number, y: number] => {
		const rect = canvas.getBoundingClientRect();
		return [event.clientX - rect.left, event.clientY - rect.top];
	};

	const endPan = (): void => {
		if (!panning) return;
		panning = false;
		if (panPointerId !== null && canvas.hasPointerCapture(panPointerId)) {
			canvas.releasePointerCapture(panPointerId);
		}
		panPointerId = null;
		updateCursor();
	};

	const handleWheel = (event: WheelEvent): void => {
		// The page must not scroll and the browser must not run its own
		// ctrl-wheel page zoom while the cursor is over the stage.
		event.preventDefault();

		const scale = DELTA_MODE_SCALE[event.deltaMode] ?? 1;

		if (event.ctrlKey || event.metaKey) {
			const [x, y] = localPoint(event);
			const dy = Math.max(-MAX_ZOOM_DELTA, Math.min(MAX_ZOOM_DELTA, event.deltaY * scale));
			zoomCameraAt(world, x, y, Math.exp(-dy * ZOOM_SENSITIVITY));
		} else {
			panCamera(world, event.deltaX * scale, event.deltaY * scale);
		}
	};

	const handlePointerDown = (event: PointerEvent): void => {
		if (panning) return;
		if (!spaceHeld && event.button !== MIDDLE_BUTTON) return;

		// Middle-click would otherwise start autoscroll on some platforms.
		event.preventDefault();

		panning = true;
		panPointerId = event.pointerId;
		canvas.setPointerCapture(event.pointerId);

		[startX, startY] = localPoint(event);
		const camera = getCamera(world);
		startE = camera.e;
		startF = camera.f;
		updateCursor();
	};

	const handlePointerMove = (event: PointerEvent): void => {
		if (!panning || event.pointerId !== panPointerId) return;

		// Absolute offset from the drag origin rather than per-move deltas, so
		// a long drag can't accumulate rounding error.
		const [x, y] = localPoint(event);
		setCamera(world, { e: startE + (x - startX), f: startF + (y - startY) });
	};

	const handlePointerUp = (event: PointerEvent): void => {
		if (event.pointerId !== panPointerId) return;
		endPan();
	};

	const handleKeyDown = (event: KeyboardEvent): void => {
		if (event.code !== 'Space' || event.repeat || isEditable(event.target)) return;
		spaceHeld = true;
		updateCursor();
	};

	const handleKeyUp = (event: KeyboardEvent): void => {
		if (event.code !== 'Space') return;
		spaceHeld = false;
		// Releasing space mid-drag ends the pan even though the pointer is
		// still down, matching how the pan was armed.
		endPan();
		updateCursor();
	};

	const handleBlur = (): void => {
		// Key-up never arrives when focus leaves mid-hold (⌘-tab, devtools).
		spaceHeld = false;
		endPan();
		updateCursor();
	};

	canvas.addEventListener('wheel', handleWheel, { passive: false });
	canvas.addEventListener('pointerdown', handlePointerDown);
	canvas.addEventListener('pointermove', handlePointerMove);
	canvas.addEventListener('pointerup', handlePointerUp);
	canvas.addEventListener('pointercancel', handlePointerUp);
	document.addEventListener('keydown', handleKeyDown);
	document.addEventListener('keyup', handleKeyUp);
	window.addEventListener('blur', handleBlur);

	return () => {
		canvas.removeEventListener('wheel', handleWheel);
		canvas.removeEventListener('pointerdown', handlePointerDown);
		canvas.removeEventListener('pointermove', handlePointerMove);
		canvas.removeEventListener('pointerup', handlePointerUp);
		canvas.removeEventListener('pointercancel', handlePointerUp);
		document.removeEventListener('keydown', handleKeyDown);
		document.removeEventListener('keyup', handleKeyUp);
		window.removeEventListener('blur', handleBlur);
		endPan();
	};
}

/**
 * Gives the stage its camera gestures: wheel to scroll-pan, ctrl/⌘-wheel (and
 * trackpad pinch, which browsers report the same way) to zoom at the cursor,
 * and drag to pan while space is held or with the middle button. Renders
 * nothing — drop it anywhere under an EngineProvider, in any order relative to
 * EngineCanvas: it follows the canvas through the world's RenderSurface, so it
 * binds as soon as one is mounted and rebinds if it is replaced.
 */
export function CameraController(): JSX.Element {
	const world = useWorld();
	const surface = useTrait(world, RenderSurface);

	// Memoized on identity: RenderSurface also changes on every resize, and
	// listeners must not be torn down and rebuilt for that.
	const canvas = createMemo(() => {
		const target = surface()?.canvas;
		return target instanceof HTMLCanvasElement ? target : null;
	});

	createEffect(() => {
		const target = canvas();
		if (target) onCleanup(bindCameraInput(world, target));
	});

	return null;
}
