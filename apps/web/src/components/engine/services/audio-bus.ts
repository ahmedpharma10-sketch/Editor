/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hasComponent } from 'bitecs';
import { attempt } from '@/utils';

import type { EngineWorld } from '../api/world';

/**
 * Per-entity audio bus. Each clip and each scene gets its own gain node.
 * Child buses connect directly into the parent bus's input — there is no
 * per-track sub-mix anymore (each clip is its own layer).
 */
export class AudioBus {
	public context: BaseAudioContext;

	private gain: GainNode;
	private eid: number;
	private world: EngineWorld;
	private _input: AudioNode;

	public constructor(world: EngineWorld, eid: number) {
		this.context = world.audio;
		this.gain = world.audio.createGain();
		this._input = this.gain;
		this.eid = eid;
		this.world = world;
	}

	public get input(): AudioNode {
		return this._input;
	}

	public getGain(): GainNode {
		return this.gain;
	}

	public sync(): void {
		this.gain.gain.value = this.getVolume();
	}

	public connect(node: AudioNode) {
		this.gain.connect(node);
	}

	public mute(): void {
		this.gain.gain.value = 0;
	}

	public disconnect() {
		attempt(() => this.gain.disconnect());
		this._input = this.gain;
	}

	private getVolume(): number {
		const c = this.world.components;

		const volumeDb = c.Computed.volume[this.eid] ?? 0;
		const muted = hasComponent(this.world, this.eid, c.Muted);

		/** Minimum dB value — treated as silence (maps to linear gain 0). */
		if (muted || volumeDb === -Infinity) {
			return 0;
		}

		return Math.pow(10, volumeDb / 20);
	}
}
