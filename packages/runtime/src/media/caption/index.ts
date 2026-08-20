/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionType } from '../../constants';
import { AssetId, Caption, ChildOf, Paint, Shadow, TextRange, TextStyle, CaptionDecoderHandle } from '../../traits';
import { getAsset } from '../../actions/assets';
import { deleteEntity } from '../../actions/entities';
import { ClassicCaptionDecoder } from './classic';
import { CascadeCaptionDecoder } from './cascade';
import { SpotlightCaptionDecoder } from './spotlight';
import { WhisperCaptionDecoder } from './whisper';
import { PaperCaptionDecoder } from './paper';
import { GuineaCaptionDecoder } from './guinea';
import { StarkCaptionDecoder } from './stark';

import type { Entity, World } from 'koota';
import type { Asset } from '@diffusionstudio/assets';
import type { CaptionDecoder } from './types';

export type { CaptionDecoder } from './types';
export { ClassicCaptionDecoder, CLASSIC_PRESET_WIDTH, CLASSIC_PRESET_HEIGHT } from './classic';
export { CascadeCaptionDecoder } from './cascade';
export { SpotlightCaptionDecoder } from './spotlight';
export { WhisperCaptionDecoder } from './whisper';
export { PaperCaptionDecoder } from './paper';
export { GuineaCaptionDecoder } from './guinea';
export { StarkCaptionDecoder } from './stark';
export * from './position';
export * from './subtitles';
export * from './utils';

function createCaptionDecoder(type: CaptionType, asset: Asset): CaptionDecoder {
	switch (type) {
		case CaptionType.CLASSIC:
			return new ClassicCaptionDecoder(asset);
		case CaptionType.CASCADE:
			return new CascadeCaptionDecoder(asset);
		case CaptionType.SPOTLIGHT:
			return new SpotlightCaptionDecoder(asset);
		case CaptionType.WHISPER:
			return new WhisperCaptionDecoder(asset);
		case CaptionType.PAPER:
			return new PaperCaptionDecoder(asset);
		case CaptionType.GUINEA:
			return new GuineaCaptionDecoder(asset);
		case CaptionType.STARK:
			return new StarkCaptionDecoder(asset);
		default:
			return new ClassicCaptionDecoder(asset);
	}
}

/**
 * Drops what the last preset authored onto the entity: the paints and shadows
 * it draws with, whatever text ranges it left behind, and its TextStyle. The
 * look of a caption is the preset's, so the next one starts from a bare node
 * instead of stacking on it. Animations and keyframe tracks are the file's and
 * stay.
 */
function clearPresetStyling(world: World, entity: Entity): void {
	for (const child of world.query(ChildOf(entity))) {
		if (child.has(Paint) || child.has(Shadow) || child.has(TextRange)) {
			deleteEntity(world, child);
		}
	}
	entity.remove(TextStyle);
}

/**
 * Lazily resolve (or create) a caption decoder for a caption entity.
 * Recreates the decoder when the caption type changes.
 * Returns null if the transcript asset isn't available yet.
 */
export function resolveCaptionDecoder(world: World, entity: Entity): CaptionDecoder | null {
	const assetId = entity.get(AssetId)?.value;
	if (!assetId) return null;

	const captionType = entity.get(Caption)?.type ?? CaptionType.CLASSIC;
	const existing = entity.get(CaptionDecoderHandle);

	if (existing && captionType === existing.type) return existing;

	const typeChanged = existing != null;
	existing?.dispose();

	const asset = getAsset(world, assetId);
	if (!asset) return null;

	const decoder = createCaptionDecoder(captionType, asset);
	entity.add(CaptionDecoderHandle);
	entity.set(CaptionDecoderHandle, decoder);

	if (typeChanged) clearPresetStyling(world, entity);
	if (typeChanged || !entity.has(TextStyle)) {
		decoder.applyStyles(world, entity);
	}

	return decoder;
}
