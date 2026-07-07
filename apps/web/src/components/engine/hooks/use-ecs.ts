/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';
import { domSyncSubs, querySyncSubs, tagSyncSubs, worldStateSyncSubs } from '../systems/dom';

import type { ValueSyncSub, TagSyncSub, QuerySyncSub, WorldStateSyncSub } from '../systems/dom';
import type { EngineWorld } from '../api/world';
import type { QueryTerm } from 'bitecs';

type EidAccessor = number | null | undefined | Accessor<number | null | undefined>;


/**
 * Subscribe to an ECS component field/scalar for a given entity.
 * Pass the SoA array directly (e.g. `world.components.Position.x`).
 * Returns a SolidJS accessor that stays in sync every frame.
 */
export function useEntityState<T>(store: T[], eid: EidAccessor, initial: T): Accessor<T>;
export function useEntityState<T>(store: T[], eid?: EidAccessor, initial?: undefined): Accessor<T | undefined>;
export function useEntityState<T>(store: T[], eid?: EidAccessor, initial?: T): Accessor<T | undefined> {
	const [value, setValue] = createSignal(initial);
	let currentSub: ValueSyncSub | undefined;

	const resolvedEid = createMemo(() => {
		if (typeof eid === 'function') {
			return eid();
		}
		return eid;
	})

	createEffect(() => {
		const currentEid = resolvedEid();

		// Tear down previous subscription when eid changes
		if (currentSub) {
			domSyncSubs.delete(currentSub);
			currentSub = undefined;
		}

		if (typeof currentEid !== 'number') {
			setValue(() => initial);
			return;
		}

		// Prime synchronously from the store when (re)subscribing. Without this,
		// a value left over from a previously-tracked eid would persist whenever
		// the new eid's stored value equals `initial`, since dom-sync only fires
		// on a *change* and the fresh sub starts at `prev: initial`. (Same hazard
		// the plural `useEntityStates` guards against — reusing a row instance for
		// a different entity, e.g. on reorder, would otherwise show a stale value.)
		const stored = (store as unknown[])[currentEid] as T | undefined;
		const primed = stored !== undefined ? stored : initial;
		setValue(() => primed);

		const sub: ValueSyncSub = {
			store: store as unknown[],
			eid: currentEid,
			prev: primed,
			set: (v) => setValue(() => v as T),
		};
		domSyncSubs.add(sub);
		currentSub = sub;
	});

	onCleanup(() => {
		if (currentSub) {
			domSyncSubs.delete(currentSub);
		}
	});

	return value;
}


type EidAccessors = number[] | Accessor<number[]>;

/**
 * Fan-out of `useEntityState` over a list of entities. The list itself may be
 * reactive (e.g. from `useQuery`). Returns one value per eid, in the same
 * order as the input. Subs are torn down and rebuilt when the eid list changes.
 */
export function useEntityStates<T>(store: T[], eids: EidAccessors, initial: T): Accessor<T[]>;
export function useEntityStates<T>(store: T[], eids: EidAccessors, initial?: undefined): Accessor<(T | undefined)[]>;
export function useEntityStates<T>(store: T[], eids: EidAccessors, initial?: T): Accessor<(T | undefined)[]> {
	const resolvedEids = createMemo(() => {
		if (typeof eids === 'function') {
			return eids();
		}
		return eids;
	});

	const [values, setValues] = createSignal<(T | undefined)[]>([]);
	let currentSubs: ValueSyncSub[] = [];

	const unsubAll = () => {
		for (const sub of currentSubs) {
			domSyncSubs.delete(sub);
		}
		currentSubs = [];
	};

	createEffect(() => {
		unsubAll();

		const currentEids = resolvedEids();

		// Prime values synchronously from the store. Without this, consumers
		// would see `undefined` slots until the next dom-sync tick — and slots
		// whose stored value already equals `initial` would never trigger a
		// sync at all, since dom-sync only fires on a *change*.
		const primed: (T | undefined)[] = currentEids.map(eid => {
			const v = (store as unknown[])[eid] as T | undefined;
			return v !== undefined ? v : initial;
		});
		setValues(primed);

		currentSubs = currentEids.map((eid, i) => {
			const sub: ValueSyncSub = {
				store: store as unknown[],
				eid,
				prev: primed[i],
				set: (v) => setValues(prev => {
					const next = [...prev];
					next[i] = v as T;
					return next;
				}),
			};
			domSyncSubs.add(sub);
			return sub;
		});
	});

	onCleanup(unsubAll);

	return values;
}

/**
 * Subscribe to an ECS tag component for a given entity.
 * Returns a SolidJS accessor that stays in sync every frame.
 * To mutate, call `addComponentTracked` / `removeComponentTracked` directly.
 */
export function useEntityTag(component: object, eid?: EidAccessor): Accessor<boolean> {
	const [value, setValue] = createSignal(false);
	let currentSub: TagSyncSub | undefined;

	const resolvedEid = createMemo(() => {
		if (typeof eid === 'function') {
			return eid();
		}
		return eid;
	})



	createEffect(() => {
		const currentEid = resolvedEid();

		if (currentSub) {
			tagSyncSubs.delete(currentSub);
			currentSub = undefined;
		}

		if (!currentEid) {
			setValue(false);
			return;
		}

		// Reset to the absent state whenever we (re)subscribe to a different eid.
		// Without this, a stale `true` left over from the previously-tracked eid
		// persists if the new eid lacks the tag: the fresh sub starts at
		// `prev: false` and dom-sync only fires `set` on a *change*, so it never
		// corrects `false`. This surfaces when an <Index> reuses a row instance
		// for a different entity (e.g. reordering layers) — two rows would then
		// appear Selected at once.
		setValue(false);

		const sub: TagSyncSub = {
			component,
			eid: currentEid,
			prev: false,
			set: (v) => setValue(v),
		};
		tagSyncSubs.add(sub);
		currentSub = sub;
	});

	onCleanup(() => {
		if (currentSub) {
			tagSyncSubs.delete(currentSub);
		}
	});

	return value;
}

export function useQuery(query: QueryTerm[]): Accessor<number[]> {
	const [value, setValue] = createSignal<number[]>([]);
	let currentSub: QuerySyncSub | undefined;

	createEffect(() => {
		const sub: QuerySyncSub = {
			query,
			prev: new Uint32Array(0),
			set: (result) => setValue(result),
		};
		querySyncSubs.add(sub);
		currentSub = sub;
	});

	onCleanup(() => {
		if (currentSub) {
			querySyncSubs.delete(currentSub);
		}
	});

	return value;
}

/**
 * Subscribe to a world-level state value via a getter. Examples:
 *   useWorldState(w => w.selection.scene, null)
 *   useWorldState(w => w.camera.a, 1)
 *   useWorldState(w => w.background, 0x171717)
 */
export function useWorldState<T>(get: (world: EngineWorld) => T, initial: T): Accessor<T> {
	const [value, setValue] = createSignal<T>(initial);
	let currentSub: WorldStateSyncSub | undefined;

	createEffect(() => {
		if (currentSub) {
			worldStateSyncSubs.delete(currentSub);
		}

		const sub: WorldStateSyncSub = {
			get: get as (world: EngineWorld) => unknown,
			prev: initial,
			set: (v) => setValue(() => v as T),
		};
		worldStateSyncSubs.add(sub);
		currentSub = sub;
	});

	onCleanup(() => {
		if (currentSub) {
			worldStateSyncSubs.delete(currentSub);
		}
	});

	return value;
}
