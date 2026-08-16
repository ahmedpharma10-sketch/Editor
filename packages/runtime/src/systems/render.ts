/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Render system (was systems/render.ts): draws the document tree onto the
// world's RenderSurface. Runs identically against the editor canvas and an
// OffscreenCanvas during capture; without a surface it is a no-op. Hit
// regions are pushed callback-less (see HitRegions); the app's input layer
// attaches its handlers.

import { Not, Or } from 'koota';
import { cubicBezier } from 'animejs';

import { store } from '../world/store';
import {
	COMPOSITE_OPERATIONS, EffectType, GeometryType, PaintType, ScaleModeType,
	StrokeCap, StrokeJoin, TransitionType,
} from '../constants';
import {
	ChildOf, Hidden, Culled, Generating, Interactive, IsMask,
	ClipsContent, Geometry, Group, Paint, Color, Caption, ScaleMode, Shader,
	Appearance, Effect, StrokeStyle, AssetId, Transition, MixedCornerRadius,
	LocalTransform, WorldTransform, Computed, Cache,
	HtmlHostHandle, SurfaceHostHandle,
	Mode, Time, FrameRate, Camera, Background, RenderSurface, Assets,
	HitRegions,
} from '../traits';
import { getDocument, getParentNode } from '../queries/hierarchy';
import { colorToHex } from '../utils/color';
import { renderText } from '../utils/text';
import { getTransitionWindow } from '../utils/transition';
import { createLinearGradient, createRadialGradient } from './gradients';
import {
	resolveImageDecoder, resolveVideoDecoder, resolveSequenceDecoder,
	resolveCaptionDecoder, resolveShaderHost, getAudioPeaks,
} from '../media';

import type { Entity, World } from 'koota';
import type { Quad } from '../math/aabb';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const MISSING_ASSET_COLOR = '#5C2828';

function getCtx(world: World): Ctx2D {
	return world.get(RenderSurface)!.ctx!;
}

export function drawRectPath(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);
	const eid = entity.id();
	const w = computed.width[eid]!;
	const h = computed.height[eid]!;

	const hasMixed = entity.has(MixedCornerRadius);
	let tl = hasMixed ? computed.cornerRadiusTopLeft[eid]! : computed.cornerRadius[eid]!;
	let tr = hasMixed ? computed.cornerRadiusTopRight[eid]! : tl;
	let br = hasMixed ? computed.cornerRadiusBottomRight[eid]! : tl;
	let bl = hasMixed ? computed.cornerRadiusBottomLeft[eid]! : tl;

	ctx.beginPath();

	if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
		ctx.rect(0, 0, w, h);
	} else if (tl === tr && tr === br && br === bl) {
		ctx.roundRect(0, 0, w, h, tl);
	} else {
		// Clamp radii so adjacent corners don't exceed the edge length (CSS spec algorithm)
		const scale = Math.min(
			w / (tl + tr || 1),
			h / (tr + br || 1),
			w / (br + bl || 1),
			h / (bl + tl || 1),
			1,
		);
		if (scale < 1) {
			tl *= scale;
			tr *= scale;
			br *= scale;
			bl *= scale;
		}

		ctx.moveTo(tl, 0);
		ctx.lineTo(w - tr, 0);
		if (tr > 0) ctx.arcTo(w, 0, w, tr, tr);
		else ctx.lineTo(w, 0);
		ctx.lineTo(w, h - br);
		if (br > 0) ctx.arcTo(w, h, w - br, h, br);
		else ctx.lineTo(w, h);
		ctx.lineTo(bl, h);
		if (bl > 0) ctx.arcTo(0, h, 0, h - bl, bl);
		else ctx.lineTo(0, h);
		ctx.lineTo(0, tl);
		if (tl > 0) ctx.arcTo(0, 0, tl, 0, tl);
		else ctx.lineTo(0, 0);
	}

	ctx.closePath();
}

