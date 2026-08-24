/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	AssetId,
	findGeometryAsset,
	hasHtmlPaint,
	hasSurfacePaint,
	isAdjustmentLayer,
	isCaption,
	isGroup,
	isMask,
	isScene,
	isText,
} from '@diffusionstudio/runtime';

import { COLORS } from './constants';

import type { Asset } from '@diffusionstudio/assets';
import type { Entity, World } from 'koota';

export type ClipStyle = {
	background: string;
	foreground: string;
	primary?: string;
};

export function getClipStyle(entity: Entity, asset: Asset | null, errored = false): ClipStyle {
	if (errored && !entity.has(AssetId)) return COLORS.clip.failed;
	if (isCaption(entity)) return COLORS.clip.caption;
	if (isText(entity)) return COLORS.clip.text;
	if (isScene(entity)) return COLORS.clip.scene;
	if (isGroup(entity)) return COLORS.clip.group;
	if (isMask(entity)) return COLORS.clip.mask;
	if (isAdjustmentLayer(entity)) return COLORS.clip.adjustment;
	if (hasHtmlPaint(entity) || hasSurfacePaint(entity)) return COLORS.clip.html;

	switch (asset?.type) {
		case 'VIDEO':
		case 'SEQUENCE':
			return COLORS.clip.video;
		case 'IMAGE':
			return COLORS.clip.image;
		case 'AUDIO':
			return COLORS.clip.audio;
		default:
			return COLORS.clip.shape;
	}
}

/** The asset a clip shows, whether it is the clip's own or one of its fills. */
export function getClipAsset(world: World, entity: Entity): Asset | null {
	return findGeometryAsset(world, entity);
}
