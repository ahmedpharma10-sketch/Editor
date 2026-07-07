/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { query, Not, Or } from 'bitecs';
import { ChildOf } from '../components';
import { aabbFromTransformedRect } from '../math';
import { getParentEntity } from './base';
import { getNextName } from './query';
import { createEntity, deleteEntity } from './entities';
import { addComponent, clearComponent, setComponent } from './events';
import { appendChild, removeChild } from './hierarchy';
import { resolveNewSequenceOverlaps } from './overlap';
import { computeLocalMatrix } from '../systems/transform';
import { sortByItemIndex } from '../utils/sort';

import type { EngineWorld } from './world';
import type { Mat2D } from '../math';

/**
 * Wrap the current node selection in a new GROUP. All selected nodes must
 * share the same parent; scenes are skipped. Children's positions are
 * rewritten into the group's local space so their on-canvas position is
 * preserved.
 */
export function groupSelection(world: EngineWorld, sequential: boolean = false): number | null {
	const c = world.components;
	const selection = [...query(world, [c.Selected, Or(c.Geometry, c.Group)])];
	if (selection.length === 0) return null;

	return world.history.transaction('Grouping selection', () => {
		const targetParent = getParentEntity(world, selection[0]);

		const groupables = selection
			.filter(eid => getParentEntity(world, eid) === targetParent)
			.sort(sortByItemIndex(world));

		// Bounding box of children in target-parent local space.
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const eid of groupables) {
			const mat: Mat2D = {
				a: c.LocalTransform.a[eid] ?? 1, b: c.LocalTransform.b[eid] ?? 0,
				c: c.LocalTransform.c[eid] ?? 0, d: c.LocalTransform.d[eid] ?? 1,
				e: c.LocalTransform.e[eid] ?? 0, f: c.LocalTransform.f[eid] ?? 0,
			};
			const w = c.Computed.width[eid];
			const h = c.Computed.height[eid];
			const bounds = aabbFromTransformedRect(mat, w, h);
			if (bounds.minX < minX) minX = bounds.minX;
			if (bounds.minY < minY) minY = bounds.minY;
			if (bounds.maxX > maxX) maxX = bounds.maxX;
			if (bounds.maxY > maxY) maxY = bounds.maxY;
		}

		// Sequences sit at the parent's origin (they're passthrough); plain
		// groups sit at the children's AABB origin so their own pivot lines up.
		const x = sequential ? 0 : Math.round(minX);
		const y = sequential ? 0 : Math.round(minY);

		const topItemIndex = c.ItemIndex[groupables[groupables.length - 1]] ?? 0;

		const groupEid = createEntity(world);
		addComponent(world, groupEid, c.Group);
		if (sequential) {
			addComponent(world, groupEid, c.Sequential);
		}
		setComponent(world, groupEid, c.Position, { x, y });
		setComponent(world, groupEid, c.Name, getNextName(world, sequential ? 'Sequence' : 'Group'));
		if (targetParent) appendChild(world, groupEid, targetParent);
		setComponent(world, groupEid, c.ItemIndex, topItemIndex);

		for (const [index, eid] of groupables.entries()) {
			const prevX = c.Position.x[eid] ?? 0;
			const prevY = c.Position.y[eid] ?? 0;
			const parentEid = getParentEntity(world, eid);
			if (parentEid) removeChild(world, eid, parentEid);
			appendChild(world, eid, groupEid);
			setComponent(world, eid, c.ItemIndex, index);
			setComponent(world, eid, c.Position, { x: prevX - x, y: prevY - y });
			// Refresh the child's cached local matrix now. The next transform pass
			computeLocalMatrix(world, eid);
		}


		if (sequential) {
			resolveNewSequenceOverlaps(world, groupEid);
		}

		clearComponent(world, c.Selected, false);
		addComponent(world, groupEid, c.Selected, false);

		return groupEid;
	});
}

/**
 * Inverse of `groupSelection`. For every GROUP in the current selection,
 * lift its direct children up to the group's parent and remove the group.
 * Children's positions are rewritten so they stay put on canvas.
 */
export function ungroupSelection(world: EngineWorld): void {
	const c = world.components;
	const groups = [...query(world, [c.Selected, c.Group])];
	if (groups.length === 0) return;

	world.history.transaction('Ungrouping selection', () => {
		const promoted: number[] = [];

		for (const groupEid of groups) {
			const targetParent = getParentEntity(world, groupEid);
			// speard is important here
			const children = [...query(world, [ChildOf(groupEid), Not(c.Deleted)])];
			for (const childEid of children) {
				removeChild(world, childEid, groupEid);
				setComponent(world, childEid, c.Position, {
					x: (c.Position.x[childEid] ?? 0) + (c.Position.x[groupEid] ?? 0),
					y: (c.Position.y[childEid] ?? 0) + (c.Position.y[groupEid] ?? 0),
				});

				if (targetParent) {
					appendChild(world, childEid, targetParent);
				}
				promoted.push(childEid);
			}

			deleteEntity(world, groupEid);
		}

		clearComponent(world, c.Selected, false);
		promoted.forEach(eid => addComponent(world, eid, c.Selected, false));
	});
}
