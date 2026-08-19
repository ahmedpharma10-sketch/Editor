/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { PeaksRequest, PeaksResponse } from './peaks-worker';

/** How many bars a rough waveform has. */
export const PEAK_BARS = 128;

/**
 * The peaks of `file`'s primary audio track, or null when it has none.
 * Decoded in a worker of its own, gone when it answers.
 */
export function derivePeaks(file: Blob, bars = PEAK_BARS): Promise<Uint8ClampedArray | null> {
	const worker = new Worker(new URL('./peaks-worker.ts', import.meta.url), { type: 'module' });
	return new Promise<Uint8ClampedArray | null>((resolve, reject) => {
		worker.onmessage = ({ data }: MessageEvent<PeaksResponse>) => {
			if ('error' in data) reject(new Error(data.error));
			else resolve(data.peaks);
		};
		worker.onerror = (event) => reject(new Error(event.message || 'The peaks worker failed'));
		worker.postMessage({ file, bars } satisfies PeaksRequest);
	}).finally(() => worker.terminate());
}
