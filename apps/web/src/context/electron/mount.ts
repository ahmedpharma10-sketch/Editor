/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { renderProject } from "@diffusionstudio/solid";

import { reorderEntity, switchActiveScene } from "@/components/engine";
import { WorldDocument, importProjectModule } from "@/utils/jsx";
import { assert } from "@/utils";
import { resolveEntityEid } from "./node";
import { hasComponent } from "bitecs";

import type { Accessor } from "solid-js";
import type { MountRequest, MountResult, NodeInsertRequest } from "@diffusionstudio/cli/channels";
import type { Engine } from "@/components/engine";

/**
 * `dapi mount` — evaluates a compiled project module and renders it directly into the ECS world
 */
export function handleMount(engine: Accessor<Engine>) {
  return async ({ code }: MountRequest): Promise<MountResult> => {
    const e = engine();
    const world = e.world;
    const c = world.components;
    let dispose = () => {};

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

      try {
        world.history.startTransaction("Commit document");
        await document.commit();
      } finally {
        world.history.commitTransaction();
      }

      if (document.rootEid && hasComponent(world, document.rootEid, c.Scene)) {
        switchActiveScene(world, document.rootEid);
      }
    } catch (error) {
      return { status: "rejected", error: error instanceof Error ? error.message : String(error) };
    } finally {
      dispose?.();
    }

    return { status: "fulfilled" };
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
  return async ({ code, parentId, index }: NodeInsertRequest): Promise<MountResult> => {
    const e = engine();
    const world = e.world;
    let dispose = () => {};

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
    } catch (error) {
      return { status: "rejected", error: error instanceof Error ? error.message : String(error) };
    } finally {
      dispose?.();
    }

    return { status: "fulfilled" };
  };
}