function getScaledImageProps(
	mode: number,
	imgW: number,
	imgH: number,
	targetW: number,
	targetH: number,
): [dx: number, dy: number, sw: number, sh: number] {
	if (mode === ScaleModeType.FILL) {
		return [0, 0, targetW, targetH];
	}
	if (mode === ScaleModeType.FIT) {
		const scale = Math.min(targetW / imgW, targetH / imgH);
		const sw = imgW * scale;
		const sh = imgH * scale;
		return [(targetW - sw) / 2, (targetH - sh) / 2, sw, sh];
	}
	if (mode === ScaleModeType.COVER) {
		const scale = Math.max(targetW / imgW, targetH / imgH);
		const sw = imgW * scale;
		const sh = imgH * scale;
		return [(targetW - sw) / 2, (targetH - sh) / 2, sw, sh];
	}
	// ScaleModeType.NONE — original size
	return [0, 0, imgW, imgH];
}

const EPSILON = 1e-4;

/** Build a single CSS filter fragment from an effect sub-entity. Returns null if hidden or no-op. */
function effectFilter(world: World, sub: Entity): string | null {
	if (sub.has(Hidden)) return null;

	const value = store(world, Computed).value[sub.id()]!;
	const type = store(world, Effect).type[sub.id()] ?? 0;

	if (type === EffectType.LAYER_BLUR) {
		const clamped = Math.max(0, value);
		return clamped > EPSILON ? `blur(${clamped}px)` : null;
	}
	if (type === EffectType.BRIGHTNESS) {
		const clamped = Math.min(1, Math.max(0, value));
		return Math.abs(clamped - 1) > EPSILON ? `brightness(${clamped})` : null;
	}
	if (type === EffectType.CONTRAST) {
		const clamped = Math.min(1, Math.max(0, value));
		return Math.abs(clamped - 1) > EPSILON ? `contrast(${clamped})` : null;
	}
	if (type === EffectType.GRAYSCALE) {
		const clamped = Math.min(1, Math.max(0, value));
		return clamped > EPSILON ? `grayscale(${clamped})` : null;
	}
	if (type === EffectType.HUE_ROTATION) {
		return Math.abs(value) > EPSILON ? `hue-rotate(${value}deg)` : null;
	}
	if (type === EffectType.INVERT) {
		const clamped = Math.min(1, Math.max(0, value));
		return clamped > EPSILON ? `invert(${clamped})` : null;
	}
	if (type === EffectType.SATURATE) {
		const clamped = Math.min(1, Math.max(0, value));
		return Math.abs(clamped - 1) > EPSILON ? `saturate(${clamped})` : null;
	}
	if (type === EffectType.SEPIA) {
		const clamped = Math.min(1, Math.max(0, value));
		return clamped > EPSILON ? `sepia(${clamped})` : null;
	}
	return null;
}

/** CSS filter string from the entity's own blur plus effect sub-entities. */
function buildEffects(world: World, entity: Entity): string | null {
	const parts: string[] = [];

	const blurVal = store(world, Computed).blur[entity.id()]!;
	if (blurVal > EPSILON) {
		parts.push(`blur(${blurVal}px)`);
	}

	const effects = store(world, Cache).effects[entity.id()] ?? [];
	for (const effect of effects) {
		const f = effectFilter(world, effect);
		if (f) parts.push(f);
	}

	if (parts.length === 0) return null;

	return parts.join(' ');
}

/**
 * The geometry's intrinsic solid fill (its own Color trait), if any. Drawn
 * into the current path before the Paint sub-entities so it always sits at
 * the bottom of the fill stack. Reads Computed.color, so it animates.
 */
export function renderIntrinsicFill(world: World, entity: Entity): void {
	if (!entity.has(Color)) return;
	const ctx = getCtx(world);
	ctx.fillStyle = colorToHex(store(world, Computed).color[entity.id()] ?? 0);
	ctx.fill();
}

