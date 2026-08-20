/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AssetId, Cache, Computed, findAssetDuration, getSourceWindow, resolveWaveformPeaks, store } from '@diffusionstudio/runtime';

import { framesToPixels, getResolution } from '../view';

import type { Entity, World } from 'koota';
import type { RowCursor } from '../layout';
import type { TimelineSurfaceState } from '../surface';

/** How wide a bar is, and how much of that is the gap after it. */
const BAR_WIDTH = 2;
const BAR_GAP = 1;
const MIN_BAR_HEIGHT = 1;

type WaveformOptions = {
	color: string;
	/** How far down the clip the waveform starts. */
	offsetY: number;
	/** How much of the height to leave above and below it. */
	padding: number;
};

/**
 * The clip's audio, as bars across the part of the waveform it plays.
 *
 * The peaks belong to the asset, not the clip: they summarise the whole file
 * in a fixed number of bars (`PEAK_BARS`), and the clip's own source window
 * says which stretch of them is its own. That is what makes a split cost
 * nothing — both halves read the same summary, from different ends of it.
 *
 * The summary is coarse, so a clip zoomed in far enough draws a smoothed
 * version of its audio rather than its samples.
 */
export function renderWaveform(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	entity: Entity,
	row: RowCursor,
	options: WaveformOptions,
): void {
	const ctx = surface.ctx!;

	const source = findPeakSource(entity);
	if (!source) return;

	const peaks = resolveWaveformPeaks(world, source);
	if (!peaks || peaks.length === 0) return;

	const height = row.height - options.offsetY - options.padding;
	if (height < 2) return;

	const computed = store(world, Computed);
	const resolution = getResolution(world, scene);

	const left = framesToPixels(computed.start[entity.id()] ?? 0, resolution);
	const width = framesToPixels(computed.end[entity.id()] ?? 0, resolution) - left;
	if (width < BAR_WIDTH) return;

	// Which stretch of the asset this clip plays, as a fraction of it: the
	// source window is in source frames, and the peaks span all of them.
	const duration = findAssetDuration(world, entity) ?? 0;
	const window = getSourceWindow(entity);
	const from = duration > 0 ? window.in / duration : 0;
	const to = duration > 0 ? Math.min(1, window.out / duration) : 1;

	const step = BAR_WIDTH + BAR_GAP;
	const count = Math.floor(width / step);
	if (count <= 0) return;

	const centerY = options.offsetY + height / 2;

	ctx.save();
	ctx.fillStyle = options.color;

	for (let i = 0; i < count; i++) {
		// Where along the clip this bar is, mapped into the asset's summary.
		const position = from + ((i + 0.5) / count) * (to - from);
		const value = (peaks[Math.min(peaks.length - 1, Math.floor(position * peaks.length))] ?? 0) / 255;
		const barHeight = Math.max(value * height, MIN_BAR_HEIGHT);

		ctx.fillRect(left + i * step, centerY - barHeight / 2, BAR_WIDTH, barHeight);
	}

	ctx.restore();
}

/**
 * What holds the asset the peaks come from: the clip itself when it is its
 * own source (an audio clip), otherwise whichever fill names one. Whether
 * that asset has any audio is `resolveWaveformPeaks`'s to say.
 */
function findPeakSource(entity: Entity): Entity | null {
	if (entity.has(AssetId)) return entity;

	for (const fill of entity.get(Cache)?.fills ?? []) {
		if (fill.has(AssetId)) return fill;
	}

	return null;
}
