/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The JSX host over the runtime world: Solid's universal renderer (via
// @diffusionstudio/jsx) writes project JSX straight into runtime entities, so
// a rendered project IS the composition, with no intermediate tree. This is
// the only file in the reconciler that knows how the runtime models nodes.
//
// Supported tags for now:
// - <stage>: the infinite canvas, i.e. the world's document root. It has no
//   size or position; `background` sets the canvas color.
// - <rect>: a rect entity with x, y, width, height and fill (the entity's
//   own Color trait, so a filled rect needs no paint sub-entities).

import { Not } from 'koota';
import {
	Background,
	ChildOf,
	createEntity,
	DEFAULT_BACKGROUND,
	Color,
	Deleted,
	Geometry,
	GeometryType,
	getDocument,
	getParentEntity,
	ItemIndex,
	parseColor,
	Position,
	resizeEntity,
	sortByItemIndex,
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
	/** null for the mount root. */
	readonly tag: Tag | null;
}

const toNumber = (value: unknown): number | undefined => {
	if (value === undefined || value === null) return undefined;
	const number = Number(value);
	return Number.isFinite(number) ? number : undefined;
};

export class RuntimeDocument implements ProjectDocument<SceneNode> {
	/** The mount root. Both it and the <stage> element stand for the document root entity. */
	public readonly stage: SceneNode;

	/** Elements this document created, by entity, so ordering only ever considers them (never paint sub-entities). */
	private readonly nodes = new Map<Entity, SceneNode>();
	private stageNode: SceneNode | undefined;

	public constructor(private readonly world: World) {
		this.stage = { entity: getDocument(world), tag: null };
	}

	public createElement(tag: string): SceneNode {
		if (!isTag(tag)) throw new Error(`<${tag}> is not supported yet (only <stage> and <rect>).`);

		if (tag === 'stage') {
			if (this.stageNode) throw new Error('A project renders exactly one <stage>.');
			// The stage is the document root: infinite, no entity of its own.
			this.stageNode = { entity: this.stage.entity, tag };
			return this.stageNode;
		}

		const world = this.world;
		const entity = createEntity(world);
		entity.add(Geometry);
		entity.set(Geometry, { value: GeometryType.RECT });
		entity.add(Position);
		entity.set(Position, { x: 0, y: 0 });
		resizeEntity(world, entity, { width: 100, height: 100 });

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
				this.setFill(entity, value);
				return;
			}
			case 'background': {
				this.setBackground(value);
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
			// The stage is the root itself; nothing to attach.
			return;
		}
		if (parent.tag !== 'stage') throw new Error('<rect> cannot have children.');
		if (node.tag === 'stage') throw new Error('<stage> is only allowed as the root element.');

		// createEntity already parented the node to the document (= the stage).
		this.reorder(parent, node, anchor);
	}

	public removeNode(_parent: SceneNode, node: SceneNode): void {
		if (node.tag === 'stage') {
			for (const child of this.children(node)) this.removeNode(node, child);
			this.stageNode = undefined;
			this.setBackground(undefined);
			return;
		}
		this.nodes.delete(node.entity);
		// ChildOf auto-destroys orphans, so paints go with it.
		node.entity.destroy();
	}

	/**
	 * Destroys everything this document rendered. Solid's universal render
	 * disposer only tears down the reactive graph, never the host nodes.
	 */
	public dispose(): void {
		if (this.stageNode) this.removeNode(this.stage, this.stageNode);
		for (const node of this.children(this.stage)) this.removeNode(this.stage, node);
		this.nodes.clear();
	}

	public getParentNode(node: SceneNode): SceneNode | undefined {
		if (node.tag === 'stage') return this.stage;
		const parent = getParentEntity(node.entity);
		if (parent === null) return undefined;
		return parent === this.stage.entity ? (this.stageNode ?? this.stage) : this.nodes.get(parent);
	}

	public getFirstChild(node: SceneNode): SceneNode | undefined {
		if (node === this.stage) return this.stageNode;
		return this.children(node)[0];
	}

	public getNextSibling(node: SceneNode): SceneNode | undefined {
		if (node.tag === 'stage') return undefined;
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

	private setBackground(value: unknown): void {
		const color = typeof value === 'string' ? parseColor(value) : null;
		this.world.set(Background, { value: color ?? DEFAULT_BACKGROUND });
	}

	/** `fill` is the entity's own Color trait (intrinsic solid fill), no paint sub-entity involved. */
	private setFill(entity: Entity, value: unknown): void {
		const color = typeof value === 'string' ? parseColor(value) : null;

		if (color === null) {
			entity.remove(Color);
			return;
		}

		entity.add(Color);
		entity.set(Color, { value: color });
	}
}
