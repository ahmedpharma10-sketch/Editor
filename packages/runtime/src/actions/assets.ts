/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Reading assets out of the world. Everything that changes the asset set
// goes through the AssetLibrary (@diffusionstudio/assets); these are the
// lookups the decoders and hosts share.

import { Ai, AssetId, Library, Paint, SourceModifiers } from '../traits';
import { PaintType } from '../constants';

import type { Entity, World } from 'koota';
import type { Asset, AssetLibrary } from '@diffusionstudio/assets';
import type { GenAi } from '../ai';

/** The world's asset library; throws when the host attached none. */
export function getLibrary(world: World): AssetLibrary {
	const library = world.get(Library);
	if (!library) throw new Error('This world has no asset library');
	return library;
}

/** The world's generation service; throws when the host attached none. */
export function getAi(world: World): GenAi {
	const ai = world.get(Ai);
	if (!ai) throw new Error('This world cannot generate assets (no Ai attached)');
	return ai;
}

/** What a source is put through after it resolves (see `SourceModifiers`). */
export interface SourceModifierValues {
	removeBackground: boolean;
	/** Factor, 1 = natural size. */
	upscale: number;
	addAudio: boolean;
}

/** Whether a set of modifiers asks for anything at all. */
export const hasModifier = (modifiers: SourceModifierValues): boolean =>
	modifiers.removeBackground || modifiers.upscale > 1 || modifiers.addAudio;

/**
 * The modifiers `entity` asks its source to be put through, or undefined
 * when it asks for none — which is what the trait's absence means, so this
 * is also the question "is this element showing a derived source".
 */
export function getModifiers(entity: Entity): SourceModifierValues | undefined {
	const modifiers = entity.get(SourceModifiers);
	return modifiers && hasModifier(modifiers) ? modifiers : undefined;
}

/**
 * Binds an entity to an asset: stamps its AssetId, and follows the asset
 * with the paint — a frames directory on a `<video>` or `<image>` plays as
 * a sequence, and a sequence paint goes back when the asset is not one.
 */
export function bindAsset(entity: Entity, asset: Asset): void {
	entity.add(AssetId);
	entity.set(AssetId, { value: asset.id });

	const paint = entity.get(Paint)?.value;
	if (asset.type === 'SEQUENCE' && (paint === PaintType.VIDEO || paint === PaintType.IMAGE)) {
		entity.set(Paint, { value: PaintType.SEQUENCE });
	} else if (asset.type !== 'SEQUENCE' && paint === PaintType.SEQUENCE) {
		entity.set(Paint, { value: asset.type === 'IMAGE' ? PaintType.IMAGE : PaintType.VIDEO });
	}
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
