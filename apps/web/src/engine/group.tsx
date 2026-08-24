/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Group as GroupElement, Sequence as SequenceElement } from '@diffusionstudio/reconciler';
import {
	AdjustmentLayer,
	Computed,
	Flip,
	FrameRate,
	Geometry,
	Group,
	IsMask,
	Selected,
	Sequential,
	Skew,
	computeLocalMatrix,
	decompose2D,
	entityAnchor,
	entityLocalMat,
	entityOffset,
	framesToSeconds,
	getEntityChildren,
	getNextName,
	getParentEntity,
	getTimelineOrigin,
	multiply2D,
	store,
	translate2D,
} from '@diffusionstudio/runtime';
import { Not, Or } from 'koota';

import { getDocumentEditor } from './editor';
import { editTransform } from './input/interactions';
import { syncKeyframe } from './keyframes';
import { resolveNewSequenceOverlaps } from './overlap';
import { authoredTime } from './timing';

import type { TransformWrite } from './input/interactions';
import type { Mat2D } from '@diffusionstudio/runtime';
import type { Entity, World } from 'koota';

/** The node kinds a group holds; a mask belongs to its target, not the group. */
const NODES = Or(Geometry, Group, AdjustmentLayer);

const EPSILON = 1e-6;

const round2 = (value: number): number => Math.round(value * 100) / 100;
const round4 = (value: number): number => Math.round(value * 10000) / 10000;

/** Whether `mat` is close enough to the identity for a bake to write nothing. */
function isIdentity(mat: Mat2D): boolean {
	return Math.abs(mat.a - 1) < EPSILON && Math.abs(mat.b) < EPSILON
		&& Math.abs(mat.c) < EPSILON && Math.abs(mat.d - 1) < EPSILON
		&& Math.abs(mat.e) < EPSILON && Math.abs(mat.f) < EPSILON;
}

/**
 * Puts the selection into a new group where it stands. The group is authored
 * with no transform of its own, so the members keep the coordinates they had
 * and nothing moves; its box is derived from theirs (see `computeGroupBounds`),
 * so there is no size to author either. Only the members sharing the first
 * one's parent go in — a wrap has one place to put things (see `wrap`). The
 * selection moves to the group.
 */
export function groupSelection(world: World): void {
	const editor = getDocumentEditor(world);
	const selected = [...world.query(Selected, NODES, Not(IsMask))];
	if (!selected.length) return;

	const group = editor.wrap(selected, () => <GroupElement name={getNextName(world, 'Group')} />);
	if (group) editor.select(group);
}

/**
 * Puts the selection into a new sequence where it stands, the wrap `split`
 * makes for a cut clip's halves. A sequence has no space or time of its own,
 * so the members keep both their position and their start; what it does have
 * is the rule that its children cannot overlap in time, so members that did
 * are settled the way a sequence that has just been made is always settled —
 * the earlier clip keeps what it has and the later one gives way (see
 * `resolveNewSequenceOverlaps`). The selection moves to the sequence.
 */
export function wrapSelectionInSequence(world: World): void {
	const editor = getDocumentEditor(world);
	const selected = [...world.query(Selected, NODES, Not(IsMask))];
	if (!selected.length) return;

	const sequence = editor.wrap(selected, () => <SequenceElement name={getNextName(world, 'Sequence')} />);
	if (!sequence) return;

	resolveNewSequenceOverlaps(world, sequence);
	editor.select(sequence);
}

/**
 * How far the group's own timeline sits from its parent's, in frames: what
 * has to be added to a child's authored times for it to play at the same
 * moment once the group is gone. Zero for any group that was never slid
 * along the timeline.
 */
function timelineShift(world: World, group: Entity): number {
	return (store(world, Computed).origin[group.id()] ?? 0) - getTimelineOrigin(group);
}

/**
 * Dissolves every selected group, sequences included: a sequence is a group
 * without spatial identity of its own (see the Sequential observer), so the
 * one bake covers both — for a sequence it finds the identity and writes
 * nothing.
 */
export function ungroupSelection(world: World): void {
	dissolveContainers(world, [...world.query(Selected, Group)]);
}

/** Dissolves only the selected sequences, the inverse of the wrap above. */
export function unwrapSequenceSelection(world: World): void {
	dissolveContainers(world, [...world.query(Selected, Sequential)]);
}

/**
 * Dissolves each container: the children move out into the container's
 * parent, in front of where it stood and in the order they were in, and the
 * container goes away. Whatever transform it had is baked into each child
 * first — composed onto the child's local matrix and decomposed back into
 * `x`/`y`/`rotation`/`scale`, the way `resizeNode` spells a scaled child —
 * so the canvas shows the same picture without it. A shear the bake produces
 * (a rotated child in a non-uniformly scaled group) has no JSX spelling;
 * like the resize gesture, it goes to the `Skew` trait alone. A container
 * slid along the timeline hands its offset to the children's times the same
 * way. The selection moves to the released children.
 */
