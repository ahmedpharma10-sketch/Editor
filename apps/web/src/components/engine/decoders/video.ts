/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { BlobSource, ALL_FORMATS, Input, InputVideoTrack, EncodedPacketSink, EncodedPacket, CanvasSink, type WrappedCanvas } from 'mediabunny';
import { addComponent } from '../api/events';
import { getAssetFile } from '../api/assets';
import { assert } from '@/utils/common';
import { FrameCache } from './frame-cache';

import type { EngineWorld } from '../api/world';
import type { VideoAsset } from '../db';


export type VideoBufferMode = 'discarded' | 'idle' | 'alive';

/**
 * Inactivity window after which an `alive` buffer automatically drops to
 * `idle`, freeing its decoder and frame cache while keeping the display canvas.
 */
const IDLE_TIMEOUT_MS = 10_000;

/**
 * Max extra frames we are willing to decode forward from the live cursor in
 * order to avoid a keyframe lookup + decoder reseed. Higher = stronger bias.
 */
const FORWARD_BIAS_FRAMES = 24;

/**
 * Frames used to drain the decoder in case of a backward seek to
 * ensure the target frame is surfaced.
 */
const DRAIN_FRAMES = 8;

export class VideoBuffer {
	public errored = false;
	public asset: VideoAsset;
	public firstPacketTimestamp = 0;
	public packetSink: EncodedPacketSink | null = null;
	public mode: VideoBufferMode = 'alive';
	public initialized: Promise<void>;

	public readonly cache = new FrameCache({ pixels: 768 * 432, count: 81 });
	public readonly queue = new VideoDecoderQueue(this.frameCallback.bind(this));

	// user facing display canvas
	public readonly canvas = new OffscreenCanvas(0, 0);
	public readonly ctx = this.canvas.getContext('2d')!;

	private currentFrame: number = -1;
	private isDirty: boolean = true;

	private lastFrameIndex: number = 0;
	private seekGeneration = 0;
	private seekLock: Promise<void> = Promise.resolve();
	private iterator: AsyncGenerator<EncodedPacket, void, unknown> | null = null;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private iteratorStart: number = Infinity;

	public constructor(asset: VideoAsset) {
		this.asset = asset;
		this.initialized = this.initialize();
	}

	private async initialize() {
		try {
			const videoTrack = await getVideoTrack(this.asset);

			assert(videoTrack, 'Video track not found');

			await this.queue.init(videoTrack);

			this.cache.rotation = videoTrack.rotation;
			this.packetSink = new EncodedPacketSink(videoTrack);
			this.firstPacketTimestamp = Math.max(0, await videoTrack.getFirstTimestamp() ?? 0);
			this.lastFrameIndex = Math.max(0, Math.round(this.asset.duration * this.asset.frameRate) - 1);
			this.isDirty = true;
		} catch (e) {
			console.error('Error initializing video decoder', e);
			this.errored = true;
		}
	}

	private frameCallback(frame: VideoFrame) {
		const timestampSeconds = frame.timestamp / 1e6;
		const frameIndex = this.secondsToFrames(timestampSeconds);
		this.cache.insert(frame, frameIndex);
		this.isDirty = true;
	}

	public seekTo(frame: number, frameRate: number): undefined {
		let targetFrame = Math.round((frame / frameRate) * this.asset.frameRate);

		const isEmpty = !this.packetSink;
		const isCurrentFrame = targetFrame === this.currentFrame;
		const isCached = this.cache.has(targetFrame) && isCurrentFrame;
		const isIdle = this.mode === 'idle' && isCurrentFrame;
		const errored = this.errored;

		if (isEmpty || isCurrentFrame || isCached || isIdle || errored) {
			return;
		}

		const previousFrame = this.currentFrame;
		const forward = this.isBlockedFrame(targetFrame)
			? targetFrame >= previousFrame
			: true;


		this.currentFrame = targetFrame;
		this.isDirty = true;

		this.touch();

		const generation = ++this.seekGeneration;

		const [left, right] = this.computeWindow(targetFrame, forward);
		this.cache.leftFrameIndex = left;
		this.cache.rightFrameIndex = right;

		let run: Promise<void>
		if (forward) {
			while (this.isBlockedFrame(targetFrame) && targetFrame <= this.cache.rightFrameIndex) {
				targetFrame++;
			}

			run = this.seekLock.then(() => this.fillCache([targetFrame, this.cache.rightFrameIndex], generation));
		} else {
			while (this.cache.has(targetFrame) && targetFrame >= this.cache.leftFrameIndex) {
				targetFrame--;
			}

			// TODO: Find a better solution for DRAIN_FRAMES
			run = this.seekLock.then(() => this.fillCache([this.cache.leftFrameIndex, targetFrame + DRAIN_FRAMES], generation));
		}

		// Run after the previous seek finishes — never concurrently.
		this.seekLock = run.catch(() => { });
	}

