/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import { Active, Animation, AnimationPhase, AnimationType, appendChild, AssetId, Audio, Background, BlendMode, BlendModeType, Blur, Chars, ClipsContent, CornerRadius, createEntity, DEFAULT_BACKGROUND, Color, ColorStop, Effect, EffectType, End, FontStyle, FrameRate, Loop, Geometry, GeometryType, Library, getEntityTree, getParentEntity, getParentNode, Hidden, IsMask, isText, ItemIndex, Keyframe, KeyframeTrack, MixedCornerRadius, Muted, Name, Offset, Opacity, Paint, PaintType, parseColor, Playback, PlaybackRate, Position, removeChild, resizeEntity, Scale, ScaleMode, ScaleModeType, secondsToFrames, getAsset, getAssetFile, getEntityChildren, getLibrary, Group, Sequential, Shader, Size, Stage, Root, Rotation, Scene, Selected, Shadow, Source, SourceIn, SourceOut, setCameraMatrix, Start, Stroke, StrokeCap, StrokeJoin, StrokeStyle, SurfaceHost, SurfaceHostHandle, TextAlign, TextBaseline, TextCase, TextRange, TextStyle, Transition, TransitionType, UniformScale, Volume } from '@diffusionstudio/runtime';
import { isPropValue, LOOP_ATTR, parseTime, SOURCE_ATTR } from '@diffusionstudio/jsx';

import type { CameraMatrix, PropertyPath } from '@diffusionstudio/runtime';
import type { Asset } from '@diffusionstudio/assets';
import type { AssetInput, PropValue } from '@diffusionstudio/jsx';
import { trait, type Entity, type World } from 'koota';
import type { ProjectDocument } from './host';

export interface SceneNode {
	readonly entity: Entity;
}

/**
 * The node a `<surface>` or `<surfacePaint>` element creates: what its `ref`
 * receives, like any other element's ref receives its node. `canvas` is the
 * backing canvas (on the geometry for a `<surface>`, whose surface is its
 * intrinsic paint; on the paint sub-entity for a `<surfacePaint>`), allocated
 * with the element and sized to the holder's box; null without a DOM.
 */
export interface SurfaceNode extends SceneNode {
	readonly canvas: HTMLCanvasElement | null;
}

export interface TextNode {
	text: string;
	parent: SceneNode | null;
}

export type HostNode = SceneNode | TextNode;

/**
 * The text nodes a `<text>` entity holds, in order.
 *
 * The world is the document's only store: everything the document knows
 * about a node lives on that node's entity as a trait, and nothing is
 * mirrored in fields on `RuntimeDocument`. State that lives in two places
 * drifts as soon as one side (a cascade destroy, a move, an undo) is
 * updated without the other; state that lives on the entity is destroyed,
 * copied and observed together with it. When the document needs something
 * new, add a trait here — do not add a Map/Set field to the class.
 *
 * Text nodes themselves are the one thing not backed by an entity (they
 * are the reconciler's, held by identity), which is why they hang off their
 * parent entity via this trait rather than the other way around.
 */
const TextParts = trait(() => new Set<TextNode>());

/**
 * What the project wrote on an entity's element, in the vocabulary of the JSX
 * rather than of the traits it became: the tag, and every prop worth a value a
 * source file could spell (see `PropValue`), as last set. Kept so an editor
 * can spell an entity back out as an element — which is how a loop's
 * iterations get written down one by one — without reading the traits
 * backwards. `children` is not a prop here: an element's text is `Chars`, and
 * its element children are the entity's.
 */
const Authored = trait(() => ({ tag: '', props: {} as Record<string, PropValue> }));

/**
 * The `src` an element is waiting on: set while the library resolves a
 * source the world does not know yet, so a resolution that arrives after the
 * element was given another source (or none) is dropped.
 */
const SourceRequest = trait(() => ({ value: undefined as unknown }));

/** Props that address or wire an element rather than describe it. */
const UNAUTHORED_PROPS: ReadonlySet<string> = new Set([SOURCE_ATTR, LOOP_ATTR, 'children', 'ref']);

export interface AuthoredElement {
	/** The camelCase tag the project used. */
	tag: string;
	props: Record<string, PropValue>;
	/** The literal text of a `<text>`, when it holds any. */
	text?: string;
}

/**
 * The element `entity` was rendered from, as a project would author it, or
 * undefined for an entity no document created (the stage included).
 */
export function authoredElement(entity: Entity): AuthoredElement | undefined {
	const authored = entity.get(Authored);
	if (authored === undefined) return undefined;

	const text = isText(entity) ? entity.get(Chars)?.value : undefined;
	return { tag: authored.tag, props: { ...authored.props }, ...(text ? { text } : {}) };
}

/** An authored element with the authored elements under it, in order. */
export interface AuthoredTree extends AuthoredElement {
	children: AuthoredTree[];
}

/**
 * The subtree `entity` was rendered from, as a project would author it:
 * `authoredElement` of it and, recursively, of every child of its that a
 * document created. Sub-entities the runtime derives (a recipe's paints) are
 * not elements and are left out; they come back with the recipe.
 */
export function authoredTree(world: World, entity: Entity): AuthoredTree | undefined {
	const element = authoredElement(entity);
	if (element === undefined) return undefined;

	const children: AuthoredTree[] = [];
	for (const child of getEntityChildren(world, entity)) {
		const tree = authoredTree(world, child);
		if (tree) children.push(tree);
	}

	return { ...element, children };
}

export function isSceneNode(node: HostNode): node is SceneNode {
	return 'entity' in node;
}

/**
 * The text nodes of `entity` in order; empty when it holds none.
 */
function textParts(entity: Entity): TextNode[] {
	return Array.from(entity.get(TextParts) ?? []);
}

