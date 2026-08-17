/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	CanvasSource,
	Output,
	AudioSample,
	AudioSampleSource,
} from 'mediabunny';
import { Or } from 'koota';
import {
	createRuntimeWorld, switchActiveScene, serializeEntity, cloneFromRecords,
	getEntityTree, propagateTimeRangeDown, framesToSeconds,
	assert, store, disposeDecoders,
	playbackSystem, motionSystem, transformSystem, renderSystem,
	AudioBus, AudioBusHandle,
	ChildOf, Geometry, Group, Paint, Workarea, Playback,
	AudioPlayback, Computed, Start, End, SourceIn, SourceOut,
	Transition, Keyframe, Animation,
	Position, Offset, Rotation, Scale, Skew,
	Project, Mode, Time, FrameRate, RenderSurface, AudioEngine, Root,
	resetCamera,
	Assets, Fonts, FramePromises,
} from '@diffusionstudio/runtime';

import { TargetBuffer } from './buffer';
import { createOutputFormat } from './format';
import { createRenderEventDetail } from './utils';

import type { World } from 'koota';
import type { EncoderConfig } from './interfaces';
import type { ExportResult } from './types';

export async function createEncoder(sourceWorld: World, config: EncoderConfig) {
	const sourceComputed = store(sourceWorld, Computed);
	const sourceScene = config.scene;
	const sourceSceneId = sourceScene.id();
	const sourceFrameRate = sourceWorld.get(FrameRate)?.value ?? 30;
	const frameRate = config.video?.fps ?? sourceFrameRate;
	const numberOfChannels = config.audio?.numberOfChannels ?? 2;
	const sampleRate = config.audio?.sampleRate ?? 48000;
	const sceneWidth = sourceComputed.width[sourceSceneId]!;
	const sceneHeight = sourceComputed.height[sourceSceneId]!;
	const sceneEnd = sourceComputed.end[sourceSceneId]!;

	// Honor the scene's Workarea trait: render only the frames between
	// Workarea.start and Workarea.end instead of the full scene duration.
	const hasWorkarea = sourceScene.has(Workarea);
	const sourceWorkarea = store(sourceWorld, Workarea);
	const workareaStart = hasWorkarea
		? Math.max(0, Math.min(sceneEnd, sourceWorkarea.start[sourceSceneId] ?? 0))
		: 0;
	const workareaEnd = hasWorkarea
		? Math.max(workareaStart, Math.min(sceneEnd, sourceWorkarea.end[sourceSceneId] ?? sceneEnd))
		: sceneEnd;
	const workareaFrames = workareaEnd - workareaStart;

	const playheadStartSeconds = framesToSeconds(workareaStart, sourceFrameRate);
	const duration = framesToSeconds(workareaFrames, sourceFrameRate);
	const audioBitrate = config.audio?.bitrate ?? 128e3;
	const videoBitrate = config.video?.bitrate ?? 10e6;
	const audioCodec = config.audio?.codec ?? 'aac';
	const resolution = config.video?.resolution ?? 1080;
	const scale = Math.round(resolution * 1e6 / sceneHeight) / 1e6;
	const width = Math.round(sceneWidth * scale / 2) * 2;
	const height = Math.round(sceneHeight * scale / 2) * 2;
	const videoCodec = config.video?.codec ?? 'avc';
	const containerFormat = config.format ?? 'mp4';
	const audioEnabled = config.audio?.enabled ?? true;
	const videoEnabled = config.video?.enabled ?? true;
	const frameDuration = 1 / frameRate;

	if (config.format === 'ogg') {
		config.audio = { ...config.audio, enabled: true };
		config.video = { ...config.video, enabled: false };
	}

	const sceneSubtree = getEntityTree(sourceWorld, sourceScene);
	const subtreeRecords = sceneSubtree.map(entity => serializeEntity(entity));

	// Offscreen canvas
	const offscreenCanvas = new OffscreenCanvas(width, height);
	const offscreenCtx = offscreenCanvas.getContext('2d')!;

	// Offline audio context
	const offlineAudioCtx = new OfflineAudioContext(
		numberOfChannels,
		Math.ceil(duration * sampleRate),
		sampleRate,
	);

	// Build a fresh offline world that shares assets with the source. Fonts are
	// already loaded into the document; copying the array just tracks them as
	// loaded so the new world doesn't try to re-add them.
	const world = createRuntimeWorld(sourceWorld.get(Project)?.id ?? '');
	world.set(Mode, { value: videoEnabled ? 'offline-video' : 'offline-audio' });
	world.set(Assets, sourceWorld.get(Assets)!);
	world.set(Fonts, { list: [...(sourceWorld.get(Fonts)?.list ?? [])] });
	world.set(RenderSurface, { canvas: offscreenCanvas, ctx: offscreenCtx, resolution: scale });
	world.set(AudioEngine, { context: offlineAudioCtx });
	world.set(FrameRate, { value: frameRate });
	world.set(FramePromises, { list: [] });

	resetCamera(world);

	const eidMap = cloneFromRecords(world, subtreeRecords);
	const scene = eidMap.get(sourceScene);
	assert(scene !== undefined, 'Failed to clone scene subtree');

	rescaleFrameTimestamps(world, sourceFrameRate, frameRate);
	recomputeAllTimeRanges(world);
	normalizeSceneTransform(world, scene.id());

	switchActiveScene(world, scene);

	const computed = store(world, Computed);
	const playback = store(world, Playback);
	// The workarea (Workarea trait) is runtime-only and never serialized, so it
	// isn't cloned into the offline world — nothing to strip here. The encoder
	// drives the playhead explicitly within the [workareaStart, workareaEnd]
	// window computed from the source scene above.
	const sceneId = scene.id();
	computed.localTimeInSeconds[sceneId] = playheadStartSeconds;
	computed.localTime[sceneId] = Math.round(playheadStartSeconds * frameRate);
	playback.playing[sceneId] = true;
	playback.loop[sceneId] = false;
	playback.speed[sceneId] = 1;
	// Anchor audio scheduling: context starts at t=0 but the playhead starts at
	// playheadStartSeconds, so audioDelay = -playheadStartSeconds shifts each
	// entity's scheduled audio back into the encoded window.
	if (!scene.has(AudioPlayback)) scene.add(AudioPlayback);
	const audioPlayback = store(world, AudioPlayback);
	audioPlayback.contextOffsetInSeconds[sceneId] = 0;
	audioPlayback.timelineOffsetInSeconds[sceneId] = playheadStartSeconds;

	// Re-execute any mounts into this offline world so it owns its own reactive
	// graphs + runtime hosts (surface/html). The per-frame playbackSystem then
	// drives them via the Mounts trait, so ticker-animated surfaces render.
	const mounts = videoEnabled ? (await config.realizeMounts?.(world)) ?? null : null;

	// Set up mediabunny output
	const buffer = await TargetBuffer.create(config.target);
	const format = await createOutputFormat(buffer, config.format);
	const output = new Output({ format, target: buffer.target });

	if (config.comment) {
		output.setMetadataTags({ comment: config.comment });
	}

	const audioSource = new AudioSampleSource({
		codec: audioCodec,
		bitrate: audioBitrate,
	});

	const sceneFills = [...world.query(Paint, ChildOf(scene))];

	const videoSource = new CanvasSource(offscreenCanvas, {
		codec: videoCodec,
		bitrate: videoBitrate,
		latencyMode: 'quality',
		alpha: containerFormat === 'webm' && !sceneFills.length
			? 'keep'
			: 'discard',
	});

	if (audioEnabled) {
		output.addAudioTrack(audioSource);
	}

	if (videoEnabled) {
		output.addVideoTrack(videoSource);
	}

	// Audio worklet streams render-quantum chunks back to the main thread so
	// we can hand them to mediabunny in step with the visual frame loop.
	const audioWorkletUrl = createAudioWorkletUrl();
	await offlineAudioCtx.audioWorklet.addModule(audioWorkletUrl);

	const sharedBuffer = new SharedArrayBuffer(4);
	const sharedUint32Array = new Uint32Array(sharedBuffer);
	const mixNode = offlineAudioCtx.createGain();

	const sinkNode = new AudioWorkletNode(offlineAudioCtx, 'sink', {
		channelCount: numberOfChannels,
		channelCountMode: 'explicit',
		numberOfInputs: 1,
		numberOfOutputs: 1,
		outputChannelCount: [numberOfChannels],
		processorOptions: {
			buffer: sharedUint32Array,
		},
	});

	mixNode.connect(sinkNode);
	sinkNode.connect(offlineAudioCtx.destination);

	// connect the scene bus to the mix node
	const sceneBus = new AudioBus(world, scene);
	scene.add(AudioBusHandle);
	scene.set(AudioBusHandle, sceneBus);
	sceneBus.connect(mixNode);

	let sampleIndex = 0;
	let audioSourcePromise: Promise<void> | null = null;

	const allAudioReceived = Promise.withResolvers<void>();

	sinkNode.port.onmessage = event => {
		if (output?.state === 'canceled') {
			return;
		}

		const planarBuffer = event.data as Float32Array;

		if (planarBuffer.length === 0) {
			allAudioReceived.resolve();
			return;
		}

		const sampleCount = planarBuffer.length / numberOfChannels;

		const audioSample = new AudioSample({
			data: planarBuffer,
			format: 'f32-planar',
			numberOfChannels,
			sampleRate,
			timestamp: sampleIndex / sampleRate,
		});
		audioSourcePromise = audioSource.add(audioSample).finally(() => {
			audioSample.close();
		});

		sampleIndex += sampleCount;
	};

	const emitProgress = createThrottledCallback(config.onProgress, 1000 / 3); // 3 times per second

	let canceled = false;
	const cancel = () => (canceled = true);

	const render = async (): Promise<ExportResult> => {
		try {
			await output.start();
			const start = performance.now();
			const startTime = start;
			const totalFrames = Math.floor(duration * frameRate);

			let audioRenderingDone = false;
			let audioRenderingCompleted: Promise<AudioBuffer> | null = null;
			if (audioEnabled) {
				audioRenderingCompleted = offlineAudioCtx.startRendering();
				audioRenderingCompleted.then(() => { audioRenderingDone = true; });
			}

			let lastAudioSampleCount = 0;

			for (let frame = 0; frame < totalFrames; frame++) {
				if (canceled) {
					await output.cancel();
					Atomics.store(sharedUint32Array, 0, 2 ** 31 - 1);
					return { type: 'canceled' };
				}

				const timestamp = frame * frameDuration;
				const playheadSeconds = playheadStartSeconds + timestamp;

				// advancePlayhead is a no-op in offline mode; the encoder owns the
				// playhead and writes both seconds + frames before each tick.
				computed.localTimeInSeconds[sceneId] = playheadSeconds;
				computed.localTime[sceneId] = Math.round(playheadSeconds * frameRate);
				const time = world.get(Time)!;
				world.set(Time, { delta: frameDuration * 1000, now: time.now + frameDuration * 1000 });

				{
					playbackSystem(world);
					await resolverSystem(world);
					motionSystem(world);
				}

				if (videoEnabled) {
					// only visual systems
					transformSystem(world);
					renderSystem(world);
				}

				if (videoEnabled) {
					await videoSource.add(timestamp, frameDuration);
				}

				if (audioEnabled) {
					await audioSourcePromise;

					while (Atomics.load(sharedUint32Array, 0) > sampleRate && !audioRenderingDone) {
						await new Promise(resolve => setTimeout(resolve, 0));
					}

					const totalAudioSampleCount = Math.floor(timestamp * sampleRate);
					const diff = totalAudioSampleCount - lastAudioSampleCount;
					Atomics.add(sharedUint32Array, 0, diff);
					lastAudioSampleCount = totalAudioSampleCount;
				}

				emitProgress(createRenderEventDetail(frame, totalFrames, startTime));
			}

			console.info(
				`Encoded frames at ${((totalFrames * 1000) / (performance.now() - start)).toFixed(2)}FPS`
			);

			if (audioEnabled) {
				assert(audioRenderingCompleted !== null, 'Audio rendering was not started');

				Atomics.add(
					sharedUint32Array,
					0,
					Math.ceil(duration * sampleRate) + sampleRate - lastAudioSampleCount,
				);

				await audioRenderingCompleted;

				sinkNode.port.postMessage(null);
				await allAudioReceived.promise;
			}

			console.info('Finalizing file');

			await output.finalize();

			console.info('Export complete');

			return {
				type: 'success',
				data: await buffer.close(containerFormat),
			};
		} catch (e) {
			return {
				type: 'error',
				error: e instanceof Error ? e : new Error('Unknown error'),
			};
		} finally {
			URL.revokeObjectURL(audioWorkletUrl);
			// Free the graphs + hosts realized above (this offline world is
			// discarded, so nothing else disposes them — an HtmlHost otherwise
			// leaks a canvas on document.body).
			mounts?.disposeAll();
			// Release decoder file handles/caches, then the world slot itself
			// (koota caps live worlds at 16, so throwaway offline worlds must
			// be destroyed — bitecs could just drop them).
			disposeDecoders(world, world.get(Root)!);
			world.destroy();
		}
	};

	return {
		render,
		cancel,
	};
}


