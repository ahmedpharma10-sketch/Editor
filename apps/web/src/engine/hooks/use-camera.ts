/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Camera, Root, type Camera2D } from '@diffusionstudio/runtime';
import { useTrait, useWorld } from '@diffusionstudio/koota-solid';

import type { Accessor } from 'solid-js';

/** Reactive read of the document's Camera trait. Write via getDocument(world).set(Camera, ...). */
export function useCamera(): Accessor<Camera2D | undefined> {
	const world = useWorld();
	return useTrait(world.get(Root)!, Camera);
}
