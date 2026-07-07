/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { WebFonts } from './fixtures';
import { FontStyle } from '../components';

import type * as types from './types';
import type { EngineWorld } from '../api/world';

const STYLE_MAP = {
	[FontStyle.NORMAL]: 'normal',
	[FontStyle.ITALIC]: 'italic',
	[FontStyle.OBLIQUE]: 'oblique',
} as const;

/**
 * Get all available local fonts, requires the
 * **Local Font Access API**
 */
export async function getLocalFonts(): Promise<types.FontSources[]> {
	const localFonts: Record<string, any> = {};

	// group by font family
	for (const font of await window.queryLocalFonts()) {
		if (font.family in localFonts) {
			localFonts[font.family].push(font);
			continue;
		}
		localFonts[font.family] = [font];
	}

	return Object.keys(localFonts).map((family: any) => {
		return {
			family,
			variants: localFonts[family].map((font: any) => {
				return {
					family,
					source: `local('${font.fullName}'), local('${font.postscriptName}')`,
					weight: matchFontWeight(font.style),
					style: matchFontStyle(font.style),
				};
			}),
		};
	});
}

/**
 * Get common web fonts
 */
export function getWebFonts(): types.FontSources[] {
	return Object.keys(WebFonts).map((family) => {
		return {
			family,
			variants: WebFonts[family as keyof typeof WebFonts].weights.map((weight) => {
				return {
					family,
					source: `url(${WebFonts[family as keyof typeof WebFonts].url})`,
					weight: weight,
				};
			}),
		};
	});
}

export async function loadWebFont(
	world: EngineWorld,
	family: keyof typeof WebFonts,
	style: FontStyle = FontStyle.NORMAL,
	weight?: string,
) {
	const source = `url(${WebFonts[family].url})`;
	const font: types.FontSource = {
		source,
		family,
		weight,
		style,
	};

	// Already loaded
	if (world.fonts.some((f) => f.source === font.source && f.weight === font.weight)) {
		return font;
	}

	world.fonts.push(font);

	// Load all weights if no weight is specified
	if (!weight) {
		const config = WebFonts[family as keyof typeof WebFonts];
		const weights = config.weights;
		weight = weights.length > 1 ? `${weights[0]} ${weights[weights.length - 1]}` : weights[0]
	}

	const fontFace = new FontFace(family, source, { weight, style: STYLE_MAP[style] });

	await new Promise((resolve, reject) => {
		fontFace
			.load()
			.then((font) => {
				document.fonts.add(font);
				resolve(null);
			})
			.catch((error) => {
				world.fonts = world.fonts.filter((f) => f.source !== font.source && f.weight !== font.weight);
				reject(error);
			});
	});

	const db = await world.store.db;
	await db.put('fonts', font);
}

export async function restoreFonts(world: EngineWorld): Promise<void> {
	const db = await world.store.db;

	for (const font of await db.getAll('fonts')) {
		if (font.family in WebFonts) {
			await loadWebFont(
				world,
				font.family as keyof typeof WebFonts,
				font.style as FontStyle,
				font.weight,
			);
		}
	}
}

function matchFontStyle(style: any) {
	if (`${style}`.match(/oblique/i)) {
		return FontStyle.OBLIQUE;
	}

	if (`${style}`.match(/italic/i)) {
		return FontStyle.ITALIC;
	}

	return FontStyle.NORMAL;
}

function matchFontWeight(weight: any) {
	if (`${weight}`.match(/black|heavy/i)) {
		return '900';
	}

	if (`${weight}`.match(/extrabold|ultrabold/i)) {
		return '800';
	}

	if (`${weight}`.match(/semibold|demibold/i)) {
		return '600';
	}

	if (`${weight}`.match(/bold|strong/i)) {
		return '700';
	}

	if (`${weight}`.match(/medium/i)) {
		return '500';
	}

	if (`${weight}`.match(/normal|regular|book|plain/i)) {
		return '400';
	}

	if (`${weight}`.match(/extralight|ultralight/i)) {
		return '200';
	}

	if (`${weight}`.match(/thin|hairline/i)) {
		return '100';
	}

	if (`${weight}`.match(/light/i)) {
		return '300';
	}

	return '400';
}