function audioWorkletCode() {
	// eslint-disable-next-line no-undef
	class SinkProcessor extends AudioWorkletProcessor {
		buffer: Uint32Array;

		constructor(options: {
			processorOptions: {
				buffer: Uint32Array;
			};
		}) {
			super();

			this.buffer = options.processorOptions.buffer;

			this.port.onmessage = () => {
				this.port.postMessage(new Float32Array(0));
			};
		}

		process(inputs: Float32Array[][], outputs: Float32Array[][]) {
			const input = inputs[0];
			const output = outputs[0];
			const renderQuantum = output[0].length;

			while (Atomics.load(this.buffer, 0) < renderQuantum);

			const planarBuffer = new Float32Array(output.length * output[0].length);
			for (let channel = 0; channel < Math.min(input.length, output.length); channel++) {
				planarBuffer.set(input[channel], channel * output[0].length);
			}

			this.port.postMessage(planarBuffer, [planarBuffer.buffer]);

			Atomics.sub(this.buffer, 0, renderQuantum);

			return true;
		}
	}

	// eslint-disable-next-line no-undef
	registerProcessor('sink', SinkProcessor);
}

function createAudioWorkletUrl(): string {
	const blob = new Blob([`(${audioWorkletCode.toString()})()`], { type: 'application/javascript' });
	return URL.createObjectURL(blob);
}

