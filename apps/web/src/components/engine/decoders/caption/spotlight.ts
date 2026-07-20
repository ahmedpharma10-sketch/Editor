/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionAlign, CaptionType, PaintType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../components';
import { renderText } from '../../utils/text';
import { loadWebFont } from '../../font/utils';
import { groupBy, findActiveGroup, clearTextRanges, resolveTranscript } from './utils';
import { placeCaption } from './position';
import { createEntity } from '../../api';
import { appendChild } from '../../api/hierarchy';
import { setComponent } from '../../api/events';

import type { EngineWorld } from '../../api/world';
import type { Asset } from '../../db';
import type { CaptionDecoder } from './types';


const WIDTH = 700;
const HEIGHT = 100;
const HIGHLIGHT_COLOR = 0x24D5FF;

export class SpotlightCaptionDecoder implements CaptionDecoder {
  public readonly type = CaptionType.SPOTLIGHT;
  public groups: ReturnType<typeof groupBy> = [];
  public ready = false;

  private readonly asset: Asset;
  private currentGroupIndex = -1;
  private currentWordIndex = -1;
  private fillEid: number | null = null;

  constructor(asset: Asset) {
    this.asset = asset;
    this.init();
  }

  private async init() {
    if (this.ready) return;
    const transcript = await resolveTranscript(this.asset);
    this.groups = groupBy(transcript, { length: 10 });
    this.ready = true;
  }

  public reposition(world: EngineWorld, eid: number): boolean {
    return placeCaption(world, eid, { width: WIDTH, height: HEIGHT, defaultAlign: CaptionAlign.CENTER });
  }

  public applyStyles(world: EngineWorld, eid: number): void {
    const c = world.components;

    if (!this.reposition(world, eid)) return;

    setComponent(world, eid, c.TextStyle, {
      fontFamily: 'The Bold Font',
      fontWeight: '500',
      fontStyle: FontStyle.ITALIC,
      fontSize: 70,
      textAlign: TextAlign.CENTER,
      textBaseline: TextBaseline.MIDDLE,
      textCase: TextCase.ORIGINAL,
      leading: 1,
    });

    const fillEid = createEntity(world);
    setComponent(world, fillEid, c.Paint, PaintType.SOLID);
    setComponent(world, fillEid, c.Color, 0xFFFFFF);
    appendChild(world, fillEid, eid);

    loadWebFont(world, 'The Bold Font');
  }

  public seekTo(world: EngineWorld, eid: number, relativeTime: number): void {
    const c = world.components;
    const groupIndex = findActiveGroup(this.groups, relativeTime);

    if (groupIndex === -1) {
      c.Chars[eid] = '';
      clearTextRanges(world, eid);
      this.fillEid = null;
      this.currentGroupIndex = -1;
      this.currentWordIndex = -1;
      return;
    }

    const group = this.groups[groupIndex];

    const wordIndex = group.findIndex(word =>
      relativeTime >= word.start && relativeTime <= word.end
    );

    const text = group.map(w => w.text).join(' ');

    if (groupIndex !== this.currentGroupIndex || wordIndex !== this.currentWordIndex) {
      this.currentGroupIndex = groupIndex;
      this.currentWordIndex = wordIndex;
      c.Chars[eid] = text;

      clearTextRanges(world, eid);
      this.fillEid = null;

      if (group.length > 1 && wordIndex !== -1) {
        const start = group.slice(0, wordIndex).map(w => w.text).join(' ').length;
        const end = group.slice(0, wordIndex + 1).map(w => w.text).join(' ').length;
        const rid = createEntity(world);
        setComponent(world, rid, c.TextRange, { start, end });
        appendChild(world, rid, eid);

        this.fillEid = createEntity(world);
        setComponent(world, this.fillEid, c.Paint, PaintType.SOLID);
        setComponent(world, this.fillEid, c.Color, HIGHLIGHT_COLOR);
        appendChild(world, this.fillEid, rid);
      }
    }
  }

  public draw(world: EngineWorld, eid: number): void {
    const c = world.components;

    const highlightColor = c.Caption.colors[eid]?.[0] ?? HIGHLIGHT_COLOR;

    if (this.fillEid) {
      c.Color[this.fillEid] = highlightColor;
    }

    renderText(world, eid);
  }

  public dispose(): void {
    this.groups = [];
    this.currentGroupIndex = -1;
    this.currentWordIndex = -1;
  }
}