export function renderFills(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);
	const paintStore = store(world, Paint);
	const appearance = store(world, Appearance);
	const scaleMode = store(world, ScaleMode);
	const eid = entity.id();
	const fills = store(world, Cache).fills[eid] ?? [];

	for (let index = 0; index < fills.length; index++) {
		const fill = fills[index]!;
		if (fill.has(Hidden) || shaderConsumesFill(world, entity, fills, index)) continue;
		const fid = fill.id();
		const savedAlpha = ctx.globalAlpha;
		const savedCO = ctx.globalCompositeOperation;
		const bi = appearance.blendMode[fid] ?? 0;

		if (bi !== 0) {
			ctx.globalCompositeOperation = COMPOSITE_OPERATIONS[bi]!;
		}

		ctx.globalAlpha = savedAlpha * computed.opacity[fid]!;

		const paint = paintStore.value[fid];
		if (paint === PaintType.IMAGE) {
			const decoder = resolveImageDecoder(world, fill)?.decoder;
			const w = computed.width[eid]!;
			const h = computed.height[eid]!;
			const bitmap = decoder?.getBitmap(w, h);

			if (bitmap) {
				ctx.save();
				ctx.clip();

				const mode = scaleMode.value[fid] ?? 0;
				const [dx, dy, sw, sh] = getScaledImageProps(mode, bitmap.width, bitmap.height, w, h);
				ctx.drawImage(bitmap, dx, dy, sw, sh);

				ctx.restore();
			} else if (decoder?.failed) {
				ctx.fillStyle = MISSING_ASSET_COLOR;
				ctx.fill();
			}
		} else if (paint === PaintType.VIDEO) {
			const decoder = resolveVideoDecoder(world, fill);
			const frame = decoder?.toBitmap();

			if (frame) {
				const w = computed.width[eid]!;
				const h = computed.height[eid]!;

				ctx.save();
				ctx.clip();

				const mode = scaleMode.value[fid] ?? 0;
				const [dx, dy, sw, sh] = getScaledImageProps(mode, frame.width, frame.height, w, h);
				ctx.drawImage(frame, dx, dy, sw, sh);

				ctx.restore();
			} else if (decoder?.errored) {
				ctx.fillStyle = MISSING_ASSET_COLOR;
				ctx.fill();
			}
		} else if (paint === PaintType.SEQUENCE) {
			const decoder = resolveSequenceDecoder(world, fill);
			const frame = decoder?.toBitmap();

			if (frame) {
				const w = computed.width[eid]!;
				const h = computed.height[eid]!;

				ctx.save();
				ctx.clip();

				const mode = scaleMode.value[fid] ?? 0;
				const [dx, dy, sw, sh] = getScaledImageProps(mode, frame.width, frame.height, w, h);
				ctx.drawImage(frame, dx, dy, sw, sh);

				ctx.restore();
			} else if (decoder?.errored) {
				ctx.fillStyle = MISSING_ASSET_COLOR;
				ctx.fill();
			}
		} else if (paint === PaintType.HTML) {
			const host = fill.has(HtmlHostHandle) ? fill.get(HtmlHostHandle) : null;

			if (host) {
				ctx.save();
				ctx.clip();
				host.draw(ctx, computed.width[eid]!, computed.height[eid]!);
				ctx.restore();
			}
		} else if (paint === PaintType.SURFACE) {
			const host = fill.has(SurfaceHostHandle) ? fill.get(SurfaceHostHandle) : null;

			if (host) {
				ctx.save();
				ctx.clip();
				host.draw(ctx, computed.width[eid]!, computed.height[eid]!);
				ctx.restore();
			}
		} else if (paint === PaintType.SOLID) {
			ctx.fillStyle = colorToHex(computed.color[fid]!);
			ctx.fill();
		} else if (paint === PaintType.LINEAR_GRADIENT) {
			const w = computed.width[eid]!;
			const h = computed.height[eid]!;
			ctx.fillStyle = createLinearGradient(world, fill, ctx, w, h);
			ctx.fill();
		} else if (paint === PaintType.RADIAL_GRADIENT) {
			const w = computed.width[eid]!;
			const h = computed.height[eid]!;
			ctx.fillStyle = createRadialGradient(world, fill, ctx, w, h);
			ctx.fill();
		} else if (paint === PaintType.WAVEFORM) {
			renderWaveform(world, entity, fill);
		} else if (paint === PaintType.SHADER) {
			renderShaderFill(world, entity, fills, index);
		}

		ctx.globalCompositeOperation = savedCO;
		ctx.globalAlpha = savedAlpha;
	}
}

