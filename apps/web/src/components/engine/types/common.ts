/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export type RuntimeMode = 'realtime' | 'offline-video' | 'offline-audio';

export type HudMode = 'idle' | 'moving' | 'marquee';

/**
 * 2D affine matrix representing the camera transform in CSS pixel space
 * (before DPR scaling). The render system multiplies this by devicePixelRatio
 * to derive the canvas transform.
 */
export type Camera2D = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};
