/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const THUMBNAIL_WIDTH = 464;
const THUMBNAIL_HEIGHT = 260;
const JPEG_QUALITY = 0.8;

export async function captureCanvasThumbnail(
  canvas?: HTMLCanvasElement | OffscreenCanvas | null,
): Promise<Blob | null> {
  if (!(canvas instanceof HTMLCanvasElement)) {
    return null;
  }

  const offscreen = document.createElement('canvas');
  offscreen.width = THUMBNAIL_WIDTH;
  offscreen.height = THUMBNAIL_HEIGHT;

  const ctx = offscreen.getContext('2d');
  if (!ctx) return null;

  const targetAspect = THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT;
  let sw = canvas.width;
  let sh = canvas.height;
  let sx = 0;
  let sy = 0;
  if (sw / sh > targetAspect) {
    sw = sh * targetAspect;
    sx = (canvas.width - sw) / 2;
  } else {
    sh = sw / targetAspect;
    sy = (canvas.height - sh) / 2;
  }

  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);

  return new Promise((resolve) => {
    offscreen.toBlob(
      resolve,
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}
