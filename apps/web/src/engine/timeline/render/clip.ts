/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Caption, CaptionType, Chars, ClipDragOrigin, Computed, Generating, Hidden, Name, Selected, SourceError, TrimDragOrigin, fitsChildren, getGeneratingColor, isCaption, isGroup, isText, store } from '@diffusionstudio/runtime';

import { getDocumentEditor } from '../../editor';
import {
	CLIP_BREAKPOINTS,
	CLIP_CORNER_RADIUS,
	CLIP_FONT,
	CLIP_LABEL_X,
	CLIP_LABEL_Y,
	CLIP_LABEL_HEIGHT,
	TRIM_HANDLE_WIDTH,
} from '../config';
import { applyClipDrag, applyTrim, beginClipDrag, beginTrim } from '../drag';
import { getClipAsset, getClipStyle } from '../style';
import { truncateText } from '../text';
import { framesToPixels, getResolution, getViewport } from '../view';
import { renderCaption } from './caption';
import { renderGroup } from './group';
import { renderThumbnails } from './thumbnails';
import { renderWaveform } from './waveform';

import type { Entity, World } from 'koota';
import type { Asset } from '@diffusionstudio/assets';
import type { ClipStyle } from '../style';
import type { RowCursor } from '../layout';
import type { TimelineSurfaceState } from '../surface';

/**
 * One clip: its body, what it holds, its label and its border, plus the
 * selection gestures that belong to its rectangle. The context is already
 * translated to the top of the row it is in, so everything here is drawn from
 * y = 0 and the row's own height.
 */
export function renderClip(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	entity: Entity,
	row: RowCursor,
): void {
	const { ctx, pointer } = surface;
	if (!ctx || !pointer) return;

	const computed = store(world, Computed);
	const resolution = getResolution(world, scene);

	let left = framesToPixels(computed.start[entity.id()] ?? 0, resolution);
	const width = framesToPixels(computed.end[entity.id()] ?? 0, resolution) - left;

	// Every region of this clip is scoped to it, so two clips at the same
	// place on two rows are told apart by the pointer.
	pointer.scope(String(entity.id()));

	const asset = getClipAsset(world, entity);
	const failed = entity.has(SourceError);
	const style = getClipStyle(entity, asset);

	handleBody(world, surface, entity, left, width, row, resolution);

	// A drag that has just moved the clip has moved where it is drawn, so the
	// left edge is read again; the width does not change with it.
	if (entity.has(ClipDragOrigin)) {
		left = framesToPixels(computed.start[entity.id()] ?? 0, resolution);
	}

	const generating = entity.has(Generating);

	ctx.save();
	ctx.beginPath();
	ctx.roundRect(left, 0, width, row.height, CLIP_CORNER_RADIUS);
	ctx.fillStyle = generating ? getGeneratingColor(world) : style.background;
	ctx.fill();
	ctx.restore();

	if (!generating && !failed) {
		renderContent(world, scene, surface, entity, asset, style, row);
	}

	renderLabel(world, scene, surface, entity, style.foreground, left, width, row);

	// Last, so it sits over whatever the clip drew inside itself.
	const selected = entity.has(Selected);

	ctx.save();
	ctx.beginPath();
	ctx.roundRect(left, 0, width, row.height, CLIP_CORNER_RADIUS);
	ctx.clip();
	ctx.strokeStyle = selected ? surface.colors.border.ring : surface.colors.border.darker;
	ctx.lineWidth = selected ? 2 : 1;
	ctx.stroke();
	ctx.restore();

	handleTrim(world, surface, entity, left, width, row, resolution);
}

/**
 * The handles at either end of the clip. They sit inside its edges rather
 * than straddling them, so a clip is always grabbable in the middle however
 * narrow it is — a third of the clip at most, and never more than half, or a
 * short clip would be nothing but handles.
 */
function handleTrim(
	world: World,
	surface: TimelineSurfaceState,
	entity: Entity,
	left: number,
	width: number,
	row: RowCursor,
	resolution: number,
): void {
	// A container that takes its bounds from its children has no edge of its
	// own to take hold of — moving one would be moving a child. One that
	// authors its own end does, and is trimmed like any other clip.
	if (fitsChildren(entity)) return;

	const pointer = surface.pointer!;
	const handle = Math.min(Math.max(width / 3, 3), width / 2, TRIM_HANDLE_WIDTH);

	const inHandle = pointer.region(left, 0, handle, row.height);
	const outHandle = pointer.region(left + width - handle, 0, handle, row.height);

	// The cursor points into the clip, at the frames the handle would take.
	if (inHandle.hovering || inHandle.dragging) surface.cursor = 'trim-right';
	else if (outHandle.hovering || outHandle.dragging) surface.cursor = 'trim-left';

	const edge = inHandle.dragging ? 'in' : outHandle.dragging ? 'out' : null;
	if (edge === null) return;

	if (!entity.has(TrimDragOrigin)) beginTrim(world, entity);

	applyTrim(world, surface, entity, edge, resolution);
}

/**
 * What the clip holds, drawn inside it: what a group has in it, the picture
 * of a still, the audio of a sound, the words of a caption. Each is clipped
 * to the clip's own body by the border that is drawn over it afterwards.
 */
