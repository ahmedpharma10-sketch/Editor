/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { EngineWorld } from '../api/world';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// html-in-canvas (https://github.com/WICG/html-in-canvas). Chromium only,
// behind chrome://flags/#canvas-draw-element; the API surface is still
// moving, so every touchpoint is typed and isolated here.
type DrawElementContext = Ctx2D & {
	drawElementImage(source: Element | unknown, dx: number, dy: number, dw: number, dh: number): DOMMatrix;
};

type CaptureCanvas = HTMLCanvasElement & {
	captureElementImage?(element: Element): unknown;
};

export function isHtmlInCanvasSupported(): boolean {
	return typeof CanvasRenderingContext2D !== 'undefined'
		&& 'drawElementImage' in CanvasRenderingContext2D.prototype;
}

// drawElementImage only accepts direct children of a canvas carrying the
// `layoutsubtree` attribute. Hosts normally live under the visible stage
// canvas and are drawn directly; this hidden singleton is the fallback
// parent when the world has no DOM canvas, drawable elsewhere only as an
// ElementImage snapshot via captureElementImage.
let layoutCanvas: HTMLCanvasElement | null = null;

function getLayoutCanvas(): HTMLCanvasElement {
	if (!layoutCanvas) {
		layoutCanvas = document.createElement('canvas');
		layoutCanvas.width = 1;
		layoutCanvas.height = 1;
		layoutCanvas.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;';
		document.body.appendChild(layoutCanvas);
	}
	return layoutCanvas;
}

/**
 * DOM host for one HTML paint: a div child of a layoutsubtree canvas. The
 * mount document inserts the paint's JSX children into `element` as real,
 * reactive DOM; the browser lays them out at the parent geometry's box size
 * and `draw` paints the result each frame.
 */
export class HtmlHost {
	public readonly element: HTMLDivElement;
	private readonly canvas: HTMLCanvasElement;
	private disposed = false;
	private warned = false;
	private width = -1;
	private height = -1;

	public constructor(world: EngineWorld) {
		this.canvas = world.canvas instanceof HTMLCanvasElement ? world.canvas : getLayoutCanvas();
		this.canvas.toggleAttribute('layoutsubtree', true);

		const el = document.createElement('div');
		// pointer-events: none — layoutsubtree children participate in hit
		// testing and would otherwise swallow stage interactions.
		el.style.cssText = 'position:absolute;left:0;top:0;overflow:hidden;pointer-events:none;';
		this.canvas.appendChild(el);
		this.element = el;
	}

	private setSize(width: number, height: number): void {
		if (width === this.width && height === this.height) return;
		this.width = width;
		this.height = height;
		this.element.style.width = `${width}px`;
		this.element.style.height = `${height}px`;
	}

	public draw(ctx: Ctx2D, width: number, height: number): void {
		if (this.disposed) return;

		this.setSize(width, height);

		try {
			if (ctx.canvas === this.canvas) {
				(ctx as DrawElementContext).drawElementImage(this.element, 0, 0, width, height);
			} else {
				const capture = (this.canvas as CaptureCanvas).captureElementImage;
				if (typeof capture !== 'function') {
					throw new Error('captureElementImage is not available; cannot draw <htmlPaint> content offscreen');
				}
				const image = capture.call(this.canvas, this.element);
				(ctx as DrawElementContext).drawElementImage(image, 0, 0, width, height);
			}
		} catch (e) {
			// A transient failure (subtree not yet laid out) just skips the
			// frame; only log once so a permanent one doesn't spam per frame.
			if (!this.warned) {
				this.warned = true;
				console.error('Error drawing <htmlPaint> content', e);
			}
		}
	}

	public dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.element.remove();
	}
}
