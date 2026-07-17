/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { addComponent } from '../api/events';

import type { EngineWorld } from '../api/world';

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
 * DOM host for one HTML paint: a div inside the host's own layoutsubtree
 * canvas. The mount document inserts the paint's JSX children into `element`
 * as real, reactive DOM; the browser lays them out at the parent geometry's
 * box size and `draw` rasterizes the result onto the host canvas and blits
 * it into the rendering context (stage or offscreen alike).
 *
 * The host canvas must stay inside the viewport: the browser only caches its
 * children's paint records (which drawElementImage reads) while the canvas
 * itself paints, so hiding it or parking it offscreen breaks every draw. The
 * 1px CSS size keeps it invisible in practice while its bitmap is resized
 * freely for rasterization.
 */
export class HtmlHost {
	public readonly element: HTMLDivElement;
	private readonly canvas = document.createElement('canvas');
	private readonly ctx = this.canvas.getContext('2d')!;
	private disposed = false;
	private warned = false;
	private width = -1;
	private height = -1;

	public constructor() {
		this.canvas.width = 1;
		this.canvas.height = 1;
		this.canvas.toggleAttribute('layoutsubtree', true);
		this.canvas.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;';

		const el = document.createElement('div');
		// pointer-events: none — layoutsubtree children participate in hit
		// testing and would otherwise swallow page interactions.
		el.style.cssText = 'position:absolute;left:0;top:0;overflow:hidden;pointer-events:none;';
		this.canvas.appendChild(el);
		document.body.appendChild(this.canvas);

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
			const m = ctx.getTransform();
			const sx = Math.hypot(m.a, m.b) || 1;
			const sy = Math.hypot(m.c, m.d) || 1;
			const pw = Math.max(1, Math.ceil(width * sx));
			const ph = Math.max(1, Math.ceil(height * sy));


			if (this.canvas.width !== pw || this.canvas.height !== ph) {
				this.canvas.width = pw;
				this.canvas.height = ph;
			}
			this.ctx.setTransform(sx, 0, 0, sy, 0, 0);
			this.ctx.clearRect(0, 0, width, height);
			(this.ctx as DrawElementContext).drawElementImage(this.element, 0, 0, width, height);
			ctx.drawImage(this.canvas, 0, 0, width, height);
		} catch (e) {
			// A transient failure (subtree not yet laid out or painted) just
			// skips the frame; log once so a permanent one doesn't spam.
			if (!this.warned) {
				this.warned = true;
				console.error('Error drawing <htmlPaint> content', e);
			}
		}
	}

	public dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.canvas.remove();
	}
}

/**
 * Shares <htmlPaint> hosts with a cloned (offline) world. Host DOM is
 * runtime state serializeEntity cannot carry, so export/capture worlds
 * reference the live hosts directly and sample whatever the mount's reactive
 * graph shows while encoding. The source world keeps ownership; offline
 * worlds must not dispose them.
 */
export function shareHtmlHosts(
	sourceWorld: EngineWorld,
	world: EngineWorld,
	eidMap: Map<number, number>,
) {
	for (const [sourceEid, targetEid] of eidMap) {
		const host = sourceWorld.components.HtmlHost[sourceEid];
		if (!host) continue;
		addComponent(world, targetEid, world.components.HtmlHost, false);
		world.components.HtmlHost[targetEid] = host;
	}
}
