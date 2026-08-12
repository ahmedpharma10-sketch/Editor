/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Not } from 'koota';

import { ChildOf, Deleted, Computed, Name, Playback, PlaybackRate, DocumentRoot } from '../traits';
import { isDocument, isScene } from './predicates';

import type { Entity, World, QueryParameter } from 'koota';

/** The world's document root (see DocumentRoot). */
export function getDocument(world: World): Entity {
	const document = world.queryFirst(DocumentRoot);
	if (document === undefined) throw new Error('World has no document root');
	return document;
}

export function getParentEntity(entity: Entity | null | undefined): Entity | null {
	if (!entity) return null;
	return entity.targetFor(ChildOf) ?? null;
}

/**
 * Parent node, or null when the parent is the document root (or missing).
 * Use this wherever "top-level" matters; getParentEntity returns the raw
 * parent including the document.
 */
export function getParentNode(entity: Entity | null | undefined): Entity | null {
	const parent = getParentEntity(entity);
	if (parent === null || isDocument(parent)) return null;
	return parent;
}

/**
 * Nearest ancestor of `entity` (excluding `entity` itself) that is a scene, or null.
 */
export function getSceneAncestor(entity: Entity): Entity | null {
	let current = getParentEntity(entity);
	while (current !== null) {
		if (isScene(current)) return current;
		current = getParentEntity(current);
	}
	return null;
}

export function getSiblingEntities(world: World, entity: Entity, ...traits: QueryParameter[]): Entity[] {
	const parent = getParentEntity(entity);
	if (parent === null) return [];

	return [...world.query(ChildOf(parent), Not(Deleted), ...traits)];
}

export function getEntityTree(world: World, root: Entity): Entity[] {
	const tree: Entity[] = [];

	const walk = (entity: Entity): Entity[] => {
		tree.push(entity);

		for (const child of world.query(ChildOf(entity), Not(Deleted))) {
			walk(child);
		}

		return tree;
	};

	return walk(root);
}

/**
 * Returns the local frame for a node in its own source/content time: the
 * timeline frame relative to the node's delay, scaled by its playback rate.
 * This matches `Computed.localTime` (the space keyframes are sampled
 * in), so keyframes authored at any playback rate land on the right content
 * frame.
 */
export function getNodeLocalFrame(node: Entity): number {
	const delay = node.get(Computed)?.delay ?? 0;
	const playbackRate = node.get(PlaybackRate)?.value ?? 1;

	let current: Entity | null = node;
	while (current) {
		const parent = getParentNode(current);

		// must be a top-level playback entity
		if (current.has(Playback) && parent === null) {
			const currentTime = current.get(Computed)?.localTime ?? 0;
			return Math.round((currentTime - delay) * playbackRate);
		}

		current = parent;
	}

	return 0;
}

export function getNextName(world: World, prefix: string): string {
	let max = 0;
	const pattern = new RegExp(`^${prefix} (\\d+)$`);

	// Deleted tombstones keep their Name and still count, so an undo can't
	// resurrect a duplicate name.
	for (const entity of world.query(Name)) {
		const match = entity.get(Name)!.value.match(pattern);
		if (match) {
			const n = parseInt(match[1] ?? '0');
			if (n > max) max = n;
		}
	}

	return `${prefix} ${max + 1}`;
}
