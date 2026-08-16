/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { PatchProps } from '@diffusionstudio/jsx';

/**
 * Every `PatchProps` key, at runtime — the patch-command allowlist. Host-side:
 * a project never enumerates its own props, but anything applying a patch has
 * to reject unknown keys. The `satisfies` guard keeps the list exhaustive as
 * `PatchProps` grows.
 */
export const PATCH_PROP_KEYS = Object.keys({
	key: true,
	scene: true,
	name: true,
	x: true,
	y: true,
	offsetX: true,
	offsetY: true,
	width: true,
	height: true,
	rotation: true,
	opacity: true,
	cornerRadius: true,
	start: true,
	end: true,
	sourceIn: true,
	sourceOut: true,
	syncTo: true,
	transition: true,
	animations: true,
	fill: true,
	src: true,
	objectFit: true,
	wgsl: true,
	uniforms: true,
	volume: true,
	muted: true,
	fontFamily: true,
	fontSize: true,
	fontWeight: true,
	fontStyle: true,
	color: true,
	textAlign: true,
	textBaseline: true,
	offset: true,
	preset: true,
	colors: true,
	verticalAlign: true,
	seed: true,
} satisfies Record<keyof PatchProps, true>) as ReadonlyArray<keyof PatchProps>;
