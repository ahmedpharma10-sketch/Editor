/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Putting an asset on the canvas: an element in the project's JSX whose
// `src` is the asset's library path, inserted the way every drawn element
// is (see DocumentEditor.insertElement), so it lands in the file too.

import { Audio, Captions, Image, Video } from '@diffusionstudio/reconciler';
import { Computed, getActiveEntity, getNextName, Root, Source, store } from '@diffusionstudio/runtime';
import { assetName } from '@diffusionstudio/assets';

import { getDocumentEditor } from './editor';

import type { Asset } from '@diffusionstudio/assets';
import type { Entity, World } from 'koota';

export interface InsertAssetOptions {
	/** The scene (or group) to insert into; the active scene by default. */
	parent?: Entity;
	/** Top-left corner in the parent's space; centered by default. */
	x?: number;
	y?: number;
	/** Where on the timeline the clip starts, in seconds; the playhead by default. */
	start?: number;
}

const AUDIO_WIDTH = 500;
const AUDIO_HEIGHT = 150;

/**
 * Inserts `asset` into the project as the element of its type and returns
 * the entity, or null when there is nothing to insert into (no project is
 * mounted, or the target has no source to be written under).
 */
export function insertAsset(world: World, asset: Asset, options: InsertAssetOptions = {}): Entity | null {
	const parent = options.parent ?? getActiveEntity(world) ?? world.get(Root)!;
	if (!parent.get(Source)?.value) return null;

	const editor = getDocumentEditor(world);
	const src = asset.path;
	const name = getNextName(world, assetName(asset).replace(/\.[^.]+$/, ''));
	const start = options.start ?? (store(world, Computed).localTimeInSeconds[parent.id()] ?? 0);

	const size = sizeOf(asset);
	const position = size ? placement(world, parent, size, options) : {};
	const timing = start > 0 ? { start } : {};

	const [entity] = editor.insertElement(parent, () => {
		switch (asset.type) {
			case 'VIDEO':
			case 'SEQUENCE':
				return <Video name={name} src={src} {...position} {...size} {...timing} />;
			case 'IMAGE':
				return <Image name={name} src={src} {...position} {...size} {...timing} />;
			case 'AUDIO':
				return <Audio name={name} src={src} {...position} {...size} {...timing} />;
			case 'TRANSCRIPT':
				return <Captions src={src} {...timing} />;
			default:
				return null;
		}
	});

	if (entity) editor.select(entity);
	return entity ?? null;
}

function sizeOf(asset: Asset): { width: number; height: number } | undefined {
	switch (asset.type) {
		case 'VIDEO':
		case 'IMAGE':
		case 'SEQUENCE':
			return { width: Math.round(asset.width), height: Math.round(asset.height) };
		case 'AUDIO':
			return { width: AUDIO_WIDTH, height: AUDIO_HEIGHT };
		default:
			return undefined;
	}
}

/** Where a new element of `size` goes: as asked, or centered in its parent. */
function placement(
	world: World,
	parent: Entity,
	size: { width: number; height: number },
	options: InsertAssetOptions,
): { x?: number; y?: number } {
	if (options.x !== undefined && options.y !== undefined) {
		return { x: Math.round(options.x), y: Math.round(options.y) };
	}
	const bounds = store(world, Computed);
	const width = bounds.width[parent.id()] ?? size.width;
	const height = bounds.height[parent.id()] ?? size.height;
	return { x: Math.round((width - size.width) / 2), y: Math.round((height - size.height) / 2) };
}
