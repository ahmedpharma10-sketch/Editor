/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Reading assets out of the world. Everything that changes the asset set
// goes through the AssetLibrary (@diffusionstudio/assets); these are the
// lookups the decoders and hosts share.

import { Library } from '../traits';

import type { World } from 'koota';
import type { Asset, AssetLibrary } from '@diffusionstudio/assets';

/** The world's asset library; throws when the host attached none. */
export function getLibrary(world: World): AssetLibrary {
	const library = world.get(Library);
	if (!library) throw new Error('This world has no asset library');
	return library;
}

/** The asset with `id` (or at that library path), or undefined without a library. */
export function getAsset(world: World, idOrPath: string): Asset | undefined {
	return world.get(Library)?.get(idOrPath);
}

const assetFileCache = new WeakMap<Asset['handle'], Promise<File>>();

/**
 * Returns the File backing an asset, reusing an in-flight or already-resolved
 * read for the same handle.
 */
export function getAssetFile(asset: Pick<Asset, 'handle'>): Promise<File> {
	const { handle } = asset;
	const cached = assetFileCache.get(handle);
	if (cached) return cached;

	const promise = handle.getFile();
	assetFileCache.set(handle, promise);
	promise.catch(() => {
		if (assetFileCache.get(handle) === promise) {
			assetFileCache.delete(handle);
		}
	});
	return promise;
}

/** Returns the File/Blob backing an asset, or null if the asset is missing. */
export async function getAssetBlob(world: World, id: string): Promise<Blob | null> {
	const asset = getAsset(world, id);
	if (!asset) return null;

	return await getAssetFile(asset);
}
