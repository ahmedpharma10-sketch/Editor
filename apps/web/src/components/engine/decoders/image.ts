/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { addComponent } from '../api/events';
import { getAssetFile } from '../api/assets';
import type { EngineWorld } from '../api/world';
import type { ImageAsset } from '../db';

export type DecodedImage = ImageBitmap | HTMLImageElement;

export interface ImageDecoder {
	readonly assetId: string;
	readonly failed: boolean;
	readonly ready: boolean;
	init(): Promise<void>;
	getBitmap(targetWidth: number, targetHeight: number): DecodedImage | null;
	dispose(): void;
}

/**
 * Image decoder backed by `createImageBitmap`. Used for raster formats
 * (PNG, JPEG, WebP, …) where we want a GPU-friendly bitmap.
 *
 * Fetching + decoding starts immediately on construction.
 */
export class BitmapImageDecoder implements ImageDecoder {
	readonly assetId: string;
	public failed = false;
	private bitmap: ImageBitmap | null = null;
	private disposed = false;

	public constructor(private readonly asset: ImageAsset) {
		this.assetId = asset.id;
	}

	public async init() {
		if (this.disposed) return;

		try {
			const file = await getAssetFile(this.asset);
			const result = await createImageBitmap(file);
			if (this.disposed) {
				result.close();
				return;
			}
			this.bitmap = result;
		} catch (e) {
			console.error('Error decoding image', e);
			this.failed = true;
		}
	}


	public get ready() {
		return this.bitmap !== null;
	}

	public getBitmap(_targetWidth: number, _targetHeight: number): ImageBitmap | null {
		// TODO: mipmap — pick the LOD closest to targetWidth × targetHeight
		return this.bitmap;
	}

	public dispose() {
		if (this.disposed) return;
		if (this.bitmap) {
			this.bitmap.close();
			this.bitmap = null;
		}
		this.disposed = true;
	}
}

/**
 * Image decoder backed by `HTMLImageElement`. Used for formats that
 * `createImageBitmap` doesn't handle reliably across browsers — most
 * notably SVG, where we want the browser's native vector renderer.
 */
export class ElementImageDecoder implements ImageDecoder {
	readonly assetId: string;
	public failed = false;
	private element: HTMLImageElement | null = null;
	private url: string | null = null;
	private disposed = false;
	private readonly width: number;
	private readonly height: number;

	public constructor(private readonly asset: ImageAsset) {
		this.assetId = asset.id;
		this.width = asset.width;
		this.height = asset.height;
	}

	public get ready() {
		return this.element !== null;
	}

	public async init() {
		if (this.disposed) return;

		try {
			const file = await getAssetFile(this.asset);
			const url = URL.createObjectURL(file);

			await new Promise<void>((resolve) => {
				const img = new Image();
				img.onload = () => {
					if (this.disposed) {
						URL.revokeObjectURL(url);
						return resolve();
					}
					// SVGs without explicit width/height attributes report
					// naturalWidth/Height = 0. Pin to the asset's recorded
					// dimensions so getScaledImageProps gets a real aspect.
					img.width = this.width;
					img.height = this.height;
					this.element = img;
					this.url = url;
					resolve();
				};
				img.onerror = () => {
					URL.revokeObjectURL(url);
					this.failed = true;
					resolve();
				};
				img.src = url;
			})
		} catch (e) {
			console.error('Error decoding image', e);
			this.failed = true;
		}
	}

	public getBitmap(_targetWidth: number, _targetHeight: number): HTMLImageElement | null {
		return this.element;
	}

	public dispose() {
		if (this.disposed) return;
		if (this.url) {
			URL.revokeObjectURL(this.url);
			this.url = null;
		}
		this.element = null;
		this.disposed = true;
	}
}

function createImageDecoder(asset: ImageAsset): ImageDecoder {
	if (asset.mimeType === 'image/svg+xml') {
		return new ElementImageDecoder(asset);
	}
	return new BitmapImageDecoder(asset);
}

type ResolvedImageDecoder = {
	decoder: ImageDecoder;
	initPromise: Promise<void> | null;
}

export function resolveImageDecoder(world: EngineWorld, eid: number): ResolvedImageDecoder | null {
	const AssetId = world.components.AssetId;
	const assetId = AssetId[eid];
	if (!assetId) return null;

	const existing = world.components.ImageDecoder[eid];
	if (existing && existing.assetId === assetId) {
		return {
			decoder: existing,
			initPromise: null,
		};
	};

	// Asset changed — dispose old decoder and create a new one.
	if (existing) existing.dispose();

	const asset = world.assets.get(assetId);
	if (!asset || asset.type !== 'IMAGE') return null;

	addComponent(world, eid, world.components.ImageDecoder, false);

	const decoder = createImageDecoder(asset);
	world.components.ImageDecoder[eid] = decoder;
	return {
		decoder,
		initPromise: decoder.init(),
	};
}
