/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { query, Or } from 'bitecs';
import { GeometryType, PaintType } from '../components';
import { aabbFromTransformedRect } from '../math';
import { getParentEntity, switchActiveScene } from './base';
import { getNextName, isScene } from './query';
import { createEntity } from './entities';
import { addComponent, clearComponent, setComponent } from './events';
import { appendChild, removeChild } from './hierarchy';
import { resizeEntity } from './resize';
import { computeLocalMatrix } from '../systems/transform';

import type { EngineWorld } from './world';
import type { Mat2D } from '../math';

/**
 * Wrap the current node selection in a new SCENE (a clipped, playable frame).
 * Mirrors `groupSelection`, but the wrapper is a Scene with its own fixed Size
 * derived from the selection's bounding box, plus the clipping/playback/fill a
 * scene needs. Already-existing scenes in the selection are skipped — scenes
 * can't be nested. Children's positions are rewritten into the scene's local
 * space so their on-canvas position is preserved. Returns the new scene's
 * entity id, or null if there was nothing to frame.
 */
export function frameSelection(world: EngineWorld): number | null {
	const c = world.components;
	const selection = [...query(world, [c.Selected, Or(c.Geometry, c.Group)])]
		.filter(eid => !isScene(world, eid));
	if (selection.length === 0) return null;

	const sceneEid = world.history.transaction('Framing selection', () => {
		const targetParent = getParentEntity(world, selection[0]);
		const frameables = selection.filter(eid => getParentEntity(world, eid) === targetParent);

		// Bounding box of children in target-parent local space.
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const eid of frameables) {
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

		const x = Math.round(minX);
		const y = Math.round(minY);
		const width = Math.max(1, Math.round(maxX - minX));
		const height = Math.max(1, Math.round(maxY - minY));

		// A scene is a RECT geometry carrying the Scene/ClipsContent/Playback
		// tags plus a solid fill — same recipe the scene draw tool uses.
		const eid = createEntity(world);
		setComponent(world, eid, c.Geometry, GeometryType.RECT);
		addComponent(world, eid, c.Scene);
		addComponent(world, eid, c.ClipsContent);
		setComponent(world, eid, c.Playback, {});
		setComponent(world, eid, c.Name, getNextName(world, 'Scene'));
		setComponent(world, eid, c.Position, { x, y });
		if (targetParent) appendChild(world, eid, targetParent);
		resizeEntity(world, eid, { width, height });

		const fillEid = createEntity(world);
		setComponent(world, fillEid, c.Paint, PaintType.SOLID);
		setComponent(world, fillEid, c.Color, 0x000000);
		appendChild(world, fillEid, eid);

		for (const child of frameables) {
			const prevX = c.Position.x[child] ?? 0;
			const prevY = c.Position.y[child] ?? 0;
			const parentEid = getParentEntity(world, child);
			if (parentEid) removeChild(world, child, parentEid);
			appendChild(world, child, eid);
			setComponent(world, child, c.Position, { x: prevX - x, y: prevY - y });
			// Refresh the child's cached local matrix now; the next transform pass
			// re-derives world transforms from it.
			computeLocalMatrix(world, child);
		}

		clearComponent(world, c.Selected, false);
		addComponent(world, eid, c.Selected, false);
		switchActiveScene(world, eid);

		return eid;
	});

	// Make the freshly created frame the active scene (mirrors the scene tool),
	// so the timeline retargets to it. Done outside history — active-scene state
	// isn't part of the undo stack.
	if (sceneEid !== null) switchActiveScene(world, sceneEid);

	return sceneEid;
}
