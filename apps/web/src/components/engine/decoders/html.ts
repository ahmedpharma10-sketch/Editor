/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// html-in-canvas (https://github.com/WICG/html-in-canvas). Chromium only,
// behind chrome://flags/#canvas-draw-element; the API surface is still
// moving, so every touchpoint is typed and isolated here.
type DrawElementContext = Ctx2D & {
	drawElementImage(source: Element | unknown, dx: number, dy: number, dw: number, dh: number): DOMMatrix;
};

export function isHtmlInCanvasSupported(): boolean {
	return typeof CanvasRenderingContext2D !== 'undefined'
		&& 'drawElementImage' in CanvasRenderingContext2D.prototype;
}

/**
 * Resolves after the browser's next rendering update (style/layout/paint) has
 * completed. drawElementImage samples paint records that are only refreshed
 * while the host canvas paints, so an offline render loop that mutates the
 * paint's DOM must yield one rendering update before rasterizing — otherwise
 * every frame in the same task samples the records of the last real paint.
 * The task queued from inside rAF runs after that frame's paint, so this
 * costs one vsync, not two.
 *
 * Memoized while in flight: every host forwarded in the same tick shares one
 * rendering update, so a scene with many HTML paints still waits a single rAF
 * per frame rather than scheduling one per host.
 */
let pendingRenderingUpdate: Promise<void> | null = null;

export function nextRenderingUpdate(): Promise<void> {
	pendingRenderingUpdate ??= Promise.race<void>([
		new Promise(resolve => {
			requestAnimationFrame(() => setTimeout(() => {
				pendingRenderingUpdate = null;
				resolve();
			}, 0))
		}),
		// A little slower than 60fps (20ms ≈ 50fps): comfortably past a 60Hz vsync so a
		// live rAF wins the race and we keep waiting for the real paint, while still
		// capping the per-frame wait when rAF is paused (hidden/headless).
		new Promise(resolve => {
			setTimeout(() => {
				pendingRenderingUpdate = null;
				resolve();
			}, 1000 / 50);
		}),
	]);

	return pendingRenderingUpdate;
}

let htmlCanvas: HTMLCanvasElement | null = null;
let htmlCtx: CanvasRenderingContext2D | null = null;
let htmlHosts = 0;

function acquireLayoutCanvas(): HTMLCanvasElement {
	if (!htmlCanvas) {
		htmlCanvas = document.createElement('canvas');
		htmlCanvas.width = 1;
		htmlCanvas.height = 1;
		htmlCanvas.toggleAttribute('layoutsubtree', true);
		htmlCanvas.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;';
		document.body.appendChild(htmlCanvas);
		htmlCtx = htmlCanvas.getContext('2d')!;
	}
	htmlHosts++;
	return htmlCanvas;
}

function releaseLayoutCanvas(): void {
	if (--htmlHosts === 0) {
		htmlCanvas?.remove();
		htmlCanvas = null;
		htmlCtx = null;
	}
}

/**
 * DOM host for one HTML paint: a div inside the shared layoutsubtree canvas.
 * The mount document inserts the paint's JSX children into `element` as real,
 * reactive DOM; the browser lays them out at the parent geometry's box size
 * and `draw` rasterizes the result at the destination's device scale and
 * blits it into the rendering context (stage or offscreen alike).
 */
export class HtmlHost {
	public readonly element: HTMLDivElement;
	private disposed = false;
	private warned = false;
	private width = -1;
	private height = -1;

	public constructor() {
		const el = document.createElement('div');
		// pointer-events: none — layoutsubtree children participate in hit
		// testing and would otherwise swallow page interactions.
		el.style.cssText = 'position:absolute;left:0;top:0;overflow:hidden;pointer-events:none;';
		acquireLayoutCanvas().appendChild(el);
		this.element = el;
	}

	public setSize(width: number, height: number): void {
		if (width === this.width && height === this.height) return;
		this.width = width;
		this.height = height;
		this.element.style.width = `${width}px`;
		this.element.style.height = `${height}px`;
	}

	public draw(ctx: Ctx2D, width: number, height: number): void {
		if (this.disposed || !htmlCanvas || !htmlCtx) return;

		this.setSize(width, height);

		try {
			const m = ctx.getTransform();
			const sx = Math.hypot(m.a, m.b) || 1;
			const sy = Math.hypot(m.c, m.d) || 1;
			const pw = Math.max(1, Math.ceil(width * sx));
			const ph = Math.max(1, Math.ceil(height * sy));

			// Grow-only: shrinking would clear and reallocate every time hosts
			// of different sizes share the canvas within one frame.
			if (htmlCanvas.width < pw) htmlCanvas.width = pw;
			if (htmlCanvas.height < ph) htmlCanvas.height = ph;

			htmlCtx.setTransform(sx, 0, 0, sy, 0, 0);
			htmlCtx.clearRect(0, 0, width, height);
			(htmlCtx as DrawElementContext).drawElementImage(this.element, 0, 0, width, height);
			ctx.drawImage(htmlCanvas, 0, 0, pw, ph, 0, 0, width, height);
		} catch (e) {
			// A transient failure (subtree not yet laid out or painted) just
			// skips the frame; log once so a permanent one doesn't spam.
			if (!this.warned) {
				this.warned = true;
				console.error(`Error drawing <HtmlPaint> content: ${e instanceof Error ? `${e.name}: ${e.message}` : e}`);
			}
		}
	}

	public dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.element.remove();
		releaseLayoutCanvas();
	}
}
