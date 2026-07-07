/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hasComponent, Not, Or, query } from 'bitecs';
import { computeTrimStart, computeTrimEnd } from '../utils';
import { cloneAudioCacheForSplit } from '../timeline/render/audio';
import { cloneThumbnailCacheForSplit } from '../timeline/render/video';
import { cloneSubtree } from './serialize';
import { getParentEntity } from './base';
import { getEntityTree, getNextName, isGroup, isSequence } from './query';
import { ChildOf, PaintType } from '../components';
import { addComponent, clearComponent, removeComponent, setComponent } from './events';
import { createEntity } from './entities';
import { appendChild, removeChild } from './hierarchy';

import type { EngineWorld } from './world';

export function togglePlayback(world: EngineWorld, eid: number | null = world.selection.scene) {
	const c = world.components;

	if (eid === null) return;
	// Playback is an ephemeral component — never recorded in history.
	setComponent(world, eid, c.Playback, {
		playing: Number(!c.Playback.playing[eid]),
		speed: 1,
	}, false);
	world.audio.resume();
}

const MAX_SHUTTLE_SPEED = 3;

export function shuttleForward(world: EngineWorld) {
	const c = world.components;
	const sid = world.selection.scene;
	if (sid === null) return;

	const speed = c.Playback.speed[sid] || 1;

	if (c.Playback.playing[sid] !== 1 || speed < 0) {
		// Start forward playback at 1x
		setComponent(world, sid, c.Playback, { playing: 1, speed: 1 }, false);
	} else {
		// Double the forward speed, capped at max
		setComponent(world, sid, c.Playback, { speed: Math.min(speed * 2, MAX_SHUTTLE_SPEED) }, false);
	}

	world.audio.resume();
}

export function shuttleReverse(world: EngineWorld) {
	const c = world.components;
	const sid = world.selection.scene;
	if (sid === null) return;

	const speed = c.Playback.speed[sid] || 1;

	if (c.Playback.playing[sid] !== 1 || speed > 0) {
		// Start reverse playback at 1x
		setComponent(world, sid, c.Playback, { playing: 1, speed: -1 }, false);
	} else {
		// Double the reverse speed, capped at max
		setComponent(world, sid, c.Playback, { speed: Math.max(speed * 2, -MAX_SHUTTLE_SPEED) }, false);
	}

	world.audio.resume();
}

export function stopPlayback(world: EngineWorld) {
	const c = world.components;
	const sid = world.selection.scene;
	if (sid === null) return;
	setComponent(world, sid, c.Playback, { playing: 0, speed: 1 }, false);
}

