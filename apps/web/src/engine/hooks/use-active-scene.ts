/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ActiveScene } from '@diffusionstudio/runtime';
import { useTrait, useWorld } from '@diffusionstudio/koota-solid';

import type { Entity } from 'koota';
import type { Accessor } from 'solid-js';

/** Reactive read of the world's ActiveScene trait. Write via world.set(ActiveScene, ...). */
export function useActiveScene(): Accessor<Entity | null | undefined> {
	const activeScene = useTrait(useWorld(), ActiveScene);
	return () => activeScene()?.entity;
}