function createThrottledCallback<T>(callback: ((value: T) => void) | undefined, intervalMs: number): (value: T) => void {
	let lastCalledAt = -Infinity;

	return (value: T) => {
		const now = performance.now();
		if (now - lastCalledAt < intervalMs) {
			return;
		}

		lastCalledAt = now;
		callback?.(value);
	};
}

function rescaleFrameTimestamps(
	world: World,
	sourceFrameRate: number,
	targetFrameRate: number,
): void {
	if (sourceFrameRate === targetFrameRate) return;

	const ratio = targetFrameRate / sourceFrameRate;
	const rescale = (v: number) => Math.round(v * ratio);

	const transition = store(world, Transition);
	const keyframe = store(world, Keyframe);
	const animation = store(world, Animation);

	for (const trait of [Start, End, SourceIn, SourceOut]) {
		const values = store(world, trait).value;
		for (const entity of world.query(trait)) {
			const eid = entity.id();
			values[eid] = rescale(values[eid] ?? 0);
		}
	}

	for (const entity of world.query(Or(Transition, Keyframe, Animation))) {
		const eid = entity.id();
		if (entity.has(Transition)) {
			transition.duration[eid] = rescale(transition.duration[eid] ?? 0);
		}
		if (entity.has(Keyframe)) {
			keyframe.time[eid] = rescale(keyframe.time[eid] ?? 0);
		}
		if (entity.has(Animation)) {
			animation.duration[eid] = rescale(animation.duration[eid] ?? 0);
			animation.delay[eid] = rescale(animation.delay[eid] ?? 0);
		}
	}
}

