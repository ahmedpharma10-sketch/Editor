/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hasComponent, Not, query, Or } from "bitecs";
import { getParentEntity, setComponent, type EngineWorld } from "../api";
import { decompose2D, identity2D, multiply2D, quadCenter, rotate2D, scale2D, skew2D, translate2D, type Mat2D } from "../math";
import { rectToQuad, type Point, type Quad } from "../math";
import { ChildOf } from "../components";
import { assert } from "@/utils";

import type { CursorType } from "./cursor";

type NodeState = {
  localTransform: Mat2D;
  parentTransform: Mat2D;
  height: number;
  width: number;
  scaleX: number;
  scaleY: number;
}

const selectionTransformSnapshot: Map<number, NodeState> = new Map();
export function snapshotSelectionTransforms(world: EngineWorld) {
  const c = world.components;
  selectionTransformSnapshot.clear();

  const snapshot = (eid: number) => {
    if (selectionTransformSnapshot.has(eid)) return;
    const parentEid = getParentEntity(world, eid);
    selectionTransformSnapshot.set(eid, {
      localTransform: entityLocalMat(world, eid),
      parentTransform: entityWorldMat(world, parentEid),
      width: c.Computed.width[eid],
      height: c.Computed.height[eid],
      scaleX: c.Scale.x[eid] ?? 1,
      scaleY: c.Scale.y[eid] ?? 1,
    });

    if (hasComponent(world, eid, c.Group)) {
      for (const child of query(world, [ChildOf(eid), Or(c.Geometry, c.Group), Not(c.Deleted)])) {
        snapshot(child);
      }
    }
  };

  // Store initial node states (local transforms and parent transforms).
  // Groups have no Size of their own, so we also snapshot their direct
  // children — those are the entities a group-resize actually transforms.
  for (const eid of query(world, [c.Selected, Or(c.Geometry, c.Group)])) {
    snapshot(eid);
  }
}

export function getSelectionTransfromSnapshot(id: number) {
  return selectionTransformSnapshot.get(id);
}

type TransformMaskState = {
  width: number;
  height: number;
  mat: Mat2D;
}

export function getSelectionMask(world: EngineWorld): TransformMaskState | null {
  const c = world.components;
  const selection = query(world, [c.Selected, Or(c.Geometry, c.Group), Not(c.Sequential)]);
  if (selection.length === 0) return null;

  let width: number = 0;
  let height: number = 0;
  let mat = identity2D();

  if (selection.length === 1) {
    const eid = selection[0];
    const worldMat = multiply2D(entityWorldMat(world, eid), translate2D(
      c.Computed.originX[eid],
      c.Computed.originY[eid],
    ));
    const d = decompose2D(worldMat);

    width = c.Computed.width[eid] * Math.abs(d.scaleX);
    height = c.Computed.height[eid] * Math.abs(d.scaleY);

    const signX = Math.sign(d.scaleX) || 1;
    const signY = Math.sign(d.scaleY) || 1;

    mat = multiply2D(mat, translate2D(d.x, d.y));
    mat = multiply2D(mat, rotate2D(d.rotation));
    mat = multiply2D(mat, scale2D(signX, signY));
    mat = multiply2D(mat, skew2D(d.skewX, d.skewY));
  } else {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const eid of selection) {
      const q = entityQuad(world, eid);
      for (const p of q) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }

    width = maxX - minX;
    height = maxY - minY;
    mat = translate2D(minX, minY);
  }

  return { width, height, mat };
}

let transformStartMaskState: TransformMaskState | null = null;
export function snapshotSelectionMask(world: EngineWorld) {
  transformStartMaskState = getSelectionMask(world);
}

export function getSelectionMaskSnapshot() {
  return transformStartMaskState;
}

export function updateRotationCursor(world: EngineWorld) {
  const state = getSelectionMask(world);
  if (state === null) return;
  const { mat, width, height } = state;

  // Mouse position in world space
  const mouseX = world.pointer.clientX;
  const mouseY = world.pointer.clientY;

  // Convert mask to quad and get center
  const quad = rectToQuad(mat, width, height);
  const centerX = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const centerY = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;

  // Calculate angle from mouse to center
  const angle = Math.atan2(centerY - mouseY, centerX - mouseX);

  world.cursor.update('nwse-rotate', angle - Math.PI / 4);
}

const HANDLE_RESIZE_CURSOR: Record<string, CursorType> = {
  tr: 'nesw-resize', br: 'nwse-resize',
  bl: 'nesw-resize', tl: 'nwse-resize',
  t: 'ns-resize', r: 'ew-resize',
  b: 'ns-resize', l: 'ew-resize',
};

