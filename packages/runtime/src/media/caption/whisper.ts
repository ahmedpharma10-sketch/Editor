/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionAlign, CaptionType, PaintType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../constants';
import { Paint, Color, TextStyle } from '../../traits';
import { renderText } from '../../utils/text';
import { loadWebFont } from '../../fonts/utils';
import { groupBy, findActiveGroup, resolveTranscript, setChars } from './utils';
import { placeCaption } from './position';
import { createEntity } from '../../actions/entities';
import { appendChild } from '../../actions/hierarchy';

import type { Entity, World } from 'koota';
import type { Asset } from '../../assets/types';
import type { CaptionDecoder } from './types';

const WIDTH = 1000;
const HEIGHT = 100;

export class WhisperCaptionDecoder implements CaptionDecoder {
	public readonly type = CaptionType.WHISPER;
	public groups: ReturnType<typeof groupBy> = [];
	public ready = false;

	private readonly asset: Asset;
	private currentGroupIndex = -1;

	constructor(asset: Asset) {
		this.asset = asset;
		this.init();
	}

	private async init() {
		if (this.ready) return;
		const transcript = await resolveTranscript(this.asset);
		this.groups = groupBy(transcript, { duration: 2 });

		this.ready = true;
	}

	public reposition(world: World, entity: Entity): boolean {
		return placeCaption(world, entity, { width: WIDTH, height: HEIGHT, defaultAlign: CaptionAlign.BOTTOM });
	}

	public applyStyles(world: World, entity: Entity): void {
		if (!this.reposition(world, entity)) return;

		entity.add(TextStyle);
		entity.set(TextStyle, {
			fontFamily: 'Montserrat',
			fontWeight: '400',
			fontSize: 40,
			textAlign: TextAlign.CENTER,
			textBaseline: TextBaseline.MIDDLE,
			textCase: TextCase.ORIGINAL,
			leading: 1.4,
			fontStyle: FontStyle.NORMAL,
		});

		const fill = createEntity(world);
		fill.add(Paint);
		fill.set(Paint, { value: PaintType.SOLID });
		fill.add(Color);
		fill.set(Color, { value: 0xFFFFFF });
		appendChild(world, fill, entity);

		loadWebFont(world, 'Montserrat');
	}

	public seekTo(world: World, entity: Entity, relativeTime: number): void {
		const groupIndex = findActiveGroup(this.groups, relativeTime);

		if (groupIndex === -1) {
			setChars(world, entity, '');
			this.currentGroupIndex = -1;
			return;
		}

		if (groupIndex !== this.currentGroupIndex) {
			this.currentGroupIndex = groupIndex;
			setChars(world, entity, this.groups[groupIndex]!.map(w => w.text).join(' '));
		}
	}

	public draw(world: World, entity: Entity): void {
		renderText(world, entity);
	}

	public dispose(): void {
		this.groups = [];
		this.currentGroupIndex = -1;
	}
}
