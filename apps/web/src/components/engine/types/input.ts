/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Point, Quad } from "../math";
import type { EngineWorld } from "../api/world";

export type CustomPointerEventType =
	| "pointermove"
	| "pointerdown"
	| "pointerup"
	| "pointerenter"
	| "pointerleave"
	| "dragstart"
	| "drag"
	| "dragend"
	| "click"
	| "dblclick";


export type CustomPointerEvent = {
	type: CustomPointerEventType;
	clientX: number;
	clientY: number;
	button: number; // 0: left, 1: middle, 2: right
}

export type PointerState = {
	state: 'pressed' | 'lifted';
	button: number;
	clientX: number;
	clientY: number;
	dragStartX: number;
	dragStartY: number;
}

export type SnapLine = { from: Point; to: Point; }

export type DispatchedPointerEvent = CustomPointerEvent & {
	target: HudTarget | EntityTarget;
}

export type HudTarget = {
	kind: 'hud';
	id: string;
	quad: Quad;
}

export type EntityTarget = {
	kind: 'entity';
	id: number;
};

export type HitRegion = {
	target: HudTarget | EntityTarget;
	callback: (world: EngineWorld, event: DispatchedPointerEvent) => void;
}