/** The current frame of a video/image paint, as a GPU-uploadable source. */
function shaderSourceBitmap(
	world: World,
	fill: Entity,
	w: number,
	h: number,
): { source: GPUCopyExternalImageSource; width: number; height: number } | null {
	const paint = store(world, Paint).value[fill.id()];

	if (paint === PaintType.IMAGE) {
		const bitmap = resolveImageDecoder(world, fill)?.decoder?.getBitmap(w, h);
		return bitmap ? { source: bitmap, width: bitmap.width, height: bitmap.height } : null;
	}
	if (paint === PaintType.VIDEO) {
		const frame = resolveVideoDecoder(world, fill)?.toBitmap();
		return frame ? { source: frame, width: frame.width, height: frame.height } : null;
	}
	return null;
}

/**
 * Whether the fill at `index` is the input of a ready shader paint directly
 * above it. Only the immediate neighbor counts (a hidden paint in between
 * decouples the pair). Must mirror `renderShaderFill`'s input selection
 * exactly — a consumed media paint that the shader then fails to draw would
 * blank the element, so both sides check pipeline readiness and frame
 * availability.
 */
function shaderConsumesFill(world: World, entity: Entity, fills: Entity[], index: number): boolean {
	const paintStore = store(world, Paint);
	const computed = store(world, Computed);
	const fill = fills[index]!;
	const paint = paintStore.value[fill.id()];
	if (paint !== PaintType.IMAGE && paint !== PaintType.VIDEO) return false;

	const next = fills[index + 1];
	if (next === undefined || paintStore.value[next.id()] !== PaintType.SHADER) return false;
	if (next.has(Hidden)) return false;
	if (!resolveShaderHost(world, next)?.ready) return false;

	const w = computed.width[entity.id()]!;
	const h = computed.height[entity.id()]!;
	return shaderSourceBitmap(world, fill, w, h) !== null;
}

/**
 * Draws a shader paint: the media paint directly below it in the fill stack
 * is sampled as the shader's `source` texture and its output lands in the
 * parent's box in the media paint's place. Without a media paint below the
 * shader runs procedurally over a transparent source; before the pipeline is
 * ready it draws nothing and the media, if any, draws normally.
 */
function renderShaderFill(world: World, entity: Entity, fills: Entity[], index: number): void {
	const ctx = getCtx(world);
	const paintStore = store(world, Paint);
	const computed = store(world, Computed);

	const host = resolveShaderHost(world, fills[index]!);
	if (!host?.ready) return;

	const eid = entity.id();
	const w = computed.width[eid]!;
	const h = computed.height[eid]!;

	// A visible media paint directly below is the shader's input. Anything
	// else (no fill below, a hidden one, a solid/gradient) runs the shader
	// procedurally over a transparent source, stacking like a normal paint.
	const media = fills[index - 1];
	const isMedia = media !== undefined
		&& !media.has(Hidden)
		&& (paintStore.value[media.id()] === PaintType.IMAGE || paintStore.value[media.id()] === PaintType.VIDEO);
	let input: ReturnType<typeof shaderSourceBitmap> = null;
	if (isMedia) {
		input = shaderSourceBitmap(world, media, w, h);
		if (!input) return;
	}

	const fit = input
		? getScaledImageProps(store(world, ScaleMode).value[media!.id()] ?? 0, input.width, input.height, w, h)
		: [0, 0, w, h] as [number, number, number, number];
	const fps = world.get(FrameRate)?.value ?? 30;
	const time = (computed.localTime[eid] ?? 0) / fps;

	ctx.save();
	ctx.clip();
	host.draw(ctx, w, h, input?.source ?? null, input?.width ?? 1, input?.height ?? 1, fit, time, store(world, Shader).uniforms[fills[index]!.id()] ?? null);
	ctx.restore();
}

