/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Subtree walkers releasing live runtime handles (was part of api/utils.ts).
// They deliberately include Deleted descendants: a tombstoned subtree keeps
// its records for undo, but its decoders and buses must not linger.

import {
	ChildOf,
	ImageDecoderHandle, VideoDecoderHandle, SequenceDecoderHandle,
	AudioDecoderHandle, CaptionDecoderHandle,
	HtmlHostHandle, SurfaceHostHandle, ShaderHostHandle, AudioBusHandle,
} from '../traits';

import type { Entity, World } from 'koota';

export function disposeDecoders(world: World, entity: Entity): void {
	if (entity.has(ImageDecoderHandle)) {
		entity.get(ImageDecoderHandle)?.dispose();
		entity.set(ImageDecoderHandle, null);
	}
	if (entity.has(VideoDecoderHandle)) {
		entity.get(VideoDecoderHandle)?.dispose();
		entity.set(VideoDecoderHandle, null);
	}
	if (entity.has(SequenceDecoderHandle)) {
		entity.get(SequenceDecoderHandle)?.dispose();
		entity.set(SequenceDecoderHandle, null);
	}
	if (entity.has(AudioDecoderHandle)) {
		entity.get(AudioDecoderHandle)?.reset();
		entity.set(AudioDecoderHandle, null);
	}
	if (entity.has(CaptionDecoderHandle)) {
		entity.get(CaptionDecoderHandle)?.dispose();
		entity.set(CaptionDecoderHandle, null);
	}

	for (const child of world.query(ChildOf(entity))) {
		disposeDecoders(world, child);
	}
}

export function disposeHtmlHosts(world: World, entity: Entity): void {
	if (entity.has(HtmlHostHandle)) {
		entity.get(HtmlHostHandle)?.dispose();
		entity.set(HtmlHostHandle, null);
	}

	for (const child of world.query(ChildOf(entity))) {
		disposeHtmlHosts(world, child);
	}
}

export function disposeSurfaceHosts(world: World, entity: Entity): void {
	if (entity.has(SurfaceHostHandle)) {
		entity.get(SurfaceHostHandle)?.dispose();
		entity.set(SurfaceHostHandle, null);
	}

	for (const child of world.query(ChildOf(entity))) {
		disposeSurfaceHosts(world, child);
	}
}

export function disposeShaderHosts(world: World, entity: Entity): void {
	if (entity.has(ShaderHostHandle)) {
		entity.get(ShaderHostHandle)?.dispose();
		entity.set(ShaderHostHandle, null);
	}

	for (const child of world.query(ChildOf(entity))) {
		disposeShaderHosts(world, child);
	}
}

export function disconnectAudioBus(world: World, entity: Entity): void {
	if (entity.has(AudioBusHandle)) {
		entity.get(AudioBusHandle)?.disconnect();
		entity.set(AudioBusHandle, null);
	}

	for (const child of world.query(ChildOf(entity))) {
		disconnectAudioBus(world, child);
	}
}
