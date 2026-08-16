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

import {
	Background,
	createEntity,
	DEFAULT_BACKGROUND,
	Color,
	Geometry,
	GeometryType,
	getDocument,
	getParentEntity,
	ItemIndex,
	parseColor,
	Position,
	resizeEntity,
	getEntityChildren,
	DocumentRoot,
} from '@diffusionstudio/runtime';

import type { Entity, World } from 'koota';
import type { ProjectDocument } from '@diffusionstudio/jsx';

/**
 * A host node: a handle around an element's entity. Koota entities are plain
 * numbers, which Solid's universal renderer would take for text (`insert()`
 * turns numbers into text nodes), so nodes wrap them. One handle per entity,
 * so node identity is stable across getParentNode/getFirstChild/getNextSibling.
 */
export interface SceneNode {
	readonly entity: Entity;
}

function toNumber(value: unknown) {
	if (value === undefined || value === null) {
		return undefined;
	}

	const number = Number(value);
	return Number.isFinite(number) ? number : undefined;
}

export class RuntimeDocument implements ProjectDocument<SceneNode> {
	/** The mount root. Both it and the <stage> element stand for the document root entity. */
	public readonly stage: SceneNode;
	private readonly world: World;

	public constructor(world: World) {
		this.world = world;
		this.stage = { entity: getDocument(world) };
	}

	public createElement(tag: string): SceneNode {
		if (tag === 'stage') {
			return this.stage;
		} else if (tag === 'rect') {
			const world = this.world;
			const entity = createEntity(world);
			entity.add(Geometry);
			entity.set(Geometry, { value: GeometryType.RECT });
			entity.add(Position);
			entity.set(Position, { x: 0, y: 0 });
			resizeEntity(world, entity, { width: 100, height: 100 });

			return { entity };
		} else {
			throw new Error(`<${tag}> is not supported yet (only <stage> and <rect>).`);
		}
	}

	public createTextNode(): SceneNode {
		throw new Error('Text children are not supported.');
	}

	public replaceText(): void { }

	public isTextNode(): boolean {
		return false;
	}

	public setProperty({ entity }: SceneNode, name: string, value: unknown): void {
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
				const color = typeof value === 'string' ? parseColor(value) : null;

				if (color === null) {
					entity.remove(Color);
					return;
				}

				entity.add(Color);
				entity.set(Color, { value: color });
				return;
			}
			case 'background': {
				const color = typeof value === 'string' ? parseColor(value) : null;
				this.world.set(Background, { value: color ?? DEFAULT_BACKGROUND });
				return;
			}
			default:
				// children/ref and anything from a richer vocabulary: ignored, so
				// such a project still renders what this host understands.
				return;
		}
	}

	public insertNode(parent: SceneNode, node: SceneNode, anchor?: SceneNode): void {
		if (parent === node) return;
		// createEntity already parented the node to the document (= the stage).
		const siblings = this.children(parent).filter((sibling) => sibling !== node);
		const at = anchor ? siblings.indexOf(anchor) : -1;
		if (at === -1) siblings.push(node);
		else siblings.splice(at, 0, node);
		for (const [index, sibling] of siblings.entries()) {
			sibling.entity.add(ItemIndex);
			sibling.entity.set(ItemIndex, { value: index });
		}
	}

	public removeNode(_parent: SceneNode, node: SceneNode): void {
		if (node.entity.has(DocumentRoot)) {
			for (const child of this.children(node)) {
				this.removeNode(node, child);
			}
			this.world.set(Background, { value: DEFAULT_BACKGROUND });
			return;
		}
		// ChildOf auto-destroys orphans, so paints go with it.
		node.entity.destroy();
	}

	public getParentNode(node: SceneNode): SceneNode | undefined {
		const parent = getParentEntity(node.entity);
		return parent === null ? undefined : { entity: parent };
	}

	public getFirstChild(node: SceneNode): SceneNode | undefined {
		return this.children(node)[0];
	}

	public getNextSibling(node: SceneNode): SceneNode | undefined {
		const parent = this.getParentNode(node);
		if (parent === undefined) return undefined;
		const siblings = this.children(parent);
		return siblings[siblings.indexOf(node) + 1];
	}

	public dispose(): void {
		this.removeNode(this.stage, this.stage);
	}

	/** Children of `parent` in draw order, as handles. */
	private children(parent: SceneNode): SceneNode[] {
		return getEntityChildren(this.world, parent.entity).map((entity) => ({ entity }));
	}
}