/**
 * Re-derives `Chars` from the text nodes `entity` currently holds.
 */
function syncChars(entity: Entity): void {
	if (!entity.isAlive()) return;
	entity.add(Chars);
	entity.set(Chars, { value: textParts(entity).map((part) => part.text).join('') });
}

/**
 * Detaches `node` from its parent entity and refreshes that entity's text.
 */
function detachText(node: TextNode): void {
	const parent = node.parent;
	if (parent === null) return;

	parent.entity.get(TextParts)?.delete(node);
	node.parent = null;
	syncChars(parent.entity);
}

const TIME_TRAITS = {
	start: Start,
	end: End,
	sourceIn: SourceIn,
	sourceOut: SourceOut,
} as const;

const PAINT_TYPES: Record<string, PaintType> = {
	solidPaint: PaintType.SOLID,
	linearGradientPaint: PaintType.LINEAR_GRADIENT,
	radialGradientPaint: PaintType.RADIAL_GRADIENT,
	shaderPaint: PaintType.SHADER,
	surfacePaint: PaintType.SURFACE,
};

export const TRANSITION_TYPES: Record<string, TransitionType> = {
	dissolve: TransitionType.DISSOLVE,
	slideFromRight: TransitionType.SLIDE_FROM_RIGHT,
	slideFromLeft: TransitionType.SLIDE_FROM_LEFT,
	fadeToBlack: TransitionType.FADE_TO_BLACK,
	fadeToWhite: TransitionType.FADE_TO_WHITE,
};

/** The canvas composite operations, spelled camelCase like the other enums. */
export const BLEND_MODES: Record<string, BlendModeType> = {
	sourceOver: BlendModeType.SOURCE_OVER,
	multiply: BlendModeType.MULTIPLY,
	screen: BlendModeType.SCREEN,
	overlay: BlendModeType.OVERLAY,
	darken: BlendModeType.DARKEN,
	lighten: BlendModeType.LIGHTEN,
	colorDodge: BlendModeType.COLOR_DODGE,
	colorBurn: BlendModeType.COLOR_BURN,
	hardLight: BlendModeType.HARD_LIGHT,
	softLight: BlendModeType.SOFT_LIGHT,
	difference: BlendModeType.DIFFERENCE,
	exclusion: BlendModeType.EXCLUSION,
	hue: BlendModeType.HUE,
	saturation: BlendModeType.SATURATION,
	color: BlendModeType.COLOR,
	luminosity: BlendModeType.LUMINOSITY,
};

/**
 * A `<keyframeTrack>`'s `property` (a prop name) as the runtime's property
 * path. `width` depends on the holder: a stroke's is its line width.
 */
const TRACK_PROPERTIES: Record<string, PropertyPath> = {
	x: 'position.x',
	y: 'position.y',
	offsetX: 'offset.x',
	offsetY: 'offset.y',
	width: 'width',
	height: 'height',
	rotation: 'rotation',
	scale: 'scale',
	scaleX: 'scale.x',
	scaleY: 'scale.y',
	opacity: 'opacity',
	cornerRadius: 'vertexRadius',
	cornerRadiusTopLeft: 'mixedVertexRadius.topLeft',
	cornerRadiusTopRight: 'mixedVertexRadius.topRight',
	cornerRadiusBottomRight: 'mixedVertexRadius.bottomRight',
	cornerRadiusBottomLeft: 'mixedVertexRadius.bottomLeft',
	volume: 'volume',
	color: 'color',
	offset: 'stop.offset',
	blur: 'blur',
	value: 'effect.value',
};

/**
 * The runtime property path a `<keyframeTrack property>` under `holder`
 * drives, or undefined for a name no track can take. `width` depends on the
 * holder: a stroke's is its line width.
 */
export function trackPropertyPath(holder: Entity | null, property: string): PropertyPath | undefined {
	const path = TRACK_PROPERTIES[property];
	if (path === 'width' && holder?.has(Stroke)) return 'stroke.width';
	return path;
}

/** The `<rect>` props of the per-corner radii, in the trait's (CSS) order. */
const CORNER_PROPS = ['cornerRadiusTopLeft', 'cornerRadiusTopRight', 'cornerRadiusBottomRight', 'cornerRadiusBottomLeft'] as const;

/**
 * Named easings as the descriptors the runtime (and the editor's
 * interpolation inspector) speak; the descriptor forms pass through with
 * their whitespace dropped, linear is the empty string.
 */
const EASINGS: Record<string, string> = {
	linear: '',
	easeIn: 'cubicBezier(0.42,0,1,1)',
	easeOut: 'cubicBezier(0,0,0.58,1)',
	easeInOut: 'cubicBezier(0.42,0,0.58,1)',
	gentle: 'spring(0.5,628)',
	snappy: 'spring(0.15,300)',
	bouncy: 'spring(0.4,500)',
	strong: 'spring(0.65,400)',
};

export const ANIMATION_TYPES: Record<string, AnimationType> = {
	fade: AnimationType.FADE,
	gain: AnimationType.GAIN,
	grow: AnimationType.GROW,
	shrink: AnimationType.SHRINK,
	blur: AnimationType.BLUR,
	slideLeft: AnimationType.SLIDE_LEFT,
	slideRight: AnimationType.SLIDE_RIGHT,
	slideUp: AnimationType.SLIDE_UP,
	slideDown: AnimationType.SLIDE_DOWN,
	spin: AnimationType.SPIN,
	twist: AnimationType.TWIST,
	appearWord: AnimationType.APPEAR_WORD,
	appearChar: AnimationType.APPEAR_CHAR,
	scramble: AnimationType.SCRAMBLE,
};

