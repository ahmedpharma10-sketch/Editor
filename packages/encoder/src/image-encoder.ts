/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Or } from 'koota';
import {
	createRuntimeWorld, createEntity, appendChild, serializeEntity,
	cloneFromRecords, getEntityTree, framesToSeconds,
	formatTimecode, assert, store, disposeDecoders,
	assetSystem, playbackSystem, motionSystem, transformSystem, renderSystem,
	ChildOf, Geometry, Group, Hidden, IsMask, Muted, Culled,
	ClipsContent, Playback, Computed, WorldBounds,
	Project, Mode, RenderSurface, AudioEngine, Library, Ai, Fonts, Root,
	resetCamera, setCamera,
	FramePromises, Time, FrameRate,
} from '@diffusionstudio/runtime';

import { resolverSystem, recomputeAllTimeRanges } from './encoder';

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
 * Renders single frames of one entity into standalone PNGs (base64, no
 * data-url prefix). The entity's subtree is cloned into a fresh offline
 * world and drawn at the top level: the canvas is sized to the union of the
 * entity's world-space AABBs across the requested frames and the camera
 * shifts that box onto the canvas, so the node is fully visible regardless
 * of where it sat in its source scene.
 */
export async function createImageEncoder(sourceWorld: World, config: ImageEncoderConfig) {
	assert(config.frames.length > 0, 'No frames requested');

	const subtree = getEntityTree(sourceWorld, config.entity);
	const records = subtree.map(entity => serializeEntity(entity));

	// Re-root the node. Its parent isn't part of the clone, so a dangling
	// ChildOf would attach to an arbitrary entity in the new world;
	const rootRecord = records.find(record => record.eid === config.entity);
	assert(rootRecord !== undefined, `No such entity: ${config.entity}`);
	delete rootRecord.ChildOf;
	delete rootRecord.Hidden;
	const rootStart = rootRecord.Start ?? 0;
	delete rootRecord.Start;
	if (rootRecord.End !== undefined) {
		rootRecord.End -= rootStart;
	}

	const offscreenCanvas = new OffscreenCanvas(2, 2);
	const offscreenCtx = offscreenCanvas.getContext('2d')!;

	// Never started — image capture is video-only; the context just satisfies
	// world construction and lazy audio-bus wiring.
	const offlineAudioCtx = new OfflineAudioContext(2, 1, 48000);

	const sourceFrameRate = sourceWorld.get(FrameRate)?.value ?? 30;
	const world = createRuntimeWorld(sourceWorld.get(Project)?.id ?? '');
	world.set(Mode, { value: 'offline-video' });
	world.set(Library, sourceWorld.get(Library) ?? null);
	world.set(Ai, sourceWorld.get(Ai) ?? null);
	world.set(Fonts, { list: [...(sourceWorld.get(Fonts)?.list ?? [])] });
	world.set(RenderSurface, { canvas: offscreenCanvas, ctx: offscreenCtx, resolution: 1 });
	world.set(AudioEngine, { context: offlineAudioCtx });
	world.set(FrameRate, { value: sourceFrameRate });
	world.set(FramePromises, { list: [] });

	resetCamera(world);

	const eidMap = cloneFromRecords(world, records);
	const root = eidMap.get(config.entity);
	assert(root !== undefined, 'Failed to clone entity subtree');

	const mounts = (await config.realizeMounts?.(world)) ?? null;

	const cloned = [...eidMap.values()];
	const computed = store(world, Computed);
	const playback = store(world, Playback);
	const worldBounds = store(world, WorldBounds);

	// Mute everything so the playback system never initializes audio decoders.
	for (const entity of cloned) {
		entity.add(Muted);
	}

	// The motion system only samples parented entities, so the node's own
	// keyframes would be skipped as a top-level root. A synthetic group above
	// it owns the playhead instead and keeps the node an ordinary child.
	const stage = createEntity(world);
	stage.add(Group);
	appendChild(world, root, stage);

	recomputeAllTimeRanges(world);

	// Map "frame 0 = first visible frame": the node now starts at 0, and its
	// source window puts its own in point there.
	const startFrame = computed.start[root.id()] ?? 0;

	// Entities in the clone that own a timeline clock
	const clocks = [...world.query(Playback)];

	const seek = (frame: number) => {
		const stageFrame = startFrame + frame;
		const stageSeconds = framesToSeconds(stageFrame, sourceFrameRate);
		computed.localTime[stage.id()] = stageFrame;
		computed.localTimeInSeconds[stage.id()] = stageSeconds;

		for (const clock of clocks) {
			computed.localTime[clock.id()] = stageFrame;
			computed.localTimeInSeconds[clock.id()] = stageSeconds;
			playback.playing[clock.id()] = true;
		}

		const delta = 1000 / sourceFrameRate;
		const time = world.get(Time)!;
		world.set(Time, { delta, now: time.now + delta });

		// Cull flags derived from a stale canvas/camera would make the motion
		// system skip entities and keep decoders idle — clear them every tick.
		for (const entity of cloned) {
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

	const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
	const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);

	/** Re-target the output height; callers that lay frames out do this once measured. */
	const resize = (height?: number) => {
		const scale = height ? height / boundsHeight : 1;
		offscreenCanvas.width = Math.max(1, Math.round(boundsWidth * scale));
		offscreenCanvas.height = Math.max(1, Math.round(boundsHeight * scale));
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
					base64: await toBase64Png(offscreenCanvas),
					timecode: formatTimecode(framesToSeconds(stampFrame, sourceFrameRate), sourceFrameRate),
				});
			}

			return { type: 'success', data: images };
		} catch (e) {
			return {
				type: 'error',
				error: e instanceof Error ? e : new Error('Unknown error'),
			};
		} finally {
			// Free the graphs + hosts realized above (this offline world is
			// discarded; realized HtmlHosts otherwise leak a canvas on
			// document.body), then release decoders and the world slot itself
			// (koota caps live worlds at 16).
			mounts?.disposeAll();
			disposeDecoders(world, world.get(Root)!);
			world.destroy();
		}
	};

	return {
		render,
		cancel,
		resize,
		bounds: { width: boundsWidth, height: boundsHeight },
	};
}

async function toBase64Png(canvas: OffscreenCanvas): Promise<string> {
	const blob = await canvas.convertToBlob({ type: 'image/png' });
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
	return dataUrl.split(',')[1] ?? '';
}