function renderContent(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	entity: Entity,
	asset: Asset | null,
	style: ClipStyle,
	row: RowCursor,
): void {
	if (isGroup(entity)) {
		renderGroup(world, scene, surface, entity, row);
		return;
	}

	if (isCaption(entity)) {
		renderCaption(world, scene, surface, entity, row);
		return;
	}

	// Too short a row to hold anything but its label.
	const tall = row.height > CLIP_BREAKPOINTS.sm;

	switch (asset?.type) {
		case 'IMAGE':
		case 'SEQUENCE':
			if (tall) renderThumbnails(world, scene, surface, entity, asset, row);
			return;

		case 'AUDIO':
			renderWaveform(world, scene, surface, entity, row, {
				color: style.primary ?? style.foreground,
				offsetY: tall ? CLIP_LABEL_HEIGHT : 2,
				padding: 4,
			});
			return;

		case 'VIDEO': {
			// A video shows both: its picture along the top of the row, its
			// sound along the bottom.
			const strip = tall ? Math.round((row.height - CLIP_LABEL_HEIGHT) / 2) : 0;
			if (strip > 0) {
				renderThumbnails(world, scene, surface, entity, asset, row, {
					top: CLIP_LABEL_HEIGHT,
					height: strip,
				});
			}
			renderWaveform(world, scene, surface, entity, row, {
				color: style.primary ?? style.foreground,
				offsetY: tall ? CLIP_LABEL_HEIGHT + strip : 2,
				padding: 2,
			});
			return;
		}
	}
}

/**
 * What the clip's body means: a click selects it, a drag moves it, and while
 * a marquee is out, being under it does the selecting. One region for all
 * three, since they are all the same rectangle — asking twice would make the
 * pointer think there were two of them.
 *
 * Selection is a document property, so it goes through the editor like every
 * other change: a click in the timeline ends up in the file the same way a
 * click on the canvas does.
 */
function handleBody(
	world: World,
	surface: TimelineSurfaceState,
	entity: Entity,
	left: number,
	width: number,
	row: RowCursor,
	resolution: number,
): void {
	const pointer = surface.pointer!;
	const editor = getDocumentEditor(world);

	const { clicked, dragging, intersectsMarquee } = pointer.region(left, 0, width, row.height);
	const selected = entity.has(Selected);

	// A press that travels starts a move. The press selected the clip first,
	// so a drag of an unselected clip moves that one and a drag of a selected
	// one moves everything selected (see `updateDragGestures`).
	if (dragging && !entity.has(ClipDragOrigin) && !entity.has(TrimDragOrigin)) {
		beginClipDrag(world, entity);
	}
	if (entity.has(ClipDragOrigin)) {
		applyClipDrag(world, surface, entity, resolution);
	}

	// While a marquee is out, the clips it covers are the selection: entering
	// it selects and leaving it deselects, so dragging back the way you came
	// undoes what the drag did.
	if (surface.marquee) {
		if (intersectsMarquee && !selected) editor.select(entity, { extend: true });
		if (!intersectsMarquee && selected) editor.deselect(entity);
		return;
	}

	if (!clicked) return;

	if (pointer.shiftPressed) editor.select(entity, { extend: true });
	else editor.select(entity);
}

/**
 * The clip's name, or what a text clip says. Pinned to the left edge of the
 * viewport while the clip runs off it, so a clip longer than the screen is
 * still labelled.
 */
function renderLabel(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	entity: Entity,
	color: string,
	left: number,
	width: number,
	row: RowCursor,
): void {
	const ctx = surface.ctx!;

	// A caption's row is mostly its words; below a certain height the label
	// would be all there is room for, so the words win. One still generating
	// (or one that failed) has no words yet, so there is nothing for the label
	// to crowd out.
	if (
		isCaption(entity) && !entity.has(Generating) && !entity.has(SourceError)
		&& row.height < CLIP_BREAKPOINTS.sm
	) return;

	const label = clipLabel(entity);
	if (!label) return;

	const [viewportLeft] = getViewport(world, scene, surface.layout.width);
	const x = Math.max(left, viewportLeft);
	const maxWidth = left + width - x - 2 * CLIP_LABEL_X;

	ctx.save();
	ctx.translate(x, 0);

	ctx.fillStyle = color;
	ctx.fontStretch = 'ultra-condensed';
	ctx.font = CLIP_FONT;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';

	const fitted = truncateText(ctx, label, maxWidth, CLIP_FONT);
	if (fitted) {
		// Tall enough for the label to sit at the top of the clip; below that
		// there is only the middle.
		ctx.fillText(fitted, CLIP_LABEL_X, row.height >= CLIP_BREAKPOINTS.xs ? CLIP_LABEL_Y : row.height / 2);
	}

	ctx.restore();
}

const CAPTION_PRESETS: Record<CaptionType, string> = {
	[CaptionType.CLASSIC]: 'Classic',
	[CaptionType.CASCADE]: 'Cascade',
	[CaptionType.SPOTLIGHT]: 'Spotlight',
	[CaptionType.WHISPER]: 'Whisper',
	[CaptionType.PAPER]: 'Paper',
	[CaptionType.GUINEA]: 'Guinea',
	[CaptionType.STARK]: 'Stark',
};

/**
 * What the clip calls itself. A plain text clip goes by what it says, and a
 * caption that has not been named goes by its preset — read here rather than
 * written to the entity, which is what the old timeline did: a renderer
 * naming the thing it is drawing is an edit nobody asked for.
 */
function clipLabel(entity: Entity): string {
	const failure = entity.get(SourceError)?.value;
	if (failure) return failure;

	if (entity.has(Generating)) return 'Generating...';

	const name = entity.get(Name)?.value;

	if (isCaption(entity)) {
		return name || `${CAPTION_PRESETS[entity.get(Caption)?.type ?? CaptionType.CLASSIC]} Captions`;
	}

	if (isText(entity)) return entity.get(Chars)?.value ?? name ?? '';

	return name ?? '';
}

/** Whether a clip is drawn faded: hidden nodes still take up their row. */
export function getClipAlpha(entity: Entity): number {
	return entity.has(Hidden) ? 0.5 : 1;
}
