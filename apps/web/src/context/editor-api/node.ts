/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { entityExists, hasComponent, query, Not } from "bitecs";

import { createEncoder } from "@/components/engine/encode/encoder";
import { createImageEncoder } from "@/components/engine/encode/image-encoder";
import { ElectronWritableFileHandle } from "@/lib/electron-file-writable";

import {
  deleteEntity,
  getParentEntity,
  isText,
  isScene,
  getEntityTree,
  cloneSubtree,
  serializeEntity,
} from "@/components/engine";
import { ChildOf } from "@/components/engine/components";
import { WorldDocument } from "@/utils/jsx";
import { entityType } from "./selection";

import type { EngineWorld, Engine } from "@/components/engine";
import type {
  EntityRecord,
  NodeDeleteResult,
  NodeDuplicateResult,
  NodeGrepMatch,
  NodeGrepRequest,
  NodeGrepResult,
  NodeListResult,
  NodePatch,
  NodePatchResult,
  NodeRef,
  NodeTree,
  NodeRenderRequest,
  NodeRenderResult,
} from "@diffusionstudio/cli/channels";
import { clamp } from "@/utils";
import type { EncoderConfig } from "@/components/engine/encode/interfaces";
import type { Accessor } from "solid-js";

// Scenes are nodes too, so node ops accept them alongside geometry, groups,
// and adjustment layers.
export function isNode(world: EngineWorld, eid: number): boolean {
  const c = world.components;
  return (
    hasComponent(world, eid, c.Geometry) ||
    hasComponent(world, eid, c.Group) ||
    hasComponent(world, eid, c.AdjustmentLayer) ||
    hasComponent(world, eid, c.Scene)
  );
}

// Any live entity — `ls`, `tree`, `rm`, `patch`, and `insert` also target
// paints and color stops, which are sub-entities rather than nodes.
export function resolveEntityEid(world: EngineWorld, eid: number): number {
  if (
    !Number.isInteger(eid) ||
    !entityExists(world, eid) ||
    hasComponent(world, eid, world.components.Deleted)
  ) {
    throw new Error(`No such entity: ${eid}`);
  }
  return eid;
}

export function resolveNodeEid(world: EngineWorld, eid: number): number {
  resolveEntityEid(world, eid);
  if (!isNode(world, eid)) {
    throw new Error(`No such node: ${eid}`);
  }
  return eid;
}

export function handleNodeList(engine: Accessor<Engine>) {
  return async ({ ids }: { ids?: number[] }): Promise<NodeListResult[]> => {
    const { world } = engine();
    const c = world.components;

    // No ids → the root: top-level nodes
    if (ids === undefined || ids.length === 0) {
      const roots = [...query(world, [c.Geometry, Not(ChildOf("*")), Not(c.Deleted)])];
      return roots.map((eid) => ({
        status: "fulfilled",
        node: serializeEntity(world, eid) as EntityRecord,
      }));
    }

    return ids.map((id) => {
      try {
        return {
          status: "fulfilled",
          node: serializeEntity(world, resolveEntityEid(world, id)) as EntityRecord,
        };
      } catch (e) {
        return { status: "rejected", id, error: (e as Error).message };
      }
    });
  };
}

/**
 * Key characteristics of an entity, from whatever components it carries — 
 * e.g. "hidden; size: 200x300; text: Hello World". Times print as seconds.
 */