export const EFFECT_TYPES: Record<string, EffectType> = {
	blur: EffectType.LAYER_BLUR,
	brightness: EffectType.BRIGHTNESS,
	contrast: EffectType.CONTRAST,
	grayscale: EffectType.GRAYSCALE,
	hueRotate: EffectType.HUE_ROTATION,
	invert: EffectType.INVERT,
	saturate: EffectType.SATURATE,
	sepia: EffectType.SEPIA,
};

const STROKE_JOINS: Record<string, StrokeJoin> = {
	miter: StrokeJoin.MITER,
	round: StrokeJoin.ROUND,
	bevel: StrokeJoin.BEVEL,
};

const STROKE_CAPS: Record<string, StrokeCap> = {
	butt: StrokeCap.BUTT,
	round: StrokeCap.ROUND,
	square: StrokeCap.SQUARE,
};

const SCALE_MODES: Record<string, ScaleModeType> = {
	cover: ScaleModeType.COVER,
	contain: ScaleModeType.FIT,
	fill: ScaleModeType.FILL,
};

const FONT_STYLES: Record<string, FontStyle> = {
	normal: FontStyle.NORMAL,
	italic: FontStyle.ITALIC,
	oblique: FontStyle.OBLIQUE,
};

const TEXT_ALIGNS: Record<string, TextAlign> = {
	left: TextAlign.LEFT,
	center: TextAlign.CENTER,
	right: TextAlign.RIGHT,
};

const TEXT_BASELINES: Record<string, TextBaseline> = {
	top: TextBaseline.TOP,
	middle: TextBaseline.MIDDLE,
	bottom: TextBaseline.BOTTOM,
	alphabetic: TextBaseline.ALPHABETIC,
};

const TEXT_CASES: Record<string, TextCase> = {
	original: TextCase.ORIGINAL,
	upper: TextCase.UPPER,
	lower: TextCase.LOWER,
};

const FONT_WEIGHTS: Record<string, string> = {
	normal: '400',
	bold: '700',
};

/**
 * Allocates a surface paint's host with the element (a canvas needs a DOM;
 * a host without one leaves the paint blank and `canvas` null).
 */
function attachSurfaceHost(paint: Entity): void {
	if (typeof document === 'undefined') return;
	paint.add(SurfaceHostHandle);
	paint.set(SurfaceHostHandle, new SurfaceHost());
}

/**
 * Sizes the surface canvases of `holder` (its own, for a `<surface>`, and
 * those of its `<surfacePaint>` children) to its authored box, so they draw
 * at the box's resolution. Same-size calls are no-ops (SurfaceHost).
 */
function syncSurfaceSize(world: World, holder: Entity): void {
	const size = holder.get(Size);
	if (size === undefined) return;
	holder.get(SurfaceHostHandle)?.setSize(size.width, size.height);
	for (const child of getEntityChildren(world, holder)) {
		child.get(SurfaceHostHandle)?.setSize(size.width, size.height);
	}
}

/**
 * A numeric prop's value, or undefined for none. A boolean is none, not 0
 * or 1: `false` is how an editor unsets a prop (the writer spells it as the
 * attribute's absence), and a number prop has no true.
 */
function toNumber(value: unknown) {
	if (value === undefined || value === null || typeof value === 'boolean') {
		return undefined;
	}

	const number = Number(value);
	return Number.isFinite(number) ? number : undefined;
}

function toSeconds(value: unknown): number | undefined {
	if (typeof value !== 'number' && typeof value !== 'string') {
		return undefined;
	}

	return parseTime(value);
}

export class RuntimeDocument implements ProjectDocument<HostNode> {
	public readonly stage: SceneNode;
	private readonly world: World;

	public constructor(world: World) {
		this.world = world;
		this.stage = { entity: world.get(Root)! };
	}

