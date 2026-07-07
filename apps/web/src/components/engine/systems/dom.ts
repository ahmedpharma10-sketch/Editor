/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { query, asBuffer, hasComponent, type QueryTerm } from 'bitecs';

import type { EngineWorld } from '../api/world';

// Global set of active subscriptions.
export type ValueSyncSub = {
	store: unknown[];
	eid: number;
	prev: unknown;
	set: (v: unknown) => void;
};

export const domSyncSubs = new Set<ValueSyncSub>();

// Tag-based subscriptions (boolean presence via hasComponent).
export type TagSyncSub = {
	component: object;
	eid: number;
	prev: boolean;
	set: (v: boolean) => void;
};

export const tagSyncSubs = new Set<TagSyncSub>();

// Query-based subscriptions for tag components (e.g. Selected, Active).
export type QuerySyncSub = {
	query: QueryTerm[];
	prev: Uint32Array;
	set: (result: number[]) => void;
};

export const querySyncSubs = new Set<QuerySyncSub>();

// World-level state subscriptions. The getter reads a value out of the world
// (e.g. `w => w.selection.scene`, `w => w.camera.a`, `w => w.background`).
export type WorldStateSyncSub = {
	get: (world: EngineWorld) => unknown;
	prev: unknown;
	set: (v: unknown) => void;
};

export const worldStateSyncSubs = new Set<WorldStateSyncSub>();

/**
 * Flush all subscriptions – called once per frame by the sync system.
 * Compares the current ECS value against the cached previous value and
 * updates the SolidJS signal only when they differ.
 */
export function syncDomSystem(world: EngineWorld): void {
	for (const sub of domSyncSubs) {
		const next = sub.store[sub.eid];
		if (next !== undefined && next !== sub.prev) {
			sub.prev = next;
			sub.set(next);
		}
	}

	for (const sub of tagSyncSubs) {
		const next = hasComponent(world, sub.eid, sub.component);
		if (next !== sub.prev) {
			sub.prev = next;
			sub.set(next);
		}
	}

	for (const sub of querySyncSubs) {
		const result = query(world, sub.query, asBuffer) as Uint32Array;

		// We may need to find a better way to compare the arrays.
		// This is in a hot path, so we need to be careful.
		if (result.length !== sub.prev.length || result[0] !== sub.prev[0]) {
			sub.prev = new Uint32Array(result);
			sub.set([...Array.from(result)]);
		}
	}

	for (const sub of worldStateSyncSubs) {
		const next = sub.get(world);
		if (next !== sub.prev) {
			sub.prev = next;
			sub.set(next);
		}
	}
}
