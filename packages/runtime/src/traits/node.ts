/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from 'koota';

import { GeometryType, PaintType, CaptionType, CaptionAlign } from '../constants';

// Geometric primitive: RECT or TEXT (see GeometryType). Other node-like roles
// (group, audio, scene, caption) are layered on top via tag traits.
export const Geometry = trait({ value: GeometryType.RECT as GeometryType });

// Paint applied to a geometry (or stroke). See PaintType.
export const Paint = trait({ value: PaintType.SOLID as PaintType });

// Tag marking a geometry as a group container. Groups have no Size of their
// own: their Computed.width/height are derived from the local AABB of their
// direct children (see the transform system). They carry transform state
// (Position/Rotation/Scale/...) like any other entity.
export const Group = trait();

// Tag marking a geometry as a scene: a clipped, playable frame. Scenes have a
// fixed Size like any frame; the tag layers playback + clipping on top.
// Scenes are NOT Groups.
export const Scene = trait();

// Tag marking a geometry as an audio clip (no visual rendering).
export const Audio = trait();

export const AdjustmentLayer = trait();

// Tag marking an entity as a mask. Masks are ChildOf their target;
// Cache.masks on the target is derived from IsMask + ChildOf queries.
export const IsMask = trait();

// Tag for shadow sub-entities (distinguishes them from other Effect
// sub-entities in ChildOf queries).
export const Shadow = trait();

// Tag for stroke sub-entities: the entity is the stroke's paint (Paint/Color/
// Opacity/BlendMode like a fill; a missing Paint reads as solid) and carries
// its own StrokeStyle.
export const Stroke = trait();

export const Hidden = trait();

export const ClipsContent = trait();

// Tag for entities whose content is still being generated.
export const Generating = trait();

export const Name = trait({ value: '' });

// Stable identity for entities.
export const Key = trait({ value: '' });

// Where this entity's JSX element is, as `<file>:<key or position>` (see
// SOURCE_ATTR in @diffusionstudio/jsx). Set by the host while a project
// renders; it is what lets a change made in the editor be written back to the
// source that produced the entity. Deliberately not serialized: a copy of an
// entity is not the element it was copied from.
export const Source = trait({ value: '' });

// On entities a `<For>`/`<Index>` body produced: the source of that loop (see
// LOOP_ATTR in @diffusionstudio/jsx). Every iteration shares one Source, so
// this is what tells the editor an element cannot be written to alone and
// which entities are its fellow iterations. Set by the host while a project
// renders and taken off once the loop has been unrolled in the source; not
// serialized, for the same reason Source is not.
export const Loop = trait({ value: '' });

export const AssetId = trait({ value: '' });

// Sibling order under a ChildOf parent.
export const ItemIndex = trait({ value: 0 });

// On a mount's root entity: the compiled module (a SCRIPT asset) that a world
// re-executes to rebuild this mount's reactive graph and runtime hosts.
export const MountScript = trait({ mountId: '', scriptAssetId: '' });

// On every entity a mount materializes: its stable structural key (an index
// path from the mount root), so a re-run in adopt mode can bind to the
// existing entity instead of minting a new one.
export const MountPath = trait({ mountId: '', path: '' });

// Caption preset configuration; only on CAPTION node entities. The transcript
// is either a standalone TRANSCRIPT asset or embedded in an AUDIO/VIDEO
// asset, referenced via AssetId.
export const Caption = trait({
	type: CaptionType.CLASSIC as CaptionType,
	colors: () => [] as number[],
	verticalAlign: undefined as CaptionAlign | undefined, // unset = the preset's default
});
