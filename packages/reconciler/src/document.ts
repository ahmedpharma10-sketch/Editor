/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import {
	Active,
	appendChild,
	AssetId,
	Assets,
	Audio,
	Background,
	Blur,
	Chars,
	ClipsContent,
	createEntity,
	DEFAULT_BACKGROUND,
	Color,
	ColorStop,
	Effect,
	EffectType,
	End,
	FontStyle,
	FrameRate,
	Loop,
	Geometry,
	GeometryType,
	getEntityTree,
	getParentEntity,
	getParentNode,
	isText,
	ItemIndex,
	Keyframe,
	KeyframeTrack,
	Muted,
	Name,
	Offset,
	Opacity,
	Paint,
	PaintType,
	parseColor,
	Playback,
	Position,
	removeChild,
	resizeEntity,
	ScaleMode,
	ScaleModeType,
	secondsToFrames,
	getEntityChildren,
	Group,
	Sequential,
	Stage,
	Root,
	Rotation,
	Scene,
	Selected,
	Shadow,
	Source,
	SourceIn,
	SourceOut,
	setCameraMatrix,
	Start,
	Stroke,
	StrokeCap,
	StrokeJoin,
	StrokeStyle,
	TextAlign,
	TextBaseline,
	TextStyle,
	Volume,
} from '@diffusionstudio/runtime';
import { isPropValue, LOOP_ATTR, parseTime, SOURCE_ATTR } from '@diffusionstudio/jsx';

import type { CameraMatrix, PropertyPath } from '@diffusionstudio/runtime';
import type { PropValue } from '@diffusionstudio/jsx';
import { trait, type Entity, type World } from 'koota';
import type { ProjectDocument } from './host';

export interface SceneNode {
	readonly entity: Entity;
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
	opacity: 'opacity',
	cornerRadius: 'vertexRadius',
	volume: 'volume',
	color: 'color',
	offset: 'stop.offset',
	blur: 'blur',
	value: 'effect.value',
};

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

const EFFECT_TYPES: Record<string, EffectType> = {
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
};

const FONT_WEIGHTS: Record<string, string> = {
	normal: '400',
	bold: '700',
};

function toNumber(value: unknown) {
	if (value === undefined || value === null) {
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

	public createElement(tag: string): SceneNode {
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
			case 'radialGradientPaint': {
				entity = createEntity(this.world);
				entity.add(Paint);
				entity.set(Paint, { value: PAINT_TYPES[name]! });
				if (name === 'solidPaint') entity.add(Color);
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
					`<${tag}> is not supported yet (only <stage>, <scene>, <group>, <sequence>, <rect>, <text>, <video>, <image>, <audio>, <solidPaint>, <linearGradientPaint>, <radialGradientPaint>, <colorStop>, <stroke>, <shadow>, <effect>, <keyframeTrack> and <keyframe>).`,
				);
		}

		if (entity !== this.stage.entity) {
			entity.add(Authored);
			entity.set(Authored, { tag: name, props: {} });
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
			case 'width':
			case 'height': {
				const size = toNumber(value);
				if (entity.has(Stroke)) {
					// A stroke's width is its line width; it has no box.
					if (name === 'width') entity.set(StrokeStyle, { width: size ?? 1 });
					return;
				}
				if (size === undefined) return;
				resizeEntity(this.world, entity, { [name]: size });
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
				if (!entity.has(Effect)) return;
				const type = typeof value === 'string' ? EFFECT_TYPES[value] : undefined;
				entity.set(Effect, { type: type ?? EffectType.LAYER_BLUR });
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
				const fps = this.world.get(FrameRate)?.value ?? 30;
				entity.set(Keyframe, { time: seconds === undefined ? 0 : secondsToFrames(seconds, fps) });
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
				const trait = TIME_TRAITS[name];
				const seconds = toSeconds(value);

				if (seconds === undefined) {
					entity.remove(trait);
					return;
				}

				const fps = this.world.get(FrameRate)?.value ?? 30;
				entity.add(trait);
				entity.set(trait, { value: secondsToFrames(seconds, fps) });
				return;
			}
			case 'src': {
				if (typeof value !== 'string' || !this.world.get(Assets)?.has(value)) {
					entity.remove(AssetId);
					return;
				}

				entity.add(AssetId);
				entity.set(AssetId, { value });
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

	/**
	 * Writes a track's runtime property path from its authored `property`,
	 * against the entity holding it (a `width` track under a stroke drives the
	 * line width). Called when the prop is set and again on insertion, since
	 * Solid sets props before the track has a parent.
	 */
	private resolveTrackProperty(track: Entity, property: unknown): void {
		let path = typeof property === 'string' ? TRACK_PROPERTIES[property] : undefined;
		if (path === 'width' && getParentEntity(track)?.has(Stroke)) path = 'stroke.width';
		track.set(KeyframeTrack, { property: path ?? '' });
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