	public createElement(tag: string): SceneNode | SurfaceNode {
		// Composition elements arrive in either spelling: the camelCase
		// intrinsics a project authors, or the PascalCase components the compile
		// step (and an app inserting elements) uses.
		const name = tag.charAt(0).toLowerCase() + tag.slice(1);
		let entity: Entity;

		switch (name) {
			case 'stage':
				entity = this.stage.entity;
				break;
			case 'scene': {
				entity = createEntity(this.world);
				entity.add(Geometry);
				entity.set(Geometry, { value: GeometryType.RECT });
				entity.add(Position);
				entity.set(Position, { x: 0, y: 0 });
				entity.add(Scene);
				entity.add(ClipsContent);
				entity.add(Playback);
				resizeEntity(this.world, entity, { width: 1920, height: 1080 });
				break;
			}
			case 'group': {
				// No Size: a group's box is the union of its children's.
				entity = createEntity(this.world);
				entity.add(Group);
				entity.add(Position);
				entity.set(Position, { x: 0, y: 0 });
				break;
			}
			case 'sequence': {
				// Sequential's observer adds Group and keeps spatial traits off:
				// a sequence sits at its parent's origin and mirrors its frame.
				entity = createEntity(this.world);
				entity.add(Sequential);
				break;
			}
			case 'rect': {
				entity = createEntity(this.world);
				entity.add(Geometry);
				entity.set(Geometry, { value: GeometryType.RECT });
				entity.add(Position);
				entity.set(Position, { x: 0, y: 0 });
				resizeEntity(this.world, entity, { width: 100, height: 100 });
				break;
			}
			case 'text': {
				// No Size: a text without one sizes itself to its glyphs.
				entity = createEntity(this.world);
				entity.add(Geometry);
				entity.set(Geometry, { value: GeometryType.TEXT });
				entity.add(Position);
				entity.set(Position, { x: 0, y: 0 });
				entity.add(Chars);
				entity.add(TextStyle);
				break;
			}
			case 'textRange': {
				entity = createEntity(this.world);
				entity.add(TextRange);
				entity.set(TextRange, { start: 0, end: null });
				entity.add(TextStyle);
				break;
			}
			case 'video': {
				entity = createEntity(this.world);
				entity.add(Geometry);
				entity.set(Geometry, { value: GeometryType.RECT });
				entity.add(Position);
				entity.set(Position, { x: 0, y: 0 });
				entity.add(Paint);
				entity.set(Paint, { value: PaintType.VIDEO });
				resizeEntity(this.world, entity, { width: 1920, height: 1080 });
				break;
			}
			case 'image': {
				entity = createEntity(this.world);
				entity.add(Geometry);
				entity.set(Geometry, { value: GeometryType.RECT });
				entity.add(Position);
				entity.set(Position, { x: 0, y: 0 });
				entity.add(Paint);
				entity.set(Paint, { value: PaintType.IMAGE });
				resizeEntity(this.world, entity, { width: 1920, height: 1080 });
				break;
			}
			case 'audio': {
				entity = createEntity(this.world);
				entity.add(Geometry);
				entity.set(Geometry, { value: GeometryType.RECT });
				entity.add(Position);
				entity.set(Position, { x: 0, y: 0 });
				entity.add(Audio);
				entity.add(Paint);
				entity.set(Paint, { value: PaintType.WAVEFORM });
				resizeEntity(this.world, entity, { width: 500, height: 150 });
				break;
			}
			case 'solidPaint':
			case 'linearGradientPaint':
			case 'radialGradientPaint':
			case 'shaderPaint':
			case 'surfacePaint': {
				entity = createEntity(this.world);
				entity.add(Paint);
				entity.set(Paint, { value: PAINT_TYPES[name]! });
				if (name === 'solidPaint') entity.add(Color);
				if (name === 'shaderPaint') entity.add(Shader);
				if (name === 'surfacePaint') attachSurfaceHost(entity);
				break;
			}
			case 'surface': {
				// A rect whose intrinsic paint is the surface, like <video>'s is
				// its media: the host lives on the geometry itself.
				entity = createEntity(this.world);
				entity.add(Geometry);
				entity.set(Geometry, { value: GeometryType.RECT });
				entity.add(Position);
				entity.set(Position, { x: 0, y: 0 });
				entity.add(Paint);
				entity.set(Paint, { value: PaintType.SURFACE });
				attachSurfaceHost(entity);
				resizeEntity(this.world, entity, { width: 100, height: 100 });
				syncSurfaceSize(this.world, entity);
				break;
			}
			case 'colorStop': {
				entity = createEntity(this.world);
				entity.add(ColorStop);
				break;
			}
			case 'stroke': {
				entity = createEntity(this.world);
				entity.add(Stroke);
				entity.add(Paint);
				entity.set(Paint, { value: PaintType.SOLID });
				entity.add(Color);
				entity.add(StrokeStyle);
				break;
			}
			case 'shadow': {
				entity = createEntity(this.world);
				entity.add(Shadow);
				entity.add(Color);
				break;
			}
			case 'effect': {
				entity = createEntity(this.world);
				entity.add(Effect);
				entity.set(Effect, { type: EffectType.LAYER_BLUR, value: 0 });
				break;
			}
			case 'animation': {
				entity = createEntity(this.world);
				entity.add(Animation);
				entity.set(Animation, { duration: this.toFrames(1) });
				break;
			}
			case 'keyframeTrack': {
				// `property` names the prop; the path it resolves to depends on the
				// holder, so it is (re)resolved when the track is inserted.
				entity = createEntity(this.world);
				entity.add(KeyframeTrack);
				break;
			}
			case 'keyframe': {
				entity = createEntity(this.world);
				entity.add(Keyframe);
				entity.set(Keyframe, { easing: '' });
				break;
			}
			default:
				throw new Error(
					`<${tag}> is not supported yet (only <stage>, <scene>, <group>, <sequence>, <rect>, <text>, <textRange>, <video>, <image>, <audio>, <surface>, <solidPaint>, <linearGradientPaint>, <radialGradientPaint>, <shaderPaint>, <surfacePaint>, <colorStop>, <stroke>, <shadow>, <effect>, <animation>, <keyframeTrack> and <keyframe>).`,
				);
		}

		if (entity !== this.stage.entity) {
			entity.add(Authored);
			entity.set(Authored, { tag: name, props: {} });
		}

		if (name === 'surface' || name === 'surfacePaint') {
			// A getter, not a copy: the node holds no state of its own.
			const node: SurfaceNode = {
				entity,
				get canvas() {
					return entity.get(SurfaceHostHandle)?.canvas ?? null;
				},
			};
			return node;
		}

		return { entity };
	}

	public createTextNode(text: string): TextNode {
		return { text, parent: null };
	}

	public replaceText(node: HostNode, text: string): void {
		if (isSceneNode(node)) return;
		node.text = text;
		if (node.parent) {
			syncChars(node.parent.entity);
		}
	}

	public isTextNode(node: HostNode): boolean {
		return !isSceneNode(node);
	}

	/**
	 * Replaces everything a `<text>` says. Its children rather than a prop, so
	 * an editor changing it comes here instead of through `setProperty`. The
	 * text nodes the reconciler holds keep their identity — the first says all
	 * of it and the rest say nothing — so a render that later updates one of
	 * them still lands where it did. An entity holding none (a text drawn on
	 * the canvas, whose element is not written yet) gets `Chars` alone.
	 */
	public setText(entity: Entity, text: string): void {
		const parts = textParts(entity);

		if (parts.length === 0) {
			entity.add(Chars);
			entity.set(Chars, { value: text });
			return;
		}

		for (const [index, part] of parts.entries()) {
			part.text = index === 0 ? text : '';
		}
		syncChars(entity);
	}

