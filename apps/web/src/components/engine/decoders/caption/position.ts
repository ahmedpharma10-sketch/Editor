/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionAlign } from '../../components';
import { getParentEntity } from '../../api';
import { setComponent } from '../../api/events';
import { resizeEntity } from '../../api/resize';

import type { EngineWorld } from '../../api/world';

// Margin between the caption box and the parent edge for top/bottom alignment.
export const CAPTION_MARGIN = 100;

/**
 * Sizes the caption box and places it within its parent. Horizontal placement
 * belongs to the preset (centered unless a fixed `x` is given); vertical
 * placement follows the entity's `Caption.verticalAlign`, falling back to the
 * preset's default. Returns false when the entity has no parent to place
 * against.
 */
export function placeCaption(
  world: EngineWorld,
  eid: number,
  preset: { width: number; height: number; x?: number; defaultAlign: CaptionAlign },
): boolean {
  const c = world.components;

  const parentEid = getParentEntity(world, eid);
  if (parentEid === null) return false;
  const parentWidth = c.Computed.width[parentEid];
  const parentHeight = c.Computed.height[parentEid];

  resizeEntity(world, eid, { width: preset.width, height: preset.height });

  const align = c.Caption.verticalAlign[eid] ?? preset.defaultAlign;
  const y = align === CaptionAlign.TOP
    ? CAPTION_MARGIN
    : align === CaptionAlign.BOTTOM
      ? parentHeight - preset.height - CAPTION_MARGIN
      : (parentHeight - preset.height) / 2;

  setComponent(world, eid, c.Position, {
    x: preset.x ?? (parentWidth - preset.width) / 2,
    y,
  });
  return true;
}
