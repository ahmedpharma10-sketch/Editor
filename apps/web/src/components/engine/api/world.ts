/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createWorld } from "bitecs";
import { createSignal } from "solid-js";

import { observeWorld } from "./observers";
import { createComponents } from "./components";
import { createHistory } from "../utils/history";
import { createLiveMounts } from "../utils/live-mounts";
import { initAssets } from "./assets";
import { initFolders } from "./folders";
import { buildTimelineLayers, type TimelineIndexValue } from "./timeline-index";
import { updateCursor } from "../utils";

import type { FontSource } from "../font";
import type { Asset, Folder } from "../db";
import type { RuntimeMode, HitRegion, Camera2D, PointerState, SnapLine, HudMode } from "../types";

export const DEFAULT_BACKGROUND = 0x161616;

export function createEngineWorld(projectId: string, audioContext: AudioContext | OfflineAudioContext) {
	const [timelineIndex, setTimelineIndex] = createSignal<TimelineIndexValue>({ root: null, layers: [] });

	const world = createWorld({
		projectId,
		components: createComponents(),
		history: createHistory(),
		liveMounts: createLiveMounts(),
		selection: {
			scene: null as number | null,
			tool: 0,
		},
		mode: 'realtime' as RuntimeMode,
		camera: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } as Camera2D,
		background: DEFAULT_BACKGROUND,
		canvas: null as HTMLCanvasElement | OffscreenCanvas | null,
		resolution: window.devicePixelRatio,
		ctx: null as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null,
		keys: new Set<string>(),
		hitRegions: [] as HitRegion[],
		snapLines: [] as SnapLine[],
		hudMode: 'idle' as HudMode,
		pointer: {
			state: 'lifted',
			button: 0,
			clientX: 0,
			clientY: 0,
			dragStartX: 0,
			dragStartY: 0,
		} as PointerState,
		timestamp: {
			now: 0,
			delta: 0,
		},
		frameRate: 30,
		fonts: [] as FontSource[],
		audio: audioContext,
		assets: new Map<string, Asset>(),
		folders: new Map<string, Folder>(),
		promises: null as (Promise<unknown> | null)[] | null,
		timelineIndex,
		rebuildTimelineIndex: () => { },
		cursor: { update: updateCursor }
	});

	world.rebuildTimelineIndex = () => {
		const root = world.selection.scene;

		if (root == null) {
			setTimelineIndex({ root: null, layers: [] });
			return;
		}

		setTimelineIndex({ root, layers: buildTimelineLayers(world, root) });
	};

	initAssets(world, projectId);
	initFolders(world, projectId);

	observeWorld(world);

	return world;
}

export type EngineWorld = ReturnType<typeof createEngineWorld>;
