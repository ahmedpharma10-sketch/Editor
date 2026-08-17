/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Asset model actions (was api/assets.ts, model only). Loading, probing,
// OPFS/db persistence, uploads, and pickers stay app-side; the runtime owns
// the in-memory metadata store, id allocation, and timeline insertion.

import Sqids from 'sqids';

import { GeometryType, PaintType } from '../constants';
import {
	Geometry, Paint, Audio, Caption, Hidden, Name, AssetId, Start, SourceIn,
	SourceOut, KeepAspectRatio, Computed, Assets, AssetIds, ActiveScene,
} from '../traits';
import { store } from '../world/store';
import { secondsToFrames } from '../utils/time';
import { createEntity } from './entities';
import { appendChild } from './hierarchy';
import { resizeEntity } from './resize';

import type { Entity, World } from 'koota';
import type { Asset, Transcript } from '../assets/types';

const sqids = new Sqids({ minLength: 4 });

/**
 * Allocates the next id in the project's shared asset/folder id space, so an
 * id never refers to both an asset and a folder.
 */
export function allocateId(world: World): string {
	const counter = (world.get(AssetIds)?.counter ?? 0) + 1;
	world.set(AssetIds, { counter });
	return sqids.encode([counter]);
}

/**
 * Raises the id counter past every sqid in `ids`. Non-sqid ids (e.g. legacy
 * "fld-…" folder ids) are ignored. Restores may run in parallel, so this only
 * ever raises the counter.
 */
export function raiseIdCounter(world: World, ids: Iterable<string>): void {
	let counter = world.get(AssetIds)?.counter ?? 0;
	for (const id of ids) {
		const decoded = sqids.decode(id);
		const num = decoded[0];
		if (decoded.length === 1 && Number.isFinite(num) && num! > counter) {
			counter = num!;
		}
	}
	world.set(AssetIds, { counter });
}

/**
 * Appends one or more assets to the in-memory store. New assets are ordered
 * first; existing records win on id conflict.
 */
export function appendAssets(world: World, ...incoming: Asset[]): void {
	const map = world.get(Assets)!;
	const existing = Array.from(map.values());
	map.clear();
	for (const asset of incoming) map.set(asset.id, asset);
	for (const asset of existing) map.set(asset.id, asset);
}

/**
 * Inserts or replaces an asset at the front of the in-memory store (newest
 * first). The app persists it and refreshes its reactive views.
 */
export function upsertAsset(world: World, asset: Asset): Asset {
	const map = world.get(Assets)!;
	const existing = Array.from(map.values()).filter(a => a.id !== asset.id);
	map.clear();
	map.set(asset.id, asset);
	existing.forEach(a => map.set(a.id, a));
	return asset;
}

/** Removes one or more assets from the in-memory store. */
export function removeAssets(world: World, ...ids: string[]): void {
	const map = world.get(Assets)!;
	for (const id of ids) map.delete(id);
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
	const asset = world.get(Assets)?.get(id);
	if (!asset) return null;

	return await getAssetFile(asset);
}

/**
 * Composes the entity tree for an asset dropped into the active scene: a
 * geometry sized to the asset with the matching paint/caption/audio setup.
 * Returns the created node, or null when there is no active scene.
 */
export async function insertAssetInTimeline(
	world: World,
	asset: Asset,
	mode: 'playhead' | 'start',
): Promise<Entity | null> {
	const scene = world.get(ActiveScene)?.entity ?? null;
	if (scene === null) return null;

	const start = mode === 'playhead' ? store(world, Computed).localTime[scene.id()] ?? 0 : 0;

	// Resolve any async asset data up front so all the entity mutations below
	// run synchronously (the app wraps them in a single undo step).
	let spokenWords: { start: number; end: number } | null = null;
	if (asset.type === 'TRANSCRIPT') {
		// Transcript should be trimmed to the span of recognized words
		const file = await getAssetFile(asset);
		const transcript = JSON.parse(await file.text()) as Transcript;
		const lastWord = transcript.at(-1)?.words.at(-1);
		const firstWord = transcript.at(0)?.words.at(0);
		spokenWords = {
			start: secondsToFrames(firstWord?.start),
			end: secondsToFrames(lastWord?.end),
		};
	}

	const entity = createEntity(world);
	entity.add(Name);
	entity.set(Name, { value: asset.name });
	entity.add(Start({ value: start }));

	if (asset.type === 'IMAGE' || asset.type === 'VIDEO' || asset.type === 'SEQUENCE') {
		const width = Math.round(asset.width);
		const height = Math.round(asset.height);
		resizeEntity(world, entity, { width, height });
		entity.add(KeepAspectRatio);
		entity.set(KeepAspectRatio, { width, height });
	}

	if (asset.type === 'TRANSCRIPT') {
		entity.add(Geometry);
		entity.set(Geometry, { value: GeometryType.TEXT });
		entity.add(Caption);
		if (spokenWords) {
			entity.set(Start, { value: start + spokenWords.start });
			entity.add(SourceIn({ value: spokenWords.start }));
			entity.add(SourceOut({ value: spokenWords.end }));
		}
	} else {
		entity.add(Geometry);
		entity.set(Geometry, { value: GeometryType.RECT });

		// Other assets need a paint sub-entity
		let paint = PaintType.IMAGE;
		if (asset.type === 'SEQUENCE') paint = PaintType.SEQUENCE;
		if (asset.type === 'VIDEO') paint = PaintType.VIDEO;
		if (asset.type === 'AUDIO') paint = PaintType.WAVEFORM;
		const fill = createEntity(world);
		fill.add(Paint);
		fill.set(Paint, { value: paint });
		fill.add(AssetId);
		fill.set(AssetId, { value: asset.id });
		if (asset.type === 'AUDIO') {
			fill.add(Hidden);
		}
		appendChild(world, fill, entity);
	}

	if (asset.type === 'AUDIO') {
		entity.add(Audio);
		resizeEntity(world, entity, { width: 500, height: 150 });
	}

	if (asset.type === 'AUDIO' || asset.type === 'TRANSCRIPT') {
		entity.add(AssetId);
		entity.set(AssetId, { value: asset.id });
	}

	appendChild(world, entity, scene);

	return entity;
}