function describeEntity(world: EngineWorld, eid: number): string {
  const c = world.components;
  const parts: string[] = [];
  const fmtTime = (frames: number) => `${Math.round((frames / world.frameRate) * 100) / 100}s`;
  const hex = (packed: number) => `#${((packed >>> 0) & 0xffffff).toString(16).padStart(6, "0")}`;

  if (hasComponent(world, eid, c.Hidden)) parts.push("hidden");
  if (hasComponent(world, eid, c.Size)) {
    parts.push(`size: ${c.Size.width[eid] ?? 0}x${c.Size.height[eid] ?? 0}`);
  }
  if (hasComponent(world, eid, c.Position)) {
    const x = c.Position.x[eid] ?? 0;
    const y = c.Position.y[eid] ?? 0;
    if (x !== 0 || y !== 0) parts.push(`pos: ${x},${y}`);
  }
  if (hasComponent(world, eid, c.Rotation) && c.Rotation[eid]) {
    parts.push(`rotation: ${c.Rotation[eid]}°`);
  }
  if (hasComponent(world, eid, c.CornerRadius) && c.CornerRadius[eid]) {
    parts.push(`cornerRadius: ${c.CornerRadius[eid]}`);
  }
  if (hasComponent(world, eid, c.Appearance)) {
    const opacity = c.Appearance.opacity[eid];
    if (opacity !== undefined && opacity !== 1) parts.push(`opacity: ${opacity}`);
  }
  const delay = hasComponent(world, eid, c.Delay) ? c.Delay[eid] ?? 0 : 0;
  if (delay !== 0) parts.push(`start: ${fmtTime(delay)}`);
  if (hasComponent(world, eid, c.Trim)) {
    const start = c.Trim.start[eid];
    const end = c.Trim.end[eid];
    if (start !== undefined) parts.push(`in: ${fmtTime(start + delay)}`);
    if (end !== undefined) parts.push(`out: ${fmtTime(end + delay)}`);
  }
  if (hasComponent(world, eid, c.Volume)) {
    const db = c.Volume[eid] ?? 0;
    parts.push(`volume: ${db === -Infinity ? "-inf" : Math.round(db * 10) / 10} dB`);
  }
  if (hasComponent(world, eid, c.AssetId)) parts.push(`asset: ${c.AssetId[eid]}`);
  if (hasComponent(world, eid, c.TextStyle)) {
    const family = c.TextStyle.fontFamily[eid];
    const size = c.TextStyle.fontSize[eid];
    const font = [family, size !== undefined ? `${size}px` : undefined].filter(Boolean).join(" ");
    if (font) parts.push(`font: ${font}`);
  }
  if (hasComponent(world, eid, c.Color)) parts.push(`color: ${hex(c.Color[eid] ?? 0)}`);
  if (hasComponent(world, eid, c.ColorStop)) {
    const offset = c.ColorStop.offset[eid];
    const color = c.ColorStop.color[eid];
    const opacity = c.ColorStop.opacity[eid];
    if (offset !== undefined) parts.push(`offset: ${offset}`);
    if (color !== undefined) parts.push(`color: ${hex(color)}`);
    if (opacity !== undefined && opacity !== 1) parts.push(`opacity: ${opacity}`);
  }
  if (hasComponent(world, eid, c.StrokeStyle) && c.StrokeStyle.width[eid] !== undefined) {
    parts.push(`width: ${c.StrokeStyle.width[eid]}`);
  }
  if (hasComponent(world, eid, c.KeyframeTrack)) {
    parts.push(`property: ${c.KeyframeTrack.property[eid]}`);
  }
  if (hasComponent(world, eid, c.Keyframe)) {
    parts.push(`time: ${fmtTime(c.Keyframe.time[eid] ?? 0)}`, `value: ${c.Keyframe.value[eid]}`);
    if (c.Keyframe.easing[eid]) parts.push(`easing: ${c.Keyframe.easing[eid]}`);
  }
  if (hasComponent(world, eid, c.TextRange)) {
    parts.push(`range: ${c.TextRange.start[eid] ?? 0}–${c.TextRange.end[eid] ?? "end"}`);
  }
  if (isText(world, eid)) {
    const text = c.Chars[eid] ?? "";
    parts.push(`text: ${text.length > 80 ? `${text.slice(0, 79)}…` : text}`);
  }

  return parts.join("; ");
}

type TreeBucket = keyof Omit<NodeTree, keyof NodeRef | "description">;

// First match wins: masks carry IsMask + Geometry, shadows carry Shadow + Effect.
function childBucket(world: EngineWorld, eid: number): TreeBucket | null {
  const c = world.components;
  if (hasComponent(world, eid, c.IsMask)) return "masks";
  if (isNode(world, eid)) return "children";
  if (hasComponent(world, eid, c.ColorStop)) return "colorStops";
  if (hasComponent(world, eid, c.Paint)) return "paints";
  if (hasComponent(world, eid, c.Stroke)) return "strokes";
  if (hasComponent(world, eid, c.Shadow)) return "shadows";
  if (hasComponent(world, eid, c.Effect)) return "effects";
  if (hasComponent(world, eid, c.TextRange)) return "textRanges";
  if (hasComponent(world, eid, c.KeyframeTrack)) return "keyframeTracks";
  if (hasComponent(world, eid, c.Keyframe)) return "keyframes";
  if (hasComponent(world, eid, c.Animation)) return "animations";
  return null;
}