	public setProperty(node: HostNode, name: string, value: unknown): void {
		if (!isSceneNode(node)) return;
		const { entity } = node;

		// Noted before it is interpreted: what the project wrote is what an
		// editor spelling the element back out needs, however the traits pack it.
		const authored = entity.get(Authored);
		if (authored && !UNAUTHORED_PROPS.has(name)) {
			if (isPropValue(value)) authored.props[name] = value;
			else delete authored.props[name];
		}

		switch (name) {
			case LOOP_ATTR: {
				if (typeof value !== 'string' || !value) {
					entity.remove(Loop);
					return;
				}

				entity.add(Loop);
				entity.set(Loop, { value });
				return;
			}
			case SOURCE_ATTR: {
				if (typeof value !== 'string' || !value) {
					entity.remove(Source);
					return;
				}

				entity.add(Source);
				entity.set(Source, { value });
				return;
			}
			case 'name': {
				if (typeof value !== 'string' || !value) {
					entity.remove(Name);
					return;
				}

				entity.add(Name);
				entity.set(Name, { value });
				return;
			}
			case 'selected': {
				if (value === true && entity !== this.stage.entity) {
					entity.add(Selected);
				} else {
					entity.remove(Selected);
				}
				return;
			}
			case 'active': {
				// Uniqueness and root-only are the runtime's observers' business.
				if (value === true && entity !== this.stage.entity) {
					entity.add(Active);
				} else {
					entity.remove(Active);
				}
				return;
			}
			case 'x':
			case 'y': {
				if (entity.has(Sequential)) return;
				entity.add(Position);
				entity.set(Position, { [name]: toNumber(value) ?? 0 });
				return;
			}
			case 'offsetX':
			case 'offsetY': {
				if (entity.has(Sequential)) return;
				entity.add(Offset);
				entity.set(Offset, { [name === 'offsetX' ? 'x' : 'y']: toNumber(value) ?? 0 });
				return;
			}
			case 'rotation': {
				if (entity.has(Sequential)) return;
				entity.add(Rotation);
				entity.set(Rotation, { value: toNumber(value) ?? 0 });
				return;
			}
			case 'scale': {
				// Uniform; wins over scaleX/scaleY while present (motion system).
				if (entity.has(Sequential)) return;
				const scale = toNumber(value);
				if (scale === undefined) {
					entity.remove(UniformScale);
					return;
				}

				entity.add(UniformScale);
				entity.set(UniformScale, { value: scale });
				return;
			}
			case 'scaleX':
			case 'scaleY': {
				if (entity.has(Sequential)) return;
				entity.add(Scale);
				entity.set(Scale, { [name === 'scaleX' ? 'x' : 'y']: toNumber(value) ?? 1 });
				return;
			}
			case 'cornerRadius': {
				const radius = toNumber(value);
				if (radius === undefined) {
					entity.remove(CornerRadius);
				} else {
					entity.add(CornerRadius);
					entity.set(CornerRadius, { value: radius });
				}
				// The corners without a radius of their own take this one.
				this.syncCornerRadii(entity);
				return;
			}
			case 'cornerRadiusTopLeft':
			case 'cornerRadiusTopRight':
			case 'cornerRadiusBottomRight':
			case 'cornerRadiusBottomLeft': {
				this.syncCornerRadii(entity);
				return;
			}
			case 'blendMode': {
				const mode = typeof value === 'string' ? BLEND_MODES[value] : undefined;
				if (mode === undefined || mode === BlendModeType.SOURCE_OVER) {
					entity.remove(BlendMode);
					return;
				}

				entity.add(BlendMode);
				entity.set(BlendMode, { value: mode });
				return;
			}
			case 'mask': {
				if (value === true && entity !== this.stage.entity) {
					entity.add(IsMask);
				} else {
					entity.remove(IsMask);
				}
				return;
			}
			case 'hidden': {
				if (value === true && entity !== this.stage.entity) {
					entity.add(Hidden);
				} else {
					entity.remove(Hidden);
				}
				return;
			}
			case 'playbackRate': {
				const rate = toNumber(value);
				if (rate === undefined || rate === 0) {
					entity.remove(PlaybackRate);
					return;
				}

				entity.add(PlaybackRate);
				entity.set(PlaybackRate, { value: rate });
				return;
			}
			case 'transition': {
				if (typeof value !== 'object' || value === null) {
					entity.remove(Transition);
					return;
				}

				if (!entity.has(Transition)) {
					entity.add(Transition);
					entity.set(Transition, { type: TransitionType.DISSOLVE, duration: this.toFrames(1) });
				}

				const spec = value as { type?: unknown; duration?: unknown };
				if ('type' in spec) {
					const type = typeof spec.type === 'string' ? TRANSITION_TYPES[spec.type] : undefined;
					entity.set(Transition, { type: type ?? TransitionType.DISSOLVE });
				}
				if ('duration' in spec) {
					entity.set(Transition, { duration: this.toFrames(toSeconds(spec.duration) ?? 1) });
				}
				return;
			}
			case 'wgsl': {
				if (!entity.has(Shader)) return;
				entity.set(Shader, { code: typeof value === 'string' ? value : '' });
				return;
			}
			case 'uniforms': {
				if (!entity.has(Shader)) return;
				const uniforms = typeof value === 'object' && value !== null && !Array.isArray(value)
					? { ...(value as Record<string, number | number[] | string>) }
					: null;
				entity.set(Shader, { uniforms });
				return;
			}
			case 'width':
			case 'height': {
				const size = toNumber(value);
				if (entity.has(Stroke)) {
					// A stroke's width is its line width; it has no box.
					if (name === 'width') entity.set(StrokeStyle, { width: size ?? 1 });
					return;
				}
				if (size === undefined) {
					// A text is the one element whose box is optional: with
					// neither bound authored it sizes itself to its glyphs
					// again. Size holds both, so it only goes when both are.
					const other = name === 'width' ? 'height' : 'width';
					if (isText(entity) && toNumber(entity.get(Authored)?.props[other]) === undefined) {
						entity.remove(Size);
					}
					return;
				}
				resizeEntity(this.world, entity, { [name]: size });
				syncSurfaceSize(this.world, entity);
				return;
			}
			case 'join': {
				if (!entity.has(Stroke)) return;
				const join = typeof value === 'string' ? STROKE_JOINS[value] : undefined;
				entity.set(StrokeStyle, { join: join ?? StrokeJoin.MITER });
				return;
			}
			case 'cap': {
				if (!entity.has(Stroke)) return;
				const cap = typeof value === 'string' ? STROKE_CAPS[value] : undefined;
				entity.set(StrokeStyle, { cap: cap ?? StrokeCap.BUTT });
				return;
			}
			case 'miterLimit': {
				if (!entity.has(Stroke)) return;
				entity.set(StrokeStyle, { miterLimit: toNumber(value) ?? 10 });
				return;
			}
			case 'type': {
				if (entity.has(Animation)) {
					const type = typeof value === 'string' ? ANIMATION_TYPES[value] : undefined;
					entity.set(Animation, { type: type ?? AnimationType.FADE });
					return;
				}
				if (!entity.has(Effect)) return;
				const type = typeof value === 'string' ? EFFECT_TYPES[value] : undefined;
				entity.set(Effect, { type: type ?? EffectType.LAYER_BLUR });
				return;
			}
			case 'phase': {
				if (!entity.has(Animation)) return;
				entity.set(Animation, { phase: value === 'out' ? AnimationPhase.OUT : AnimationPhase.IN });
				return;
			}
			case 'duration':
			case 'delay': {
				if (!entity.has(Animation)) return;
				const seconds = toSeconds(value);
				entity.set(Animation, { [name]: this.toFrames(seconds ?? (name === 'duration' ? 1 : 0)) });
				return;
			}
			case 'value': {
				if (entity.has(Keyframe)) {
					// A number, or a color on a color track; either is a number to the trait.
					entity.set(Keyframe, { value: toNumber(value) ?? parseColor(value) ?? 0 });
					return;
				}
				if (!entity.has(Effect)) return;
				entity.set(Effect, { value: toNumber(value) ?? 0 });
				return;
			}
			case 'property': {
				if (!entity.has(KeyframeTrack)) return;
				this.resolveTrackProperty(entity, value);
				return;
			}
			case 'time': {
				if (!entity.has(Keyframe)) return;
				const seconds = toSeconds(value);
				entity.set(Keyframe, { time: this.toFrames(seconds ?? 0) });
				return;
			}
			case 'easing': {
				if (!entity.has(Keyframe)) return;
				const easing = typeof value === 'string' ? value.replace(/\s+/g, '') : '';
				entity.set(Keyframe, { easing: EASINGS[easing] ?? easing });
				return;
			}
			case 'blur': {
				const blur = toNumber(value);
				if (blur === undefined) {
					entity.remove(Blur);
					return;
				}

				entity.add(Blur);
				entity.set(Blur, { value: blur });
				return;
			}
			case 'start':
			case 'end':
			case 'sourceIn':
			case 'sourceOut': {
				if (entity.has(TextRange)) {
					// A range's start/end are character indices, not times; an
					// unset end runs to the end of the text.
					if (name === 'start') {
						entity.set(TextRange, { start: Math.max(0, Math.trunc(toNumber(value) ?? 0)) });
					}
					if (name === 'end') {
						const end = toNumber(value);
						entity.set(TextRange, { end: end === undefined ? null : Math.max(0, Math.trunc(end)) });
					}
					return;
				}

				const trait = TIME_TRAITS[name];
				const seconds = toSeconds(value);

				if (seconds === undefined) {
					entity.remove(trait);
					return;
				}

				entity.add(trait);
				entity.set(trait, { value: this.toFrames(seconds) });
				return;
			}
			case 'src': {
				this.setSource(entity, value);
				return;
			}
			case 'objectFit': {
				const mode = typeof value === 'string' ? SCALE_MODES[value] : undefined;
				if (mode === undefined) {
					entity.remove(ScaleMode);
					return;
				}

				entity.add(ScaleMode);
				entity.set(ScaleMode, { value: mode });
				return;
			}
			case 'volume': {
				// Decibels; -Infinity is silence, not an invalid number.
				const decibels = value === -Infinity ? value : toNumber(value);
				if (decibels === undefined) {
					entity.remove(Volume);
					return;
				}

				entity.add(Volume);
				entity.set(Volume, { value: decibels });
				return;
			}
			case 'muted': {
				if (value === true) {
					entity.add(Muted);
				} else {
					entity.remove(Muted);
				}
				return;
			}
			case 'fill':
			case 'color': {
				const color = parseColor(value);

				if (color === null) {
					entity.remove(Color);
					return;
				}

				entity.add(Color);
				entity.set(Color, { value: color });
				return;
			}
			case 'opacity': {
				const opacity = toNumber(value);
				if (opacity === undefined) {
					entity.remove(Opacity);
					return;
				}

				entity.add(Opacity);
				entity.set(Opacity, { value: opacity });
				return;
			}
			case 'offset': {
				if (entity.has(ColorStop)) {
					entity.set(ColorStop, { offset: toNumber(value) ?? 0 });
				}
				return;
			}
			case 'fontSize': {
				const size = toNumber(value);
				entity.add(TextStyle);
				entity.set(TextStyle, { fontSize: size !== undefined && size > 0 ? Math.round(size) : undefined });
				return;
			}
			case 'fontFamily': {
				const family = typeof value === 'string' ? value.trim() : '';
				entity.add(TextStyle);
				entity.set(TextStyle, { fontFamily: family || undefined });
				return;
			}
			case 'fontWeight': {
				// Authored as a CSS keyword or a number; the trait keeps the numeric string.
				const weight = value === undefined || value === null ? '' : String(value).trim();
				const numeric = FONT_WEIGHTS[weight] ?? weight;
				entity.add(TextStyle);
				entity.set(TextStyle, { fontWeight: numeric && Number.isFinite(Number(numeric)) ? numeric : undefined });
				return;
			}
			case 'fontStyle': {
				entity.add(TextStyle);
				entity.set(TextStyle, { fontStyle: typeof value === 'string' ? FONT_STYLES[value] : undefined });
				return;
			}
			case 'textAlign': {
				entity.add(TextStyle);
				entity.set(TextStyle, { textAlign: typeof value === 'string' ? TEXT_ALIGNS[value] : undefined });
				return;
			}
			case 'textBaseline': {
				entity.add(TextStyle);
				entity.set(TextStyle, { textBaseline: typeof value === 'string' ? TEXT_BASELINES[value] : undefined });
				return;
			}
			case 'textCase': {
				entity.add(TextStyle);
				entity.set(TextStyle, { textCase: typeof value === 'string' ? TEXT_CASES[value] : undefined });
				return;
			}
			case 'letterSpacing': {
				entity.add(TextStyle);
				entity.set(TextStyle, { letterSpacing: toNumber(value) });
				return;
			}
			case 'leading': {
				const leading = toNumber(value);
				entity.add(TextStyle);
				entity.set(TextStyle, { leading: leading !== undefined && leading > 0 ? leading : undefined });
				return;
			}
			case 'background': {
				const color = parseColor(value);
				this.stage.entity.set(Background, { value: color ?? DEFAULT_BACKGROUND });
				return;
			}
			case 'camera': {
				if (!Array.isArray(value) || value.length !== 6) return;

				const numbers = value.map(toNumber);
				if (!numbers.includes(undefined)) {
					setCameraMatrix(this.world, (numbers as CameraMatrix));
				}
				return;
			}
			default:
				// children/ref and anything from a richer vocabulary: ignored, so
				// such a project still renders what this host understands.
				return;
		}
	}

