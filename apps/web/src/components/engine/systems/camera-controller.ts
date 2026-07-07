/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { persistWorldState } from '../api';
import { isPanMode } from './input-system';
import { ToolType } from '../components';

import type { EngineWorld } from '../api/world';
import { Or, query } from 'bitecs';

export type Camera = ReturnType<typeof createCameraController>;

export function createCameraController(world: EngineWorld) {
	let isPanning = false;
	let panStartX = 0;
	let panStartY = 0;
	let panStartCamera: [e: number, f: number];

	const c = world.components;

	let canvas: HTMLCanvasElement | null = null;
	const cam = world.camera;


	/** Pan the camera by a screen-space delta (CSS pixels). */
	const pan = (screenDx: number, screenDy: number): void => {
		const { a, b, c, d, e, f } = cam;

		// Invert the camera to convert screen delta to world delta
		const det = a * d - b * c;
		if (Math.abs(det) < 1e-12) return;

		const invDet = 1 / det;
		const worldDx = (d * screenDx - c * screenDy) * invDet;
		const worldDy = (-b * screenDx + a * screenDy) * invDet;

		// Translate: M' = M * T(-worldDelta)
		cam.e = e - (a * worldDx + c * worldDy);
		cam.f = f - (b * worldDx + d * worldDy);
	}

	/**
	 * Zoom the camera towards a screen point (CSS pixels).
	 * @param screenX  Cursor X in CSS pixels relative to the canvas
	 * @param screenY  Cursor Y in CSS pixels relative to the canvas
	 * @param factor   Zoom multiplier (>1 = zoom in, <1 = zoom out)
	 */
	const zoom = (screenX: number, screenY: number, factor: number): void => {
		const { a, b, c, d, e, f } = cam;

		// Convert screen point to world coordinates via camera inverse
		const det = a * d - b * c;
		if (Math.abs(det) < 1e-12) return;
		const invDet = 1 / det;

		const worldX = invDet * (d * (screenX - e) - c * (screenY - f));
		const worldY = invDet * (-b * (screenX - e) + a * (screenY - f));

		// Clamp resulting scale
		const currentScale = Math.hypot(a, b);
		const targetScale = currentScale * factor;
		const clampedScale = Math.max(0.01, Math.min(10, targetScale));
		const s = clampedScale / currentScale;

		// M' = T(world) * S(s) * T(-world) * M
		cam.a = a * s;
		cam.b = b * s;
		cam.c = c * s;
		cam.d = d * s;
		cam.e = screenX - (a * s * worldX + c * s * worldY);
		cam.f = screenY - (b * s * worldX + d * s * worldY);
	}

	/** Zoom at the canvas center by a factor (>1 zoom in, <1 zoom out). */
	const zoomBy = (factor: number): void => {
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		zoom(rect.width / 2, rect.height / 2, factor);
		persistWorldState(world);
	}

	/** Reset camera zoom to 100% at the canvas center. */
	const resetZoom = (): void => {
		const currentScale = Math.hypot(cam.a, cam.b);
		if (currentScale > 0) zoomBy(1 / currentScale);
	}

	/**
	 * Center the camera on a world-space rectangle with optional padding.
	 * @param bounds  { x, y, width, height } in world coordinates
	 * @param padding Padding in CSS pixels
	 */
	const centerRect = (bounds: { x: number; y: number; width: number; height: number }, padding = 80): void => {
		const parent = canvas?.parentElement;
		if (!parent) return;

		const rect = parent.getBoundingClientRect();
		const screenWidth = rect.width;
		const screenHeight = rect.height;

		const scaleX = (screenWidth - padding * 2) / bounds.width;
		const scaleY = (screenHeight - padding * 2) / bounds.height;
		const scale = Math.min(scaleX, scaleY, 1);

		const centerX = bounds.x + bounds.width / 2;
		const centerY = bounds.y + bounds.height / 2;
		const tx = screenWidth / 2 - centerX * scale;
		const ty = screenHeight / 2 - centerY * scale;

		cam.a = scale;
		cam.b = 0;
		cam.c = 0;
		cam.d = scale;
		cam.e = tx;
		cam.f = ty;

		persistWorldState(world);
	}

	/**
	 * Compute the union of WorldBounds for a set of entities in pre-camera
	 * scene-space (the space centerRect expects). Returns null if no entity
	 * has bounds. WorldBounds are stored post-camera (Camera × dpr), so we
	 * invert that transform here.
	 */
	const computeSceneSpaceBounds = (eids: number[]): { x: number; y: number; width: number; height: number } | null => {
		const sx = cam.a * world.resolution;
		const sy = cam.d * world.resolution;
		const tx = cam.e * world.resolution;
		const ty = cam.f * world.resolution;
		if (sx === 0 || sy === 0) return null;

		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		let found = false;
		for (const eid of eids) {
			if (c.WorldBounds.minX[eid] === undefined) continue;
			const x0 = ((c.WorldBounds.minX[eid] ?? 0) - tx) / sx;
			const x1 = ((c.WorldBounds.maxX[eid] ?? 0) - tx) / sx;
			const y0 = ((c.WorldBounds.minY[eid] ?? 0) - ty) / sy;
			const y1 = ((c.WorldBounds.maxY[eid] ?? 0) - ty) / sy;
			minX = Math.min(minX, x0, x1);
			maxX = Math.max(maxX, x0, x1);
			minY = Math.min(minY, y0, y1);
			maxY = Math.max(maxY, y0, y1);
			found = true;
		}
		if (!found) return null;
		const width = maxX - minX;
		const height = maxY - minY;
		if (width <= 0 || height <= 0) return null;
		return { x: minX, y: minY, width, height };
	}

	/** Fit the current selection into view. No-op if nothing is selected. */
	const fitToSelection = (): void => {
		const selection = [...query(world, [c.Selected, Or(c.Geometry, c.Group)])];
		const bounds = computeSceneSpaceBounds(selection);
		if (bounds) centerRect(bounds);
	}

	/** Fit the given entities into view. No-op if none have bounds yet. */
	const focusEntities = (eids: number[]): void => {
		if (eids.length === 0) return;
		const bounds = computeSceneSpaceBounds(eids);
		if (bounds) centerRect(bounds);
	}

	/** Fit the active scene into view. No-op if no active scene. */
	const fitToActiveScene = (): void => {
		const sceneEid = world.selection.scene;
		if (sceneEid === null) return;
		const Position = world.components.Position;
		const Computed = world.components.Computed;
		const x = Position.x[sceneEid] ?? 0;
		const y = Position.y[sceneEid] ?? 0;
		const width = Computed.width[sceneEid];
		const height = Computed.height[sceneEid];
		if (width <= 0 || height <= 0) return;
		centerRect({ x, y, width, height });
	}

	// ── Wheel: zoom + scroll-pan ──

	const handleWheel = (e: WheelEvent) => {
		if (!canvas) return;

		e.preventDefault();
		const delta = e.deltaMode === 0 ? 1 : (e.deltaMode === 1 ? 16 : 600);

		if (e.ctrlKey || e.metaKey) {
			const rect = canvas?.getBoundingClientRect();
			const screenX = e.clientX - rect.left;
			const screenY = e.clientY - rect.top;
			const dy = Math.max(-50, Math.min(50, e.deltaY * delta));
			zoom(screenX, screenY, Math.exp(-dy * 0.01));
		} else {
			pan(e.deltaX * delta, e.deltaY * delta);
		}

		persistWorldState(world);
	};

	// ── Space + drag: pan ──
	const handleKeyUp = (e: KeyboardEvent) => {
		// Releasing space mid-drag ends the pan even though the pointer is still down.
		if (e.code === 'Space') isPanning = false;
		if (world.selection.tool !== ToolType.HAND) {
			world.cursor.update('default');
		}
	};

	const handlePointerDown = (e: PointerEvent) => {
		if (!isPanMode(world) || !canvas) return;

		isPanning = true;
		canvas.setPointerCapture(e.pointerId);

		const rect = canvas.getBoundingClientRect();
		panStartX = e.clientX - rect.left;
		panStartY = e.clientY - rect.top;
		panStartCamera = [cam.e, cam.f];
	};

	const handlePointerMove = (e: PointerEvent) => {
		if (!isPanning || !canvas) return;

		const rect = canvas.getBoundingClientRect();
		const dx = (e.clientX - rect.left) - panStartX;
		const dy = (e.clientY - rect.top) - panStartY;

		cam.e = panStartCamera[0] + dx;
		cam.f = panStartCamera[1] + dy;
	};

	const handlePointerUp = () => {
		if (!isPanning || !canvas) return;
		isPanning = false;
		persistWorldState(world);
	};

	const init = (el: HTMLCanvasElement) => {
		if (canvas) return;

		canvas = el;
		canvas.addEventListener('wheel', handleWheel, { passive: false });
		canvas.addEventListener('pointerdown', handlePointerDown);
		canvas.addEventListener('pointermove', handlePointerMove);
		canvas.addEventListener('pointerup', handlePointerUp);
		canvas.addEventListener('pointercancel', handlePointerUp);
		window.addEventListener('keyup', handleKeyUp);
	};

	function dispose() {
		canvas?.removeEventListener('wheel', handleWheel);
		canvas?.removeEventListener('pointerdown', handlePointerDown);
		canvas?.removeEventListener('pointermove', handlePointerMove);
		canvas?.removeEventListener('pointerup', handlePointerUp);
		canvas?.removeEventListener('pointercancel', handlePointerUp);
		window.removeEventListener('keyup', handleKeyUp);
	}

	return {
		dispose,
		pan,
		zoom,
		zoomBy,
		resetZoom,
		centerRect,
		fitToSelection,
		fitToActiveScene,
		focusEntities,
		init,
	};
}
