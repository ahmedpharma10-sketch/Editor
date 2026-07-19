/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { addComponent } from '../api/events';

import type { EngineWorld } from '../api/world';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Backing store for one surface paint: a detached canvas handed to the
 * mount's `ref` callback, which draws into it with any context type (2d,
 * webgl, webgpu). The engine samples the bitmap every frame and stretches it
 * into the parent geometry's box. After the initial box-sized allocation the
 * bitmap belongs to user code — external renderers (e.g. three.js via
 * `renderer.setSize`) resize it through their own APIs, so the engine never
 * touches it again.
 */
export class SurfaceHost {
	public readonly canvas = document.createElement('canvas');
	private disposed = false;

	/** Initial bitmap allocation — called once at materialization, before the ref runs. */
	public setSize(width: number, height: number): void {
		this.canvas.width = Math.max(1, Math.round(width));
		this.canvas.height = Math.max(1, Math.round(height));
	}

	public draw(ctx: Ctx2D, width: number, height: number): void {
		if (this.disposed || this.canvas.width === 0 || this.canvas.height === 0) return;
		ctx.drawImage(this.canvas, 0, 0, width, height);
	}

	public dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		// Release the backing store; context teardown (e.g. a WebGL renderer)
		// is the mount's own onCleanup concern.
		this.canvas.width = 0;
		this.canvas.height = 0;
	}
}
