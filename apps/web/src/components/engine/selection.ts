/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hasComponent, Not, Or, query } from 'bitecs';
import { ChildOf } from './components/relations';
import { clearComponent, getParentEntity } from '.';
import { addComponent } from './api/events';

import type { EngineWorld } from './api/world';

export function selectStageEntities(world: EngineWorld): void {
	const c = world.components;
	for (const eid of query(world, [Or(c.Geometry, c.Group, c.AdjustmentLayer), Not(ChildOf('*')), Not(c.Sequential), Not(c.Deleted), Not(c.Hidden), Not(c.Culled)])) {
		addComponent(world, eid, c.Selected, false);
	}
}

/**
 * Replace the current selection with the parents of the selected nodes.
 * Top-level entities (no parent) are skipped; Sequential GROUP ancestors
 * are transparent — keep walking up until a selectable parent is found.
 * A no-op if no valid parent exists.
 */
export function selectParentEntities(world: EngineWorld): void {
	const c = world.components;
	const selection = query(world, [c.Selected, Or(c.Geometry, c.Group, c.AdjustmentLayer)])
	if (selection.length === 0) return;

	const parents = new Set<number>();
	for (const eid of selection) {
		let parent = getParentEntity(world, eid);
		while (parent !== null && hasComponent(world, parent, c.Sequential)) {
			parent = getParentEntity(world, parent);
		}
		if (parent !== null) {
			parents.add(parent);
		}
	}
	if (parents.size === 0) return;

	clearComponent(world, c.Selected, false);
	parents.forEach(parent => addComponent(world, parent, c.Selected, false));
}

/**
 * Replace the current selection with the direct children of selected nodes.
 * Sequential GROUP children are transparent — descend into them so the
 * caller selects actual selectable nodes underneath. No-op when no selected
 * node has any selectable descendant.
 */
export function selectChildEntities(world: EngineWorld): void {
	const c = world.components;
	const selection = query(world, [c.Selected, Or(c.Geometry, c.Group, c.AdjustmentLayer)])
	if (selection.length === 0) return;

	const children = new Set<number>();

	const collect = (parentEid: number) => {
		for (const child of query(world, [ChildOf(parentEid), Not(c.Deleted), Not(c.Hidden), Not(c.Culled)])) {
			if (hasComponent(world, child, c.Sequential)) {
				collect(child);
				continue;
			}

			children.add(child);
		}
	};
	for (const eid of selection) {
		collect(eid);
	}
	if (children.size === 0) return;

	clearComponent(world, c.Selected, false);
	children.forEach(child => addComponent(world, child, c.Selected, false));
}