function dissolveContainers(world: World, containers: Entity[]): void {
	if (!containers.length) return;

	const editor = getDocumentEditor(world);
	const computed = store(world, Computed);
	const flip = store(world, Flip);
	const released: Entity[] = [];

	for (const group of containers) {
		if (!group.isAlive()) continue;
		const parent = getParentEntity(group);
		if (!parent) continue;

		// The group's transform as drawn right now, motion included — rebuilt
		// rather than read, since an adjustment layer composes itself into the
		// stored matrix of the clip below it.
		computeLocalMatrix(world, group);
		const groupLocal = entityLocalMat(world, group);
		const bake = !isIdentity(groupLocal);
		const shift = timelineShift(world, group);

		const children = getEntityChildren(world, group).filter(
			(child) => (child.has(Geometry) || child.has(Group) || child.has(AdjustmentLayer)) && !child.has(IsMask),
		);

		for (const child of children) {
			const writes: TransformWrite[] = [];
			let scale: { x: number; y: number } | null = null;
			let skew: { x: number; y: number } | null = null;
			const cid = child.id();

			if (bake) {
				computeLocalMatrix(world, child);
				const anchor = entityAnchor(world, child);
				const pivotX = anchor.x * (computed.width[cid] ?? 0);
				const pivotY = anchor.y * (computed.height[cid] ?? 0);

				// The pivot folded in before decomposing, as `resizeNode` folds
				// it: the translation that comes out is position + pivot, clear
				// of the (I - L)·pivot term the local matrix wraps around it.
				const composed = multiply2D(
					multiply2D(groupLocal, entityLocalMat(world, child)),
					translate2D(pivotX, pivotY),
				);
				const decomposed = decompose2D(composed);
				const offset = entityOffset(world, child);

				const x = Math.round(decomposed.x - pivotX - offset.x);
				const y = Math.round(decomposed.y - pivotY - offset.y);
				const rotation = round2(decomposed.rotation);
				if (x !== Math.round(computed.positionX[cid] ?? 0)) writes.push(['x', x]);
				if (y !== Math.round(computed.positionY[cid] ?? 0)) writes.push(['y', y]);
				if (rotation !== round2(computed.rotation[cid] ?? 0)) writes.push(['rotation', rotation]);

				// The decomposed scale carries the flip the local matrix folded
				// in; divided back out, since the trait keeps holding it.
				const scaleX = round4(decomposed.scaleX / (flip.x[cid] ?? 1));
				const scaleY = round4(decomposed.scaleY / (flip.y[cid] ?? 1));
				if (scaleX !== round4(computed.scaleX[cid] ?? 1) || scaleY !== round4(computed.scaleY[cid] ?? 1)) {
					scale = { x: scaleX, y: scaleY };
				}

				const skewX = round2(decomposed.skewX);
				const skewY = round2(decomposed.skewY);
				if (skewX !== round2(computed.skewX[cid] ?? 0) || skewY !== round2(computed.skewY[cid] ?? 0)) {
					skew = { x: skewX, y: skewY };
				}
			}

			if (!editor.reparent(child, parent, group)) continue;
			released.push(child);

			if (writes.length) editTransform(world, editor, child, writes);

			if (scale) {
				// The scale-row's spelling: one uniform `scale`, or the two axes
				// with whichever of the two forms it replaces unset.
				if (Math.abs(scale.x - scale.y) < EPSILON) {
					editor.editProperty(child, 'scaleX', false);
					editor.editProperty(child, 'scaleY', false);
					editor.editProperty(child, 'scale', scale.x === 1 ? false : scale.x);
					syncKeyframe(world, editor, child, 'scale', scale.x);
				} else {
					editor.editProperty(child, 'scale', false);
					editor.editProperty(child, 'scaleX', scale.x);
					editor.editProperty(child, 'scaleY', scale.y);
					syncKeyframe(world, editor, child, 'scaleX', scale.x);
					syncKeyframe(world, editor, child, 'scaleY', scale.y);
				}
			}

			if (skew) {
				// Skew has no JSX spelling, so it is written to the trait alone
				// and lasts until the project is rendered again (see resizeNode).
				child.add(Skew);
				child.set(Skew, skew);
			}

			if (shift !== 0) {
				const fps = world.get(FrameRate)?.value ?? 30;
				const start = (authoredTime(world, child, 'start') ?? 0) + shift;
				editor.editProperty(child, 'start', start === 0 ? false : framesToSeconds(start, fps));
				const end = authoredTime(world, child, 'end');
				if (end !== undefined) editor.editProperty(child, 'end', framesToSeconds(end + shift, fps));
			}
		}

		editor.remove(group);
	}

	if (released.length) editor.select(released);
}
