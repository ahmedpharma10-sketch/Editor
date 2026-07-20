/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { CaptionType } from '../../components';
import type { EngineWorld } from '../../api/world';
import type { WordGroup } from '@diffusionstudio/api-contract';

export interface CaptionDecoder {
  readonly type: CaptionType;
  groups: WordGroup[];
  ready: boolean;
  applyStyles(world: EngineWorld, eid: number): void;
  reposition(world: EngineWorld, eid: number): boolean;
  seekTo(world: EngineWorld, eid: number, relativeTime: number): void;
  draw(world: EngineWorld, eid: number): void;
  dispose(): void;
}
