/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The generation service a host may attach to the world (the `Ai` trait):
// what turns a `generate.*` declaration into an asset of the project's
// library. The runtime itself cannot generate — it only knows the contract —
// so a world without an Ai never resolves such sources (see the asset
// system). The asset library knows nothing of generation either; an
// implementation *uses* a library to look up and store what it makes.

import { generate } from '@diffusionstudio/jsx';

import type { Asset } from '@diffusionstudio/assets';
import type {
	AssetRef,
	GenerateAudioOptions,
	GenerateImageOptions,
	GenerateVideoOptions,
	GenerateVoiceOptions,
} from '@diffusionstudio/jsx';

export abstract class GenAi {
	/**
	 * The declaration, made real: an asset whose bytes the model produced.
	 * Content-addressed — the fully-resolved spec's hash is the asset's
	 * `generation.key`, so the same spec is the same asset in this session
	 * and the next, and identical concurrent declarations share one run.
	 */
	public abstract resolve(ref: AssetRef): Promise<Asset>;

	/**
	 * The imperative surface: `ai.generate.image({...})` declares and resolves
	 * in one call, returning the finished asset.
	 */
	public readonly generate = {
		image: (options: GenerateImageOptions): Promise<Asset> => this.resolve(generate.image(options)),
		video: (options: GenerateVideoOptions): Promise<Asset> => this.resolve(generate.video(options)),
		voice: (options: GenerateVoiceOptions): Promise<Asset> => this.resolve(generate.voice(options)),
		audio: (options: GenerateAudioOptions): Promise<Asset> => this.resolve(generate.audio(options)),
	};
}
