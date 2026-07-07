/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionType, PaintType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../components';
import { renderText } from '../../utils/text';
import { loadWebFont } from '../../font/utils';
import { groupBy, findActiveGroup, resolveTranscript } from './utils';
import { getParentEntity, createEntity } from '../../api';
import { appendChild } from '../../api/hierarchy';
import { setComponent } from '../../api/events';
import { resizeEntity } from '../../api/resize';

import type { EngineWorld } from '../../api/world';
import type { Asset } from '../../db';
import type { CaptionDecoder } from './types';

const WIDTH = 800;
const HEIGHT = 200;

export class CascadeCaptionDecoder implements CaptionDecoder {
  public readonly type = CaptionType.CASCADE;
  public groups: ReturnType<typeof groupBy> = [];
  public ready = false;

  private readonly asset: Asset;
  private currentText = '';

  constructor(asset: Asset) {
    this.asset = asset;
    this.init();
  }

  private async init() {
    if (this.ready) return;
    const transcript = await resolveTranscript(this.asset);
    this.groups = groupBy(transcript, { length: 50 });
    this.ready = true;
  }

  public applyStyles(world: EngineWorld, eid: number): void {
    const c = world.components;

    const parentEid = getParentEntity(world, eid);
    if (parentEid === null) return;
    const parentHeight = c.Computed.height[parentEid];

    resizeEntity(world, eid, { width: WIDTH, height: HEIGHT });
    setComponent(world, eid, c.Position, { x: 100, y: parentHeight - HEIGHT - 50 });
    setComponent(world, eid, c.TextStyle, {
      fontFamily: 'Inter',
      fontWeight: '300',
      fontSize: 50,
      textAlign: TextAlign.LEFT,
      textBaseline: TextBaseline.TOP,
      fontStyle: FontStyle.NORMAL,
      textCase: TextCase.ORIGINAL,
      leading: 1.2,
    });

    const fillEid = createEntity(world);
    setComponent(world, fillEid, c.Paint, PaintType.SOLID);
    setComponent(world, fillEid, c.Color, 0xFFFFFF);
    appendChild(world, fillEid, eid);

    loadWebFont(world, 'Inter');
  }

  public seekTo(world: EngineWorld, eid: number, relativeTime: number): void {
    const groupIndex = findActiveGroup(this.groups, relativeTime);

    if (groupIndex === -1) {
      world.components.Chars[eid] = '';
      this.currentText = '';
      return;
    }

    const group = this.groups[groupIndex];

    // Progressive reveal: only show words that have started
    const text = group
      .filter(word => word.start <= relativeTime)
      .map(w => w.text)
      .join(' ');

    if (text !== this.currentText) {
      this.currentText = text;
      world.components.Chars[eid] = text;
    }
  }

  public draw(world: EngineWorld, eid: number): void {
    renderText(world, eid);
  }

  public dispose(): void {
    this.groups = [];
    this.currentText = '';
  }
}