	/** Seconds as frames of this project. */
	private toFrames(seconds: number): number {
		return secondsToFrames(seconds, this.world.get(FrameRate)?.value ?? 30);
	}

	/**
	 * Writes a track's runtime property path from its authored `property`,
	 * against the entity holding it (a `width` track under a stroke drives the
	 * line width). Called when the prop is set and again on insertion, since
	 * Solid sets props before the track has a parent.
	 */
	private resolveTrackProperty(track: Entity, property: unknown): void {
		const path = typeof property === 'string' ? trackPropertyPath(getParentEntity(track), property) : undefined;
		track.set(KeyframeTrack, { property: path ?? '' });
	}

	/**
	 * Derives `MixedCornerRadius` from the five radius props as authored: it
	 * is present while any corner has a radius of its own, and a corner
	 * without one takes `cornerRadius`. Recomputed whole on every one of the
	 * five, so the order Solid sets them in does not matter.
	 */
	private syncCornerRadii(entity: Entity): void {
		const props = entity.get(Authored)?.props ?? {};
		const corners = CORNER_PROPS.map((name) => toNumber(props[name]));
		if (corners.every((corner) => corner === undefined)) {
			entity.remove(MixedCornerRadius);
			return;
		}

		const uniform = toNumber(props.cornerRadius) ?? 0;
		const [topLeft, topRight, bottomRight, bottomLeft] = corners.map((corner) => corner ?? uniform);
		entity.add(MixedCornerRadius);
		entity.set(MixedCornerRadius, { topLeft, topRight, bottomRight, bottomLeft });
	}

