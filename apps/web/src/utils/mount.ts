/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { query, Not } from "bitecs";
import { renderProject } from "@diffusionstudio/jsx";

import { WorldDocument, importProjectModule } from "@/utils/jsx";
import { getAssetFile } from "@/components/engine/api/assets";
import { assert } from "@/utils";

import type { Engine, EngineWorld } from "@/components/engine";

export interface RenderMountOptions {
  mode: "author" | "adopt";
  mountId: string;
  scriptAssetId: string;
  adoptIndex?: Map<string, number>;
  parentEid?: number;
  engine?: Engine;
}

export interface RealizedMount {
  document: WorldDocument;
  /** Tears down the reactive graph AND frees the runtime hosts it created. */
  dispose: () => void;
}

/** Root keys of a rendered mount (its top-level entities' `Key` values). */
export function documentRootKeys(world: EngineWorld, document: WorldDocument): string[] {
  const keys: string[] = [];
  for (const node of document.stage.children) {
    if (node.eid === undefined) continue;
    const key = world.components.Key[node.eid];
    if (key !== undefined) keys.push(key);
  }
  return keys;
}

/**
 * Evaluates a compiled project module and renders it into `world` through a
 * WorldDocument, then settles async work (asset loads, generation). Shared by
 * the author path (`dapi mount`) and the adopt path (restore/export/capture).
 * The returned `dispose` frees both the reactive graph and the hosts it made.
 */
export async function renderMount(
  world: EngineWorld,
  code: string,
  options: RenderMountOptions,
): Promise<RealizedMount> {
  const module = await importProjectModule(code);
  const project = module.default as () => unknown;
  assert(typeof project === "function", "The project module must default-export a Solid component");

  const document = new WorldDocument(world, options);
  const disposeGraph = renderProject(project, document);
  await document.commit();

  return {
    document,
    dispose: () => {
      disposeGraph();
      document.disposeHosts();
    },
  };
}

/** MountPath -> entity id for one mount, so adopt can bind the re-run by key. */
export function buildAdoptIndex(world: EngineWorld, mountId: string): Map<string, number> {
  const c = world.components;
  const index = new Map<string, number>();
  for (const eid of query(world, [c.MountPath, Not(c.Deleted)])) {
    if (c.MountPath.mountId[eid] !== mountId) continue;
    index.set(c.MountPath.path[eid], eid);
  }
  return index;
}

/**
 * Re-executes every mount recorded in `world` (via its `MountScript` root) in
 * adopt mode: binds the re-run to the world's existing entities by `MountPath`,
 * rebuilds the runtime-only hosts, and registers the graph so the per-frame
 * `playbackSystem` drives it. This is how a cloned (export/capture) or restored
 * (reload) world gets animated surfaces without host-sharing.
 *
 * A world's own re-entry is a no-op (`liveMounts.hasMount`). Every mount stays
 * registered so the world's per-frame `playbackSystem` keeps driving it (live
 * in the editor, per-frame during an offline export/capture render).
 */
export async function realizeMounts(
  world: EngineWorld,
  options: { engine?: Engine } = {},
): Promise<{ disposeAll: () => void }> {
  const c = world.components;
  const seen = new Set<string>();

  const roots = [...query(world, [c.MountScript, Not(c.Deleted)])].filter((eid) => {
    const mountId = c.MountScript.mountId[eid];
    if (seen.has(mountId) || world.liveMounts.hasMount(mountId)) return false;
    seen.add(mountId);
    return true;
  });

  for (const eid of roots) {
    const mountId = c.MountScript.mountId[eid];
    const scriptAssetId = c.MountScript.scriptAssetId[eid];

    try {
      const asset = world.assets.get(scriptAssetId);
      assert(asset, `mount ${mountId}: SCRIPT asset ${scriptAssetId} not found`);
      const code = await getAssetFile(asset).then((file) => file.text());

      const adoptIndex = buildAdoptIndex(world, mountId);
      const { document, dispose } = await renderMount(world, code, {
        mode: "adopt",
        mountId,
        scriptAssetId,
        adoptIndex,
        engine: options.engine,
      });

      world.liveMounts.register({
        mountId,
        rootKeys: () => documentRootKeys(world, document),
        advance: () => document.advanceTicker(),
        dispose,
      });
    } catch (error) {
      // A single malformed mount must not break loading/exporting the world.
      console.error(`realizeMounts: failed to realize mount ${mountId}`, error);
    }
  }

  return { disposeAll: () => world.liveMounts.disposeAll() };
}
