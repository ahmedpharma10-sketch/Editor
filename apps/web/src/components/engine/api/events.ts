/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { addComponent as bitecsAddComponent, removeComponent as bitecsRemoveComponent, hasComponent, query } from "bitecs";

import type { EngineWorld } from "./world";
import type { HistoryEntry } from "../utils/history";

// bitecs tags pair components (e.g. ChildOf(parent)) with this symbol pointing
// back to the relation factory. We use it so observers registered against the
// factory (ChildOf) fire for any target.
const $relation = Symbol.for("bitecs-relation");

export type ComponentData<C> =
  C extends readonly (infer V)[]
  ? V
  : Partial<{ [K in keyof C]: C[K] extends readonly (infer V)[] ? V : never }>;

type EventName = "add" | "remove" | "set";

type Callback<E extends EventName, C> =
  E extends "set"
  ? (eid: number, data: ComponentData<C>) => void
  : (eid: number) => void;

type Registry = {
  observers: Map<unknown, Map<EventName, Set<Function>>>;
};

const REGISTRIES = new WeakMap<object, Registry>();

function getRegistry(world: EngineWorld): Registry {
  let reg = REGISTRIES.get(world as object);
  if (!reg) {
    reg = { observers: new Map() };
    REGISTRIES.set(world as object, reg);
  }
  return reg;
}

/**
 * Push a history entry, or replay it untracked when `track` is false so it
 * never reaches the undo stack. Callers pass `track: false` for ephemeral or
 * derived runtime state (selection, hovering, drag snapshots, decoders, …)
 * that must not be undoable.
 */
function record(world: EngineWorld, track: boolean, entry: HistoryEntry): void {
  if (track) {
    world.history.push(entry);
  } else {
    world.history.untrack(() => world.history.push(entry));
  }
}

function getKey(component: unknown): unknown {
  if (component && typeof component === "object" && $relation in (component as object)) {
    return (component as Record<symbol, unknown>)[$relation];
  }
  return component;
}

function notify(world: EngineWorld, event: EventName, component: unknown, eid: number, data: unknown): void {
  const perComponent = getRegistry(world).observers.get(getKey(component));
  const observers = perComponent?.get(event);
  if (!observers) return;
  for (const cb of observers) {
    (cb as (eid: number, data: unknown) => void)(eid, data);
  }
}

export function observe<E extends EventName, C>(
  world: EngineWorld,
  event: E,
  component: C,
  callback: Callback<E, C>,
): () => void {
  const reg = getRegistry(world);
  const key = getKey(component);

  let perComponent = reg.observers.get(key);
  if (!perComponent) {
    perComponent = new Map();
    reg.observers.set(key, perComponent);
  }

  let observers = perComponent.get(event);
  if (!observers) {
    observers = new Set();
    perComponent.set(event, observers);
  }

  observers.add(callback as Function);
  return () => { observers!.delete(callback as Function); };
}

export function addComponent<C>(world: EngineWorld, eid: number, component: C, track = true): void {
  if (hasComponent(world, eid, component)) return;

  record(world, track, {
    label: `adding component ${componentName(world, component)} to entity ${eid}`,
    execute: () => {
      bitecsAddComponent(world, eid, component);
      notify(world, "add", component, eid, undefined);
    },
    reverse: () => {
      bitecsRemoveComponent(world, eid, component);
      notify(world, "remove", component, eid, undefined);
    },
  });
}

export function removeComponent<C>(world: EngineWorld, eid: number, component: C, track = true): void {
  if (!hasComponent(world, eid, component)) return;

  record(world, track, {
    label: `removing component ${componentName(world, component)} from entity ${eid}`,
    execute: () => {
      bitecsRemoveComponent(world, eid, component);
      notify(world, "remove", component, eid, undefined);
    },
    reverse: () => {
      bitecsAddComponent(world, eid, component);
      notify(world, "add", component, eid, undefined);
    },
  });
}

function hasSetObserver(world: EngineWorld, component: unknown): boolean {
  const observers = getRegistry(world).observers.get(getKey(component))?.get("set");
  return observers !== undefined && observers.size > 0;
}

function componentName(world: EngineWorld, component: unknown): string {
  for (const [name, value] of Object.entries(world.components)) {
    if (value === component) return name;
  }
  return "<unknown>";
}

function snapshotComponentData<C>(component: C, eid: number): ComponentData<C> {
  if (Array.isArray(component)) {
    return (component as unknown as unknown[])[eid] as ComponentData<C>;
  }
  const snapshot: Record<string, unknown> = {};
  for (const key in (component as object)) {
    snapshot[key] = (component as Record<string, unknown[]>)[key]?.[eid];
  }
  return snapshot as ComponentData<C>;
}

export function setComponent<C>(world: EngineWorld, eid: number, component: C, data: ComponentData<C>, track = true): void {
  if (!hasSetObserver(world, component) && typeof component === "object" && component !== null) {
    console.error(`setComponent: no 'set' observer registered for component '${componentName(world, component)}' — data passed to setComponent will be dropped.`);
  }

  const wasPresent = hasComponent(world, eid, component);
  const previous = wasPresent ? snapshotComponentData(component, eid) : undefined;

  record(world, track, {
    label: `setting component ${componentName(world, component)} on entity ${eid}`,
    execute: () => {
      bitecsAddComponent(world, eid, component);
      if (!wasPresent) notify(world, "add", component, eid, undefined);
      notify(world, "set", component, eid, data);
    },
    reverse: () => {
      if (!wasPresent) {
        bitecsRemoveComponent(world, eid, component);
        notify(world, "remove", component, eid, undefined);
      } else {
        notify(world, "set", component, eid, previous);
      }
    },
  });
}

export function clearComponent(world: EngineWorld, component: unknown, track = true): void {
  world.history.transaction(`Clearing component ${componentName(world, component)}`, () => {
    for (const eid of query(world, [component])) {
      removeComponent(world, eid, component, track);
    }
  })
}