	private framesToSeconds(frames: number) {
		return Math.max(this.firstPacketTimestamp, (frames / this.asset.frameRate) + this.firstPacketTimestamp);
	}

	private secondsToFrames(seconds: number) {
		return Math.max(0, Math.round((seconds - this.firstPacketTimestamp) * this.asset.frameRate));
	}

	/**
	 * Whether `frame` is already taken care of — decoded into the cache, or still in-flight
	 */
	private isBlockedFrame(frame: number) {
		if (this.cache.has(frame)) return true;
		const cursor = this.queue.lastSubmitted;
		if (!cursor || this.iteratorStart === Infinity) return false;
		return frame >= this.secondsToFrames(this.iteratorStart)
			&& frame <= this.secondsToFrames(cursor.timestamp);
	}

	private computeWindow(targetFrame: number, forward: boolean): [number, number] {
		const span = this.cache.config.count - 2;

		// Whole video fits in the cache — keep all of it.
		if (this.lastFrameIndex <= span) {
			return [0, this.lastFrameIndex];
		}

		const ahead = Math.round((span * 2) / 3);
		const behind = span - ahead;

		let left = targetFrame - (forward ? behind : ahead);
		let right = targetFrame + (forward ? ahead : behind);

		// Push budget that falls outside the boundaries onto the other side.
		if (left < 0) {
			right -= left;
			left = 0;
		}
		if (right > this.lastFrameIndex) {
			left -= right - this.lastFrameIndex;
			right = this.lastFrameIndex;
		}

		return [Math.max(0, left), Math.min(this.lastFrameIndex, right)];
	}

	private async fillCache(range: [number, number], generation: number): Promise<void> {
		if (generation !== this.seekGeneration || Math.abs(range[1] - range[0]) <= 3) return;
		// Note: only decode for three or more frames at a time to avoid unnecessary reseeding

		const fromSecs = this.framesToSeconds(range[0]);
		const untilSecs = this.framesToSeconds(range[1]);
		const cursor = this.queue.lastSubmitted;
		const live = !!(this.iterator && this.queue.isAlive && cursor);

		let reuse = live && cursor!.timestamp < untilSecs;
		let keyPacket: EncodedPacket | null = null;

		// If the cursor lags far behind the range start, skip forward to the nearest
		// keyframe rather than decoding through the whole gap.
		const biasSecs = FORWARD_BIAS_FRAMES / this.asset.frameRate;
		if (reuse && cursor!.timestamp < fromSecs - biasSecs) {
			keyPacket = (await this.packetSink?.getKeyPacket(fromSecs)) ?? null;
			if (keyPacket && keyPacket.timestamp - cursor!.timestamp > biasSecs) {
				reuse = false; // jumping to the keyframe
			}
		}

		// we cant reuse the iterator, so we need to reseed the decoder
		// and get create a new iterator
		if (!reuse) {
			keyPacket ??= (await this.packetSink?.getKeyPacket(fromSecs)) ?? null;
			if (!keyPacket) return;
			await this.iterator?.return();
			this.iterator = this.packetSink?.packets(keyPacket) ?? null;
			this.iteratorStart = keyPacket.timestamp;
		}

		if (!this.queue.isAlive) {
			this.queue.reseed();
		}

		if (generation !== this.seekGeneration || !this.iterator) return;

		while (true) {
			const { value: packet, done } = await this.iterator.next();
			if (done || !packet) break;

			await this.queue.decode(packet);

			if (generation !== this.seekGeneration || packet.timestamp >= untilSecs) break;
		}
	}

