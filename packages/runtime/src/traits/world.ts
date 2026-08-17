/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait, type Entity } from 'koota';

import { createLiveMounts } from '../utils/live-mounts';

import type { FontSource } from '../fonts/types';
import type { Asset, Folder } from '../assets/types';
import type { Quad } from '../math/aabb';

// Singleton state attached to the world itself (world.get/world.set).
// Replaces the bitecs createWorld({...}) context bag. Only headless runtime
// state lives here; editor state (input, HUD, history, persistence, asset
// stores) is layered on by the app as its own world traits.

export const Project = trait({ id: '' });

// Tag on the single stage entity every runtime world owns.
export const Stage = trait();

// World-level pointer to the stage entity
export const Root = trait(() => null as Entity | null);

/**
 * 2D affine camera transform in CSS pixel space (before DPR scaling), on the
 * stage. The render system multiplies this by RenderSurface.resolution
 * to derive the canvas transform.
 */
export const Camera = trait({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export type Camera2D = { a: number; b: number; c: number; d: number; e: number; f: number };

export const DEFAULT_BACKGROUND = 0x161616;

// Stage background color, on the stage entity.
export const Background = trait({ value: DEFAULT_BACKGROUND });

export type RuntimeMode = 'realtime' | 'offline-video' | 'offline-audio';

export const Mode = trait({ value: 'realtime' as RuntimeMode });

// Frame clock (was timestamp).
export const Time = trait({ now: 0, delta: 0 });

// Project frame rate (frames per second).
export const FrameRate = trait({ value: 30 });

// Render target injected by the host: the editor canvas in the app, an
// OffscreenCanvas during capture. resolution is the device pixel ratio.
export const RenderSurface = trait({
	canvas: () => null as HTMLCanvasElement | OffscreenCanvas | null,
	ctx: () => null as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null,
	resolution: 1,
});

// Audio output injected by the host: a realtime AudioContext in the editor,
// an OfflineAudioContext during capture.
export const AudioEngine = trait({
	context: () => null as AudioContext | OfflineAudioContext | null,
});

// Fonts registered for text layout.
export const Fonts = trait({ list: () => [] as FontSource[] });

// Asset metadata by id (model only; the app persists and rehydrates it).
export const Assets = trait(() => new Map<string, Asset>());

// Asset-library folder tree by id (model only, like Assets).
export const Folders = trait(() => new Map<string, Folder>());

// Allocation state for the project's shared asset/folder id space (sqids
// over a monotonic counter), so an id never refers to both kinds.
export const AssetIds = trait({ counter: 0 });

// Live JSX mount registry; running graphs advance once per frame.
export const Mounts = trait(() => createLiveMounts());

// Async barrier for offline capture: systems push decoder/host readiness
// promises here; the encoder awaits and clears them before sampling a frame.
// null in realtime mode (nothing collects).
export const FramePromises = trait({
	list: () => null as (Promise<unknown> | null)[] | null,
});

export type EntityTarget = {
	kind: 'entity';
	id: Entity;
};

export type HudTarget = {
	kind: 'hud';
	id: string;
	quad: Quad;
};

// Paint-order hit regions collected during a render pass (topmost last). The
// render system pushes callback-less entries for Interactive entities and the
// stage canvas; the app's input system clears the list each frame, pushes its
// HUD controls with handlers attached, and maps callback-less targets to its
// default interaction handlers.
export type HitRegion = {
	target: EntityTarget | HudTarget;
	callback?: (world: unknown, event: unknown) => void;
};

export const HitRegions = trait({ list: () => [] as HitRegion[] });
