/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The pictures the timeline draws inside clips. The library derives and keeps
 * an asset's poster (see `AssetCache.thumbnail`); what is needed here is the
 * same picture decoded and ready to draw, which asking for it every frame
 * would not give — so it is asked for once and kept until the asset changes.
 *
 * Keyed by asset rather than by clip: two clips of the same footage show the
 * same picture, and a clip that is split into two does not need a second copy
 * of anything.
 */

import { Library } from '@diffusionstudio/runtime';

import type { Asset } from '@diffusionstudio/assets';
import type { World } from 'koota';

/** How wide a poster is asked for: the widest tile any row height draws. */
const POSTER_WIDTH = 300;

const posters = new Map<string, ImageBitmap | null>();
const loading = new Set<string>();

/**
 * The asset's poster, or null until it has loaded (the load is started here).
 * Null is also the answer for an asset that has no picture to show, and is
 * remembered as such so it is not asked for again.
 */
export function resolvePoster(world: World, asset: Asset): ImageBitmap | null {
	const existing = posters.get(asset.id);
	if (existing !== undefined) return existing;

	if (loading.has(asset.id)) return null;
	loading.add(asset.id);

	const cache = world.get(Library)?.cache;
	if (!cache) {
		loading.delete(asset.id);
		return null;
	}

	void cache
		.thumbnail(asset, POSTER_WIDTH)
		.then((blob) => (blob ? createImageBitmap(blob) : null))
		.then((bitmap) => posters.set(asset.id, bitmap))
		.catch(() => posters.set(asset.id, null))
		.finally(() => loading.delete(asset.id));

	return null;
}

/**
 * Forgets an asset's poster, so the next frame asks for it again. Called when
 * an asset is re-pointed at another file, which the picture would outlive.
 */
export function forgetPoster(assetId: string): void {
	posters.get(assetId)?.close();
	posters.delete(assetId);
}
