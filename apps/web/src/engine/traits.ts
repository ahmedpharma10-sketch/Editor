/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Editor state on the world, next to the runtime's own singletons: what the
 * pointer and keyboard are doing, and what the HUD is drawing because of it.
 * None of it belongs in `@diffusionstudio/runtime` (a headless world has no
 * pointer), and none of it is authored, so it never reaches the source.
 */

import { trait } from 'koota';

import type { CanvasPointerEvent, Point } from '@diffusionstudio/runtime';

export type PointerPhase = 'pressed' | 'lifted';

/**
 * The pointer in canvas device pixels, as of the last event the input system
 * drained. `dragStart*` is where the current press began, which is what a
 * gesture measures its delta from.
 */
export const Pointer = trait({
	phase: 'lifted' as PointerPhase,
	button: 0,
	clientX: 0,
	clientY: 0,
	dragStartX: 0,
	dragStartY: 0,
});

/**
 * The keyboard, lowercased, with 'mod' standing in for meta/control so a
 * shortcut does not have to know which platform it is on. `held` is what is
 * down right now (what a gesture reads its modifiers from, mutated in
 * place); `justPressed` and `justLifted` say whether a key went down or up
 * since the last frame, for whatever acts on a press rather than a hold —
 * which key it was is what `held` holds by then. Both flags are reset by the
 * shortcut system, so anything reading them runs before it.
 */
export const Keys = trait({
	held: () => new Set<string>(),
	justPressed: false,
	justLifted: false,
});

export type SnapLine = { from: Point; to: Point };

/** Snap guides for the gesture in flight; the HUD draws and empties them. */
export const SnapLines = trait({ list: () => [] as SnapLine[] });

export type HudMode = 'idle' | 'moving' | 'marquee';

/**
 * What the HUD is in the middle of. 'moving' hides the selection mask (the
 * nodes are under the pointer, the box would only be in the way) and
 * 'marquee' turns the drag rectangle into a selection.
 */
export const Hud = trait({ mode: 'idle' as HudMode });

/**
 * Queue of pointer events to be processed by the input system.
 */
export const PointerEvents = trait({ queue: () => [] as CanvasPointerEvent[] });
