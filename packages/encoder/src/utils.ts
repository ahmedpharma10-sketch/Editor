/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The exact pixel size an export produces, and the scale it draws at. */
export interface OutputSize {
	width: number;
	height: number;
	scale: number;
}

/**
 * The output size an export at `resolution` produces for a scene: the
 * resolution is a target height, the scene is scaled to reach it, and both
 * sides are rounded to even for the encoders. The one formula the video
 * encoder, the image encoder and the UI all share — what is shown to the
 * user is what is encoded.
 */
export function computeOutputSize(
	sceneWidth: number,
	sceneHeight: number,
	resolution?: number,
): OutputSize {
	const scale = Math.round((resolution ?? sceneHeight) * 1e6 / sceneHeight) / 1e6;
	return {
		scale,
		width: Math.round(sceneWidth * scale / 2) * 2,
		height: Math.round(sceneHeight * scale / 2) * 2,
	};
}

/**
 * Helper for creating the render event detail
 */
export function createRenderEventDetail(progress: number, total: number, startTime: number) {
  const duration = performance.now() - startTime;
  const time = (duration / gte1(progress)) * (total - progress);
  const remaining = new Date(time);

  return { remaining, progress, total };
}

/**
 * Helper for making sure a number is greater than 1
 */
function gte1(num: number): number {
  if (num < 1) return 1;
  return num;
}