export function updateResizeCursor(world: EngineWorld, orientation: string) {
  const state = getSelectionMask(world);
  if (state === null) return;
  const { a, b } = state.mat;
  const rotation = Math.atan2(b, a);

  world.cursor.update(HANDLE_RESIZE_CURSOR[orientation], rotation);
}

type SnapAxisCandidate = { value: number; point: Point };
type SnapCandidates = { x: SnapAxisCandidate[]; y: SnapAxisCandidate[] };

const snapCandidatesSnapshot: SnapCandidates = { x: [], y: [] };
export function snapshotSnapCandidates(world: EngineWorld) {
  snapCandidatesSnapshot.x.length = 0;
  snapCandidatesSnapshot.y.length = 0;

  const seen = new Set<string>();
  const c = world.components;
  const selection = new Set<number>(query(world, [c.Selected, Or(c.Geometry, c.Group)]));

  const addNodeCandidates = (eid: number) => {
    if (c.Computed.visibility[eid] === 0) return;

    const quad = entityQuad(world, eid);
    const nodeCandidates = buildSnapCandidatesFromQuad(quad);
    const axisCandidates = [
      ...nodeCandidates.x.map(candidate => ({ axis: 'x' as const, candidate })),
      ...nodeCandidates.y.map(candidate => ({ axis: 'y' as const, candidate })),
    ];

    for (const { axis, candidate } of axisCandidates) {
      const key = axis === 'x'
        ? `${axis}:${Math.round(candidate.value * 100) / 100}:${Math.round(candidate.point.y * 100) / 100}`
        : `${axis}:${Math.round(candidate.value * 100) / 100}:${Math.round(candidate.point.x * 100) / 100}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (axis === 'x') {
        snapCandidatesSnapshot.x.push(candidate);
      } else {
        snapCandidatesSnapshot.y.push(candidate);
      }
    }
  };

  let parentEid: number | null = null;
  if (selection.size === 1) {
    parentEid = getParentEntity(world, selection.values().next().value);
  }

  let parentComponent = Not(ChildOf('*'));
  if (parentEid) {
    parentComponent = ChildOf(parentEid);
  }

  const siblings = [
    ...query(world, [
      parentComponent,
      Or(c.Geometry, c.Group),
      Not(c.Deleted),
      Not(c.Culled),
      Not(c.Hidden),
    ])
  ];

  for (const childEid of siblings) {
    if (selection.has(childEid)) continue;
    addNodeCandidates(childEid);
  }

  if (parentEid !== null && !selection.has(parentEid)) {
    addNodeCandidates(parentEid);
  }
}

export function getSnapCandidatesSnapshot(): SnapCandidates {
  return snapCandidatesSnapshot;
}

const LABEL_INPUT_STYLE = {
  position: 'absolute',
  transformOrigin: 'left top',
  font: '350 11px Inter, sans-serif',
  color: 'var(--foreground)',
  background: 'var(--input)',
  border: '1px solid var(--primary)',
  borderRadius: '2px',
  outline: 'none',
  padding: '0 0 0 2px',
  margin: '0',
  boxSizing: 'content-box',
  zIndex: '1000',
}

let mountedNameInput: HTMLInputElement | null = null;
let mountedNameInputEid: number | null = null;

export function mountNameInput(world: EngineWorld, eid: number) {
  const canvas = world.canvas;
  assert(canvas instanceof HTMLCanvasElement, 'Canvas must be an HTMLCanvasElement');
  const container = canvas.parentElement;
  const c = world.components;
  if (!container) return;

  const originalName = c.Name[eid] ?? '';
  world.history.startTransaction('Edit label');

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.value = originalName;

  Object.assign(labelInput.style, LABEL_INPUT_STYLE);

  labelInput.addEventListener('input', (e) => {
    const input = e.currentTarget as HTMLInputElement;
    setComponent(world, eid, c.Name, input.value ?? '');
  });

  labelInput.addEventListener('blur', (e) => {
    const input = e.currentTarget as HTMLInputElement;
    input.remove();

    if (!input.value.trim()) {
      setComponent(world, eid, c.Name, originalName);
    }

    world.history.commitTransaction();
    mountedNameInput = null;
    mountedNameInputEid = null;
  });

  labelInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const input = e.currentTarget as HTMLInputElement;

    if (e.key === 'Escape') {
      setComponent(world, eid, c.Name, originalName);
      input.blur();
    }

    if (e.key === 'Enter') {
      input.blur();
    }
  });

  container.appendChild(labelInput);
  labelInput.focus();
  labelInput.select();

  mountedNameInput = labelInput;
  mountedNameInputEid = eid;
};

export function getMountedNameInput() {
  return { input: mountedNameInput, eid: mountedNameInputEid };
}

export function findSnapTarget(source: SnapAxisCandidate[], targets: SnapAxisCandidate[], threshold: number, axis: 'x' | 'y') {
  let best: {
    offset: number;
    distance: number;
    sourcePoint: Point;
    targetPoint: Point;
  } | null = null;

  for (const sourceCandidate of source) {
    for (const target of targets) {
      const offset = target.value - sourceCandidate.value;
      const distance = Math.abs(offset);
      const crossDistance = axis === 'x'
        ? Math.abs(target.point.y - sourceCandidate.point.y)
        : Math.abs(target.point.x - sourceCandidate.point.x);

      if (distance > threshold) continue;
      if (!best || distance < best.distance || (distance === best.distance && crossDistance < (axis === 'x'
        ? Math.abs(best.targetPoint.y - best.sourcePoint.y)
        : Math.abs(best.targetPoint.x - best.sourcePoint.x)))) {
        best = {
          offset,
          distance,
          sourcePoint: sourceCandidate.point,
          targetPoint: target.point,
        };
      }
    }
  }

  return best;
};

export function getMarqueeQuad(world: EngineWorld): Quad | null {
  if (world.hudMode !== 'marquee') return null;

  const x0 = world.pointer.dragStartX;
  const y0 = world.pointer.dragStartY;
  const x1 = world.pointer.clientX;
  const y1 = world.pointer.clientY;

  const minX = Math.min(x0, x1);
  const minY = Math.min(y0, y1);
  const maxX = Math.max(x0, x1);
  const maxY = Math.max(y0, y1);

  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

export function buildSnapCandidatesFromQuad(quad: Quad): { x: SnapAxisCandidate[], y: SnapAxisCandidate[] } {
  const center = quadCenter(quad);
  const corners = quad;
  const points: Point[] = [...corners, center];

  return {
    x: points.map(point => ({ value: point.x, point })),
    y: points.map(point => ({ value: point.y, point })),
  };
}

export function buildSnapCandidatesFromCorners(points: Point[]): { x: SnapAxisCandidate[], y: SnapAxisCandidate[] } {
  return {
    x: points.map(point => ({ value: point.x, point })),
    y: points.map(point => ({ value: point.y, point })),
  };
}

export function entityWorldMat(world: EngineWorld, eid: number | null): Mat2D {
  if (eid === null) {
    const res = world.resolution;
    return {
      a: world.camera.a * res, b: world.camera.b * res,
      c: world.camera.c * res, d: world.camera.d * res,
      e: world.camera.e * res, f: world.camera.f * res,
    };
  }

  const WorldTransform = world.components.WorldTransform;
  return {
    a: WorldTransform.a[eid] ?? 1, b: WorldTransform.b[eid] ?? 0,
    c: WorldTransform.c[eid] ?? 0, d: WorldTransform.d[eid] ?? 1,
    e: WorldTransform.e[eid] ?? 0, f: WorldTransform.f[eid] ?? 0,
  };
}

export function entityLocalMat(world: EngineWorld, eid: number): Mat2D {
  const LocalTransform = world.components.LocalTransform;
  return {
    a: LocalTransform.a[eid] ?? 1, b: LocalTransform.b[eid] ?? 0,
    c: LocalTransform.c[eid] ?? 0, d: LocalTransform.d[eid] ?? 1,
    e: LocalTransform.e[eid] ?? 0, f: LocalTransform.f[eid] ?? 0,
  };
}

export function entityOffset(world: EngineWorld, eid: number): Point {
  const Offset = world.components.Offset;
  return {
    x: Offset.x[eid] ?? 0,
    y: Offset.y[eid] ?? 0,
  };
}

export function entityAnchor(world: EngineWorld, eid: number): Point {
  const Anchor = world.components.Anchor;
  return {
    x: Anchor.x[eid] ?? 0.5,
    y: Anchor.y[eid] ?? 0.5,
  };
}

export function entityQuad(world: EngineWorld, eid: number): Quad {
  const Computed = world.components.Computed;
  const width = Computed.width[eid];
  const height = Computed.height[eid];

  const mat = multiply2D(entityWorldMat(world, eid), translate2D(Computed.originX[eid], Computed.originY[eid]));

  return rectToQuad(mat, width, height);
}
