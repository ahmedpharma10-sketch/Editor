/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { assert } from '@/utils';
import { CanvasSink } from 'mediabunny';
import { framesToPixels, getRelativeViewport, pixelsToFrames, getCurrentResolution } from '../utils';
import { getVideoTrack } from '../../decoders/video';
import { renderAudioWaveform } from './audio';
import { CLIP_BREAKPOINTS, CLIP_LABEL_HEIGHT } from '../config';
import { secondsToFrames } from '../../utils/time';

import type { TimelineContext } from '../world';
import type { VideoAsset } from '../../db';
import type { EngineWorld } from '../../api/world';

type ThumbnailOptions = {
  clipId: number;
  asset: VideoAsset;
  interval: number;
  width: number;
  height: number;
  firstFrame: number;
  lastFrame: number;
  fps: number;
};

type Thumbnail = {
  timestamp: number;
  canvas: OffscreenCanvas | HTMLCanvasElement;
  tombstoned?: boolean;
}

type ThumbnailCache = {
  thumbnails: Thumbnail[];
  options?: ThumbnailOptions;
  start: number;
  end: number;
  pendingUpdate: ThumbnailOptions | null;
  decoding: boolean;
  fps: number;
};

type ThumbnailStore = {
  thumbnails: Thumbnail[];
  decoding: boolean;
};

const thumbnailCache = new Map<number, ThumbnailCache>(); // By clip eid
const thumbnailStore = new Map<string, ThumbnailStore>(); // By asset id

export function cloneThumbnailCacheForSplit(sourceClipId: number, splitClipId: number) {
  const sourceCache = thumbnailCache.get(sourceClipId);
  if (!sourceCache) return;

  thumbnailCache.set(splitClipId, {
    ...sourceCache,
    // Keep per-clip mutable metadata separate; reuse canvas buffers by reference.
    thumbnails: sourceCache.thumbnails.map(thumbnail => ({ ...thumbnail })),
    pendingUpdate: null,
    decoding: false,
  });
}

export function clearThumbnailCache(id?: number) {
  if (id) {
    thumbnailCache.delete(id);
    return;
  }

  thumbnailCache.clear();
}

export function clearVideoBuffers() {
  thumbnailCache.clear();
  thumbnailStore.clear();
}

type VideoThumbnailOptions = {
  asset: VideoAsset;
}

const MIN_MASK_HEIGHT = 42;

function getClipLayout(timeline: TimelineContext) {
  let maskHeight = 0;

  const clipHeight = timeline.currentLayerHeight;

  if ((clipHeight - CLIP_LABEL_HEIGHT) > MIN_MASK_HEIGHT) {
    maskHeight = (clipHeight - CLIP_LABEL_HEIGHT) * 0.5;
  }

  let waveformOffsetY = clipHeight > CLIP_BREAKPOINTS.sm ? maskHeight + CLIP_LABEL_HEIGHT : 2;

  let thumbnailHeight = 46;
  let thumbnailWidth = 56;

  if (maskHeight > 44) {
    thumbnailHeight = 52;
    thumbnailWidth = 84;
  }

  let thumbnailOffsetY = CLIP_LABEL_HEIGHT + (maskHeight - thumbnailHeight);

  return {
    maskHeight,
    waveformOffsetY,
    thumbnailOffsetY,
    thumbnailHeight,
    thumbnailWidth,
  }
}