export function splitAtPlayhead(world: EngineWorld) {
	const c = world.components;
	const sceneEid = world.selection.scene;
	if (sceneEid === null) return;

	world.history.transaction('Split', () => {
		const splitFrame = c.Computed.localTime[sceneEid];

		// (original, copy) root pairs produced by splitting clips as a unit.
		const pairs: { original: number; copy: number }[] = [];

		// Split a non-sequence clip (a leaf clip or a plain group) as a unit:
		// clone its whole subtree — including all children — then shrink the
		// original to end at the playhead and the copy to start there.
		const splitUnit = (eid: number) => {
			const tree = getEntityTree(world, eid);
			const nextTrimEnd = computeTrimEnd(world, eid, splitFrame);
			const copyTrimStart = computeTrimStart(world, eid, splitFrame);

			// Clone first so the copy inherits the original (un-shrunk) trimEnd.
			const result = cloneSubtree(world, tree);
			const copyEid = result.get(eid);
			if (!copyEid) return;

			// Apply trim to both split roots.
			setComponent(world, eid, c.Trim, { end: nextTrimEnd });
			setComponent(world, copyEid, c.Trim, { start: copyTrimStart });

			cloneAudioCacheForSplit(eid, copyEid);
			cloneThumbnailCacheForSplit(eid, copyEid);

			// Hand the primed video decoder to the copy. The original clip's range
			// now ends at the playhead (no longer in range), while the copy starts
			// there — so the copy is what's about to render. Both share delay and
			// playbackRate, so the decoder's relativeTime is already correct and
			// the copy renders its first frame without a blank/seek flash.
			const fills = query(world, [c.Paint, ChildOf(eid), Not(c.Deleted), Not(c.Hidden)]);
			const origVideoFill = fills.find(fid => c.Paint[fid] === PaintType.VIDEO);
			if (origVideoFill) {
				const decoder = c.VideoDecoder[origVideoFill];
				const copyVideoFill = result.get(origVideoFill);
				if (decoder && copyVideoFill) {
					// Decoder components are flat arrays with no `set` observer, so
					// setComponent would drop the value. Move it by direct assignment.
					addComponent(world, copyVideoFill, c.VideoDecoder, false);
					c.VideoDecoder[copyVideoFill] = decoder;
					removeComponent(world, origVideoFill, c.VideoDecoder, false);
					c.VideoDecoder[origVideoFill] = null;
				}
			}

			const origSequenceFill = fills.find(fid => c.Paint[fid] === PaintType.SEQUENCE);
			if (origSequenceFill) {
				const decoder = c.SequenceDecoder[origSequenceFill];
				const copySequenceFill = result.get(origSequenceFill);
				if (decoder && copySequenceFill) {
					addComponent(world, copySequenceFill, c.SequenceDecoder, false);
					c.SequenceDecoder[copySequenceFill] = decoder;
					removeComponent(world, origSequenceFill, c.SequenceDecoder, false);
					c.SequenceDecoder[origSequenceFill] = null;
				}
			}

			pairs.push({ original: eid, copy: copyEid });
		};

		// Split an entity at the playhead. A sequence can't be trimmed as a unit —
		// its time range is derived from its children — so we descend and split
		// each child the playhead intersects. Everything else (leaf clips, plain
		// groups, scenes) is split as a unit.
		const splitEntity = (eid: number) => {
			if (isSequence(world, eid)) {
				const children = [...query(world, [Or(c.Geometry, c.Group, c.AdjustmentLayer), ChildOf(eid), Not(c.Deleted)])]
					.filter(child => c.Computed.visibility[child] === 1);
				for (const child of children) splitEntity(child);
				return;
			}

			splitUnit(eid);
		};

		// Split the current selection, or — when nothing is selected — every
		// visible clip directly under the active scene. The active scene itself is
		// the editing context, never a split target.
		const selection = [...query(world, [Or(c.Geometry, c.Group, c.AdjustmentLayer), c.Selected])]
			.filter(eid => eid !== sceneEid)
			.filter(eid => c.Computed.visibility[eid] === 1);

		const roots = selection.length > 0
			? selection
			: [...query(world, [Or(c.Geometry, c.Group, c.AdjustmentLayer), ChildOf(sceneEid), Not(c.Deleted)])]
				.filter(eid => c.Computed.visibility[eid] === 1);

		for (const eid of roots) splitEntity(eid);

		// When the split happens outside a group/sequence (e.g. directly on the
		// scene), wrap each (original, copy) pair in a fresh Sequential group so
		// the two halves stay tied together in time.
		for (const { original, copy } of pairs) {
			const parentEid = getParentEntity(world, original);
			// If the parent already wraps children (a group or sequence) the
			// pair is implicitly tied together; only naked clips under a scene
			// need a fresh Sequential wrapper.
			if (parentEid === null || isGroup(world, parentEid) || hasComponent(world, parentEid, c.Sequential)) continue;

			const groupEid = createEntity(world);
			addComponent(world, groupEid, c.Group);
			addComponent(world, groupEid, c.Sequential);
			setComponent(world, groupEid, c.Name, getNextName(world, 'Sequence'));
			if (hasComponent(world, original, c.ClipHeight)) {
				setComponent(world, groupEid, c.ClipHeight, c.ClipHeight[original]);
			}
			appendChild(world, groupEid, parentEid);

			removeChild(world, original, parentEid);
			appendChild(world, original, groupEid);
			removeChild(world, copy, parentEid);
			appendChild(world, copy, groupEid);
		}

		clearComponent(world, c.Selected, false);
		pairs.forEach(({ copy }) => addComponent(world, copy, c.Selected, false));
	});
}
