/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The rough waveform of a media file, computed off the main thread: a fixed
// number of bars, each the peak amplitude (across channels, gamma-lifted so
// quiet passages still show) of its slice of the file, as a byte. WebCodecs
// decodes elsewhere already, but PCM formats (WAV) are unpacked in JS and
// would stall the UI. One worker per request: a file and a bar count in,
// the peaks out.

import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';

export interface PeaksRequest {
	file: Blob;
	bars: number;
}

export type PeaksResponse = { peaks: Uint8ClampedArray | null } | { error: string };

// The package is typed against the DOM lib, so the worker scope is narrowed by hand.
const scope = self as unknown as {
	onmessage: ((event: MessageEvent<PeaksRequest>) => void) | null;
	postMessage(message: PeaksResponse, transfer?: Transferable[]): void;
};

scope.onmessage = async ({ data: { file, bars } }) => {
	try {
		const peaks = await computePeaks(file, bars);
		scope.postMessage({ peaks }, peaks ? [peaks.buffer as ArrayBuffer] : []);
	} catch (error) {
		scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
	}
};

/** The peaks of `file`'s primary audio track, or null when it has none. */
async function computePeaks(file: Blob, bars: number): Promise<Uint8ClampedArray | null> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) return null;

		const sink = new AudioSampleSink(track);
		const chunks: Uint8ClampedArray[] = [];

		for await (const sample of sink.samples()) {
			let floats: Float32Array;
			let channels: number;
			let frames: number;
			try {
				const size = sample.allocationSize({ format: 'f32', planeIndex: 0 });
				floats = new Float32Array(size / Float32Array.BYTES_PER_ELEMENT);
				sample.copyTo(floats, { format: 'f32', planeIndex: 0 });
				channels = sample.numberOfChannels;
				frames = floats.length / channels;
			} finally {
				sample.close();
			}

			const framePeaks = new Uint8ClampedArray(frames);
			for (let f = 0; f < frames; f++) {
				let max = 0;
				for (let ch = 0; ch < channels; ch++) {
					max = Math.max(max, Math.pow(Math.abs(floats[f * channels + ch]!), 0.8));
				}
				framePeaks[f] = Math.floor(max * 255);
			}
			chunks.push(framePeaks);
		}

		if (chunks.length === 0) return null;

		const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
		const merged = new Uint8ClampedArray(total);
		let offset = 0;
		for (const chunk of chunks) {
			merged.set(chunk, offset);
			offset += chunk.length;
		}

		const peaks = new Uint8ClampedArray(bars);
		const ratio = total / bars;
		for (let i = 0; i < bars; i++) {
			const start = Math.floor(i * ratio);
			const end = Math.min(total, Math.floor((i + 1) * ratio));
			let max = 0;
			for (let j = start; j < end; j++) max = Math.max(max, merged[j]!);
			peaks[i] = max;
		}
		return peaks;
	} finally {
		input.dispose();
	}
}
