/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { EngineWorld } from "../api/world";

export function sortByItemIndex(world: EngineWorld) {
	const ItemIndex = world.components.ItemIndex;
	return (a: number, b: number) => (ItemIndex[a] ?? 0) - (ItemIndex[b] ?? 0);
}

export function sortByStartTime(world: EngineWorld) {
	const Computed = world.components.Computed;
	return (a: number, b: number) => (Computed.start[a]) - (Computed.start[b]);
}

export function sortByOffset(world: EngineWorld) {
	const Computed = world.components.Computed;
	return (a: number, b: number) => Computed.stopOffset[a] - Computed.stopOffset[b];
}

export function sortByFrame(world: EngineWorld) {
	const Keyframe = world.components.Keyframe;
	return (a: number, b: number) => Keyframe.time[a] - Keyframe.time[b];
}