	/**
	 * Entity handles are minted per lookup, so every comparison here is between
	 * entities: two handles for the same node are never the same object. Text
	 * nodes are the exception, held by identity (see `TextNode`).
	 */
	public insertNode(parent: HostNode, node: HostNode, anchor?: HostNode): void {
		if (!isSceneNode(parent)) {
			throw new Error('Text cannot contain children.');
		}

		if (!isSceneNode(node)) {
			if (!isText(parent.entity)) {
				throw new Error('Only <text> takes text children.');
			}

			if (node.parent && node.parent.entity !== parent.entity) {
				detachText(node);
			}

			// The Set keeps insertion order, so a reorder is a rebuild.
			parent.entity.add(TextParts);
			const parts = textParts(parent.entity).filter((part) => part !== node);
			const at = anchor && !isSceneNode(anchor) ? parts.indexOf(anchor) : -1;
			if (at === -1) parts.push(node);
			else parts.splice(at, 0, node);
			parent.entity.set(TextParts, new Set(parts));

			node.parent = parent;
			syncChars(parent.entity);
			return;
		}

		if (parent.entity === node.entity) return;


		if (getParentEntity(node.entity) !== parent.entity) {
			// appendChild only takes top-level entities, so a move between two
			// parents goes back through the stage on the way.
			const current = getParentNode(node.entity);

			if (current !== null) {
				removeChild(this.world, node.entity, current);
			}

			appendChild(this.world, node.entity, parent.entity);

			if (node.entity.has(KeyframeTrack)) {
				this.resolveTrackProperty(node.entity, node.entity.get(Authored)?.props.property);
			}
			if (node.entity.has(SurfaceHostHandle)) {
				syncSurfaceSize(this.world, parent.entity);
			}
		}

		const siblings = getEntityChildren(this.world, parent.entity).filter((sibling) => sibling !== node.entity);
		const at = anchor && isSceneNode(anchor) ? siblings.indexOf(anchor.entity) : -1;
		if (at === -1) siblings.push(node.entity);
		else siblings.splice(at, 0, node.entity);
		for (const [index, sibling] of siblings.entries()) {
			sibling.add(ItemIndex);
			sibling.set(ItemIndex, { value: index });
		}
	}

