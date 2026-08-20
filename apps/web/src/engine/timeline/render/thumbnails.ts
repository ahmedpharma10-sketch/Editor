/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Computed, store } from '@diffusionstudio/runtime';

import { CLIP_LABEL_HEIGHT } from '../config';
import { resolvePoster } from '../media';
import { framesToPixels, getResolution, getViewport } from '../view';

import type { Asset } from '@diffusionstudio/assets';
import type { Entity, World } from 'koota';
import type { RowCursor } from '../layout';
import type { TimelineSurfaceState } from '../surface';

/**
 * Tile widths, chosen by row height. Three fixed sizes rather than one
 * derived from the height, so dragging a row taller does not slide every
 * tile along as it goes.
 */
const TILE_WIDTHS = [80, 100, 120] as const;

const TOP = 20;
const INSET = 2;

/**
 * The clip's picture, tiled along it. An image shows the same frame however
 * long it runs, so tiling its poster is the whole truth about it; a video's
 * poster is only its first frame, so this says where the footage is rather
 * than what is in it.
 */
export function renderThumbnails(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	entity: Entity,
	asset: Asset,
	row: RowCursor,
	options: { top?: number; height?: number } = {},
): void {
	const ctx = surface.ctx!;

	const poster = resolvePoster(world, asset);
	if (!poster) return;

	const top = options.top ?? TOP;
	const height = options.height ?? row.height - CLIP_LABEL_HEIGHT;
	if (height < 4) return;

	const computed = store(world, Computed);
	const resolution = getResolution(world, scene);

	const left = framesToPixels(computed.start[entity.id()] ?? 0, resolution);
	const width = framesToPixels(computed.end[entity.id()] ?? 0, resolution) - left;
	if (width < 4) return;

	const tile = tileWidth(row.height);
	const crop = coverCrop(poster.width, poster.height, tile, height);

	// Only the tiles on screen: a clip an hour long is as cheap to draw as a
	// clip a second long.
	const [viewportLeft, viewportRight] = getViewport(world, scene, surface.layout.width);
	const first = Math.max(0, Math.floor((viewportLeft - left) / tile));
	const last = Math.min(Math.ceil(width / tile) - 1, Math.floor((viewportRight - left) / tile));

	ctx.save();

	ctx.beginPath();
	ctx.roundRect(left + INSET, top, width - INSET * 2, height - INSET, 2);
	ctx.clip();

	for (let i = first; i <= last; i++) {
		ctx.drawImage(
			poster,
			crop.x, crop.y, crop.width, crop.height,
			left + i * tile, top, tile, height,
		);
	}

	ctx.restore();
}

function tileWidth(rowHeight: number): number {
	if (rowHeight >= 100) return TILE_WIDTHS[2];
	if (rowHeight >= 70) return TILE_WIDTHS[1];
	return TILE_WIDTHS[0];
}

/**
 * The part of the picture to draw, so a tile is filled rather than letterboxed
 * — the same as `object-fit: cover`, cropped from the middle.
 */
function coverCrop(sourceWidth: number, sourceHeight: number, width: number, height: number) {
	const source = sourceWidth / sourceHeight;
	const target = width / height;

	if (source > target) {
		const cropped = sourceHeight * target;
		return { x: (sourceWidth - cropped) / 2, y: 0, width: cropped, height: sourceHeight };
	}

	const cropped = sourceWidth / target;
	return { x: 0, y: (sourceHeight - cropped) / 2, width: sourceWidth, height: cropped };
}