	public toBitmap() {
		if (this.isDirty && this.currentFrame >= 0) {
			const tile = this.cache.findTile(this.currentFrame);
			const ctx = this.ctx;

			if (tile && (this.canvas.width !== tile.width || this.canvas.height !== tile.height)) {
				this.canvas.width = tile.width;
				this.canvas.height = tile.height;
				this.ctx.imageSmoothingEnabled = false;
			}

			if (tile) {
				ctx.drawImage(
					this.cache.atlas,
					tile.x,
					tile.y,
					tile.width,
					tile.height,
					0,
					0,
					tile.width,
					tile.height,
				);
				this.isDirty = false;
			}
		}

		if (this.canvas.width === 0 || this.canvas.height === 0) {
			return null;
		}

		return this.canvas;
	}

	private touch() {
		this.mode = 'alive';
		if (this.idleTimer !== null) {
			clearTimeout(this.idleTimer);
		}
		this.idleTimer = setTimeout(() => this.idle(), IDLE_TIMEOUT_MS);
	}

	public idle() {
		if (this.mode !== 'alive') return;
		this.mode = 'idle';

		if (this.idleTimer !== null) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}

		this.cache.dispose();
		this.queue.dispose();
		this.iterator?.return();
		this.iterator = null;
		this.iteratorStart = Infinity;
	}

	public dispose() {
		if (this.mode === 'discarded') return;
		this.mode = 'discarded';

		if (this.idleTimer !== null) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}

		this.cache.dispose();
		this.queue.dispose();
		this.iterator?.return();
		this.iterator = null;
		this.iteratorStart = Infinity;

		// Release the display canvas backing store.
		this.canvas.width = 0;
		this.canvas.height = 0;
	}
}

class VideoDecoderQueue {
	private config: VideoDecoderConfig | null = null;
	private decoder: VideoDecoder | null = null;
	private resolver: ReturnType<typeof Promise.withResolvers> | null = null;
	private callback: (frame: VideoFrame) => void;
	public lastSubmitted: EncodedPacket | null = null;

	public constructor(callback: (frame: VideoFrame) => void) {
		this.callback = callback;
	}

	public get isAlive() {
		return this.decoder?.state === 'configured';
	}

	/**
	 * Synchronously discard all in-flight work and re-arm the decoder for a fresh keyframe
	 */
	public reseed() {
		if (!this.decoder) return;
		this.decoder.reset();
		assert(this.config, 'Decoder config not available');
		this.decoder.configure(this.config);
		this.resolver?.resolve(null);
		this.resolver = null;
		this.lastSubmitted = null;
	}

	private handleOutput(frame: VideoFrame) {
		this.resolver?.resolve(null);
		this.callback(frame);
		frame.close();
	}

	private handleDequeue() {
		this.resolver?.resolve(null);
		this.resolver = null;
	};

	private handleError(e?: DOMException) {
		console.error(e?.message);
		this.dispose();
	}

	public async init(track: InputVideoTrack) {
		this.config = await track.getDecoderConfig();
		assert(this.config, 'Failed to get decoder config from track');
		const support = await VideoDecoder.isConfigSupported(this.config);
		assert(support.supported, 'Decoder config not supported');
	}

	private ensureDecoder(packet: EncodedPacket) {
		if (this.decoder || packet.type === 'delta') return;

		assert(this.config, 'Decoder config not available');

		this.decoder = new VideoDecoder({
			error: this.handleError.bind(this),
			output: this.handleOutput.bind(this),
		});

		this.decoder.addEventListener('dequeue', this.handleDequeue.bind(this));
		this.decoder.configure(this.config);
	}

	public async decode(packet: EncodedPacket) {
		this.ensureDecoder(packet);

		if (this.decoder?.state !== 'configured') {
			this.lastSubmitted = null;
			this.resolver?.resolve(null);
			this.resolver = null;
			return;
		}

		if (this.decoder.decodeQueueSize > 2) {
			this.resolver = Promise.withResolvers();
		}

		this.decoder.decode(packet.toEncodedVideoChunk());
		this.lastSubmitted = packet;

		await this.resolver?.promise;
	}

	public dispose() {
		try {
			this.decoder?.close();
		} catch { /* ignore */ }
		this.resolver?.resolve(null);
		this.decoder = null;
		this.lastSubmitted = null;
		this.resolver = null;
	}
}