	public removeNode(_parent: HostNode, node: HostNode): void {
		if (!isSceneNode(node)) {
			detachText(node);
			return;
		}

		if (node.entity.has(Stage)) {
			for (const child of getEntityChildren(this.world, node.entity)) {
				this.removeNode(node, { entity: child });
			}
			node.entity.set(Background, { value: DEFAULT_BACKGROUND });
			node.entity.remove(Source);
			return;
		}
		// Destroy cascades through the subtree; the text nodes held for it go too.
		for (const entity of getEntityTree(this.world, node.entity)) {
			const texts = entity.get(TextParts);
			if (texts === undefined) continue;
			for (const text of texts) {
				text.parent = null;
			}
			entity.remove(TextParts);
		}
		// ChildOf auto-destroys orphans, so paints go with it.
		node.entity.destroy();
	}

	public getParentNode(node: HostNode): SceneNode | undefined {
		if (!isSceneNode(node)) return node.parent ?? undefined;
		const parent = getParentEntity(node.entity);
		return parent === null ? undefined : { entity: parent };
	}

	public getFirstChild(node: HostNode): HostNode | undefined {
		if (!isSceneNode(node)) return undefined;
		const text = node.entity.get(TextParts)?.values().next().value;
		if (text !== undefined) return text;
		const child = getEntityChildren(this.world, node.entity).at(0);
		return child === undefined ? undefined : { entity: child };
	}

	public getNextSibling(node: HostNode): HostNode | undefined {
		if (!isSceneNode(node)) {
			// A text entity has only text nodes to iterate.
			if (node.parent === null) return undefined;
			const parts = textParts(node.parent.entity);
			const at = parts.indexOf(node);
			return at === -1 ? undefined : parts[at + 1];
		}

		const parent = this.getParentNode(node);
		if (parent === undefined) return undefined;
		const siblings = getEntityChildren(this.world, parent.entity);
		const at = siblings.indexOf(node.entity);
		if (at === -1) return undefined;
		const next = siblings[at + 1];
		return next === undefined ? undefined : { entity: next };
	}

	/**
	 * Binds an element to the asset its `src` names. A library path or id the
	 * world already knows binds at once; anything else — a path or URL outside
	 * the library, a `generate.*` ref — is resolved through the library, and
	 * binds when it arrives, unless the element has moved on to another source
	 * or gone away in the meantime.
	 */
	private setSource(entity: Entity, value: unknown): void {
		const library = this.world.get(Library);
		const known = typeof value === 'string' ? getAsset(this.world, value) : undefined;

		if (known) {
			entity.remove(SourceRequest);
			this.bindAsset(entity, known);
			return;
		}

		if (!library || value === undefined || value === null || value === '') {
			entity.remove(SourceRequest);
			entity.remove(AssetId);
			return;
		}

		// Whatever it showed before is wrong until the new source arrives.
		entity.remove(AssetId);
		entity.add(SourceRequest);
		entity.set(SourceRequest, { value });

		void library.resolve(value).then(
			(asset) => {
				if (!entity.isAlive() || entity.get(SourceRequest)?.value !== value) return;
				entity.remove(SourceRequest);
				this.bindAsset(entity, asset);
			},
			(error: unknown) => {
				if (!entity.isAlive() || entity.get(SourceRequest)?.value !== value) return;
				entity.remove(SourceRequest);
				console.error(`[reconciler] could not resolve src:`, error);
			},
		);
	}

	/**
	 * Binds an element to an asset. A frames directory on a `<video>` or
	 * `<image>` plays as a sequence: the element's paint follows the asset.
	 */
	private bindAsset(entity: Entity, asset: Asset): void {
		entity.add(AssetId);
		entity.set(AssetId, { value: asset.id });

		const paint = entity.get(Paint)?.value;
		if (asset.type === 'SEQUENCE' && (paint === PaintType.VIDEO || paint === PaintType.IMAGE)) {
			entity.set(Paint, { value: PaintType.SEQUENCE });
		} else if (asset.type !== 'SEQUENCE' && paint === PaintType.SEQUENCE) {
			entity.set(Paint, { value: asset.type === 'IMAGE' ? PaintType.IMAGE : PaintType.VIDEO });
		}
	}

	/** The `useFile` of a project: what its `src` would bind to, as a File. */
	public async loadFile(input: AssetInput): Promise<File> {
		const known = typeof input === 'string' ? getAsset(this.world, input) : undefined;
		const asset = known ?? await getLibrary(this.world).resolve(input);
		return getAssetFile(asset);
	}

	public dispose(): void {
		this.removeNode(this.stage, this.stage);
	}
}

const documents = new WeakMap<World, RuntimeDocument>();

export function getRuntimeDocument(world: World): RuntimeDocument {
	const document = documents.get(world);

	if (document === undefined) {
		throw new Error("The requested world has no runtime document");
	}

	return document;
}

export function createRuntimeDocument(world: World): RuntimeDocument {
	const document = new RuntimeDocument(world);
	documents.set(world, document);
	return document;
}