export function renderVideoThumbnails(world: EngineWorld, timeline: TimelineContext, eid: number, { asset }: VideoThumbnailOptions) {
  const ctx = timeline.ctx!;

  const c = world.components;
  const fps = world.frameRate;

  const layout = getClipLayout(timeline);

  const start = c.Computed.start[eid];
  const end = c.Computed.end[eid];

  const delay = c.Computed.delay[eid];
  const trimStart = c.Trim.start[eid] ?? 0;
  const trimEnd = c.Trim.end[eid] ?? c.Computed.duration[eid] ?? 0;
  const playbackRate = c.PlaybackRate[eid] ?? 1;

  renderAudioWaveform(world, timeline, eid, {
    color: timeline.colors.clip.video.primary,
    asset,
    padding: 0,
    offsetY: layout.waveformOffsetY,
  });

  // Don't render thumbnails if clip is too small
  if (layout.maskHeight == 0) {
    return;
  }

  const clipLeft = framesToPixels(world, start);
  const clipRight = framesToPixels(world, end);
  const clipWidth = clipRight - clipLeft;

  const [vpl, vpr] = getRelativeViewport(world, timeline);

  ctx.save();

  {
    // create a drawing area for the thumbnails
    ctx.beginPath();
    ctx.roundRect(clipLeft + 2, CLIP_LABEL_HEIGHT, clipWidth - 4, layout.maskHeight, 2);
    ctx.clip();
  }

  // Thumbnail interval in asset (source) frames, scaled by playbackRate so a
  // thumbnailWidth of timeline pixels maps to the correct chunk of source.
  // Kept as a float — at high zoom this can be sub-frame (e.g. 0.28); rounding
  // it to 0 with `pixelsToFrames` makes the decode range collapse to NaN and
  // every thumbnail goes missing.
  const interval = (layout.thumbnailWidth / getCurrentResolution(world)) * playbackRate;

  const adjustedVpl = vpl;
  const adjustedVpr = vpr;

  const delayPx = framesToPixels(world, delay);

  // Intersect the trim range with the viewport directly in frames — going
  // through pixels first lets `framesToPixels` floor and `pixelsToFrames`
  // round, which can shave a frame off `lastFrame` when `trimEnd`
  // sits at a thumbnail boundary, leaving the last thumbnail un-decoded.
  // Multiply by playbackRate to match the trim frames' source time base.
  const vplFrames = (pixelsToFrames(world, adjustedVpl) - delay) * playbackRate;
  const vprFrames = (pixelsToFrames(world, adjustedVpr) - delay) * playbackRate;

  const firstFrame = Math.max(trimStart, vplFrames);
  const lastFrame = Math.min(trimEnd, vprFrames);

  updateThumbnails({
    clipId: eid,
    asset,
    fps,
    firstFrame,
    lastFrame,
    width: layout.thumbnailWidth,
    height: layout.thumbnailHeight,
    interval,
  });

  ctx.translate(delayPx, 0);

  // draw thumnail when available — indices are in asset time so they
  // line up with the asset-time thumbnails after the delayPx translate.
  const firstIndex = Math.floor(trimStart / interval);
  const lastIndex = Math.floor(trimEnd / interval);

  const cachedStart = thumbnailCache.get(eid)?.start;
  const cachedEnd = thumbnailCache.get(eid)?.end;

  for (let i = firstIndex; i <= lastIndex; i++) {
    const timestamp = i * interval;

    const hasCached = cachedStart != undefined && cachedEnd != undefined;
    if (!hasCached || (timestamp < cachedStart - interval || timestamp > cachedEnd + interval)) {
      var thumbnails = thumbnailStore.get(asset.id)?.thumbnails ?? [];
    } else {
      var thumbnails = thumbnailCache.get(eid)?.thumbnails ?? [];
    }

    const thumbnailIndex = binarySearchClosest(thumbnails, timestamp, x => x.timestamp);
    const thumbnail = thumbnails[thumbnailIndex];

    if (!thumbnail) continue;

    const thumbnailX = i * layout.thumbnailWidth;
    const thumbnailY = layout.thumbnailOffsetY;

    ctx.drawImage(
      thumbnail.canvas,
      thumbnailX,
      thumbnailY,
      layout.thumbnailWidth,
      layout.thumbnailHeight,
    );
  }

  ctx.closePath();

  ctx.restore();
}


