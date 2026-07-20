/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { BlendMode, CaptionAlign, CaptionType, PaintType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../components';
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

const WIDTH = 700;
const HEIGHT = 100;

export class StarkCaptionDecoder implements CaptionDecoder {
  public readonly type = CaptionType.STARK;
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

  public reposition(world: EngineWorld, eid: number): boolean {
    return placeCaption(world, eid, { width: WIDTH, height: HEIGHT, defaultAlign: CaptionAlign.CENTER });
  }

  public applyStyles(world: EngineWorld, eid: number): void {
    const c = world.components;

    if (!this.reposition(world, eid)) return;

    setComponent(world, eid, c.TextStyle, {
      fontFamily: 'Figtree',
      fontWeight: '800',
      fontSize: 70,
      textAlign: TextAlign.CENTER,
      textBaseline: TextBaseline.MIDDLE,
      textCase: TextCase.UPPER,
      fontStyle: FontStyle.NORMAL,
      leading: 1,
    });

    const fillEid = createEntity(world);
    setComponent(world, fillEid, c.Paint, PaintType.SOLID);
    setComponent(world, fillEid, c.Color, 0xFFFFFF);
    setComponent(world, fillEid, c.Appearance, { blendMode: BlendMode.DIFFERENCE });
    appendChild(world, fillEid, eid);

    loadWebFont(world, 'Figtree');
  }

  public seekTo(world: EngineWorld, eid: number, relativeTime: number): void {
    const groupIndex = findActiveGroup(this.groups, relativeTime);

    if (groupIndex === -1) {
      world.components.Chars[eid] = '';
      this.currentGroupIndex = -1;
      return;
    }

    if (groupIndex !== this.currentGroupIndex) {
      this.currentGroupIndex = groupIndex;
      world.components.Chars[eid] = this.groups[groupIndex].map(w => w.text).join(' ');
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
