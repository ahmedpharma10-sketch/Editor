/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { assert } from '@/utils';
import { AudioSample, AudioSampleSink } from 'mediabunny';
import { framesToPixels, getRelativeViewport, getCurrentResolution } from '../utils';
import { CLIP_BREAKPOINTS, CLIP_CORNER_RADIUS } from '../config';
import { getAudioTrack } from '../../decoders/audio';

import type { EngineWorld } from '../../api/world';
import type { TimelineContext } from '../world';
import type { AudioAsset, VideoAsset } from '../../db';

interface StoredPeaks {
  start: number;
  end: number;
  id: string;
}

interface SampledPeaks extends StoredPeaks {
  data: Uint8ClampedArray;
  peaksPerSecond: number;
};

type SampleOptions = {
  clipEid: number;
  asset: VideoAsset | AudioAsset;
  peaksPerSecond: number;
  start: number;
  end: number;
}

type PeakData = {
  start: number;
  end: number;
  data: Uint8ClampedArray;
}

type WaveformDrawOptions = {
  asset: VideoAsset | AudioAsset;
  offsetY: number;
  padding: number;
  color: string;
}

type AudioCache = {
  samples: SampledPeaks[];
  start: number;
  end: number;
  hash: string;
  updating: boolean;
  pendingUpdate: SampleOptions | null;
}

type AudioStore = {
  initializing: boolean;
  data: StoredPeaks[];
}

const HIGH_RES_PEAKS_PER_SECOND = 800;
const MAX_CHUNK_DURATION = 2;
const SAMPLE_WIDTH = 1;

const IDB_NAME = "peak-cache-db";
const IDB_VERSION = 1;
const IDB_STORE_NAME = "data";

const audioCache = new Map<number, AudioCache>(); // By clip eid
const audioStore = new Map<string, AudioStore>(); // By asset id

export function pixelsToSeconds(world: EngineWorld, pixels: number) {
  const resolution = getCurrentResolution(world);
  const fps = world.frameRate;

  return pixels / (fps * resolution);
}

export function cloneAudioCacheForSplit(clipEid: number, splitClipEid: number) {
  const sourceCache = audioCache.get(clipEid);
  if (!sourceCache) return;

  audioCache.set(splitClipEid, {
    ...sourceCache,
    // Keep a separate cache object/array but reuse underlying peak buffers.
    samples: sourceCache.samples.map(sample => ({ ...sample })),
    updating: false,
    pendingUpdate: null,
  });
}

export function clearAudioCache(eid?: number) {
  if (eid != undefined) {
    audioCache.delete(eid);
    return;
  }

  audioCache.clear();
}

export function clearAudioBuffers() {
  audioCache.clear();
  audioStore.clear();
}

export function renderAudioWaveform(world: EngineWorld, timeline: TimelineContext, eid: number, options: WaveformDrawOptions) {
  const ctx = timeline.ctx!;

  if (!options.asset.sampleRate) return;

  const resolution = getCurrentResolution(world);

  const c = world.components;
  const fps = world.frameRate;

  const layerHeight = timeline.currentLayerHeight;
  const clipLeft = framesToPixels(world, c.Computed.start[eid]);
  const clipRight = framesToPixels(world, c.Computed.end[eid]);
  const clipWidth = clipRight - clipLeft;
  const maskHeight = layerHeight - options.offsetY;

  const [vpl, vpr] = getRelativeViewport(world, timeline);

  ctx.save();

  // Clip the waveform to the background
  {
    ctx.beginPath();
    ctx.roundRect(clipLeft, options.offsetY, clipWidth, maskHeight, CLIP_CORNER_RADIUS);
    ctx.clip();
  }

  // Make the samples a bit smaller to avoid clipping
  const waveformHeight = maskHeight - options.padding;

  const adjustedViewportLeft = vpl - 5;
  const adjustedViewportRight = vpr + 5;

  const playbackRate = c.PlaybackRate[eid] ?? 1;

  // Each pixel covers playbackRate× more source audio when sped up, so we
  // need proportionally fewer peaks per source second to keep one peak/pixel.
  const pixelsPerSecond = Math.floor(fps * resolution);
  const peaksPerSecond = pixelsPerSecond / SAMPLE_WIDTH / playbackRate;

  // Trim is in source frames; the clip occupies trim/playbackRate timeline frames.
  const inPx = framesToPixels(world, (c.Trim.start[eid] ?? 0) / playbackRate);
  const outPx = framesToPixels(world, (c.Trim.end[eid] ?? c.Computed.duration[eid]) / playbackRate);
  const delayPx = framesToPixels(world, c.Computed.delay[eid]);

  const firstSample = Math.max(inPx, adjustedViewportLeft - delayPx);
  const lastSample = Math.min(outPx, adjustedViewportRight - delayPx);

  updateSamples({
    clipEid: eid,
    asset: options.asset,
    start: pixelsToSeconds(world, firstSample) * playbackRate,
    end: pixelsToSeconds(world, lastSample) * playbackRate,
    peaksPerSecond,
  });

  ctx.fillStyle = options.color;

  const positionMultiplier = maskHeight > CLIP_BREAKPOINTS.sm ? 0.5 : 1;
  const minSampleHeight = maskHeight > CLIP_BREAKPOINTS.sm ? 1 : 0;

  // Tone the waveform down on short clip rows so the label stays readable.
  if (timeline.currentLayerHeight <= CLIP_BREAKPOINTS.sm) {
    ctx.globalAlpha *= 0.6;
  }

  // Draw samples
  ctx.translate(delayPx, options.offsetY + options.padding * positionMultiplier);

  // Enables search at O(1) time complexity when peaks are sorted by start time ascending
  let lastPeakIndex = 0;

  for (let sampleX = firstSample; sampleX < lastSample; sampleX += SAMPLE_WIDTH) {
    const samples = audioCache.get(eid)?.samples;
    const time = pixelsToSeconds(world, sampleX) * playbackRate;
    const index = samples?.findIndex(p => time >= p.start && time <= p.end, lastPeakIndex) ?? -1;
    const sampleData = samples?.[index];
    lastPeakIndex = index;

    if (!sampleData) continue;

    const sampleIndex = Math.floor((time - sampleData.start) * sampleData.peaksPerSecond);
    const sample: number | undefined = sampleData.data[sampleIndex];

    if (sample === undefined) continue;

    const value = sample / 255;
    const sampleHeight = Math.max(value * waveformHeight, minSampleHeight);
    const sampleTop = (waveformHeight - sampleHeight);
    const sampleY = sampleTop * positionMultiplier;

    ctx.fillRect(sampleX, sampleY, SAMPLE_WIDTH, sampleHeight);
  }

  // close clip path
  ctx.closePath();
  ctx.restore();
}