export function handleNodeTree(engine: Accessor<Engine>) {
  return async ({ id, depth }: { id?: number; depth?: number }): Promise<NodeTree[]> => {
    const { world } = engine();
    const c = world.components;

    // depth caps how many levels of descendants to descend into; the root is
    // level 0, so --depth 1 yields the root plus its immediate children.
    const build = (eid: number, level: number): NodeTree => {
      const node: NodeTree = {
        id: eid,
        name: c.Name[eid] ?? "",
        type: entityType(world, eid),
        description: describeEntity(world, eid),
      };
      if (depth !== undefined && level + 1 > depth) return node;
      for (const cid of query(world, [ChildOf(eid), Not(c.Deleted)])) {
        const bucket = childBucket(world, cid);
        if (bucket === null) continue;
        (node[bucket] ??= []).push(build(cid, level + 1));
      }
      return node;
    };

    if (id === undefined) {
      const roots = [...query(world, [c.Geometry, Not(ChildOf("*")), Not(c.Deleted)])];
      return roots.map((eid) => build(eid, 0));
    }

    return [build(resolveEntityEid(world, id), 0)];
  };
}

export function handleNodeGrep(engine: Accessor<Engine>) {
  return async ({
    pattern,
    ignoreCase,
    id,
    types,
    components,
  }: NodeGrepRequest): Promise<NodeGrepResult[]> => {
    const { world } = engine();
    const c = world.components;
    const re = new RegExp(pattern, ignoreCase ? "i" : "");

    // The corpus: the given entity's subtree, or every live entity.
    const eids =
      id !== undefined
        ? getEntityTree(world, resolveEntityEid(world, id))
        : [...query(world, [c.Geometry, Not(ChildOf("*")), Not(c.Deleted)])].flatMap((root) =>
          getEntityTree(world, root),
        );

    const results: NodeGrepResult[] = [];
    for (const eid of eids) {
      const type = entityType(world, eid);
      if (types !== undefined && types.length > 0 && !types.includes(type)) continue;

      const record = serializeEntity(world, eid);
      const matches: NodeGrepMatch[] = [];
      for (const [component, value] of Object.entries(record)) {
        if (component === "id" || component === "eid") continue;
        if (components !== undefined && components.length > 0 && !components.includes(component)) {
          continue;
        }
        const text = typeof value === "string" ? value : JSON.stringify(value);
        if (re.test(text)) matches.push({ component, value: text });
      }
      if (matches.length > 0) {
        results.push({ id: eid, name: c.Name[eid] ?? "", type, matches });
      }
    }
    return results;
  };
}

// Walk up from a node to the scene that owns it (a scene resolves to itself).
function sceneOfNode(world: EngineWorld, eid: number): number | null {
  let cur: number | null = eid;
  while (cur !== null) {
    if (isScene(world, cur)) return cur;
    cur = getParentEntity(world, cur);
  }
  return null;
}

export function handleNodeCapture(engine: Accessor<Engine>) {
  return async ({ id, frames, timestamp }: { id: number; frames?: number[]; timestamp?: boolean }): Promise<{ base64: string }[]> => {
    const e = engine();
    const w = e.world;
    const c = w.components;

    const eid = resolveNodeEid(w, id);

    // `undefined` means the current playhead, mapped into the node's local
    // timeline (the encoder's frame 0 is the node's first visible frame).
    let shots = frames;
    if (shots === undefined || shots.length === 0) {
      const sceneEid = sceneOfNode(w, eid);
      const sceneFrame = sceneEid !== null ? c.Computed.localTime[sceneEid] ?? 0 : 0;
      const start = c.Computed.start[eid] ?? 0;
      const duration = c.Computed.duration[eid] ?? 0;
      shots = [clamp(sceneFrame - start, 0, Math.max(0, duration - 1))];
    }

    const encoder = await createImageEncoder(w, {
      eid,
      frames: shots,
      timestamp: timestamp !== false,
    });
    const result = await encoder.render();

    if (result.type === "canceled") throw new Error("Capture canceled");
    if (result.type === "error") throw result.error;

    return result.data.map((base64) => ({ base64 }));
  };
}

