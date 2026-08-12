/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Runtime-owned invariants as koota event subscriptions (was the runtime half
// of api/observers.ts): cache upkeep on ChildOf changes, authored-to-Computed
// mirrors, and time-range reactions. Registered by createRuntimeWorld, so
// deserialization and clones prime Cache/Computed through the same path as
// actions. App-side duties of the bitecs observers (persistence, timeline
// index, interactive state, selection styling, drag origins) and media
// disposal hooks are layered on by their owners.
//
// Keyframe auto-sync on authored edits deliberately did not move here: koota
// change events don't say which field changed, and syncing every field of a
// trait would mint spurious keyframes on untouched properties. Editing
// surfaces call syncKeyframeTrack for the property they changed (resizeEntity
// already does for width/height).

import { store } from './store';
import {
	ChildOf, Deleted, Culled, Sequential, Group, Scene, Audio, Paint, AssetId,
	Delay, PlaybackRate, Trim, Keyframe, ItemIndex,
	Position, Offset, Rotation, Scale, UniformScale, Skew, Anchor, Flip,
	Appearance, Color, Blur, Volume, Effect, CornerRadius, MixedCornerRadius,
	ColorStop, StrokeStyle, Size, Computed,
} from '../traits';
import { getParentEntity } from '../queries/hierarchy';
import { rebuildCaches } from '../actions/cache';
import {
	disposeDecoders, disposeHtmlHosts, disposeSurfaceHosts, disposeShaderHosts,
	disconnectAudioBus,
} from '../media/dispose';
import {
	reactToChildAttached, reactToChildDetached, reactToAssetChange,
	reactToPaintChange, recomputeEntityTimeRange, propagateTimeRangeDown,
	bubbleTimeRangeUp, clampTrimToAssetDuration,
} from '../actions/timing';
import { propagateSize, resolveConstraintOffsets } from '../actions/resize';

import type { Entity, Trait, World } from 'koota';

/**
 * Wire the runtime invariants into a world. Returns a disposer (worlds are
 * normally destroyed outright, but tests recycling the 16-world budget can
 * unhook explicitly).
 */
export function observeWorld(world: World): () => void {
	const subs: (() => void)[] = [];

	// ── Structure ─────────────────────────────────────────────

	subs.push(world.onAdd(ChildOf('*'), (child, parent) => {
		rebuildCaches(world, child, parent);
		propagateSize(world, child);
		resolveConstraintOffsets(world, child);
		disconnectAudioBus(world, child);
		reactToChildAttached(world, child);
	}));

	// On re-target (and destroy) the remove event fires while the child is
	// still present in the old parent's queries, so it is excluded by hand.
	subs.push(world.onRemove(ChildOf('*'), (child, parent) => {
		rebuildCaches(world, child, parent, child);
		disconnectAudioBus(world, child);
	}));

	subs.push(world.onAdd(Deleted, (entity) => {
		// The Not(Deleted) cache queries already skip the tombstone.
		rebuildCaches(world, entity, getParentEntity(entity));
		reactToChildDetached(world, entity);
		// A tombstoned subtree keeps its records for undo, but its live media
		// handles must not linger.
		disposeDecoders(world, entity);
		disposeHtmlHosts(world, entity);
		disposeSurfaceHosts(world, entity);
		disposeShaderHosts(world, entity);
		disconnectAudioBus(world, entity);
	}));

	// Off-screen entities release their decoders (frame caches are the bulk
	// of media memory); the next resolve recreates them.
	subs.push(world.onAdd(Culled, (entity) => {
		disposeDecoders(world, entity);
	}));

	subs.push(world.onRemove(Deleted, (entity) => {
		rebuildCaches(world, entity, getParentEntity(entity));
	}));

	// Keyframes re-sort by frame, siblings re-sort by index.
	subs.push(world.onChange(Keyframe, (entity) => {
		rebuildCaches(world, entity, getParentEntity(entity));
	}));

	subs.push(world.onChange(ItemIndex, (entity) => {
		rebuildCaches(world, entity, getParentEntity(entity));
	}));

	// ── Model invariants ──────────────────────────────────────

	// A sequence is a group without spatial identity of its own.
	subs.push(world.onAdd(Sequential, (entity) => {
		entity.add(Group);
		entity.remove(Position, Offset, Rotation, Scale, Skew, Anchor, Flip);
	}));

	// First Trim on an entity defaults its end to the current duration (the
	// bitecs setComponent fallback), so a partial { start } set stays valid.
	subs.push(world.onAdd(Trim, (entity) => {
		if (entity.get(Trim)!.end === 0) {
			entity.set(Trim, { end: store(world, Computed).duration[entity.id()] ?? 0 });
		}
	}));

	// ── Time ranges ───────────────────────────────────────────

	const recomputeAndBubble = (entity: Entity) => {
		recomputeEntityTimeRange(world, entity);
		bubbleTimeRangeUp(world, entity);
	};

	subs.push(world.onAdd(Group, recomputeAndBubble));
	subs.push(world.onAdd(Scene, recomputeAndBubble));
	subs.push(world.onAdd(Audio, recomputeAndBubble));

	subs.push(world.onChange(Paint, (entity) => {
		reactToPaintChange(world, entity);
	}));

	subs.push(world.onChange(AssetId, (entity) => {
		reactToAssetChange(world, entity);
	}));

	const propagateAndBubble = (entity: Entity) => {
		propagateTimeRangeDown(world, entity);
		bubbleTimeRangeUp(world, entity);
	};

	subs.push(world.onChange(Delay, propagateAndBubble));
	subs.push(world.onChange(PlaybackRate, propagateAndBubble));

	subs.push(world.onChange(Trim, (entity) => {
		// Clamping re-enters this handler once via set; the second pass no-ops.
		clampTrimToAssetDuration(world, entity);
		recomputeAndBubble(entity);
	}));

	subs.push(world.onRemove(Trim, recomputeAndBubble));

	// ── Authored → Computed mirrors ───────────────────────────
	// Base values for entities the motion system skips (no animation data);
	// animated entities re-derive them every frame via resetAnimatedValues.
	// Registered on add and change so both spawn-with-value and add-then-set
	// arrive in Computed. Trait removal does not reset (same as bitecs).

	const mirror = (trait: Trait, apply: (entity: Entity) => void) => {
		subs.push(world.onAdd(trait, apply));
		subs.push(world.onChange(trait, apply));
	};

	mirror(Position, (entity) => {
		const computed = store(world, Computed);
		const { x, y } = entity.get(Position)!;
		computed.positionX[entity.id()] = x;
		computed.positionY[entity.id()] = y;
	});

	mirror(Offset, (entity) => {
		const computed = store(world, Computed);
		const { x, y } = entity.get(Offset)!;
		computed.offsetX[entity.id()] = x;
		computed.offsetY[entity.id()] = y;
	});

	mirror(Rotation, (entity) => {
		store(world, Computed).rotation[entity.id()] = entity.get(Rotation)!.value;
	});

	mirror(Scale, (entity) => {
		const computed = store(world, Computed);
		const { x, y } = entity.get(Scale)!;
		computed.scaleX[entity.id()] = x;
		computed.scaleY[entity.id()] = y;
	});

	mirror(UniformScale, (entity) => {
		const computed = store(world, Computed);
		const { value } = entity.get(UniformScale)!;
		computed.scaleX[entity.id()] = value;
		computed.scaleY[entity.id()] = value;
	});

	mirror(Skew, (entity) => {
		const computed = store(world, Computed);
		const { x, y } = entity.get(Skew)!;
		computed.skewX[entity.id()] = x;
		computed.skewY[entity.id()] = y;
	});

	mirror(Appearance, (entity) => {
		store(world, Computed).opacity[entity.id()] = entity.get(Appearance)!.opacity;
	});

	mirror(Color, (entity) => {
		store(world, Computed).color[entity.id()] = entity.get(Color)!.value;
	});

	mirror(Blur, (entity) => {
		store(world, Computed).blur[entity.id()] = entity.get(Blur)!.value;
	});

	mirror(Volume, (entity) => {
		store(world, Computed).volume[entity.id()] = entity.get(Volume)!.value;
	});

	mirror(Effect, (entity) => {
		store(world, Computed).value[entity.id()] = entity.get(Effect)!.value;
	});

	mirror(CornerRadius, (entity) => {
		store(world, Computed).cornerRadius[entity.id()] = entity.get(CornerRadius)!.value;
	});

	mirror(MixedCornerRadius, (entity) => {
		const computed = store(world, Computed);
		const radius = entity.get(MixedCornerRadius)!;
		computed.cornerRadiusTopLeft[entity.id()] = radius.topLeft;
		computed.cornerRadiusTopRight[entity.id()] = radius.topRight;
		computed.cornerRadiusBottomRight[entity.id()] = radius.bottomRight;
		computed.cornerRadiusBottomLeft[entity.id()] = radius.bottomLeft;
	});

	mirror(ColorStop, (entity) => {
		const computed = store(world, Computed);
		const stop = entity.get(ColorStop)!;
		computed.stopOffset[entity.id()] = stop.offset;
		computed.stopColor[entity.id()] = stop.color;
		computed.stopOpacity[entity.id()] = stop.opacity;
	});

	mirror(StrokeStyle, (entity) => {
		store(world, Computed).strokeWidth[entity.id()] = entity.get(StrokeStyle)!.width;
	});

	// Size flows into Computed via propagation (descendants owning a Size
	// re-derive too). bitecs restored sizes through resizeEntity; deserialize
	// is a plain set now, so the propagation rides on the event instead.
	mirror(Size, (entity) => {
		propagateSize(world, entity);
	});

	return () => {
		for (const unsubscribe of subs) unsubscribe();
	};
}
