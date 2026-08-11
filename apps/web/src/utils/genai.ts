/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { query, Not, Or } from "bitecs";
import { ChildOf, PaintType, aabbFromTransformedRect, aabbsIntersect, invert2D, transformPoint, getEntityTree, createEntity, setComponent, appendChild, addComponent, removeComponent, createFolder, ensureFolder, uniqueFolderName, type AABB } from "@/components/engine";
import { MAIN_CANVAS_ID } from "@/components/canvas";

import type { EngineWorld } from "@/components/engine";

const GEN_AI_FOLDER_NAME = 'Gen AI';

/**
 * Map aspect ratio to pixel dimensions assuming 1080p as baseline.
 */
export const ASPECT_RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:3": { width: 1440, height: 1080 },
  "3:4": { width: 1080, height: 1440 },
};

/**
 * Get the world-space center of the current viewport.
 */
export function getViewportCenter(world: EngineWorld) {
  const canvasEl = document.getElementById(MAIN_CANVAS_ID) as HTMLCanvasElement | null;
  if (!canvasEl) return { x: 0, y: 0 };
  const rect = canvasEl.getBoundingClientRect();
  const invMat = invert2D(world.camera);
  const pt = transformPoint(invMat, rect.width / 2, rect.height / 2);
  return pt ?? { x: 0, y: 0 };
}

/**
 * Get the world-space AABB of the current viewport.
 */
function getViewportBounds(world: EngineWorld): AABB | null {
  const canvasEl = document.getElementById(MAIN_CANVAS_ID) as HTMLCanvasElement | null;
  if (!canvasEl) return null;
  const rect = canvasEl.getBoundingClientRect();
  const invMat = invert2D(world.camera);
  const tl = transformPoint(invMat, 0, 0);
  const tr = transformPoint(invMat, rect.width, 0);
  const br = transformPoint(invMat, rect.width, rect.height);
  const bl = transformPoint(invMat, 0, rect.height);
  return {
    minX: Math.min(tl.x, tr.x, br.x, bl.x),
    minY: Math.min(tl.y, tr.y, br.y, bl.y),
    maxX: Math.max(tl.x, tr.x, br.x, bl.x),
    maxY: Math.max(tl.y, tr.y, br.y, bl.y),
  };
}

/**
 * Find a placement spot for a `width`x`height` block on the canvas.
 */
export function findEmptyPlacement(
  world: EngineWorld,
  width: number,
  height: number,
  gap: number,
  extra: AABB[] = [],
): { x: number; y: number } {
  const center = getViewportCenter(world);
  const viewport = getViewportBounds(world);

  const c = world.components;
  const LocalTransform = c.LocalTransform;
  const Computed = c.Computed;

  // `extra` boxes are content the world can't report yet — e.g. sibling roots
  // placed earlier in the same mount, whose layout has not been computed. They
  // are avoided and anchored beside like any existing box.
  const boxes: AABB[] = [...extra];
  for (const cid of query(world, [Or(c.Geometry, c.Group), Not(ChildOf('*')), Not(c.Deleted), Not(c.Hidden), Not(c.Generating)])) {
    const w = Computed.width[cid];
    const h = Computed.height[cid];
    if (!w || !h) continue;
    if (LocalTransform.a[cid] === undefined) continue;
    const aabb = aabbFromTransformedRect(
      {
        a: LocalTransform.a[cid], b: LocalTransform.b[cid],
        c: LocalTransform.c[cid], d: LocalTransform.d[cid],
        e: LocalTransform.e[cid], f: LocalTransform.f[cid],
      },
      w,
      h,
    );
    boxes.push(aabb);
  }

  if (boxes.length === 0) {
    return center;
  }

  const candidates = viewport
    ? boxes.filter((b) => aabbsIntersect(b, viewport))
    : boxes;
  const ordered = (candidates.length > 0 ? candidates : boxes).slice().sort((a, b) => {
    const acx = (a.minX + a.maxX) / 2, acy = (a.minY + a.maxY) / 2;
    const bcx = (b.minX + b.maxX) / 2, bcy = (b.minY + b.maxY) / 2;
    return Math.hypot(acx - center.x, acy - center.y)
      - Math.hypot(bcx - center.x, bcy - center.y);
  });

  const overlapsAny = (rect: AABB): boolean => {
    for (const b of boxes) {
      if (aabbsIntersect(rect, b)) return true;
    }
    return false;
  };

  for (const cand of ordered) {
    const cy = (cand.minY + cand.maxY) / 2;
    const minY = cy - height / 2;
    const maxY = cy + height / 2;

    const rightMinX = cand.maxX + gap;
    const right: AABB = { minX: rightMinX, minY, maxX: rightMinX + width, maxY };
    if (!overlapsAny(right)) {
      return { x: rightMinX + width / 2, y: cy };
    }

    const leftMaxX = cand.minX - gap;
    const left: AABB = { minX: leftMaxX - width, minY, maxX: leftMaxX, maxY };
    if (!overlapsAny(left)) {
      return { x: leftMaxX - width / 2, y: cy };
    }
  }

  return center;
}

/**
 * Attach the waveform fill to a generated audio entity.
 */
export function addWaveformFill(world: EngineWorld, eid: number, assetId: string) {
  const c = world.components;
  const fillEid = createEntity(world);
  setComponent(world, fillEid, c.Paint, PaintType.WAVEFORM);
  setComponent(world, fillEid, c.AssetId, assetId);
  appendChild(world, fillEid, eid);
}

/**
 * The library folder for a finished generation: every generated asset lands in
 * a root-level "Gen AI" folder, and a multi-variant batch gets its own
 * subfolder inside it, named after the generation. Both are created on demand.
 * Call only after the generation succeeded, so failures leave no empty folders.
 */
export async function ensureGenerationFolder(
  world: EngineWorld,
  name: string,
  count: number,
): Promise<string> {
  const genAi = await ensureFolder(world, GEN_AI_FOLDER_NAME, null);
  if (count <= 1) return genAi.id;

  const batch = await createFolder(world, uniqueFolderName(world, name, genAi.id), genAi.id);
  return batch.id;
}

/**
 * Record a finished generation as a single undoable step.
 */
export function recordGeneration(world: EngineWorld, label: string, rootEids: number[]) {
  const c = world.components;
  const eids = rootEids.flatMap((root) => getEntityTree(world, root));

  world.history.push({
    label,
    execute: () => eids.forEach((e) => removeComponent(world, e, c.Deleted)),
    reverse: () => eids.forEach((e) => addComponent(world, e, c.Deleted)),
  });
}