function renderShadows(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);

	const shadows = store(world, Cache).shadows[entity.id()];
	if (!shadows) return;

	ctx.save();
	const savedAlpha = ctx.globalAlpha;

	// ctx.shadowBlur/OffsetX/OffsetY are in device-pixel space and are not
	// affected by the current transform, so scale them up to match the
	// content transform (camera * resolution).
	const camera = getDocument(world).get(Camera);
	const resolution = world.get(RenderSurface)?.resolution ?? 1;
	const shadowScale = (camera?.a ?? 1) * resolution;

	for (const shadow of shadows) {
		if (shadow.has(Hidden)) continue;
		const sid = shadow.id();
		const color = colorToHex(computed.color[sid]!);
		ctx.shadowColor = color;
		ctx.fillStyle = color;
		ctx.globalAlpha = savedAlpha * computed.opacity[sid]!;
		ctx.shadowBlur = computed.blur[sid]! * shadowScale;
		ctx.shadowOffsetX = computed.offsetX[sid]! * shadowScale;
		ctx.shadowOffsetY = computed.offsetY[sid]! * shadowScale;
		ctx.fill();
	}

	ctx.restore();
}

function renderStrokes(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const eid = entity.id();
	const strokes = store(world, Cache).strokes[eid];
	if (!strokes) return;

	const strokeStyle = store(world, StrokeStyle);
	const computed = store(world, Computed);
	const appearance = store(world, Appearance);
	const paintStore = store(world, Paint);

	ctx.lineWidth = computed.strokeWidth[eid]!;
	ctx.lineJoin = StrokeJoin[strokeStyle.join[eid] ?? 0]!.toLocaleLowerCase() as CanvasLineJoin;
	ctx.lineCap = StrokeCap[strokeStyle.cap[eid] ?? 0]!.toLocaleLowerCase() as CanvasLineCap;
	ctx.miterLimit = strokeStyle.miterLimit[eid] ?? 3;

	for (const stroke of strokes) {
		if (stroke.has(Hidden)) continue;
		const sid = stroke.id();
		const savedAlpha = ctx.globalAlpha;
		const savedCO = ctx.globalCompositeOperation;
		const bi = appearance.blendMode[sid] ?? 0;

		if (bi !== 0) {
			ctx.globalCompositeOperation = COMPOSITE_OPERATIONS[bi]!;
		}

		ctx.globalAlpha = savedAlpha * computed.opacity[sid]!;

		const paintType = paintStore.value[sid];
		if (paintType === PaintType.LINEAR_GRADIENT) {
			const w = computed.width[eid]!;
			const h = computed.height[eid]!;
			ctx.strokeStyle = createLinearGradient(world, stroke, ctx, w, h);
		} else if (paintType === PaintType.RADIAL_GRADIENT) {
			const w = computed.width[eid]!;
			const h = computed.height[eid]!;
			ctx.strokeStyle = createRadialGradient(world, stroke, ctx, w, h);
		} else {
			ctx.strokeStyle = colorToHex(computed.color[sid]!);
		}
		ctx.stroke();

		ctx.globalCompositeOperation = savedCO;
		ctx.globalAlpha = savedAlpha;
	}
}

/**
 * Pulse animation for entities with the Generating tag.
 *
 * Easing:     cubic-bezier(0.52, 0.18, 0.56, 0.88)
 * Duration:   0.6s per half-cycle (alternating)
 * Delay:      0.2s before the first transition
 * Full cycle: 0.2 delay + 0.6 forward + 0.6 reverse = 1.4s
 *             repeats ∞ for the entire gen phase (~4.5s)
 *
 * Pulses between --background (#1c1c1c) and --secondary (#292929).
 */
const generatingEase = cubicBezier(0.52, 0.18, 0.56, 0.88);

