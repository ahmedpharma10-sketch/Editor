/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CONONICAL_TIME_BASE, PaintType } from '../constants';
import {
	Audio, AssetId, Cache, Computed, Paint, PlaybackRate, Assets, FrameRate,
} from '../traits';

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
 * Computes the trim start frame (local) for a given entity,
 * based on the specified start frame (global) and playback rate.
 */
export function computeTrimStart(entity: Entity, start: number) {
	const delay = entity.get(Computed)?.delay ?? 0;
	const playbackRate = entity.get(PlaybackRate)?.value ?? 1;

	return Math.round((start - delay) * playbackRate);
}

/**
 * Computes the trim end frame (local) for a given entity,
 * based on the specified end frame (global) and playback rate.
 */
export function computeTrimEnd(entity: Entity, end: number) {
	const delay = entity.get(Computed)?.delay ?? 0;
	const playbackRate = entity.get(PlaybackRate)?.value ?? 1;

	return Math.round((end - delay) * playbackRate);
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
 * entity: the audio asset on Audio clips, else the first video/sequence fill.
 * Null when nothing time-based is attached.
 */
export function findAssetDuration(world: World, entity: Entity): number | null {
	const assets = world.get(Assets);
	if (!assets) return null;
	const frameRate = world.get(FrameRate)?.value ?? 30;

	if (entity.has(Audio)) {
		const asset = assets.get(entity.get(AssetId)?.value ?? '');

		if (asset?.type === 'AUDIO' || asset?.type === 'VIDEO') {
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
