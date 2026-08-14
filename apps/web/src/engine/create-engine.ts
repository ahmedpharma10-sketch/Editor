/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AudioEngine, createRuntimeWorld, RenderSurface, runSystems, Time } from '@diffusionstudio/runtime';

import type { RuntimeWorld } from '@diffusionstudio/runtime';

export interface EngineOptions {
	/**
	 * Inject an existing AudioContext (e.g. shared across projects). When
	 * omitted, the engine creates and owns one; it is closed on dispose().
	 */
	audioContext?: AudioContext;
}

/**
 * Browser-realtime engine shell: owns the koota runtime world, the canvas
 * render surface, the AudioContext, and the requestAnimationFrame tick loop.
 * Input, HUD, and DOM-sync systems are app-side concerns layered on top by
 * the host, not part of this shell.
 */
export class Engine {
	readonly world: RuntimeWorld;

	private canvas: HTMLCanvasElement | null = null;
	private _running = false;
	private rafId: number | null = null;
	private lastTimestamp: number | null = null;

	private readonly audioContext: AudioContext;
	private readonly ownsAudioContext: boolean;
	private readonly runningListeners = new Set<(running: boolean) => void>();
	private readonly boundLoop = (timestamp: number): void => this.loop(timestamp);

	public constructor(projectId: string, options: EngineOptions = {}) {
		this.world = createRuntimeWorld(projectId);

		this.ownsAudioContext = options.audioContext === undefined;
		this.audioContext = options.audioContext ?? new AudioContext({ latencyHint: 'playback' });
		this.world.set(AudioEngine, { context: this.audioContext });
	}

	public get running(): boolean {
		return this._running;
	}

	/**
	 * Subscribe to start()/stop() transitions.
	 */
	public onRunningChange(listener: (running: boolean) => void): () => void {
		this.runningListeners.add(listener);
		return () => this.runningListeners.delete(listener);
	}

	private setRunning(running: boolean): void {
		this._running = running;
		for (const listener of this.runningListeners) listener(running);
	}

	public mount(canvas: HTMLCanvasElement): void {
		this.canvas = canvas;
		this.world.set(RenderSurface, { canvas, ctx: canvas.getContext('2d') });
	}

	public resize(width: number, height: number, dpr = 1): void {
		const pixelWidth = Math.round(width * dpr);
		const pixelHeight = Math.round(height * dpr);

		if (this.canvas) {
			if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
				this.canvas.width = pixelWidth;
				this.canvas.height = pixelHeight;
			}
			this.canvas.style.width = `${width}px`;
			this.canvas.style.height = `${height}px`;
		}

		this.world.set(RenderSurface, { resolution: dpr });
	}

	/**
	 * Advance one frame at `timestamp` (ms, rAF clock). Public so a future
	 * host can drive the tick from its own rAF loop instead of this engine's
	 * internal one, to interleave app-side input/HUD systems around it.
	 */
	public step(timestamp: number): void {
		const delta = this.lastTimestamp === null ? 0 : timestamp - this.lastTimestamp;
		this.lastTimestamp = timestamp;
		this.world.set(Time, { now: timestamp, delta });
		runSystems(this.world);
	}

	private loop(timestamp: number): void {
		this.step(timestamp);
		this.rafId = requestAnimationFrame(this.boundLoop);
	}

	public start(): void {
		if (this._running) return;
		this.setRunning(true);
		this.lastTimestamp = null;
		this.rafId = requestAnimationFrame(this.boundLoop);
	}

	public stop(): void {
		this.setRunning(false);
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
	}

	public dispose(): void {
		this.stop();
		if (this.ownsAudioContext) void this.audioContext.close();
		this.world.destroy();
	}
}
