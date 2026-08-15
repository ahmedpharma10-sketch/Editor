/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The JSX host over the runtime world: Solid's universal renderer (via
// @diffusionstudio/jsx) writes project JSX straight into runtime entities, so
// a rendered project IS the composition, with no intermediate tree. This is
// the only file in the reconciler that knows how the runtime models nodes.
// Supported tags for now: <stage> (the composition root, a Scene) and <rect>,
// with x, y, width, height and fill (rect only).

import { Not } from 'koota';
import {
	appendChild,
	ChildOf,
	ClipsContent,
	Color,
	createEntity,
	Deleted,
	Geometry,
	GeometryType,
	getDocument,
	getParentEntity,
	ItemIndex,
	Name,
	Paint,
	PaintType,
	parseColor,
	Playback,
	Position,
	resizeEntity,
	Scene,
	sortByItemIndex,
	switchActiveScene,
} from '@diffusionstudio/runtime';

import type { Entity, World } from 'koota';
import type { ProjectDocument } from '@diffusionstudio/jsx';

const TAGS = ['stage', 'rect'] as const;
type Tag = (typeof TAGS)[number];

const isTag = (tag: string): tag is Tag => (TAGS as readonly string[]).includes(tag);

/**
 * A host node: an element's entity plus its tag. Entities are plain numbers,
 * which Solid's renderer would take for text, so nodes wrap them.
 */
export interface SceneNode {
	readonly entity: Entity;
	/** null for the mount root (the world's document root). */
	readonly tag: Tag | null;
}

const toNumber = (value: unknown): number | undefined => {
	if (value === undefined || value === null) return undefined;
	const number = Number(value);
	return Number.isFinite(number) ? number : undefined;
};

export class RuntimeDocument implements ProjectDocument<SceneNode> {
	/** The mount root: the world's document root entity. */
	public readonly stage: SceneNode;

	/** Elements this document created, by entity, so ordering only ever considers them (never paint sub-entities). */
	private readonly nodes = new Map<Entity, SceneNode>();

	public constructor(private readonly world: World) {
		this.stage = { entity: getDocument(world), tag: null };
	}

	public createElement(tag: string): SceneNode {
		if (!isTag(tag)) throw new Error(`<${tag}> is not supported yet (only <stage> and <rect>).`);

		const world = this.world;
		const entity = createEntity(world);
		entity.add(Geometry);
		entity.set(Geometry, { value: GeometryType.RECT });
		entity.add(Position);
		entity.set(Position, { x: 0, y: 0 });

		if (tag === 'stage') {
			// A scene is a RECT carrying Scene/ClipsContent/Playback plus a solid
			// fill; the same recipe the scene tool uses.
			entity.add(Scene);
			entity.add(ClipsContent);
			entity.add(Playback);
			entity.add(Name);
			entity.set(Name, { value: 'Stage' });
			resizeEntity(world, entity, { width: 1920, height: 1080 });
			this.setFill(entity, '#000000');
		} else {
			resizeEntity(world, entity, { width: 100, height: 100 });
		}

		const node: SceneNode = { entity, tag };
		this.nodes.set(entity, node);
		return node;
	}

	public createTextNode(): SceneNode {
		throw new Error('Text children are not supported.');
	}

	public replaceText(): void {}

	public isTextNode(): boolean {
		return false;
	}

	public setProperty(node: SceneNode, name: string, value: unknown): void {
		const { entity } = node;
		switch (name) {
			case 'x':
			case 'y': {
				entity.add(Position);
				entity.set(Position, { [name]: toNumber(value) ?? 0 });
				return;
			}
			case 'width':
			case 'height': {
				const size = toNumber(value);
				if (size === undefined) return;
				resizeEntity(this.world, entity, { [name]: size });
				return;
			}
			case 'fill': {
				if (node.tag !== 'rect') return;
				this.setFill(entity, value);
				return;
			}
			default:
				// children/ref and anything from a richer vocabulary: ignored, so
				// such a project still renders what this host understands.
				return;
		}
	}

	public insertNode(parent: SceneNode, node: SceneNode, anchor?: SceneNode): void {
		if (parent === this.stage) {
			if (node.tag !== 'stage') throw new Error('The root element must be <stage>.');
			// createEntity already parented the node to the document.
			switchActiveScene(this.world, node.entity);
		} else {
			if (parent.tag !== 'stage') throw new Error('<rect> cannot have children.');
			appendChild(this.world, node.entity, parent.entity);
		}
		this.reorder(parent, node, anchor);
	}

	public removeNode(_parent: SceneNode, node: SceneNode): void {
		this.nodes.delete(node.entity);
		// ChildOf auto-destroys orphans, so paints and children go with it.
		node.entity.destroy();
	}

	/**
	 * Destroys everything this document rendered. Solid's universal render
	 * disposer only tears down the reactive graph, never the host nodes.
	 */
	public dispose(): void {
		for (const node of this.children(this.stage)) this.removeNode(this.stage, node);
		this.nodes.clear();
	}

	public getParentNode(node: SceneNode): SceneNode | undefined {
		const parent = getParentEntity(node.entity);
		if (parent === null) return undefined;
		return parent === this.stage.entity ? this.stage : this.nodes.get(parent);
	}

	public getFirstChild(node: SceneNode): SceneNode | undefined {
		return this.children(node)[0];
	}

	public getNextSibling(node: SceneNode): SceneNode | undefined {
		const parent = this.getParentNode(node);
		if (!parent) return undefined;
		const siblings = this.children(parent);
		return siblings[siblings.indexOf(node) + 1];
	}

	/** Element children of `parent` in draw order. */
	private children(parent: SceneNode): SceneNode[] {
		return [...this.world.query(ChildOf(parent.entity), Not(Deleted))]
			.sort(sortByItemIndex)
			.map((entity) => this.nodes.get(entity))
			.filter((node): node is SceneNode => node !== undefined);
	}

	/** Places `node` before `anchor` (or last) by rewriting sibling ItemIndex. */
	private reorder(parent: SceneNode, node: SceneNode, anchor?: SceneNode): void {
		const siblings = this.children(parent).filter((sibling) => sibling !== node);
		const at = anchor ? siblings.indexOf(anchor) : -1;
		if (at === -1) siblings.push(node);
		else siblings.splice(at, 0, node);
		for (const [index, sibling] of siblings.entries()) {
			sibling.entity.add(ItemIndex);
			sibling.entity.set(ItemIndex, { value: index });
		}
	}

	private setFill(entity: Entity, value: unknown): void {
		const color = typeof value === 'string' ? parseColor(value) : null;
		const paint = this.world.queryFirst(ChildOf(entity), Paint);

		if (color === null) {
			paint?.destroy();
			return;
		}

		if (paint) {
			paint.set(Color, { value: color });
			return;
		}

		const fill = createEntity(this.world);
		fill.add(Paint);
		fill.set(Paint, { value: PaintType.SOLID });
		fill.add(Color);
		fill.set(Color, { value: color });
		appendChild(this.world, fill, entity);
	}
}