function normalizeSceneTransform(world: World, sceneId: number): void {
	const position = store(world, Position);
	const offset = store(world, Offset);
	const rotation = store(world, Rotation);
	const scaleStore = store(world, Scale);
	const skew = store(world, Skew);
	position.x[sceneId] = 0;
	position.y[sceneId] = 0;
	offset.x[sceneId] = 0;
	offset.y[sceneId] = 0;
	rotation.value[sceneId] = 0;
	scaleStore.x[sceneId] = 1;
	scaleStore.y[sceneId] = 1;
	skew.x[sceneId] = 0;
	skew.y[sceneId] = 0;
	// computeLocalMatrix reads the Computed.* mirror, not the raw traits. The
	// base traits are populated via entity.set during the clone, which fires
	// the observer that copies the (canvas) position into Computed. Writing
	// the raw stores above bypasses that observer, so the Computed mirror must
	// be reset here too — otherwise the scene renders at its canvas position
	// instead of centered in the export.
	const computed = store(world, Computed);
	computed.positionX[sceneId] = 0;
	computed.positionY[sceneId] = 0;
	computed.offsetX[sceneId] = 0;
	computed.offsetY[sceneId] = 0;
	computed.rotation[sceneId] = 0;
	computed.scaleX[sceneId] = 1;
	computed.scaleY[sceneId] = 1;
	computed.skewX[sceneId] = 0;
	computed.skewY[sceneId] = 0;
}

export async function resolverSystem(world: World) {
	const promises = world.get(FramePromises)?.list;
	if (promises?.length) {
		await Promise.all(promises.filter(promise => promise !== null));
		world.set(FramePromises, { list: [] });
	}
}

/**
 * Refresh every entity's accumulated delay + time bounds after raw store
 * rewrites. propagateTimeRangeDown recomputes top-down and then re-derives
 * each parent after its children (bitecs used a two-pass Hierarchy(ChildOf)
 * walk; koota has no hierarchy-ordered queries).
 */
export function recomputeAllTimeRanges(world: World): void {
	const document = world.get(Root)!;
	for (const node of world.query(Or(Geometry, Group), ChildOf(document))) {
		propagateTimeRangeDown(world, node);
	}
}