function updateSamples(options: SampleOptions) {
  const stored = audioStore.get(options.asset.id);
  if (!stored || (!stored.initializing && stored.data.length === 0)) {
    initializePeakCache(options);
  }

  if (stored && stored.data.length > 0) {
    updateSampleCache(options, stored);
  }
}


function findBestPeakRange(options: SampleOptions) {
  const stored = audioStore.get(options.asset.id);

  assert(stored, 'Stored must be set');

  const minValue = Math.max(0, options.start);
  const maxValue = Math.min(options.asset.duration, options.end);

  const fistMatch = stored.data.find(p => inRange(minValue, [p.start, p.end]));
  const lastMatch = stored.data.find(p => inRange(maxValue, [p.start, p.end]));

  const start = fistMatch?.start ?? stored.data.at(0)?.start ?? 0;
  const end = lastMatch?.end ?? stored.data.at(-1)?.end ?? 0;

  const hash = createRangeHash({ ...options, start, end });

  return { start, end, hash };
}

async function updateSampleCache(options: SampleOptions, stored: AudioStore) {
  let cache = audioCache.get(options.clipEid);
  if (!cache) {
    cache = {
      samples: [],
      start: 0,
      end: 0,
      hash: '',
      updating: false,
      pendingUpdate: null,
    }
    audioCache.set(options.clipEid, cache);
  }

  if (cache.updating) {
    cache.pendingUpdate = options;
    return;
  }

  try {
    const { peaksPerSecond } = options;
    const bestRange = findBestPeakRange(options);

    if (bestRange.hash === cache.hash) {
      return;
    }

    cache.updating = true;
    cache.hash = bestRange.hash;

    for (const peak of stored.data) {
      if (!inRange(peak.start, [bestRange.start, bestRange.end])) {
        continue;
      }

      // Downsample to desired peaks per second
      const duration = peak.end - peak.start;
      const targetPeaks = Math.ceil(duration * peaksPerSecond);
      const downsampledBytes = new Uint8ClampedArray(targetPeaks);
      const data = await loadPeaks(peak.id);

      if (!data) continue;
      const numFrames = data.length;

      // Downsample by calculating peaks directly for target positions
      const ratio = numFrames / targetPeaks;
      for (let i = 0; i < targetPeaks; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.floor((i + 1) * ratio);
        let max = 0;

        // For each frame in the range, find max across all channels
        for (let frameIdx = start; frameIdx < end && frameIdx < numFrames; frameIdx++) {
          max = Math.max(max, data[frameIdx]);
        }

        downsampledBytes[i] = max;
      }

      cache.samples = cache.samples.filter(p => p.id !== peak.id);
      cache.samples.push({
        ...peak,
        data: downsampledBytes,
        peaksPerSecond,
      });
      // order by start time ascending
      cache.samples.sort((a, b) => a.start - b.start);
    }

    cache.samples = cache.samples.filter(p => inRange(p.start, [
      bestRange.start,
      bestRange.end,
    ]));
  } catch (error) {
    console.error('Error updating peak cache', error);
  } finally {
    cache.updating = false;
  }

  if (cache.pendingUpdate) {
    const pending = cache.pendingUpdate;
    if (!pending) return;
    cache.pendingUpdate = null;
    void updateSampleCache(pending, stored);
  }
}

