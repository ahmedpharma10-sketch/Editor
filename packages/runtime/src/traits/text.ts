/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from 'koota';

import { FontStyle, TextAlign, TextBaseline, TextCase } from '../constants';

import type { Token } from '../utils/text';

// Text characters: only on the parent text node, not shared with ranges.
export const Chars = trait({ value: '' });

// Text style properties, shared between a text node and its TextRange
// sub-entities. On a text node this is the default style; on a range
// sub-entity it overrides.
export const TextStyle = trait({
	leading: 1.2,
	fontSize: 16,
	fontFamily: '',
	fontWeight: '400',
	fontStyle: FontStyle.NORMAL as FontStyle,
	textAlign: TextAlign.LEFT as TextAlign,
	textBaseline: TextBaseline.TOP as TextBaseline,
	textCase: TextCase.ORIGINAL as TextCase,
	letterSpacing: 0, // extra spacing between characters (px)
});

// Character range a TextStyle override applies to; end null = to the end.
export const TextRange = trait({ start: 0, end: null as number | null });

// Runtime-only: cached text layout, one Token[] per line. Never serialized.
export const TextCache = trait({ tokens: () => [] as Token[][] });
