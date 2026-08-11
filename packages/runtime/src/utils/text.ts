/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Text layout data model. The layout, measurement, and canvas render helpers
// join this file when engine/utils/text.ts moves into the runtime.

export type TokenOptions = {
	/**
	 * Defines the characters to render
	 */
	chars: string;
	/**
	 * Defines the X offset of the token to the left of the line
	 */
	offset: number;
	/**
	 * Defines the metrics of the token
	 */
	metrics: TextMetrics;
	/**
	 * Defines the style of the token
	 */
	ranges: number[];
}

export type Line = {
	offsetX: number;
	offsetY: number;
	baseline: number;
	height: number;
};

export class Token {
	public offset: number;
	public metrics: TextMetrics;
	public ranges: number[];
	public chars: string;
	public width: number;
	public height: number;
	public line = { offsetX: 0, offsetY: 0, baseline: 0, height: 0 };

	constructor(options: TokenOptions) {
		this.offset = options.offset;
		this.metrics = options.metrics;
		this.ranges = options.ranges;
		this.width = options.metrics.width;
		this.height = options.metrics.fontBoundingBoxAscent + options.metrics.fontBoundingBoxDescent;
		this.chars = options.chars;
	}

	public get x(): number {
		return (this.offset + this.line.offsetX) | 0;
	}

	public get y(): number {
		return (this.line.offsetY + this.line.baseline) | 0;
	}

	public get left(): number {
		return (
			this.offset +
			this.line.offsetX -
			this.metrics.actualBoundingBoxLeft
		) | 0;
	}

	public get right(): number {
		return (
			this.offset +
			this.line.offsetX +
			this.metrics.actualBoundingBoxRight
		) | 0;
	}

	public get top(): number {
		return (
			this.line.offsetY +
			this.line.baseline -
			this.metrics.actualBoundingBoxAscent
		) | 0
	}

	public get bottom(): number {
		return (
			this.line.offsetY +
			this.line.baseline +
			this.metrics.actualBoundingBoxDescent
		) | 0
	}

	public setLine(line: Line) {
		this.line = { ...line };
	}
}