export function handleNodeRender(engine: Accessor<Engine>) {
  return async ({ id, output, config }: NodeRenderRequest): Promise<NodeRenderResult> => {
    const e = engine();
    const w = e.world;

    const sceneEid = id ?? w.selection.scene;
    if (sceneEid === null || sceneEid === undefined) {
      throw new Error("No active scene. Provide a scene id, or open a scene first.");
    }
    if (!entityExists(w, sceneEid) || !isScene(w, sceneEid)) {
      throw new Error(`Node ${sceneEid} is not a scene.`);
    }

    const target = new ElectronWritableFileHandle(output);
    e.stop();
    let result;
    try {
      const encoder = await createEncoder(w, {
        ...(config as Partial<EncoderConfig>),
        scene: sceneEid,
        target,
      });
      result = await encoder.render();
    } finally {
      e.start();
    }

    if (result.type !== "success") {
      // Clean up the partial file on cancel / error.
      await target.dispose().catch(() => { });
      if (result.type === "canceled") throw new Error("Export canceled");
      throw new Error(result.error?.message || "Export failed");
    }

    return { path: output };
  };
}

export function handleNodeDelete(engine: Accessor<Engine>) {
  return async ({ ids }: { ids: number[] }): Promise<NodeDeleteResult[]> => {
    const { world } = engine();
    const resolved = ids.map((id) => {
      try {
        return { id, eid: resolveEntityEid(world, id) };
      } catch (e) {
        return { id, error: (e as Error).message };
      }
    });

    const toDelete = resolved.filter((r): r is { id: number; eid: number } => "eid" in r);
    world.history.transaction("deleting nodes", () => {
      for (const { eid } of toDelete) {
        deleteEntity(world, eid);
      }
    });

    return resolved.map((r) =>
      "eid" in r
        ? { status: "fulfilled", id: r.id }
        : { status: "rejected", id: r.id, error: r.error },
    );
  };
}

export function handleNodeDuplicate(engine: Accessor<Engine>) {
  return async ({ ids }: { ids: number[] }): Promise<NodeDuplicateResult[]> => {
    const { world } = engine();
    const resolved = ids.map((id) => {
      try {
        const eid = resolveNodeEid(world, id);
        return { id, tree: getEntityTree(world, eid) };
      } catch (e) {
        return { id, error: (e as Error).message };
      }
    });

    const toClone = resolved.filter(
      (r): r is { id: number; tree: number[] } => "tree" in r,
    );

    const newRootEids = new Map<number, number>();
    if (toClone.length > 0) {
      world.history.transaction("duplicating nodes", () => {
        for (const { id, tree } of toClone) {
          newRootEids.set(id, cloneSubtree(world, tree).get(id)!);
        }
      });
    }

    return resolved.map((r) =>
      "tree" in r
        ? { status: "fulfilled", sourceId: r.id, newId: newRootEids.get(r.id)! }
        : { status: "rejected", sourceId: r.id, error: r.error },
    );
  };
}

export function handleNodePatch(engine: Accessor<Engine>) {
  return async ({ patches }: { patches: NodePatch[] }): Promise<NodePatchResult[]> => {
    const e = engine();
    const world = e.world;

    const results: NodePatchResult[] = [];
    for (const patch of patches) {
      const doc = new WorldDocument(e);

      try {
        const eid = resolveEntityEid(world, patch.id);

        world.history.startTransaction("patching node");
        try {
          const node = doc.element(eid);
          for (const [key, value] of Object.entries(patch)) {
            if (key === "id") continue;
            doc.setProperty(node, key, value);
          }
          world.history.commitTransaction();
        } catch (error) {
          world.history.rollbackTransaction();
          throw error;
        }

        // `src` mounts asynchronously; a failed mount rejects this patch, but
        // its synchronous props are committed at this point regardless.
        world.history.startTransaction("Commit document");
        try {
          await doc.commit();
        } finally {
          world.history.commitTransaction();
        }

        results.push({ status: "fulfilled", id: patch.id });
      } catch (error) {
        results.push({ status: "rejected", id: patch.id, error: (error as Error).message });
      }
    }

    return results;
  };
}
