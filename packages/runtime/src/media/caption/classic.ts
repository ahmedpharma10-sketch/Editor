/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionAlign, CaptionType, PaintType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../constants';
import { Paint, Color, Shadow, Opacity, Blur, Offset, TextStyle } from '../../traits';
import { renderText } from '../../utils/text';
import { loadWebFont } from '../../fonts/utils';
import { groupBy, findActiveGroup, resolveTranscript, setChars } from './utils';
import { placeCaption } from './position';
import { createEntity } from '../../actions/entities';
import { appendChild } from '../../actions/hierarchy';

import type { Entity, World } from 'koota';
import type { Asset } from '../../assets/types';
import type { CaptionDecoder } from './types';

export const CLASSIC_PRESET_WIDTH = 600;
export const CLASSIC_PRESET_HEIGHT = 100;

export class ClassicCaptionDecoder implements CaptionDecoder {
	public readonly type = CaptionType.CLASSIC;
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
		this.groups = groupBy(transcript, { duration: 0.2 });
		this.ready = true;
	}

	public reposition(world: World, entity: Entity): boolean {
		return placeCaption(world, entity, {
			width: CLASSIC_PRESET_WIDTH,
			height: CLASSIC_PRESET_HEIGHT,
			defaultAlign: CaptionAlign.CENTER,
		});
	}

	public applyStyles(world: World, entity: Entity): void {
		if (!this.reposition(world, entity)) return;

		entity.add(TextStyle);
		entity.set(TextStyle, {
			fontFamily: 'Urbanist',
			fontWeight: '600',
			fontSize: 62,
			textAlign: TextAlign.CENTER,
			textBaseline: TextBaseline.MIDDLE,
			textCase: TextCase.LOWER,
			fontStyle: FontStyle.NORMAL,
			leading: 1,
		});

		const fill = createEntity(world);
		fill.add(Paint);
		fill.set(Paint, { value: PaintType.SOLID });
		fill.add(Color);
		fill.set(Color, { value: 0xFFFFFF });
		appendChild(world, fill, entity);

		const shadow = createEntity(world);
		shadow.add(Shadow);
		shadow.add(Color);
		shadow.set(Color, { value: 0x000000 });
		shadow.add(Opacity);
		shadow.set(Opacity, { value: 1 });
		shadow.add(Blur);
		shadow.set(Blur, { value: 28 });
		shadow.add(Offset);
		shadow.set(Offset, { x: 0, y: 5 });
		appendChild(world, shadow, entity);

		loadWebFont(world, 'Urbanist');
	}

	public seekTo(world: World, entity: Entity, relativeTime: number): void {
		const groupIndex = findActiveGroup(this.groups, relativeTime);

		if (groupIndex === -1) {
			setChars(world, entity, '');
			this.currentGroupIndex = -1;
			return;
		}

		const group = this.groups[groupIndex]!;

		if (groupIndex !== this.currentGroupIndex) {
			this.currentGroupIndex = groupIndex;
			setChars(world, entity, group.map(w => w.text).join(' '));
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