/**
 * Dedicated, full-resolution video decoder for export.
 */
export class VideoExporter {
	public errored = false;
	public asset: VideoAsset;
	public initialized: Promise<void>;

	private input: Input | null = null;
	private canvasSink: CanvasSink | null = null;
	private iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
	private currentCanvas: WrappedCanvas | null = null;
	private firstTimestamp: number = 0;

	public constructor(asset: VideoAsset) {
		this.asset = asset;
		this.initialized = this.initialize();
	}

	private async initialize() {
		try {
			const blob = await getAssetFile(this.asset);
			this.input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
			const track = await this.input.getPrimaryVideoTrack();
			assert(track, 'Video track not found');
			// See VideoBuffer.initialize: clamp so an edit-list head trim (negative first
			// timestamp) doesn't offset every exported frame relative to the audio.
			this.firstTimestamp = Math.max(0, await track.getFirstTimestamp() ?? 0);
			this.canvasSink = new CanvasSink(track, { poolSize: 2 });
		} catch (e) {
			console.error('Error initializing video exporter', e);
			this.errored = true;
		}
	}

	public async seekTo(frame: number, frameRate: number): Promise<void> {
		await this.initialized;

		if (this.errored || !this.canvasSink) return;

		const targetFrame = Math.round((frame / frameRate) * this.asset.frameRate);
		const lastFrame = this.currentCanvas
			? this.secondsToFrames(this.currentCanvas.timestamp)
			: -1;

		if (targetFrame === lastFrame) return;

		if (!this.iterator || targetFrame < lastFrame) {
			this.iterator = this.canvasSink?.canvases(this.framesToSeconds(targetFrame)) ?? null;
		}
		if (!this.iterator) return;

		// Walk forward while the lookahead frame still starts at/before target.
		while (true) {
			const { value, done } = await this.iterator.next();
			if (done || !value) break;

			this.currentCanvas = value;

			if (this.secondsToFrames(value.timestamp) >= targetFrame) {
				break;
			}
		}
	}

	private framesToSeconds(frames: number) {
		return Math.max(this.firstTimestamp, (frames / this.asset.frameRate) + this.firstTimestamp);
	}

	private secondsToFrames(seconds: number) {
		return Math.max(0, Math.round((seconds - this.firstTimestamp) * this.asset.frameRate));
	}

	public toBitmap(): HTMLCanvasElement | OffscreenCanvas | null {
		if (!this.currentCanvas) {
			return null;
		}

		return this.currentCanvas.canvas;
	}

	public idle(): void { }

	public dispose(): void {
		this.iterator?.return();
		this.iterator = null;
		this.input?.dispose();
	}
}

export type VideoDecoderInstance = VideoBuffer | VideoExporter;

const videoTrackCache = new Map<string, Promise<InputVideoTrack | null>>();

export function clearVideoTrackCache() {
	videoTrackCache.clear();
}

export function getVideoTrack(source: VideoAsset) {
	let promise = videoTrackCache.get(source.id);
	if (promise) {
		return promise;
	}

	promise = (async () => {
		try {
			const blob = await getAssetFile(source);
			const input = new Input({
				formats: ALL_FORMATS,
				source: new BlobSource(blob)
			});
			return await input.getPrimaryVideoTrack();
		} catch {
			videoTrackCache.delete(source.id);
			return null;
		}
	})();

	videoTrackCache.set(source.id, promise);
	return promise;
}

export function resolveVideoDecoder(world: EngineWorld, fid: number): VideoDecoderInstance | null {
	const AssetId = world.components.AssetId;
	const assetId = AssetId[fid];
	if (!assetId) return null;

	const existing = world.components.VideoDecoder[fid];
	if (existing && existing.asset.id === assetId) {
		return existing;
	}

	// Asset changed — dispose old decoder and create a new one.
	existing?.dispose();

	const asset = world.assets.get(assetId);
	if (!asset || asset.type !== 'VIDEO') return null;

	addComponent(world, fid, world.components.VideoDecoder, false);

	const decoder = world.mode === 'realtime'
		? new VideoBuffer(asset)
		: new VideoExporter(asset);
	world.components.VideoDecoder[fid] = decoder;
	return decoder;
}
