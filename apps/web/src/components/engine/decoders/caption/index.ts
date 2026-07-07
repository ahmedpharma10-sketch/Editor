/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hasComponent } from 'bitecs';
import { CaptionType } from '../../components';
import { addComponent } from '../../api/events';
import { ClassicCaptionDecoder } from './classic';
import { CascadeCaptionDecoder } from './cascade';
import { SpotlightCaptionDecoder } from './spotlight';
import { WhisperCaptionDecoder } from './whisper';
import { PaperCaptionDecoder } from './paper';
import { GuineaCaptionDecoder } from './guinea';
import { StarkCaptionDecoder } from './stark';

import type { EngineWorld } from '../../api/world';
import type { Asset } from '../../db';
import type { CaptionDecoder } from './types';

export type { CaptionDecoder } from './types';
export { ClassicCaptionDecoder } from './classic';
export { CascadeCaptionDecoder } from './cascade';
export { SpotlightCaptionDecoder } from './spotlight';
export { WhisperCaptionDecoder } from './whisper';
export { PaperCaptionDecoder } from './paper';
export { GuineaCaptionDecoder } from './guinea';
export { StarkCaptionDecoder } from './stark';

function createCaptionDecoder(type: CaptionType, asset: Asset): CaptionDecoder {
  switch (type) {
    case CaptionType.CLASSIC:
      return new ClassicCaptionDecoder(asset);
    case CaptionType.CASCADE:
      return new CascadeCaptionDecoder(asset);
    case CaptionType.SPOTLIGHT:
      return new SpotlightCaptionDecoder(asset);
    case CaptionType.WHISPER:
      return new WhisperCaptionDecoder(asset);
    case CaptionType.PAPER:
      return new PaperCaptionDecoder(asset);
    case CaptionType.GUINEA:
      return new GuineaCaptionDecoder(asset);
    case CaptionType.STARK:
      return new StarkCaptionDecoder(asset);
    default:
      return new ClassicCaptionDecoder(asset);
  }
}

/**
 * Lazily resolve (or create) a caption decoder for a caption entity.
 * Recreates the decoder when the caption type changes.
 * Returns null if the transcript asset isn't available yet.
 */
export function resolveCaptionDecoder(world: EngineWorld, eid: number): CaptionDecoder | null {
  const AssetId = world.components.AssetId;
  const assetId = AssetId[eid];
  if (!assetId) return null;

  const captionType = world.components.Caption.type[eid];
  const existing = world.components.CaptionDecoder[eid];

  if (existing && captionType === existing.type) return existing;

  const typeChanged = existing != null;
  existing?.dispose();

  const asset = world.assets.get(assetId);
  if (!asset) return null;

  addComponent(world, eid, world.components.CaptionDecoder);

  const decoder = createCaptionDecoder(captionType, asset);
  world.components.CaptionDecoder[eid] = decoder;


  if (typeChanged || !hasComponent(world, eid, world.components.TextStyle)) {
    decoder.applyStyles(world, eid);
  }

  return decoder;
}