function updateThumbnails(options: ThumbnailOptions) {
  const stored = thumbnailStore.get(options.asset.id);
  if (!stored || (!stored.decoding && stored.thumbnails.length === 0)) {
    initializeThumbnailCache(options);
  }

  if (stored && stored.thumbnails.length > 0) {
    updateThumbnailCache(options);
  }
}

function createBestThumbnailRange(options: ThumbnailOptions) {
  const { firstFrame, lastFrame, interval } = options;
  const { asset } = options;

  // decode one more thumbnail than the visible range
  const margin = 1;

  const minIndex = 0;
  const maxIndex = Math.floor(secondsToFrames(asset.duration) / interval);

  const startIndex = Math.max(Math.floor(firstFrame / interval) - margin, minIndex);
  const endIndex = Math.min(Math.floor(lastFrame / interval) + margin, maxIndex);

  return {
    start: startIndex * interval,
    end: endIndex * interval,
    startIndex,
    endIndex,
  }
}

async function updateThumbnailCache(options: ThumbnailOptions) {
  let cached = thumbnailCache.get(options.clipId);

  if (cached?.decoding == true) {
    cached.pendingUpdate = options;
    return;
  }

  if (cached == undefined) {
    cached = {
      thumbnails: [],
      start: -1,
      end: -1,
      pendingUpdate: null,
      decoding: true,
      fps: options.fps,
    }
    thumbnailCache.set(options.clipId, cached);
  }

  try {
    cached.decoding = true;

    const currentHash = createRangeHash(cached.options);
    const newHash = createRangeHash(options);

    if (currentHash == newHash) {
      return;
    }

    const bestRange = createBestThumbnailRange(options);
    const intersects = intersect(
      [bestRange.start, bestRange.end],
      [cached.start, cached.end],
    );
    const resized = createSizeHash(options) != createSizeHash(cached.options);
    const intervalChanged = options.interval != cached.options?.interval;

    // indices of the thumbnails to decode
    let decodeStartIndex: number = 0;
    let decodeEndIndex: number = 0;

    // if the interval has changed, we need to re-initialize the cache
    // or there is no intersection between the new range and the cache
    if (intervalChanged || !intersects || resized) {
      decodeStartIndex = bestRange.startIndex;
      decodeEndIndex = bestRange.endIndex;

      // Tombstone all the canvases in the cache
      cached.thumbnails.forEach(c => c.tombstoned = true);
    } else if (bestRange.start < cached.start) {
      decodeStartIndex = bestRange.startIndex;
      decodeEndIndex = Math.floor(cached.start / options.interval);
    } else if (bestRange.end > cached.end) {
      decodeStartIndex = Math.floor(cached.end / options.interval);
      decodeEndIndex = bestRange.endIndex;
    }

    // Tombstone the canvases that are outside the new range
    cached.thumbnails.forEach(c => {
      if (c.timestamp > bestRange.end || c.timestamp < bestRange.start) {
        c.tombstoned = true;
      }
    });

    const decodeCount = decodeEndIndex - decodeStartIndex;

    // This case handles when no new thumbnails need to be decoded because the 
    // existing cache already covers the visible range.
    if (decodeCount <= 0) {
      cached.thumbnails = cached.thumbnails
        .filter(c => !c.tombstoned)
        .sort((a, b) => a.timestamp - b.timestamp);
      cached.start = bestRange.start;
      cached.end = bestRange.end;
      cached.options = options;
      return;
    }

    const track = await getVideoTrack(options.asset);
    assert(track, 'Track must be set');

    const sink = new CanvasSink(track, {
      width: options.width * window.devicePixelRatio,
      height: options.height * window.devicePixelRatio,
      fit: 'cover',
    });

    for (let i = 0; i < decodeCount; i++) {
      try {
        const frameTimestamp = (decodeStartIndex + i) * options.interval;
        const canvas = await sink.getCanvas(frameTimestamp / options.fps);
        if (!canvas) continue;

        // Decoder may snap to the nearest keyframe — store the actual returned
        // timestamp so the binary search at draw time finds the right thumbnail.
        const decodedFrame = secondsToFrames(canvas.timestamp);

        cached.thumbnails = cached.thumbnails
          .filter(c => !c.tombstoned || c.timestamp > decodedFrame)
          .sort((a, b) => a.timestamp - b.timestamp);

        cached.thumbnails.push({
          timestamp: decodedFrame,
          canvas: canvas.canvas,
          tombstoned: false,
        });
      } catch {
        // Must not be handled
      }
    }

    cached.thumbnails = cached.thumbnails
      .filter(c => !c.tombstoned)
      .sort((a, b) => a.timestamp - b.timestamp);
    cached.start = bestRange.start;
    cached.end = bestRange.end;
    cached.options = options;
  } catch (e) {
    console.error('Error updating thumbnail cache', e);
  } finally {
    cached.decoding = false;
  }

  if (cached.pendingUpdate) {
    const options = cached.pendingUpdate;
    if (!options) return;
    cached.pendingUpdate = null;
    void updateThumbnailCache(options);
  }
}

