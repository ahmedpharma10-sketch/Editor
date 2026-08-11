/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from 'koota';

import { BlendMode, EffectType, ScaleModeType, StrokeJoin, StrokeCap } from '../constants';

export const Appearance = trait({
	opacity: 1,
	blendMode: BlendMode.SOURCE_OVER as BlendMode,
});

export const Color = trait({ value: 0 });

export const CornerRadius = trait({ value: 0 });

// Per-corner radii (CSS order: TL, TR, BR, BL).
export const MixedCornerRadius = trait({
	topLeft: 0,
	topRight: 0,
	bottomRight: 0,
	bottomLeft: 0,
});

export const Blur = trait({ value: 0 });

// Scale mode for image fills and any other scaled asset display.
export const ScaleMode = trait({ value: ScaleModeType.COVER as ScaleModeType });

// Effect sub-entity: one per applied effect, ChildOf its target.
export const Effect = trait({
	type: EffectType.DROP_SHADOW as EffectType,
	value: 0,
});

// Single gradient stop. Each stop is its own entity, ChildOf the gradient
// fill. Stop count is fixed for the lifetime of the fill: to animate between
// gradients with different stop counts use a separate fill and cross-fade.
export const ColorStop = trait({ offset: 0, color: 0, opacity: 1 });

export const StrokeStyle = trait({
	width: 1,
	join: StrokeJoin.MITER as StrokeJoin,
	cap: StrokeCap.BUTT as StrokeCap,
	miterLimit: 10,
});

// Shader paint source (document data; the compiled host lives in ShaderHost).
export const Shader = trait({
	code: '',
	uniforms: () => null as Record<string, number | number[] | string> | null,
});
