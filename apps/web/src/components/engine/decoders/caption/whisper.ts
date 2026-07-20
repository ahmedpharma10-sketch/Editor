/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionAlign, CaptionType, PaintType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../components';
import { renderText } from '../../utils/text';
import { loadWebFont } from '../../font/utils';
import { groupBy, findActiveGroup, resolveTranscript } from './utils';
import { placeCaption } from './position';
import { createEntity } from '../../api';
import { appendChild } from '../../api/hierarchy';
import { setComponent } from '../../api/events';

import type { EngineWorld } from '../../api/world';
import type { Asset } from '../../db';
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

  public reposition(world: EngineWorld, eid: number): boolean {
    return placeCaption(world, eid, { width: WIDTH, height: HEIGHT, defaultAlign: CaptionAlign.BOTTOM });
  }

  public applyStyles(world: EngineWorld, eid: number): void {
    const c = world.components;

    if (!this.reposition(world, eid)) return;

    setComponent(world, eid, c.TextStyle, {
      fontFamily: 'Montserrat',
      fontWeight: '400',
      fontSize: 40,
      textAlign: TextAlign.CENTER,
      textBaseline: TextBaseline.MIDDLE,
      textCase: TextCase.ORIGINAL,
      leading: 1.4,
      fontStyle: FontStyle.NORMAL,
    });

    const fid = createEntity(world);
    setComponent(world, fid, c.Paint, PaintType.SOLID);
    setComponent(world, fid, c.Color, 0xFFFFFF);
    appendChild(world, fid, eid);

    loadWebFont(world, 'Montserrat');
  }

  public seekTo(world: EngineWorld, eid: number, relativeTime: number): void {
    const c = world.components;
    const groupIndex = findActiveGroup(this.groups, relativeTime);

    if (groupIndex === -1) {
      c.Chars[eid] = '';
      this.currentGroupIndex = -1;
      return;
    }

    if (groupIndex !== this.currentGroupIndex) {
      this.currentGroupIndex = groupIndex;
      c.Chars[eid] = this.groups[groupIndex].map(w => w.text).join(' ');
    }
  }

  public draw(world: EngineWorld, eid: number): void {
    renderText(world, eid);
  }

  public dispose(): void {
    this.groups = [];
    this.currentGroupIndex = -1;
  }
}
