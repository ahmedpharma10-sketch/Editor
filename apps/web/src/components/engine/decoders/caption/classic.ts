/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionType, PaintType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../components';
import { renderText } from '../../utils/text';
import { loadWebFont } from '../../font/utils';
import { groupBy, findActiveGroup, resolveTranscript } from './utils';
import { getParentEntity, createEntity } from '../../api';
import { appendChild } from '../../api/hierarchy';
import { addComponent, setComponent } from '../../api/events';
import { resizeEntity } from '../../api/resize';

import type { EngineWorld } from '../../api/world';
import type { Asset } from '../../db';
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

  public applyStyles(world: EngineWorld, eid: number): void {
    const c = world.components;

    const parentEid = getParentEntity(world, eid);
    if (parentEid === null) return;

    const parentWidth = c.Computed.width[parentEid];
    const parentHeight = c.Computed.height[parentEid];

    resizeEntity(world, eid, {
      width: CLASSIC_PRESET_WIDTH,
      height: CLASSIC_PRESET_HEIGHT,
    });

    setComponent(world, eid, c.Position, {
      x: (parentWidth - CLASSIC_PRESET_WIDTH) / 2,
      y: (parentHeight - CLASSIC_PRESET_HEIGHT) / 2,
    });

    setComponent(world, eid, c.TextStyle, {
      fontFamily: 'Urbanist',
      fontWeight: '600',
      fontSize: 62,
      textAlign: TextAlign.CENTER,
      textBaseline: TextBaseline.MIDDLE,
      textCase: TextCase.LOWER,
      fontStyle: FontStyle.NORMAL,
      leading: 1,
    });

    const fillEid = createEntity(world);
    setComponent(world, fillEid, c.Paint, PaintType.SOLID);
    setComponent(world, fillEid, c.Color, 0xFFFFFF);
    appendChild(world, fillEid, eid);

    const shadowEid = createEntity(world);
    addComponent(world, shadowEid, c.Shadow);
    setComponent(world, shadowEid, c.Color, 0x000000);
    setComponent(world, shadowEid, c.Appearance, { opacity: 1 });
    setComponent(world, shadowEid, c.Blur, 28);
    setComponent(world, shadowEid, c.Offset, { x: 0, y: 5 });
    appendChild(world, shadowEid, eid);

    loadWebFont(world, 'Urbanist');
  }

  public seekTo(world: EngineWorld, eid: number, relativeTime: number): void {
    const groupIndex = findActiveGroup(this.groups, relativeTime);

    if (groupIndex === -1) {
      world.components.Chars[eid] = '';
      this.currentGroupIndex = -1;
      return;
    }

    const group = this.groups[groupIndex];

    if (groupIndex !== this.currentGroupIndex) {
      this.currentGroupIndex = groupIndex;
      world.components.Chars[eid] = group.map(w => w.text).join(' ');
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
