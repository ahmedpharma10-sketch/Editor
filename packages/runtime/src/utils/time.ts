/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CONONICAL_TIME_BASE, PaintType } from '../constants';
import {
	Audio, AssetId, Cache, Computed, Geometry, Paint, SourceIn, Assets, FrameRate,
} from '../traits';
import { getParentNode } from '../queries/hierarchy';

import type { Entity, World } from 'koota';
import type { Asset } from '../assets/types';

export function snapToMs(seconds: number) {
	return Math.round(seconds * CONONICAL_TIME_BASE) / CONONICAL_TIME_BASE;
}

export function snapToFps(seconds: number, fps: number = 30) {
	return Math.round(seconds * fps) / fps;
}

export function secondsToFrames(seconds: number = 0, fps: number = 30) {
	return Math.round(seconds * fps);
}

export function framesToSeconds(frames: number = 0, fps: number = 30) {
	return snapToMs(frames / fps);
}

function splitTimecode(seconds: number, frameRate: number): [hours: number, minutes: number, seconds: number, frames: number] {
	const fps = Math.max(1, Math.round(frameRate));
	const totalFrames = Math.round(seconds * fps);
	const totalSeconds = Math.floor(totalFrames / fps);
	return [
		Math.floor(totalSeconds / 3600),
		Math.floor((totalSeconds % 3600) / 60),
		totalSeconds % 60,
		totalFrames % fps,
	];
}

/** `HH:MM:SS:FF`, fixed width so ruler ticks line up. */
export function formatTimestamp(seconds: number, frameRate: number): string {
	return splitTimecode(seconds, frameRate).map((v) => String(v).padStart(2, '0')).join(':');
}

/**
 * The same timecode with its zero segments dropped, for labels and filenames:
 * `08s10f`, `01m05s`, `0f`. Each segment carries its unit, so nothing is
 * ambiguous once the empty ones are gone.
 */
export function formatTimecode(seconds: number, frameRate: number): string {
	const units = ['h', 'm', 's', 'f'];
	const stamp = splitTimecode(seconds, frameRate)
		.map((value, i) => (value === 0 ? '' : `${String(value).padStart(2, '0')}${units[i]}`))
		.join('');
	return stamp || '0f';
}

/**
 * The scene frame that authored time 0 means for `entity`, its parent's
 * origin. Converts between the absolute frames Computed works in and the
 * parent-relative frames Start and End are authored in.
 */
export function getTimelineOrigin(entity: Entity): number {
	const parent = getParentNode(entity);
	return parent === null ? 0 : (parent.get(Computed)?.origin ?? 0);
}

/** The source frame `entity` is playing at scene frame `frame`. */
export function getSourceFrameAt(entity: Entity, frame: number): number {
	const computed = entity.get(Computed);
	const origin = computed?.origin ?? 0;
	const playbackRate = computed?.playbackRate || 1;

	return Math.round((frame - origin) * playbackRate);
}

/**
 * The node's resolved source window, in source frames: where its in point is
 * and how far its timeline span actually reaches into the source. Derived from
 * the resolved duration rather than read off SourceOut, so a window the node
 * never gets to play (an End that runs out first) is not reported as playing.
 */
export function getSourceWindow(entity: Entity): { in: number; out: number } {
	const sourceIn = entity.get(SourceIn)?.value ?? 0;
	const computed = entity.get(Computed);
	const duration = computed?.duration ?? 0;
	const playbackRate = computed?.playbackRate || 1;

	return { in: sourceIn, out: sourceIn + Math.round(duration * playbackRate) };
}

/**
 * The paint a geometry is intrinsically made of: its own Paint trait, when it
 * carries one. Like its own Color, an intrinsic paint is drawn (and played) by
 * the geometry itself, from its own AssetId, beneath any paint children — a
 * paint child is a sub-entity carrying Paint and an asset of its own. Only a
 * geometry can have an intrinsic paint; a paint sub-entity has no Geometry.
 */
export function getIntrinsicPaint(entity: Entity): PaintType | undefined {
	if (!entity.has(Geometry)) return undefined;
	return entity.get(Paint)?.value;
}

/** Whether `entity` is a paint sub-entity (as opposed to a geometry with an intrinsic paint). */
export function isPaintEntity(entity: Entity): boolean {
	return entity.has(Paint) && !entity.has(Geometry);
}

/** The asset backing a geometry: its own AssetId, or the first fill's. */
export function findGeometryAsset(world: World, entity: Entity): Asset | null {
	const assets = world.get(Assets);
	if (!assets) return null;

	const ownId = entity.get(AssetId)?.value;
	if (ownId) {
		const asset = assets.get(ownId);
		if (asset) return asset;
	}

	for (const fill of entity.get(Cache)?.fills ?? []) {
		const fillId = fill.get(AssetId)?.value;
		if (fillId) {
			const asset = assets.get(fillId);
			if (asset) return asset;
		}
	}

	return null;
}

/**
 * Intrinsic duration (in project frames) of the media asset attached to an
 * entity: its own asset when the entity is an audio clip or its intrinsic
 * paint is a video/sequence, else the first video/sequence fill. Null when
 * nothing time-based is attached. `ignoreOwn` reads the entity's own asset as
 * absent (for a handler of its removal).
 */
export function findAssetDuration(world: World, entity: Entity, ignoreOwn = false): number | null {
	const assets = world.get(Assets);
	if (!assets) return null;
	const frameRate = world.get(FrameRate)?.value ?? 30;

	const paint = getIntrinsicPaint(entity);
	if (!ignoreOwn && (entity.has(Audio) || paint === PaintType.VIDEO || paint === PaintType.SEQUENCE)) {
		const asset = assets.get(entity.get(AssetId)?.value ?? '');
		if (asset?.type === 'AUDIO' || asset?.type === 'VIDEO' || asset?.type === 'SEQUENCE') {
			return secondsToFrames(asset.duration, frameRate);
		}
	}

	for (const fill of entity.get(Cache)?.fills ?? []) {
		const paint = fill.get(Paint)?.value;
		if (paint === PaintType.VIDEO || paint === PaintType.SEQUENCE) {
			const asset = assets.get(fill.get(AssetId)?.value ?? '');
			if (asset && (asset.type === 'VIDEO' || asset.type === 'SEQUENCE')) {
				return secondsToFrames(asset.duration, frameRate);
			}
		}
	}

	return null;
}
