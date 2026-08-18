/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Backing store for one surface paint: a detached canvas handed to the
 * mount's `ref` callback, which draws into it with any context type (2d,
 * webgl, webgpu). The engine samples the bitmap every frame and stretches it
 * into the parent geometry's box. The host allocates the bitmap at the box
 * size and follows the box's authored size; user code (e.g. three.js via
 * `renderer.setSize`) may resize it through its own APIs as well.
 */
export class SurfaceHost {
	public readonly canvas = document.createElement('canvas');
	private disposed = false;

	/**
	 * Bitmap allocation at the box size. A no-op when the size is unchanged:
	 * assigning a canvas dimension clears the bitmap even when the value is
	 * the same, and user code may already have applied this size itself.
	 */
	public setSize(width: number, height: number): void {
		const w = Math.max(1, Math.round(width));
		const h = Math.max(1, Math.round(height));
		if (this.canvas.width !== w) this.canvas.width = w;
		if (this.canvas.height !== h) this.canvas.height = h;
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
