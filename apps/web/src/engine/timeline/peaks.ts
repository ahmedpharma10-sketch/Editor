/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The peaks the timeline's waveforms are drawn from, in two layers.
 *
 * The asset layer decodes a file once, at a fixed high resolution, and hands
 * every couple of seconds of it to IndexedDB. Peaks that fine are the better
 * part of a kilobyte a second, so a few long files would be tens of megabytes
 * held for a whole session; the store is what keeps them off the JS heap. It
 * is emptied when it is opened, since the index of which chunks exist lives
 * in memory — nothing written in an earlier session could be found again.
 *
 * The clip layer takes whichever chunks the visible stretch of one clip
 * covers and downsamples them to one peak per pixel, which is the only
 * resolution a draw pass can use. Zoom changes what a pixel is worth, so this
 * layer is rebuilt as the timeline is zoomed; the asset layer never is.
 *
 * Both are asked for by the draw pass and filled in behind it: a request says
 * what a clip needs, and the next frame draws whatever has arrived. Nothing
 * here blocks a frame.
 */

import { AudioSampleSink } from 'mediabunny';
import { getAudioTrack } from '@diffusionstudio/runtime';

import type { AudioSample } from 'mediabunny';
import type { AudioAsset, VideoAsset } from '@diffusionstudio/assets';

/** Peaks a second the asset layer decodes at: finer than any zoom reaches. */
const SOURCE_PEAKS_PER_SECOND = 800;

/** How much audio one stored chunk covers, in seconds. */
const CHUNK_DURATION = 2;

/** How wide one drawn sample is, in pixels. */
export const SAMPLE_WIDTH = 1;

const IDB_NAME = 'peak-cache-db';
const IDB_VERSION = 1;
const IDB_STORE = 'data';

/** Where a chunk of an asset's peaks sits in it, in seconds, and its key. */
type PeakChunk = {
	start: number;
	end: number;
	id: string;
};

/** A chunk of peaks, downsampled to what one clip draws it at. */
export type ClipSamples = PeakChunk & {
	data: Uint8ClampedArray;
	peaksPerSecond: number;
};

/** What the decode produced for one stretch of a file, before it is stored. */
type DecodedPeaks = {
	start: number;
	end: number;
	data: Uint8ClampedArray;
};

/** The asset layer's record of one file: which chunks of it exist. */
type AssetPeaks = {
	decoding: boolean;
	/** True once the file has been read through, whatever came of it. */
	decoded: boolean;
	chunks: PeakChunk[];
};

/** The clip layer's record of one clip: the chunks it can draw, at its zoom. */
type ClipPeaks = {
	assetId: string;
	samples: ClipSamples[];
	/** The range and zoom `samples` was built for; unchanged means no work. */
	hash: string;
	updating: boolean;
	pending: PeakRequest | null;
};

/** What a clip needs this frame: a stretch of its asset, at a zoom. */
export type PeakRequest = {
	/** The entity id of the clip asking. */
	clip: number;
	asset: AudioAsset | VideoAsset;
	peaksPerSecond: number;
	/** The visible stretch of the source, in source seconds. */
	start: number;
	end: number;
};

const assetPeaks = new Map<string, AssetPeaks>();
const clipPeaks = new Map<number, ClipPeaks>();

/**
 * The chunks `clip` can draw right now, ordered by where they start. Empty
 * (or short) while the decode behind them is still running.
 */
export function getClipSamples(clip: number): ClipSamples[] | undefined {
	return clipPeaks.get(clip)?.samples;
}

/**
 * Asks for the peaks a clip needs. Starts the file's decode the first time it
 * is asked about, and re-cuts the clip's own samples whenever the stretch it
 * wants or the zoom it wants them at has changed.
 */
export function requestPeaks(request: PeakRequest): void {
	const record = assetPeaks.get(request.asset.id);

	if (!record || (!record.decoding && !record.decoded)) {
		void decodeAsset(request);
	}

	if (record && record.chunks.length > 0) {
		void updateClip(request, record);
	}
}

/**
 * Gives a clip's samples to the half that was cut off it. Both halves play
 * the same source at the same zoom, so the copy starts with everything the
 * original had — the peak buffers themselves are shared, only the records
 * that say what is being drawn are its own.
 */
export function clonePeaksForSplit(clip: number, copy: number): void {
	const source = clipPeaks.get(clip);
	if (!source) return;

	clipPeaks.set(copy, {
		assetId: source.assetId,
		samples: source.samples.map((sample) => ({ ...sample })),
		hash: source.hash,
		updating: false,
		pending: null,
	});
}

