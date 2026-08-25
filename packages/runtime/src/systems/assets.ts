/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Ai, FramePromises, Generating, GenerationRequest, Host, Library, LoadRequest, PendingSource, SourceError, TranscriptionRequest } from '../traits';
import { bindAsset, getAssetFile, getModifiers } from '../actions/assets';
import { getEntityTree, getSceneAncestor } from '../queries/hierarchy';

import type { Entity, World } from 'koota';
import type { Asset } from '@diffusionstudio/assets';

export function assetSystem(world: World): void {
	for (const entity of world.query(LoadRequest, Host)) {
		const source = entity.get(LoadRequest)!.value;
		if (!isDomImage(entity)) continue;
		pointDomImageAt(entity, null);
		if (source !== '' && !/^(?:data|blob):/i.test(source)) continue;
		entity.remove(LoadRequest);
		pointDomImageAt(entity, source || null);
	}

	const library = world.get(Library);
	if (library) {
		for (const entity of world.query(LoadRequest)) {
			const source = entity.get(LoadRequest)!.value;
			entity.remove(LoadRequest);
			start(world, entity, library.resolve(source));
		}
	}

	const ai = world.get(Ai);
	if (ai) {
		for (const entity of world.query(GenerationRequest)) {
			const ref = entity.get(GenerationRequest)!.ref;
			entity.remove(GenerationRequest);
			if (ref === null || entity.has(SourceError)) continue;
			if (isDomImage(entity)) pointDomImageAt(entity, null);
			start(world, entity, ai.resolve(ref), true);
		}

		for (const entity of world.query(TranscriptionRequest)) {
			const scene = getSceneAncestor(entity);
			if (!scene || hasPendingSources(world, scene, entity)) continue;

			const seed = entity.get(TranscriptionRequest)!.seed;
			entity.remove(TranscriptionRequest);
			if (entity.has(SourceError)) continue;
			resolve(world, entity, ai.transcribe(world, scene, seed), true);
		}
	}
}

/**
 * Starts a resolution for whatever the element's src named, putting it
 * through the modifiers the element asks of it (see `SourceModifiers`). The
 * two are one wait: the element binds the asset it is going to show, not
 * first the one it was made from.
 */
function start(world: World, entity: Entity, base: Promise<Asset>, generating = false): void {
	const modifiers = getModifiers(entity);
	const ai = world.get(Ai);

	if (!modifiers || !ai) {
		resolve(world, entity, base, generating);
		return;
	}

	resolve(world, entity, base.then((asset) => ai.derive(asset, modifiers)), true);
}

/**
 * Whether anything in `scene`'s subtree (besides `except`, the requesting
 * element itself) is still waiting on a source: a request this system has
 * not consumed, or a resolution it started that has not landed.
 */
function hasPendingSources(world: World, scene: Entity, except: Entity): boolean {
	for (const entity of getEntityTree(world, scene)) {
		if (entity === except) continue;
		if (entity.has(LoadRequest) || entity.has(GenerationRequest) || entity.has(PendingSource)) {
			return true;
		}
	}
	return false;
}

/**
 * Tracks one started resolution: the entity remembers which one it is waiting
 * on (PendingSource), so of overlapping resolutions only the latest binds, and
 * one that outlives its element (or its src) is dropped. The wait itself is
 * the identity rather than what was asked for — the same src put through
 * different modifiers is a different answer, and the later question is always
 * the one being asked.
 */
function resolve(world: World, entity: Entity, promise: Promise<Asset>, generating = false): void {
	const token = {};
	entity.remove(SourceError);
	entity.add(PendingSource);
	entity.set(PendingSource, { value: token });
	if (generating) entity.add(Generating);

	const done = promise.then(async (asset) => {
		if (!current(entity, token)) return;
		bindAsset(entity, asset);
		await bindDomImage(entity, asset, token);
		if (current(entity, token)) entity.remove(PendingSource, Generating);
	}).catch((error: unknown) => {
		if (!current(entity, token)) return;
		entity.remove(PendingSource, Generating);
		entity.add(SourceError);
		entity.set(SourceError, { value: errorMessage(error), generated: generating });
		console.error('[runtime] could not resolve src:', error);
	});

	world.get(FramePromises)?.list?.push(done);
}

function isDomImage(entity: Entity): boolean {
	return typeof HTMLImageElement !== 'undefined'
		&& entity.get(Host)?.element instanceof HTMLImageElement;
}

function pointDomImageAt(entity: Entity, source: string | null): void {
	const node = entity.get(Host);
	const image = node?.element;
	if (typeof HTMLImageElement === 'undefined' || !(image instanceof HTMLImageElement) || !node) return;

	releaseDomImageSource(image);
	if (source === null) image.removeAttribute('src');
	else image.src = source;
}

export function releaseDomImageSource(image: HTMLImageElement): void {
	if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src);
}

async function bindDomImage(entity: Entity, asset: Asset, token: object): Promise<void> {
	if (!isDomImage(entity)) return;
	const file = await getAssetFile(asset);
	if (!current(entity, token)) return;

	const url = URL.createObjectURL(file);
	if (!current(entity, token)) {
		URL.revokeObjectURL(url);
		return;
	}

	pointDomImageAt(entity, url);
	const image = entity.get(Host)?.element;
	if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) {
		await image.decode().catch(() => undefined);
	}
}

/** What a rejection says, for an entity to carry and the host to show. */
function errorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.trim() || 'Something went wrong';
}

function current(entity: Entity, token: object): boolean {
	return entity.isAlive() && entity.get(PendingSource)?.value === token;
}
