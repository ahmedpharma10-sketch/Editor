/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hasComponent, query, Or } from 'bitecs';
import { cloneFromRecords, cloneSubtree, serializeEntity, stripMountIdentity } from './serialize';
import { getEntityTree } from './query';
import { getParentEntity } from './base';
import { addComponent, clearComponent, setComponent } from './events';
import { appendChild, removeChild } from './hierarchy';

import type { DBEntity } from '../types';
import type { EngineWorld } from './world';

type ClipboardEntry = {
	root: number;
	records: DBEntity[];
};

let clipboard: ClipboardEntry[] = [];

export function copySelection(world: EngineWorld) {
	const c = world.components;
	const selection = [...query(world, [c.Selected, Or(c.Geometry, c.Group)])];
	if (selection.length === 0) return;

	clipboard = selection.map(eid => ({
		root: eid,
		records: getEntityTree(world, eid).map(e => serializeEntity(world, e)),
	}));
}

export function pasteClipboard(world: EngineWorld) {
	if (clipboard.length === 0) return;

	const c = world.components;
	const selection = [...query(world, [c.Selected, Or(c.Scene, c.Group)])];
	const targetParentEid = selection[0] ?? null;

	world.history.transaction('Paste', () => {
		const copyRootEids: number[] = [];

		for (const snapshot of clipboard) {
			const result = cloneFromRecords(world, stripMountIdentity(snapshot.records));
			const rootCopyEid = result.get(snapshot.root);
			if (!rootCopyEid || (!hasComponent(world, rootCopyEid, c.Geometry) && !hasComponent(world, rootCopyEid, c.Group))) continue;

			copyRootEids.push(rootCopyEid);

			const currentParentEid = getParentEntity(world, rootCopyEid);

			if (currentParentEid !== null) {
				removeChild(world, rootCopyEid, currentParentEid);
			}
			if (targetParentEid !== null) {
				appendChild(world, rootCopyEid, targetParentEid);
			}
		}

		clearComponent(world, c.Selected, false);

		copyRootEids.forEach(eid => addComponent(world, eid, c.Selected, false));
	});
}

export function duplicateSelection(world: EngineWorld, { offset = true }: { offset?: boolean } = {}) {
	const c = world.components;
	const selection = [...query(world, [c.Selected, Or(c.Geometry, c.Group)])];
	if (selection.length === 0) return;

	const snapshots = selection.map(eid => ({
		root: eid,
		tree: getEntityTree(world, eid),
	}));

	world.history.transaction('Duplicate', () => {
		const copyRootEids: number[] = [];
		for (const snapshot of snapshots) {
			const result = cloneSubtree(world, snapshot.tree);
			const rootCopyEid = result.get(snapshot.root);
			if (!rootCopyEid || (!hasComponent(world, rootCopyEid, c.Geometry) && !hasComponent(world, rootCopyEid, c.Group))) continue;

			copyRootEids.push(rootCopyEid);

			const currentParentEid = getParentEntity(world, rootCopyEid);
			if (offset && currentParentEid === null) {
				// Source's Computed is populated; the copy's isn't refreshed until the next caching pass.
				const nextX = c.Position.x[rootCopyEid] + c.Computed.width[snapshot.root];
				setComponent(world, rootCopyEid, c.Position, { x: nextX });
			}
		}

		clearComponent(world, c.Selected, false);

		copyRootEids.forEach(eid => addComponent(world, eid, c.Selected, false));
	});
}