/** Forgets one clip's samples, or every clip's. */
export function clearClipPeaks(clip?: number): void {
	if (clip === undefined) clipPeaks.clear();
	else clipPeaks.delete(clip);
}

/** Forgets everything: the clips' samples and the index of what was decoded. */
export function clearPeaks(): void {
	clipPeaks.clear();
	assetPeaks.clear();
}

/** Forgets one asset's peaks, for a file that is no longer the one it was. */
export function forgetAssetPeaks(assetId: string): void {
	assetPeaks.delete(assetId);
	for (const [clip, peaks] of clipPeaks) {
		if (peaks.assetId === assetId) clipPeaks.delete(clip);
	}
}

// ---------------------------------------------------------------------------
// The asset layer

/**
 * Reads the file through once, writing its peaks to the store a couple of
 * seconds at a time. Each chunk is usable the moment it lands, so a long file
 * draws from the top down rather than all at once at the end.
 */
async function decodeAsset(request: PeakRequest): Promise<void> {
	const { asset } = request;

	const record = assetPeaks.get(asset.id) ?? { decoding: false, decoded: false, chunks: [] };
	assetPeaks.set(asset.id, record);
	if (record.decoding) return;

	record.decoding = true;

	try {
		const track = await getAudioTrack(asset);
		if (!track) return;

		const sink = new AudioSampleSink(track);
		const pending: DecodedPeaks[] = [];
		let covered = 0;

		const flush = async (): Promise<void> => {
			const merged = mergePeaks(pending);
			const id = `${asset.id}-${merged.start}`;
			record.chunks.push({ start: merged.start, end: merged.end, id });
			pending.length = 0;
			covered = 0;
			await storePeaks(id, merged.data);
		};

		for await (const sample of sink.samples()) {
			covered += sample.duration;
			try {
				pending.push(peaksOfSample(sample));
			} finally {
				sample.close();
			}

			if (covered > CHUNK_DURATION) await flush();
		}

		if (pending.length > 0) await flush();

		record.chunks.sort((a, b) => a.start - b.start);
	} catch (error) {
		console.error('[timeline] could not decode peaks', error);
	} finally {
		record.decoding = false;
		record.decoded = true;
	}
}

/**
 * One decoded sample's peaks: the loudest frame of each slice, across every
 * channel, raised to a power so quiet passages still show as something.
 */
function peaksOfSample(sample: AudioSample): DecodedPeaks {
	const size = sample.allocationSize({ format: 'f32', planeIndex: 0 });
	const floats = new Float32Array(size / Float32Array.BYTES_PER_ELEMENT);
	sample.copyTo(floats, { format: 'f32', planeIndex: 0 });

	const channels = sample.numberOfChannels;
	const frames = floats.length / channels;
	const target = Math.ceil(sample.duration * SOURCE_PEAKS_PER_SECOND);
	const peaks = new Uint8ClampedArray(target);
	const ratio = frames / target;

	for (let i = 0; i < target; i++) {
		const from = Math.floor(i * ratio);
		const to = Math.floor((i + 1) * ratio);
		let max = 0;

		for (let frame = from; frame < to && frame < frames; frame++) {
			for (let channel = 0; channel < channels; channel++) {
				max = Math.max(max, Math.pow(Math.abs(floats[frame * channels + channel]!), 0.8));
			}
		}

		peaks[i] = Math.floor(255 * max);
	}

	return { start: sample.timestamp, end: sample.timestamp + sample.duration, data: peaks };
}

function mergePeaks(peaks: DecodedPeaks[]): DecodedPeaks {
	const length = peaks.reduce((total, peak) => total + peak.data.length, 0);
	const merged = new Uint8ClampedArray(length);

	let offset = 0;
	for (const peak of peaks) {
		merged.set(peak.data, offset);
		offset += peak.data.length;
	}

	return { start: peaks[0]!.start, end: peaks[peaks.length - 1]!.end, data: merged };
}

// ---------------------------------------------------------------------------
// The clip layer

/**
 * Re-cuts a clip's samples for the stretch and zoom it is asking about. Only
 * one runs at a time per clip — a zoom or a scroll that arrives while one is
 * reading the store replaces whatever was queued behind it, so the work that
 * finally runs is for where the timeline ended up rather than where it went
 * through.
 */
