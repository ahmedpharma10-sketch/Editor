/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { framesToPixels, getRelativeViewport } from "../utils";
import { CLIP_BREAKPOINTS, CLIP_LABEL_HEIGHT, MAX_CLIP_HEIGHT } from '../config';
import { getAssetFile } from '../../api/assets';

import type { EngineWorld } from "../../api/world";
import type { TimelineContext } from "../world";
import type { ImageAsset, SequenceAsset } from '../../db';

type ThumbnailAsset = ImageAsset | SequenceAsset;

type ThumbnailCache = {
  canvas: OffscreenCanvas;
  hash: string;
  width: number;
  height: number;
}

type ThumbnailOptions = {
  width: number;
  height: number;
}

let thumbnailCache = new WeakMap<ThumbnailAsset, ThumbnailCache>();

// 3 discrete thumbnail widths to prevent constant repositioning during resize
const THUMBNAIL_WIDTHS = [80, 100, 120] as const;

function getSnappedThumbnailWidth(clipHeight: number): number {
  if (clipHeight >= 100) return THUMBNAIL_WIDTHS[2];
  if (clipHeight >= 70) return THUMBNAIL_WIDTHS[1];
  return THUMBNAIL_WIDTHS[0];
}

type ImageThumbnailOptions = {
  asset: ThumbnailAsset;
}

export function clearImageThumbnailCache() {
  thumbnailCache = new WeakMap<ThumbnailAsset, ThumbnailCache>();
}

export function renderImageThumbnails(world: EngineWorld, timeline: TimelineContext, eid: number, { asset }: ImageThumbnailOptions) {
  const ctx = timeline.ctx!;

  // SVGs aren't supported by createImageBitmap on every browser, so skip
  // the timeline thumbnail strip for them.
  if (asset.mimeType === 'image/svg+xml') return;

  const c = world.components;

  // Don't render thumbnails if clip is too small
  const layerHeight = timeline.currentLayerHeight;
  if (layerHeight <= CLIP_BREAKPOINTS.sm) return;

  const start = c.Computed.start[eid];
  const end = c.Computed.end[eid];

  const clipDelayPx = framesToPixels(world, start);
  const clipWidth = framesToPixels(world, end) - clipDelayPx;

  const [firstX, lastX] = getRelativeViewport(world, timeline);

  // Thumbnail fills full height, but width snaps to 3 discrete values for stability
  const thumbnailWidth = getSnappedThumbnailWidth(layerHeight);
  const thumbnailHeight = Math.round(thumbnailWidth * (asset.height / asset.width));

  const tileCount = Math.ceil(clipWidth / thumbnailWidth);
  const firstIndex = Math.max(0, Math.floor((firstX - clipDelayPx) / thumbnailWidth));
  const lastIndex = Math.min(tileCount - 1, Math.floor((lastX - clipDelayPx) / thumbnailWidth));

  // Update the thumbnail cache
  updateThumbnailCache(asset, {
    width: thumbnailWidth,
    height: thumbnailHeight,
  });

  const cached = thumbnailCache.get(asset);

  if (!cached) return;

  const thumbnailY = 18;
  const maskHeight = layerHeight - CLIP_LABEL_HEIGHT;

  // Calculate image crop to match object-fit: cover behavior
  const srcAspect = cached.width / cached.height;
  const destAspect = thumbnailWidth / maskHeight;

  let cropX = 0;
  let cropY = 0;
  let cropWidth = cached.width;
  let cropHeight = cached.height;

  if (srcAspect > destAspect) {
    // Source is wider - crop horizontally
    cropWidth = cached.height * destAspect;
    cropX = (cached.width - cropWidth) / 2;
  } else {
    // Source is taller - crop vertically
    cropHeight = cached.width / destAspect;
    cropY = (cached.height - cropHeight) / 2;
  }

  // Draw thumbnails
  {
    ctx.save();

    // translate to the delay of the clip
    ctx.translate(clipDelayPx, 0);

    // create a drawing area for the thumbnails
    ctx.beginPath();
    ctx.roundRect(2, 20, clipWidth - 4, maskHeight - 2, 2);
    ctx.clip();

    ctx.translate(-clipDelayPx, 0);

    for (let i = firstIndex; i <= lastIndex; i++) {
      const thumbnailX = clipDelayPx + i * thumbnailWidth;

      ctx.drawImage(
        cached.canvas,
        cropX, cropY, cropWidth, cropHeight,
        thumbnailX, thumbnailY, thumbnailWidth, maskHeight,
      );
    }

    ctx.closePath();

    ctx.restore();
  }
}

let decoding = false;
async function updateThumbnailCache(asset: ThumbnailAsset, options: ThumbnailOptions) {
  const hash = `$${options.width}x${options.height}`;

  try {
    if (hash != thumbnailCache.get(asset)?.hash && !decoding) {
      decoding = true;
      const blob = await getAssetFile(asset);
      const bitmap = await createImageBitmap(blob);

      const dpr = window.devicePixelRatio;
      const scale = Math.min(1, Math.max(
        (options.width * dpr) / bitmap.width,
        (MAX_CLIP_HEIGHT * dpr) / bitmap.height,
      ));
      const canvasWidth = Math.max(1, Math.round(bitmap.width * scale));
      const canvasHeight = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
      const ctx = canvas.getContext('2d')!;

      ctx.drawImage(bitmap, 0, 0, canvasWidth, canvasHeight);
      bitmap.close();

      thumbnailCache.set(asset, { canvas, hash, width: canvasWidth, height: canvasHeight });
    }
  } catch (e) {
    console.error('Error updating thumbnail cache', e);
  } finally {
    decoding = false;
  }
}
