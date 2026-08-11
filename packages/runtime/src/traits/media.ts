/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from 'koota';

// Renderer-runtime state on mounted entities (never serialized).
export type MountData = {
	props: Record<string, unknown>;
	textBox?: DocumentFragment;
};

// Handle traits store live runtime instances (hosts, decoders, buses) and are
// never serialized. They use AoS storage: entity.get(X) returns the instance
// directly. Handle types are opaque until engine/decoders and services move
// into src/media; tighten them to the concrete classes then.
type Handle = object;

export const HtmlHost = trait(() => null as Handle | null);

export const SurfaceHost = trait(() => null as Handle | null);

export const ShaderHost = trait(() => null as Handle | null);

export const ImageDecoder = trait(() => null as Handle | null);

export const VideoDecoder = trait(() => null as Handle | null);

export const SequenceDecoder = trait(() => null as Handle | null);

export const AudioDecoder = trait(() => null as Handle | null);

export const CaptionDecoder = trait(() => null as Handle | null);

export const AudioBus = trait(() => null as Handle | null);

export const Data = trait(() => null as MountData | null);