async function updateClip(request: PeakRequest, record: AssetPeaks): Promise<void> {
	const peaks = clipPeaks.get(request.clip)
		?? { assetId: request.asset.id, samples: [], hash: '', updating: false, pending: null };
	clipPeaks.set(request.clip, peaks);

	if (peaks.updating) {
		peaks.pending = request;
		return;
	}

	try {
		const range = coveringRange(request, record);
		if (range.hash === peaks.hash) return;

		peaks.updating = true;
		peaks.hash = range.hash;

		for (const chunk of record.chunks) {
			if (!inRange(chunk.start, range.start, range.end)) continue;

			const data = await loadPeaks(chunk.id);
			if (!data) continue;

			peaks.samples = peaks.samples.filter((sample) => sample.id !== chunk.id);
			peaks.samples.push({
				...chunk,
				data: downsample(data, Math.ceil((chunk.end - chunk.start) * request.peaksPerSecond)),
				peaksPerSecond: request.peaksPerSecond,
			});
			peaks.samples.sort((a, b) => a.start - b.start);
		}

		peaks.samples = peaks.samples.filter((sample) => inRange(sample.start, range.start, range.end));
	} catch (error) {
		console.error('[timeline] could not cut peaks', error);
	} finally {
		peaks.updating = false;
	}

	const pending = peaks.pending;
	if (pending) {
		peaks.pending = null;
		void updateClip(pending, record);
	}
}

/**
 * The stretch of the asset to cut, snapped out to whole chunks: what is on
 * screen, widened to the chunks its ends fall inside, so the waveform does
 * not stop short of the edge of the viewport.
 */
function coveringRange(request: PeakRequest, record: AssetPeaks) {
	const from = Math.max(0, request.start);
	const to = Math.min(request.asset.duration, request.end);

	const first = record.chunks.find((chunk) => inRange(from, chunk.start, chunk.end));
	const last = record.chunks.find((chunk) => inRange(to, chunk.start, chunk.end));

	const start = first?.start ?? record.chunks.at(0)?.start ?? 0;
	const end = last?.end ?? record.chunks.at(-1)?.end ?? 0;

	return { start, end, hash: `${request.peaksPerSecond}.${start}.${end}` };
}

/**
 * The peaks of `data` at `target` positions: the loudest of each slice, and
 * never fewer than one sample per position.
 *
 * Zoomed in past the resolution the peaks were stored at, a position's slice
 * of the source is narrower than one stored sample, and every slice whose
 * ends round to the same sample would read nothing at all — a fifth of them
 * at the far end of the zoom, drawn as a regular pattern of gaps through the
 * waveform. Holding the sample the slice starts in draws what there is to
 * draw instead: past that zoom the file has no more detail to show.
 */
function downsample(data: Uint8ClampedArray, target: number): Uint8ClampedArray {
	const peaks = new Uint8ClampedArray(target);
	const ratio = data.length / target;

	for (let i = 0; i < target; i++) {
		const from = Math.floor(i * ratio);
		const to = Math.max(from + 1, Math.floor((i + 1) * ratio));
		let max = 0;

		for (let index = from; index < to && index < data.length; index++) {
			max = Math.max(max, data[index]!);
		}

		peaks[i] = max;
	}

	return peaks;
}

const inRange = (value: number, from: number, to: number): boolean => value >= from && value <= to;

// ---------------------------------------------------------------------------
// The store

let database: Promise<IDBDatabase> | null = null;

function getDatabase(): Promise<IDBDatabase> {
	database ??= new Promise((resolve, reject) => {
		const request = indexedDB.open(IDB_NAME, IDB_VERSION);

		request.onupgradeneeded = () => request.result.createObjectStore(IDB_STORE);
		request.onerror = () => reject(request.error);

		request.onsuccess = () => {
			// What an earlier session left behind is unreachable — the index of
			// which chunks exist was never written — so the session starts on
			// an empty store rather than one that only grows.
			const transaction = request.result.transaction(IDB_STORE, 'readwrite');
			transaction.objectStore(IDB_STORE).clear();
			transaction.oncomplete = () => resolve(request.result);
			transaction.onerror = () => reject(transaction.error);
		};
	});

	return database;
}

async function storePeaks(key: string, peaks: Uint8ClampedArray): Promise<void> {
	const db = await getDatabase();
	const transaction = db.transaction(IDB_STORE, 'readwrite');

	transaction.objectStore(IDB_STORE).put(new Blob([new Uint8Array(peaks)]), key);

	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
}

async function loadPeaks(key: string): Promise<Uint8ClampedArray | null> {
	const db = await getDatabase();
	const store = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE);

	const blob = await new Promise<Blob | null>((resolve, reject) => {
		const request = store.get(key);
		request.onsuccess = () => resolve(request.result ?? null);
		request.onerror = () => reject(request.error);
	});

	return blob ? new Uint8ClampedArray(await blob.arrayBuffer()) : null;
}
