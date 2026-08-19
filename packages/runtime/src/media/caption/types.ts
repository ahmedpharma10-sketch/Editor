/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Entity, World } from 'koota';
import type { CaptionType } from '../../constants';
import type { WordGroup } from '@diffusionstudio/assets';

export interface CaptionDecoder {
	readonly type: CaptionType;
	groups: WordGroup[];
	ready: boolean;
	applyStyles(world: World, entity: Entity): void;
	reposition(world: World, entity: Entity): boolean;
	seekTo(world: World, entity: Entity, relativeTime: number): void;
	draw(world: World, entity: Entity): void;
	dispose(): void;
}
