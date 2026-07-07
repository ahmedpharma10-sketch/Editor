/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionType, PaintType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../components';
import { renderText } from '../../utils/text';
import { loadWebFont } from '../../font/utils';
import { groupBy, findActiveGroup, splitSequence, clearTextRanges, resolveTranscript } from './utils';
import { getParentEntity, createEntity } from '../../api';
import { appendChild } from '../../api/hierarchy';
import { setComponent } from '../../api/events';
import { resizeEntity } from '../../api/resize';

import type { EngineWorld } from '../../api/world';
import type { Asset } from '../../db';
import type { CaptionDecoder } from './types';

const WIDTH = 700;
const HEIGHT = 200;

export class PaperCaptionDecoder implements CaptionDecoder {
  public readonly type = CaptionType.PAPER;
  public groups: ReturnType<typeof groupBy> = [];
  public ready = false;

  private readonly asset: Asset;
  private currentGroupIndex = -1;
  private activeSplit: 'left' | 'right' | null = null;

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

  public applyStyles(world: EngineWorld, eid: number): void {
    const c = world.components;

    const parentEid = getParentEntity(world, eid);
    if (parentEid === null) return;
    const parentWidth = c.Computed.width[parentEid];
    const parentHeight = c.Computed.height[parentEid];

    resizeEntity(world, eid, {
      width: WIDTH,
      height: HEIGHT,
    });

    setComponent(world, eid, c.Position, {
      x: (parentWidth - WIDTH) / 2,
      y: (parentHeight - HEIGHT) / 2,
    });

    setComponent(world, eid, c.TextStyle, {
      fontFamily: 'Montserrat',
      fontWeight: '300',
      fontSize: 50,
      textAlign: TextAlign.CENTER,
      textBaseline: TextBaseline.MIDDLE,
      textCase: TextCase.ORIGINAL,
      leading: 0.9,
      fontStyle: FontStyle.NORMAL,
    });

    const fillEid = createEntity(world);
    setComponent(world, fillEid, c.Paint, PaintType.SOLID);
    setComponent(world, fillEid, c.Color, 0xFFFFFF);
    appendChild(world, fillEid, eid);

    loadWebFont(world, 'Montserrat');
  }

  public seekTo(world: EngineWorld, eid: number, relativeTime: number): void {
    const c = world.components;
    const groupIndex = findActiveGroup(this.groups, relativeTime);

    if (groupIndex === -1) {
      c.Chars[eid] = '';
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

      // Two-line display with newline separator.
      // The active line gets weight '500', inactive stays at the node's '300'.
      clearTextRanges(world, eid);
      const start = activeSplit === 'left' ? 0 : leftText.length + 1;
      const end = activeSplit === 'left' ? leftText.length : text.length;
      if (end > start) {
        const rid = createEntity(world);
        setComponent(world, rid, c.TextRange, { start, end });
        setComponent(world, rid, c.TextStyle, { fontWeight: '500' });
        appendChild(world, rid, eid);
      }
    }
  }

  public draw(world: EngineWorld, eid: number): void {
    renderText(world, eid);
  }

  public dispose(): void {
    this.groups = [];
    this.currentGroupIndex = -1;
    this.activeSplit = null;
  }
}