async function initializeThumbnailCache(options: ThumbnailOptions) {
  const { asset } = options;

  let stored = thumbnailStore.get(options.asset.id);

  if (stored?.decoding) {
    return;
  }

  if (!stored) {
    stored = { thumbnails: [], decoding: true };
    thumbnailStore.set(options.asset.id, stored);
  }

  try {
    stored.decoding = true;

    if (asset.duration < 60 * 10) {
      var count = 7
    } else if (asset.duration < 20) {
      var count = 5
    } else {
      var count = 10;
    }

    const track = await getVideoTrack(asset);
    assert(track, 'Track must be set');
    const firstTimestamp = await track.getFirstTimestamp();
    const lastTimestamp = await track.computeDuration();

    const dpr = window.devicePixelRatio;
    const sink = new CanvasSink(track, {
      width: options.width * dpr,
      height: options.height * dpr,
      fit: 'cover',
    });

    for (let i = 0; i < count; i++) {
      try {
        const timestamp = firstTimestamp + i * (lastTimestamp - firstTimestamp) / count;
        const canvas = await sink.getCanvas(timestamp);
        if (!canvas) continue;

        stored.thumbnails.push({
          timestamp: secondsToFrames(canvas.timestamp),
          canvas: canvas.canvas,
        });
      } catch {
        // Must not be handled
      }
    }
  } catch (e) {
    console.error('Error initializing thumbnail cache', e);
  } finally {
    stored.decoding = false;
  }
}

function binarySearchClosest<T>(
  arr: T[],
  key: number,
  valueGetter: (x: T) => number
) {
  if (arr.length === 0) return -1;

  let low = 0;
  let high = arr.length - 1;
  let closestIndex = -1;
  let closestDistance = Infinity;

  while (low <= high) {
    const mid = (low + (high - low + 1) / 2) | 0;
    const midVal = valueGetter(arr[mid]!);
    const distance = Math.abs(midVal - key);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = mid;
    }

    if (midVal < key) {
      low = mid + 1;
    } else if (midVal > key) {
      high = mid - 1;
    } else {
      // Exact match
      return mid;
    }
  }

  return closestIndex;
}

function createRangeHash(options?: ThumbnailOptions) {
  if (!options) return '';

  return `$${options.width}x${options.height}@${window.devicePixelRatio}-${options.interval}-${options.firstFrame}-${options.lastFrame}`;
}

function createSizeHash(options?: ThumbnailOptions) {
  if (!options) return '';

  return `$${options.width}x${options.height}@${window.devicePixelRatio}`;
}

/**
 * Check if two ranges intersect (non-inclusive)
 * @param range1 [start, end]
 * @param range2 [start, end]
 * @returns true if the ranges intersect, false otherwise
 */
export function intersect(range1: [number, number], range2: [number, number]): boolean {
  const [x1, x2] = range1;
  const [y1, y2] = range2;

  return x1 < y2 && y1 < x2;
}
