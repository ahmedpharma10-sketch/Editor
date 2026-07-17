/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { renderProject } from "@diffusionstudio/jsx";

import { reorderEntity, switchActiveScene } from "@/components/engine";
import { WorldDocument, importProjectModule } from "@/utils/jsx";
import { assert } from "@/utils";
import { resolveEntityEid } from "./node";
import { hasComponent } from "bitecs";

import type { Accessor } from "solid-js";
import type { MountRequest, NodeInsertRequest } from "@diffusionstudio/cli/channels";
import type { Engine } from "@/components/engine";

function documentRootKeys(world: Engine["world"], document: WorldDocument): string[] {
  const keys: string[] = [];
  for (const node of document.stage.children ?? []) {
    if (node.kind !== "element") continue;
    const key = world.components.Key[node.eid];
    if (key !== undefined) keys.push(key);
  }
  return keys;
}

/**
 * `dapi mount` — evaluates a compiled project module and renders it directly into the ECS world
 */
export function handleMount(engine: Accessor<Engine>) {
  return async ({ code, live }: MountRequest): Promise<void> => {
    const e = engine();
    const world = e.world;
    const c = world.components;
    let dispose = () => { };
    let persisted = false;

    try {
      // Evaluate — top-level code (including top-level await) runs here.
      const module = await importProjectModule(code);
      const project = module.default as () => unknown;
      assert(typeof project === "function", "The project module must default-export a Solid component");

      const document = new WorldDocument(e);

      try {
        world.history.startTransaction("Render project");
        dispose = renderProject(project, document);
        world.history.commitTransaction();
      } catch (error) {
        world.history.rollbackTransaction();
        throw error;
      }

      // The keyed root replacement above deleted any same-key entities, so
      // graphs that were driving them are dead; dispose them before their
      // next effect can write to a recycled entity id.
      world.liveMounts.supersede(documentRootKeys(world, document));

      try {
        world.history.startTransaction("Commit document");
        await document.commit();
      } finally {
        world.history.commitTransaction();
      }

      if (live) {
        world.liveMounts.register({
          rootKeys: () => documentRootKeys(world, document),
          advance: () => document.advanceTicker(),
          dispose,
        });
        persisted = true;
      }

      if (document.rootEid && hasComponent(world, document.rootEid, c.Scene)) {
        switchActiveScene(world, document.rootEid);
        e.camera.fitToActiveScene();
      }
    } finally {
      if (!persisted) dispose?.();
    }
  };
}

/**
 * `dapi node insert` — the mount pipeline, but rendered into an existing
 * parent entity instead of the document: roots take no key, nothing is
 * reconciled or deleted, every run inserts fresh entities. The parent may be
 * any live entity that takes children — a node, or a gradient paint for
 * `<colorStop>` roots.
 */
export function handleNodeInsert(engine: Accessor<Engine>) {
  return async ({ code, parentId, index }: NodeInsertRequest): Promise<void> => {
    const e = engine();
    const world = e.world;
    let dispose = () => { };

    try {
      const parentEid = resolveEntityEid(world, parentId);
      const module = await importProjectModule(code);
      const project = module.default as () => unknown;
      assert(typeof project === "function", "The project module must default-export a Solid component");

      const document = new WorldDocument(e, { parentEid });

      try {
        world.history.startTransaction("Insert nodes");
        dispose = renderProject(project, document);
        if (index !== undefined && document.rootEid !== null) {
          reorderEntity(world, document.rootEid, index);
        }
        world.history.commitTransaction();
      } catch (error) {
        world.history.rollbackTransaction();
        throw error;
      }

      try {
        world.history.startTransaction("Commit document");
        await document.commit();
      } finally {
        world.history.commitTransaction();
      }
    } finally {
      dispose?.();
    }
  };
}
