/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Not, query } from 'bitecs';
import { ChildOf } from '../components';
import { isScene } from '../api/query';
import type { EngineWorld } from '../api/world';
import { aabbFromTransformedRect, invert2D, transformPoint, type Mat2D, type Point } from '../math';

/** Convert a screen-space point (CSS pixels) to world coordinates via the camera matrix. */
export function screenToWorld(world: EngineWorld, sx: number, sy: number): Point {
	const { a, b, c, d, e, f } = world.camera;

	const det = a * d - b * c;
	const inv = 1 / det;

	return {
		x: inv * (d * (sx - e) - c * (sy - f)),
		y: inv * (-b * (sx - e) + a * (sy - f)),
	};
}

/** Convert a world-space point (as produced by `screenToWorld`) to an entity's
 *  local coordinates via its LocalTransform. Assumes the entity is top-level
 *  (parent-less) so its LocalTransform is in world space. */
export function worldToLocal(world: EngineWorld, eid: number, wx: number, wy: number): Point {
	const LocalTransform = world.components.LocalTransform;

	const a = LocalTransform.a[eid] ?? 1;
	const b = LocalTransform.b[eid] ?? 0;
	const c = LocalTransform.c[eid] ?? 0;
	const d = LocalTransform.d[eid] ?? 1;
	const e = LocalTransform.e[eid] ?? 0;
	const f = LocalTransform.f[eid] ?? 0;

	const det = a * d - b * c;
	const inv = 1 / det;

	return {
		x: inv * (d * (wx - e) - c * (wy - f)),
		y: inv * (-b * (wx - e) + a * (wy - f)),
	};
}

/** Find the first scene entity whose world-space bounds contain the given
 *  world-space point (as produced by `screenToWorld`). */
export function findSceneAt(world: EngineWorld, wx: number, wy: number): number | null {
	const c = world.components;

	for (const cid of query(world, [Not(ChildOf('*')), c.Geometry, Not(c.Deleted), Not(c.Culled), Not(c.Hidden)])) {
		if (!isScene(world, cid)) continue;

		const mat: Mat2D = {
			a: c.LocalTransform.a[cid] ?? 1,
			b: c.LocalTransform.b[cid] ?? 0,
			c: c.LocalTransform.c[cid] ?? 0,
			d: c.LocalTransform.d[cid] ?? 1,
			e: c.LocalTransform.e[cid] ?? 0,
			f: c.LocalTransform.f[cid] ?? 0,
		};
		const bounds = aabbFromTransformedRect(
			mat,
			c.Computed.width[cid],
			c.Computed.height[cid],
		);

		if (wx >= bounds.minX && wx <= bounds.maxX && wy >= bounds.minY && wy <= bounds.maxY) {
			return cid;
		}
	}

	return null;
}

export function isPointerInEntity(world: EngineWorld, eid: number, point: Point) {
  const c = world.components;
  const minX = c.WorldBounds.minX[eid];
  const minY = c.WorldBounds.minY[eid];
  const maxX = c.WorldBounds.maxX[eid];
  const maxY = c.WorldBounds.maxY[eid];

  const x = point.x;
  const y = point.y;

  if (x < minX || x > maxX || y < minY || y > maxY) return false;

  // Precise test: map pointer into entity-local space so rotation/skew
  // don't produce false positives along the AABB's outer slack.
  const world2D: Mat2D = {
    a: c.WorldTransform.a[eid], b: c.WorldTransform.b[eid],
    c: c.WorldTransform.c[eid], d: c.WorldTransform.d[eid],
    e: c.WorldTransform.e[eid], f: c.WorldTransform.f[eid],
  };
  const inv = invert2D(world2D);
  const local = transformPoint(inv, x, y);
  const w = c.Computed.width[eid];
  const h = c.Computed.height[eid];
  const ox = c.Computed.originX[eid];
  const oy = c.Computed.originY[eid];

  if (local.x >= ox && local.x <= ox + w && local.y >= oy && local.y <= oy + h) {
    return true;
  }

  return false;
}
