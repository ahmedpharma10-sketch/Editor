/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionAlign, CaptionType, PaintType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../components';
import { renderText } from '../../utils/text';
import { loadWebFont } from '../../font/utils';
import { groupBy, findActiveGroup, splitSequence, clearTextRanges, resolveTranscript } from './utils';
import { placeCaption } from './position';
import { createEntity } from '../../api';
import { appendChild } from '../../api/hierarchy';
import { setComponent } from '../../api/events';

import type { EngineWorld } from '../../api/world';
import type { Asset } from '../../db';
import type { CaptionDecoder } from './types';

const WIDTH = 700;
const HEIGHT = 200;

const HIGHLIGHT_COLOR_0 = 0xF55353;
const HIGHLIGHT_COLOR_1 = 0xFEB139;
const HIGHLIGHT_COLOR_2 = 0xF6F54D;

const PSEUDO_RANDOM_SEQUENCE = [0, 1, 0, 2, 1, 1, 0, 0, 1, 0, 2, 1, 0, 2, 1, 0, 2, 1];

export class GuineaCaptionDecoder implements CaptionDecoder {
  public readonly type = CaptionType.GUINEA;
  public groups: ReturnType<typeof groupBy> = [];
  public ready = false;

  private readonly asset: Asset;
  private currentGroupIndex = -1;
  private activeSplit: 'left' | 'right' | null = null;
  private fillEid: number | null = null;
  private colorIndex = 0;

  constructor(asset: Asset) {
    this.asset = asset;
    this.init();
  }

  private async init() {
    if (this.ready) return;
    const transcript = await resolveTranscript(this.asset);
    this.groups = groupBy(transcript, { length: 18 });
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
      fontSize: 62,
      textAlign: TextAlign.CENTER,
      textBaseline: TextBaseline.MIDDLE,
      textCase: TextCase.UPPER,
      fontStyle: FontStyle.NORMAL,
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
      setComponent(world, eid, c.Chars, '');
      clearTextRanges(world, eid);
      this.currentGroupIndex = -1;
      this.activeSplit = null;
      return;
    }

    const group = this.groups[groupIndex];
    const [left, right] = splitSequence(group);
    const leftText = left.map(w => w.text).join(' ');
    const rightText = right.map(w => w.text).join(' ');
    const text = rightText ? `${leftText}\n${rightText}` : leftText;
    const activeSplit = right.length > 0 && relativeTime >= right[0].start ? 'right' : 'left';

    if (groupIndex !== this.currentGroupIndex || activeSplit !== this.activeSplit) {
      this.currentGroupIndex = groupIndex;
      this.activeSplit = activeSplit;
      c.Chars[eid] = text;

      // Active line gets a random highlight color and a slightly larger font (1.1x).
      clearTextRanges(world, eid);
      const start = activeSplit === 'left' ? 0 : leftText.length + 1;
      const end = activeSplit === 'left' ? leftText.length : text.length;
      if (end > start) {
        const baseSize = c.TextStyle.fontSize[eid] ?? 62;
        const fontSize = Math.round(baseSize * 1.1);

        const rid = createEntity(world);
        setComponent(world, rid, c.TextRange, { start, end });
        setComponent(world, rid, c.TextStyle, { fontSize });
        appendChild(world, rid, eid);

        this.fillEid = createEntity(world);
        setComponent(world, this.fillEid, c.Paint, PaintType.SOLID);
        setComponent(world, this.fillEid, c.Color, HIGHLIGHT_COLOR_0);
        setComponent(world, this.fillEid, c.ItemIndex, 0);
        appendChild(world, this.fillEid, rid);

        this.colorIndex++;
      }
    }
  }

  public draw(world: EngineWorld, eid: number): void {
    const c = world.components;

    const colors = [
      c.Caption.colors[eid]?.[0] ?? HIGHLIGHT_COLOR_0,
      c.Caption.colors[eid]?.[1] ?? HIGHLIGHT_COLOR_1,
      c.Caption.colors[eid]?.[2] ?? HIGHLIGHT_COLOR_2,
    ] as const;

    const index = PSEUDO_RANDOM_SEQUENCE[this.colorIndex % PSEUDO_RANDOM_SEQUENCE.length];

    if (this.fillEid) {
      c.Color[this.fillEid] = colors[index];
    }

    renderText(world, eid);
  }

  public dispose(): void {
    this.groups = [];
    this.currentGroupIndex = -1;
    this.activeSplit = null;
  }
}
