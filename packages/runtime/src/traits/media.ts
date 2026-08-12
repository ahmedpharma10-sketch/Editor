/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from 'koota';

// Type-only imports: erased at compile time, so the traits ↔ media module
// cycle never materializes at runtime.
import type { HtmlHost } from '../media/html';
import type { SurfaceHost } from '../media/surface';
import type { ShaderHost } from '../media/shader';
import type { ImageDecoder } from '../media/image';
import type { VideoDecoderInstance } from '../media/video';
import type { SequenceDecoder } from '../media/sequence';
import type { AudioDecoder } from '../media/audio';
import type { CaptionDecoder } from '../media/caption/types';
import type { AudioBus } from '../media/audio-bus';

// Renderer-runtime state on mounted entities (never serialized).
export type MountData = {
	props: Record<string, unknown>;
	textBox?: DocumentFragment;
};

// Handle traits store live runtime instances (hosts, decoders, buses) and are
// never serialized. They use AoS storage: entity.get(X) returns the instance
// directly. Suffixed Handle so the trait and the class it stores (HtmlHost,
// AudioDecoder, ...) can share one export surface.

export const HtmlHostHandle = trait(() => null as HtmlHost | null);

export const SurfaceHostHandle = trait(() => null as SurfaceHost | null);

export const ShaderHostHandle = trait(() => null as ShaderHost | null);

export const ImageDecoderHandle = trait(() => null as ImageDecoder | null);

export const VideoDecoderHandle = trait(() => null as VideoDecoderInstance | null);

export const SequenceDecoderHandle = trait(() => null as SequenceDecoder | null);

export const AudioDecoderHandle = trait(() => null as AudioDecoder | null);

export const CaptionDecoderHandle = trait(() => null as CaptionDecoder | null);

export const AudioBusHandle = trait(() => null as AudioBus | null);

export const Data = trait(() => null as MountData | null);
