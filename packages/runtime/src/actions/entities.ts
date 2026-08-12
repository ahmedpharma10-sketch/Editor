/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Entity lifecycle actions (was api/entities.ts). No history layer here: the
// app records undo entries by observing koota add/remove/change events.

import { DEFAULT_DURATION_FRAMES } from '../constants';
import { ChildOf, Computed, Cache, Deleted } from '../traits';
import { getDocument, getEntityTree } from '../queries/hierarchy';

import type { Entity, World } from 'koota';

/**
 * Spawn an empty document entity. Computed/Cache are pre-attached (systems
 * index into their stores unconditionally), and the entity starts as a child
 * of the document root, i.e. top-level, until appendChild re-parents it.
 */
export function createEntity(world: World): Entity {
	return world.spawn(
		// Overrides where the neutral trait default differs from the values a
		// fresh unparented entity must render with.
		Computed({
			width: 300,
			height: 300,
			strokeWidth: 1,
			end: DEFAULT_DURATION_FRAMES,
			duration: DEFAULT_DURATION_FRAMES,
		}),
		Cache,
		ChildOf(getDocument(world)),
	);
}

/**
 * Soft-delete an entity and its subtree: tag with Deleted so queries skip it
 * but undo can resurrect it. Hard destruction happens when the app prunes
 * tombstones (or the document root is destroyed).
 */
export function deleteEntity(world: World, entity: Entity) {
	for (const e of getEntityTree(world, entity)) {
		e.add(Deleted);
	}
}
