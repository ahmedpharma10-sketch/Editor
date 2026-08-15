/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { query, getRelationTargets, Not, getAllEntities } from "bitecs";
import { getCssVar } from "@/utils/browser";
import { rgbToColor } from "@/utils/color";
import { deserializeEntity } from "./serialize";
import { ChildOf } from "../components/relations";
import { restoreFonts } from "../font/utils";
import * as tl from '../timeline';
import { createEntity, deleteEntity } from "./entities";
import { assert } from "@/utils";
import { syncInteractiveState } from "./utils";
import { isScene } from "./query";
import { restoreAssets } from "./assets";
import { restoreFolders } from "./folders";

import type { EngineWorld } from "./world";
import type { DBEntity, Camera2D } from "../types";

/** Serialized world-level state (camera + background). */
export type DBWorldState = {
	camera: Camera2D;
	background: number;
};

export function getParentEntity(world: EngineWorld, eid: number | null | undefined): number | null {
	if (!eid) return null;

	const targets = getRelationTargets(world, eid, ChildOf);
	if (targets.length === 0) return null;
	return targets[0];
}

export function getSiblingEntities(world: EngineWorld, eid: number, component: unknown): number[] {
	const c = world.components;

	const parentEid = getParentEntity(world, eid);
	if (parentEid === null) return [];
	const children = [...query(world, [ChildOf(parentEid), Not(c.Deleted), component])];

	return children;
}

/**
 * Placeholder: projects are held purely in memory. Hook project (JSX package)
 * persistence of camera + background in here once it lands.
 */
export function persistWorldState(_world: EngineWorld): void { }

/** Placeholder loader for entity records; projects are in memory only. */
async function loadEntityRecords(_world: EngineWorld): Promise<DBEntity[]> {
	return [];
}

/** Placeholder loader for the world record; projects are in memory only. */
async function loadWorldRecord(_world: EngineWorld): Promise<DBWorldState | undefined> {
	return undefined;
}

/**
 * Restores a world from its persisted records. Projects are currently held
 * purely in memory, so this boots an empty world; `records` / `worldRecord`
 * are placeholders for the upcoming project (JSX package) loader.
 */
export async function restoreWorld(world: EngineWorld) {
	assert(getAllEntities(world).length === 0, 'World is not empty');

	const [records, worldRecord] = await Promise.all([
		loadEntityRecords(world),
		loadWorldRecord(world),
	]);

	await Promise.all([
		restoreAssets(world),
		restoreFolders(world),
		restoreFonts(world),
	]);

	const cam = worldRecord?.camera;
	const cameraValid = !!cam
		&& [cam.a, cam.b, cam.c, cam.d, cam.e, cam.f].every(Number.isFinite)
		&& cam.a > 0 && cam.d > 0;

	if (cameraValid) {
		world.camera.a = cam.a;
		world.camera.b = cam.b;
		world.camera.c = cam.c;
		world.camera.d = cam.d;
		world.camera.e = cam.e;
		world.camera.f = cam.f;
	} else {
		world.camera.a = 1;
		world.camera.b = 0;
		world.camera.c = 0;
		world.camera.d = 1;
		world.camera.e = 0;
		world.camera.f = 0;
	}

	if (worldRecord) {
		world.background = worldRecord.background;
	} else {
		const { r, g, b } = getCssVar('--color-canvas').toRgb();
		world.background = rgbToColor(r, g, b);
	}

	// Bitecs hands out fresh sequential eids after resetWorld, but the record
	// key is the entity's eid — so to keep records stable across reloads we
	// restore each entity at the exact eid it was saved under. Fill the gap
	// eids with placeholder entities up to the max stored eid, then remove
	// them once the real ones are deserialized.
	const liveEids = new Set(records.map(r => r.eid));
	const maxEid = records.length ? Math.max(...records.map(r => r.eid)) : 0;

	// Loading a project must never populate the undo stack: deserialize
	// untracked, then clear so the first undo can't unwind the boot.
	world.history.untrack(() => {
		const placeholders: number[] = [];
		for (let i = 1; i <= maxEid; i++) {
			const eid = createEntity(world);
			if (!liveEids.has(eid)) placeholders.push(eid);
		}

		for (const record of records) {
			try {
				const copy = { ...record };
				if (copy.ChildOf !== undefined && !liveEids.has(copy.ChildOf)) {
					// Parent entity is missing from the records — make this entity
					// top-level rather than letting the ChildOf dangle into a
					// placeholder slot that's about to be removed.
					delete copy.ChildOf;
				}
				deserializeEntity(world, record.eid, copy);
			} catch (error) {
				deleteEntity(world, record.eid);
				console.error(error);
			}
		}

		for (const eid of placeholders) {
			deleteEntity(world, eid);
		}
	});

	world.history.clear();

	syncInteractiveState(world);
}

export function switchActiveScene(world: EngineWorld, eid: number | null): void {
	if (eid !== null) {
		assert(isScene(world, eid), "Entity is not a scene");
	}

	if (eid === world.selection.scene) {
		return;
	}

	world.selection.scene = eid;

	tl.clearAudioBuffers();
	tl.clearVideoBuffers();
	tl.clearImageThumbnailCache();
	tl.updateTimelineTransform(world);
	world.rebuildTimelineIndex();
}
