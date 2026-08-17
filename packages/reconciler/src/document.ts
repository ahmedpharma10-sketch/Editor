/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import {
	Active,
	appendChild,
	Background,
	Chars,
	ClipsContent,
	createEntity,
	DEFAULT_BACKGROUND,
	Color,
	End,
	FontStyle,
	FrameRate,
	Geometry,
	GeometryType,
	getEntityTree,
	getParentEntity,
	getParentNode,
	isText,
	ItemIndex,
	Name,
	Offset,
	parseColor,
	Playback,
	Position,
	removeChild,
	resizeEntity,
	secondsToFrames,
	getEntityChildren,
	Stage,
	Root,
	Rotation,
	Scene,
	Selected,
	Source,
	SourceIn,
	SourceOut,
	setCameraMatrix,
	Start,
	TextAlign,
	TextBaseline,
	TextStyle,
} from '@diffusionstudio/runtime';
import { parseTime, SOURCE_ATTR } from '@diffusionstudio/jsx';

import type { CameraMatrix } from '@diffusionstudio/runtime';
import type { Entity, World } from 'koota';
import type { ProjectDocument } from './host';

export interface SceneNode {
	readonly entity: Entity;
}

export interface TextNode {
	text: string;
	parent: SceneNode | null;
}

export type HostNode = SceneNode | TextNode;

export function isSceneNode(node: HostNode): node is SceneNode {
	return 'entity' in node;
}

const TIME_TRAITS = {
	start: Start,
	end: End,
	sourceIn: SourceIn,
	sourceOut: SourceOut,
} as const;

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
	private readonly texts = new Map<Entity, TextNode[]>();

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
			default:
				throw new Error(`<${tag}> is not supported yet (only <stage>, <scene>, <rect> and <text>).`);
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
			node.parent.entity.add(Chars);
			node.parent.entity.set(Chars, { value: this.buildText(node) });
		}
	}

	public isTextNode(node: HostNode): boolean {
		return !isSceneNode(node);
	}

	public setProperty(node: HostNode, name: string, value: unknown): void {
		if (!isSceneNode(node)) return;
		const { entity } = node;

		switch (name) {
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
				entity.add(Position);
				entity.set(Position, { [name]: toNumber(value) ?? 0 });
				return;
			}
			case 'offsetX':
			case 'offsetY': {
				entity.add(Offset);
				entity.set(Offset, { [name === 'offsetX' ? 'x' : 'y']: toNumber(value) ?? 0 });
				return;
			}
			case 'rotation': {
				entity.add(Rotation);
				entity.set(Rotation, { value: toNumber(value) ?? 0 });
				return;
			}
			case 'width':
			case 'height': {
				const size = toNumber(value);
				if (size === undefined) return;
				resizeEntity(this.world, entity, { [name]: size });
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
	 * Entity handles are minted per lookup, so every comparison here is between
	 * entities: two handles for the same node are never the same object. Text
	 * nodes are the exception, held by identity (see `TextNode`).
	 */
	public insertNode(parent: HostNode, node: HostNode, anchor?: HostNode): void {
		if (!isSceneNode(parent)) {
			throw new Error('Text cannot contain children.');
		}

		if (!isSceneNode(node)) {
			this.insertText(parent, node, anchor);
			return;
		}

		if (parent.entity === node.entity) return;

		if (isText(parent.entity)) {
			throw new Error('<text> only takes text children.');
		}

		// Scenes own a timeline, so one inside another has no coherent reading.
		if (node.entity.has(Scene) && !parent.entity.has(Stage)) {
			throw new Error('<scene> is only allowed as a direct child of <stage>.');
		}

		if (getParentEntity(node.entity) !== parent.entity) {
			// appendChild only takes top-level entities, so a move between two
			// parents goes back through the stage on the way.
			const current = getParentNode(node.entity);

			if (current !== null) {
				removeChild(this.world, node.entity, current);
			}

			appendChild(this.world, node.entity, parent.entity);
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
			this.removeText(node);
			return;
		}

		if (node.entity.has(Stage)) {
			for (const child of this.children(node)) {
				this.removeNode(node, child);
			}
			node.entity.set(Background, { value: DEFAULT_BACKGROUND });
			node.entity.remove(Source);
			return;
		}
		// Destroy cascades through the subtree; the text nodes held for it go too.
		for (const entity of getEntityTree(this.world, node.entity)) {
			const texts = this.texts.get(entity);
			if (texts === undefined) continue;
			for (const text of texts) {
				text.parent = null;
			}
			this.texts.delete(entity);
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
		return this.texts.get(node.entity)?.[0] ?? this.children(node)[0];
	}

	public getNextSibling(node: HostNode): HostNode | undefined {
		if (!isSceneNode(node)) {
			// A text entity has only text nodes to iterate.
			const texts = node.parent ? this.texts.get(node.parent.entity) : undefined;
			const at = texts?.indexOf(node) ?? -1;
			return at === -1 ? undefined : texts![at + 1];
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

	/** Children of `parent` in draw order, as handles. */
	private children(parent: SceneNode): SceneNode[] {
		return getEntityChildren(this.world, parent.entity).map((entity) => ({ entity }));
	}

	private insertText(parent: SceneNode, node: TextNode, anchor?: HostNode): void {
		if (!isText(parent.entity)) {
			throw new Error('Only <text> takes text children.');
		}

		if (node.parent && node.parent.entity !== parent.entity) {
			this.removeText(node);
		}

		let texts = this.texts.get(parent.entity);
		if (texts === undefined) {
			texts = [];
			this.texts.set(parent.entity, texts);
		}

		const current = texts.indexOf(node);
		if (current !== -1) texts.splice(current, 1);
		const at = anchor && !isSceneNode(anchor) ? texts.indexOf(anchor) : -1;
		if (at === -1) texts.push(node);
		else texts.splice(at, 0, node);

		node.parent = parent;
		node.parent.entity.add(Chars);
		node.parent.entity.set(Chars, { value: this.buildText(node) });
	}

	private removeText(node: TextNode): void {
		const parent = node.parent;
		if (parent === null) return;

		const texts = this.texts.get(parent.entity);
		const at = texts?.indexOf(node) ?? -1;
		if (at !== -1) texts!.splice(at, 1);
		node.parent = null;

		if (parent.entity.isAlive()) {
			parent.entity.add(Chars);
			parent.entity.set(Chars, { value: this.buildText(node) });
		}
	}

	private buildText(node: TextNode): string {
		if (isSceneNode(node) || node.parent === null) return '';

		return (this.texts.get(node.parent.entity) ?? []).map((node) => node.text).join('');
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