const GEN_DELAY = 200;  // ms
const GEN_DURATION = 600;  // ms per half-cycle
const GEN_CYCLE = GEN_DURATION * 2; // full forward+reverse cycle

// Colors: #1c1c1c → rgb(28,28,28) and #292929 → rgb(41,41,41)
const GEN_FROM_R = 28, GEN_FROM_G = 28, GEN_FROM_B = 28;
const GEN_TO_R = 41, GEN_TO_G = 41, GEN_TO_B = 41;

function renderGenerating(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	if (!entity.has(Generating)) return;

	const t = world.get(Time)?.now ?? 0;

	// Before initial delay → show base color
	const elapsed = t % (GEN_DELAY + GEN_CYCLE);
	let factor = 0;

	if (elapsed >= GEN_DELAY) {
		const cycleT = elapsed - GEN_DELAY;
		const half = cycleT % GEN_DURATION;
		const progress = half / GEN_DURATION;
		const eased = generatingEase(progress);

		// Alternate direction: first half forward, second half reverse
		const inReverse = cycleT >= GEN_DURATION;
		factor = inReverse ? 1 - eased : eased;
	}

	const r = Math.round(GEN_FROM_R + (GEN_TO_R - GEN_FROM_R) * factor);
	const g = Math.round(GEN_FROM_G + (GEN_TO_G - GEN_FROM_G) * factor);
	const b = Math.round(GEN_FROM_B + (GEN_TO_B - GEN_FROM_B) * factor);

	ctx.fillStyle = `rgb(${r},${g},${b})`;
	ctx.fill();
}

// ── WAVEFORM paint ─────────────────────────────────────
//
// Renders an audio asset's pre-computed peaks as a bar chart inside the
// parent geometry's bounds. Sourced from the paint's own AssetId — the paint
// carries its asset reference, exactly like IMAGE/VIDEO/SEQUENCE paints.

const WAVEFORM_BAR_WIDTH = 6;
const WAVEFORM_BAR_GAP = 6;
const WAVEFORM_BAR_RADIUS = WAVEFORM_BAR_WIDTH / 2;
const WAVEFORM_MIN_BAR_HEIGHT = 4;
const WAVEFORM_PADDING = 12;
const WAVEFORM_BG_COLOR = '#202020';
const WAVEFORM_BG_RADIUS = 12;

function renderWaveform(world: World, entity: Entity, fill: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);

	const assetId = store(world, AssetId).value[fill.id()];
	if (!assetId) return;

	const asset = world.get(Assets)?.get(assetId);
	// Both AUDIO and VIDEO assets carry pre-computed peaks (video has audio).
	if (asset?.type !== 'AUDIO' && asset?.type !== 'VIDEO') return;

	const peaks = getAudioPeaks(asset);
	if (!peaks || peaks.length === 0) return;

	const w = computed.width[entity.id()]!;
	const h = computed.height[entity.id()]!;

	ctx.save();
	ctx.clip();

	// Background
	ctx.fillStyle = WAVEFORM_BG_COLOR;
	ctx.beginPath();
	ctx.roundRect(0, 0, w, h, WAVEFORM_BG_RADIUS);
	ctx.fill();

	// Bars
	const step = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP;
	const availableWidth = w - WAVEFORM_PADDING * 2;
	const barCount = Math.floor(availableWidth / step);
	const maxBarHeight = h - WAVEFORM_PADDING * 2;
	if (barCount <= 0 || maxBarHeight <= 0) {
		ctx.restore();
		return;
	}

	const startX = WAVEFORM_PADDING + (availableWidth - barCount * step + WAVEFORM_BAR_GAP) / 2;

	ctx.fillStyle = '#ffffff';

	for (let i = 0; i < barCount; i++) {
		const peakIndex = Math.floor((i / barCount) * peaks.length);
		const value = (peaks[peakIndex] ?? 0) / 255;
		const barHeight = Math.max(value * maxBarHeight, WAVEFORM_MIN_BAR_HEIGHT);
		const x = startX + i * step;
		const y = (h - barHeight) / 2;

		ctx.beginPath();
		ctx.roundRect(x, y, WAVEFORM_BAR_WIDTH, barHeight, WAVEFORM_BAR_RADIUS);
		ctx.fill();
	}

	ctx.restore();
}

