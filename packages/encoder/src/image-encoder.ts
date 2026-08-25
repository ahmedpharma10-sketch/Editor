/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Or } from 'koota';
import {
	createEntity, appendChild, getEntityTree, framesToSeconds,
	formatTimecode, assert, store,
	assetSystem, playbackSystem, motionSystem, transformSystem, renderSystem,
	ChildOf, Geometry, Group, Hidden, IsMask, Muted, Culled,
	ClipsContent, Playback, Computed, WorldBounds,
	RenderSurface, AudioEngine, Root,
	setCamera,
	Time, FrameRate,
} from '@diffusionstudio/runtime';

import { resolverSystem, recomputeAllTimeRanges, warmupAssets } from './encoder';

import type { Entity, World } from 'koota';
import type { AABB } from '@diffusionstudio/runtime';
import type { ImageEncoderConfig } from './interfaces';

/** One capture: the PNG plus the timecode of the frame rendered, e.g. `01s15f`. */
export type CapturedImage = { base64: string; timecode: string };

export type ImageExportResult =
	| { type: 'success'; data: CapturedImage[] }
	| { type: 'canceled' }
	| { type: 'error'; error: Error };

/**
 * Renders single frames of the node a capture world holds into standalone
 * PNGs (base64, no data-url prefix).
 *
 * `world` is the caller's, built for this capture and holding the node as the
 * stage's only child — the same arrangement `createEncoder` takes, and for
 * the same reason. The canvas is sized to the union of the node's world-space
 * AABBs across the requested frames and the camera shifts that box onto it,
 * so the node is fully visible wherever it sat in the scene it was rendered
 * in.
 */
export async function createImageEncoder(world: World, config: ImageEncoderConfig) {
	assert(config.frames.length > 0, 'No frames requested');

	const roots = [...world.query(ChildOf(world.get(Root)!))];
	assert(roots.length === 1, `A capture world holds one node, this one holds ${roots.length}`);
	const root = roots[0]!;

	const canvas = world.get(RenderSurface)?.canvas;
	assert(canvas instanceof HTMLCanvasElement, 'The capture world has no canvas to draw into');

	// Never started — image capture is video-only; the context is only there
	// for the lazy audio-bus wiring to have something to bind to.
	world.set(AudioEngine, { context: new OfflineAudioContext(2, 1, 48000) });

	await warmupAssets(world);

	const frameRate = world.get(FrameRate)?.value ?? 30;
	const computed = store(world, Computed);
	const playback = store(world, Playback);
	const worldBounds = store(world, WorldBounds);

	const subtree = getEntityTree(world, root);

	// Mute everything so the playback system never initializes audio decoders.
	for (const entity of subtree) {
		entity.add(Muted);
	}

	// The motion system only samples parented entities, so the node's own
	// keyframes would be skipped as a top-level root. A synthetic group above
	// it owns the playhead instead and keeps the node an ordinary child. It
	// goes under the stage, or nothing below it would be walked at all.
	const clock = createEntity(world);
	clock.add(Group);
	clock.add(Playback);
	appendChild(world, clock, world.get(Root)!);
	appendChild(world, root, clock);

	recomputeAllTimeRanges(world);

	// Map "frame 0 = the node's first visible frame": the node keeps the time
	// it was authored at, so where it begins is the offset every requested
	// frame is counted from.
	const startFrame = computed.start[root.id()] ?? 0;

	// Everything in this world that owns a timeline clock, the synthetic one
	// above included.
	const clocks = [...world.query(Playback)];

	const seek = (frame: number) => {
		const stageFrame = startFrame + frame;
		const stageSeconds = framesToSeconds(stageFrame, frameRate);

		for (const entity of clocks) {
			computed.localTime[entity.id()] = stageFrame;
			computed.localTimeInSeconds[entity.id()] = stageSeconds;
			playback.playing[entity.id()] = true;
		}

		const delta = 1000 / frameRate;
		const time = world.get(Time)!;
		world.set(Time, { delta, now: time.now + delta });

		// Cull flags derived from a stale canvas/camera would make the motion
		// system skip entities and keep decoders idle — clear them every tick.
		for (const entity of subtree) {
			if (entity.has(Culled)) entity.remove(Culled);
		}

		playbackSystem(world);
	};

	// Union an entity's world-space AABB into `bounds`, descending so children
	// that overflow a leaf's own rect still count — except where content is
	// clipped. Group bounds already aggregate their children.
	const measure = (entity: Entity, bounds: AABB): void => {
		if (entity.has(Hidden) || entity.has(IsMask)) return;
		if (computed.visibility[entity.id()] === 0) return;

		bounds.minX = Math.min(bounds.minX, worldBounds.minX[entity.id()]!);
		bounds.minY = Math.min(bounds.minY, worldBounds.minY[entity.id()]!);
		bounds.maxX = Math.max(bounds.maxX, worldBounds.maxX[entity.id()]!);
		bounds.maxY = Math.max(bounds.maxY, worldBounds.maxY[entity.id()]!);

		if (entity.has(ClipsContent)) return;
		for (const child of world.query(Or(Geometry, Group), ChildOf(entity))) {
			measure(child, bounds);
		}
	};

	// Warm-up tick: group bounds aggregate from their children's local
	// matrices, which don't exist until the first transform walk has visited
	// them — measuring on that walk would union stale boxes.
	seek(config.frames[0]!);
	motionSystem(world);
	transformSystem(world);

	// Measure pass: run motion + transforms over every requested frame with an
	// identity camera and union the bounds, so an animated node stays fully
	// visible in a fixed-size output across all frames.
	const bounds: AABB = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	for (const frame of config.frames) {
		seek(frame);
		motionSystem(world);
		transformSystem(world);
		measure(root, bounds);
	}
	assert(Number.isFinite(bounds.minX), 'Entity is not visible at any of the requested frames');

	await resolverSystem(world);

	const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
	const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);

	/** Re-target the output height; callers that lay frames out do this once measured. */
	const resize = (height?: number) => {
		const scale = height ? height / boundsHeight : 1;
		canvas.width = Math.max(1, Math.round(boundsWidth * scale));
		canvas.height = Math.max(1, Math.round(boundsHeight * scale));
		world.set(RenderSurface, { resolution: scale });
	};

	resize(config.resolution);
	// Shift the measured box onto the canvas so the node is centered in view;
	// the camera translation is scaled by the surface resolution at render time.
	setCamera(world, { e: -bounds.minX, f: -bounds.minY });

	let canceled = false;
	const cancel = () => (canceled = true);

	const render = async (): Promise<ImageExportResult> => {
		try {
			const images: CapturedImage[] = [];

			for (const frame of config.frames) {
				if (canceled) {
					return { type: 'canceled' };
				}

				seek(frame);
				assetSystem(world);
				await resolverSystem(world);
				motionSystem(world);
				transformSystem(world);
				renderSystem(world);

				const stampFrame = startFrame + frame;
				images.push({
					base64: await toBase64Png(canvas),
					timecode: formatTimecode(framesToSeconds(stampFrame, frameRate), frameRate),
				});
			}

			return { type: 'success', data: images };
		} catch (e) {
			return {
				type: 'error',
				error: e instanceof Error ? e : new Error('Unknown error'),
			};
		}
		// The world, its canvas and its decoders are the caller's to release.
	};

	return {
		render,
		cancel,
		resize,
		bounds: { width: boundsWidth, height: boundsHeight },
	};
}

async function toBase64Png(canvas: HTMLCanvasElement): Promise<string> {
	const blob = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode PNG')), 'image/png');
	});
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
	return dataUrl.split(',')[1] ?? '';
}
