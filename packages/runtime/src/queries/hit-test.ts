/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Document-space hit testing and coordinate mapping for top-level entities.
// LocalTransform is written straight into the SoA store by the transform
// system (never added as a trait), so it is read by entity id here, like
// WorldBounds in ./camera.

import { Not } from 'koota';

import { Computed, Culled, Geometry, Hidden, LocalTransform, Scene } from '../traits';
import { store } from '../world/store';
import { aabbFromTransformedRect, invert2D, transformPoint } from '../math';

import type { Entity, World } from 'koota';
import type { Mat2D, Point } from '../math';

/** Below this the transform is singular and the mapping is undefined. */
const MIN_DETERMINANT = 1e-12;

function localMatrix(world: World, entity: Entity): Mat2D {
	const local = store(world, LocalTransform);
	const eid = entity.id();

	return {
		a: local.a[eid] ?? 1,
		b: local.b[eid] ?? 0,
		c: local.c[eid] ?? 0,
		d: local.d[eid] ?? 1,
		e: local.e[eid] ?? 0,
		f: local.f[eid] ?? 0,
	};
}

/**
 * Convert a document-space point (as produced by `screenToWorld`) to an
 * entity's local coordinates via its LocalTransform. Meant for top-level
 * entities (scenes), whose LocalTransform is in document space.
 */
export function worldToLocal(world: World, entity: Entity, worldX: number, worldY: number): Point {
	const mat = localMatrix(world, entity);
	if (Math.abs(mat.a * mat.d - mat.b * mat.c) < MIN_DETERMINANT) return { x: worldX, y: worldY };
	return transformPoint(invert2D(mat), worldX, worldY);
}

/**
 * The first visible top-level scene whose document-space bounds contain the
 * point (as produced by `screenToWorld`), or null.
 */
export function findSceneAt(world: World, worldX: number, worldY: number): Entity | null {
	const computed = store(world, Computed);

	// Scenes are direct children of the stage, so their LocalTransform is in
	// document space already.
	for (const entity of world.query(Scene, Geometry, Not(Culled), Not(Hidden))) {
		const eid = entity.id();
		const bounds = aabbFromTransformedRect(localMatrix(world, entity), computed.width[eid] ?? 0, computed.height[eid] ?? 0);

		if (worldX >= bounds.minX && worldX <= bounds.maxX && worldY >= bounds.minY && worldY <= bounds.maxY) {
			return entity;
		}
	}

	return null;
}