function renderShapeNode(world: World, entity: Entity): void {
	drawRectPath(world, entity);
	renderShadows(world, entity);
	renderIntrinsicFill(world, entity);
	renderFills(world, entity);
	renderGenerating(world, entity);
	renderStrokes(world, entity);
}

function renderTextNode(world: World, entity: Entity): void {
	renderText(world, entity);
}

function renderCaptionNode(world: World, entity: Entity): void {
	resolveCaptionDecoder(world, entity)?.draw(world, entity);
}

// ── Transition rendering ─────────────────────────────────────

function renderTransition(world: World, scene: Entity, left: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);

	const currentTime = computed.localTime[scene.id()]!;

	const children = store(world, Cache).children[scene.id()] ?? [];
	const right = children.find(sibling => computed.start[sibling.id()] === computed.end[left.id()]);
	if (!right) return;

	const win = getTransitionWindow(world, left, right);

	if (currentTime < win.start || currentTime >= win.end) return;

	// we are transitioning
	const duration = win.end - win.start;
	const completion = (currentTime - win.start) / duration;

	const type = store(world, Transition).type[left.id()] ?? TransitionType.DISSOLVE;

	const parent = getParentNode(left);
	if (parent === null) return;
	const width = computed.width[parent.id()]!;
	const height = computed.height[parent.id()]!;

	switch (type) {
		case TransitionType.SLIDE_FROM_RIGHT: {
			renderNode(world, left);
			ctx.save();
			ctx.translate(((1 - completion) ** 2 * width) | 0, 0);
			renderNode(world, right);
			ctx.restore();
			break;
		}
		case TransitionType.SLIDE_FROM_LEFT: {
			renderNode(world, left);
			ctx.save();
			ctx.translate(((1 - completion) ** 2 * width * -1) | 0, 0);
			renderNode(world, right);
			ctx.restore();
			break;
		}
		case TransitionType.FADE_TO_BLACK: {
			if (completion < 0.5) {
				renderNode(world, left);
			} else {
				renderNode(world, right);
			}
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, width, height);
			ctx.closePath();
			ctx.fillStyle = '#000000';
			ctx.globalAlpha = completion < 0.5 ? 2 * completion : 2 * (1 - completion);
			ctx.fill();
			ctx.restore();
			break;
		}
		case TransitionType.FADE_TO_WHITE: {
			if (completion < 0.5) {
				renderNode(world, left);
			} else {
				renderNode(world, right);
			}
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, width, height);
			ctx.closePath();
			ctx.fillStyle = '#FFFFFF';
			ctx.globalAlpha = completion < 0.5 ? 2 * completion : 2 * (1 - completion);
			ctx.fill();
			ctx.restore();
			break;
		}
		default: {
			// Dissolve (default)
			renderNode(world, left);
			ctx.save();
			ctx.globalAlpha = completion;
			renderNode(world, right);
			ctx.restore();
			break;
		}
	}

	// Mark both partners as already drawn this frame so the parent's
	// children loop skips its plain renderNode pass for them.
	computed.visibility[left.id()] = 0;
	computed.visibility[right.id()] = 0;
}