async function initializePeakCache(options: SampleOptions) {
  let stored = audioStore.get(options.asset.id);
  if (!stored) {
    stored = { initializing: false, data: [] };
    audioStore.set(options.asset.id, stored);
  }

  try {
    stored.initializing = true;
    const track = await getAudioTrack(options.asset);
    if (!track) return;
    const sink = new AudioSampleSink(track);
    // const iterator = sink.samples(...clip.range);
    const iterator = sink.samples();

    const peaks: PeakData[] = [];
    let duration = 0;

    for await (const sample of iterator) {
      duration += sample.duration;
      try {
        peaks.push(getPeaksFromAudioSample(sample))
      } finally {
        sample.close();
      }

      if (duration > MAX_CHUNK_DURATION) {
        const mergedPeaks = mergePeaks(peaks);
        const id = `${options.asset.id}-${mergedPeaks.start}`;

        stored.data.push({
          start: mergedPeaks.start,
          end: mergedPeaks.end,
          id,
        });
        await storePeaks(id, mergedPeaks.data);
        peaks.length = 0;
        duration = 0;
      }
    }

    if (peaks.length > 0) {
      const mergedPeaks = mergePeaks(peaks);
      const id = `${options.asset.id}-${mergedPeaks.start}`;

      stored.data.push({
        start: mergedPeaks.start,
        end: mergedPeaks.end,
        id,
      });

      await storePeaks(id, mergedPeaks.data);
    }

    stored.data.sort((a, b) => a.start - b.start);
  } catch (error) {
    console.error('Error initializing peak cache', error);
  } finally {
    stored.initializing = false;
  }
}

function getPeaksFromAudioSample(sample: AudioSample): PeakData {
  const size = sample.allocationSize({ format: 'f32', planeIndex: 0 });
  const floats = new Float32Array(size / Float32Array.BYTES_PER_ELEMENT);
  sample.copyTo(floats, { format: 'f32', planeIndex: 0 });

  const numChannels = sample.numberOfChannels;
  const numFrames = floats.length / numChannels;
  const timestamp = sample.timestamp;
  const duration = sample.duration;

  // Downsample to 500 peaks per second
  const targetPeaks = Math.ceil(duration * HIGH_RES_PEAKS_PER_SECOND);
  const downsampledBytes = new Uint8ClampedArray(targetPeaks);

  // Downsample by calculating peaks directly for target positions
  const ratio = numFrames / targetPeaks;

  for (let i = 0; i < targetPeaks; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let max = 0;

    // For each frame in the range, find max across all channels
    for (let frameIdx = start; frameIdx < end && frameIdx < numFrames; frameIdx++) {
      // Find the max across all channels for this frame
      for (let ch = 0; ch < numChannels; ch++) {
        const floatIdx = frameIdx * numChannels + ch;
        // make a more visually pleasing waveform using a power function
        max = Math.max(max, Math.pow(Math.abs(floats[floatIdx]), 0.8));
      }
    }

    downsampledBytes[i] = Math.floor(255 * max);
  }

  return {
    start: timestamp,
    end: timestamp + duration,
    data: downsampledBytes,
  }
}

function mergePeaks(peaks: PeakData[]): PeakData {
  const length = peaks.reduce((acc, peak) => acc + peak.data.length, 0);
  const mergedPeaks = new Uint8ClampedArray(length);

  let offset = 0;
  for (const peak of peaks) {
    mergedPeaks.set(peak.data, offset);
    offset += peak.data.length;
  }

  return {
    start: peaks[0].start,
    end: peaks[peaks.length - 1].end,
    data: mergedPeaks,
  };
}

type RangeHashOptions = {
  peaksPerSecond: number;
  start?: number;
  end?: number;
}

function createRangeHash(options: RangeHashOptions) {
  return `${options.peaksPerSecond}.${options.start}.${options.end}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);

      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_STORE_NAME);
      };

      req.onsuccess = () => {
        const db = req.result;

        const tx = db.transaction(IDB_STORE_NAME, "readwrite");
        tx.objectStore(IDB_STORE_NAME).clear();
        tx.oncomplete = () => resolve(db);
        tx.onerror = () => reject(tx.error);
      };

      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function storePeaks(key: string, peaks: Uint8ClampedArray) {
  const db = await getDB();

  const tx = db.transaction(IDB_STORE_NAME, "readwrite");
  const store = tx.objectStore(IDB_STORE_NAME);

  const blob = new Blob([new Uint8Array(peaks)]);
  store.put(blob, key);


  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function loadPeaks(key: string): Promise<Uint8ClampedArray | null> {
  const db = await getDB();

  const tx = db.transaction(IDB_STORE_NAME, "readonly");
  const store = tx.objectStore(IDB_STORE_NAME);

  const blob: Blob | null = await new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (!blob) return null;

  const buffer = await blob.arrayBuffer();
  return new Uint8ClampedArray(buffer);
}

const inRange = (value: number, range: [number, number]) => {
  return value >= range[0] && value <= range[1];
}