export function renderNode(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);
	const eid = entity.id();

	if (computed.visibility[eid] === 0 || entity.has(Culled)) return;

	if (entity.has(Interactive)) {
		world.get(HitRegions)?.list.push({
			target: { kind: 'entity', id: entity },
		});
	}

	if (entity.has(IsMask) || entity.has(Hidden)) return;

	ctx.save();

	const local = store(world, LocalTransform);
	ctx.transform(
		local.a[eid]!,
		local.b[eid]!,
		local.c[eid]!,
		local.d[eid]!,
		local.e[eid]!,
		local.f[eid]!,
	);

	const worldTransform = store(world, WorldTransform);
	for (const mask of store(world, Cache).masks[eid] ?? []) {
		if (computed.visibility[mask.id()] === 0) continue;
		ctx.save();
		ctx.setTransform(
			worldTransform.a[mask.id()]!,
			worldTransform.b[mask.id()]!,
			worldTransform.c[mask.id()]!,
			worldTransform.d[mask.id()]!,
			worldTransform.e[mask.id()]!,
			worldTransform.f[mask.id()]!,
		);
		drawRectPath(world, mask);
		ctx.restore();
		ctx.clip();
	}

	// Appearance
	ctx.globalAlpha *= computed.opacity[eid]!;
	const bi = store(world, Appearance).blendMode[eid] ?? 0;
	if (bi !== 0) ctx.globalCompositeOperation = COMPOSITE_OPERATIONS[bi]!;

	const effects = buildEffects(world, entity);
	let initialFilter = 'none';

	if (effects !== null) {
		initialFilter = ctx.filter;
		ctx.filter = effects;
	}


	if (entity.has(Caption)) {
		renderCaptionNode(world, entity);
	} else if (store(world, Geometry).value[eid] === GeometryType.TEXT) {
		renderTextNode(world, entity);
	} else if (store(world, Geometry).value[eid] === GeometryType.RECT) {
		renderShapeNode(world, entity);
	}

	// Clip and render children
	const children = store(world, Cache).children[eid] ?? [];
	if (children.length) {
		if (entity.has(ClipsContent)) {
			ctx.save();
			ctx.clip();
		}

		for (const child of children) {
			// Edge case: Child with transition
			if (child.has(Transition)) {
				renderTransition(world, entity, child);
				// Note: we are not breaking here since the transition handler will hide/unhide the children
			}

			renderNode(world, child);
		}

		if (entity.has(ClipsContent)) {
			ctx.restore();
		}
	}

	// Reset filter after drawing
	if (initialFilter !== 'none') {
		ctx.filter = initialFilter;
	}

	ctx.restore();
}

/**
 * Render system entry point. Call after transformSystem.
 *
 * Reads camera, background, and canvas size from world state and applies
 * DPR * Camera as the base canvas transform before drawing top-level nodes.
 * Without a render surface (headless world) this is a no-op.
 */
export function renderSystem(world: World): void {
	const surface = world.get(RenderSurface);
	const ctx = surface?.ctx;
	const canvas = surface?.canvas;
	if (!ctx || !canvas) return;

	const cw = canvas.width;
	const ch = canvas.height;

	// Clear + background (identity transform for full-canvas clear)
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, cw, ch);

	// The stage background is a preview-only affordance; offline encoding
	// renders just the scene onto a transparent canvas (the scene paints its
	// own fill if it has one).
	if (world.get(Mode)?.value === 'realtime') {
		ctx.fillStyle = colorToHex(getDocument(world).get(Background)?.value ?? 0);
		ctx.fillRect(0, 0, cw, ch);
		world.get(HitRegions)?.list.push({
			target: { kind: 'hud', id: 'canvas', quad: getCanvasQuad(cw, ch) },
		});
	}

	// Apply camera transform: DPR * Camera
	const camera = getDocument(world).get(Camera)!
	const resolution = surface.resolution;
	ctx.setTransform(
		camera.a * resolution,
		camera.b * resolution,
		camera.c * resolution,
		camera.d * resolution,
		camera.e * resolution,
		camera.f * resolution,
	);

	// Render top-level nodes.
	const document = getDocument(world);
	for (const entity of world.query(Or(Geometry, Group), ChildOf(document), Not(Culled))) {
		renderNode(world, entity);
	}
}

function getCanvasQuad(width: number, height: number): Quad {
	return [
		{ x: 0, y: 0 },
		{ x: width, y: 0 },
		{ x: width, y: height },
		{ x: 0, y: height },
	];
}
