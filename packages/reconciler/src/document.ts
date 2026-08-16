/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import {
	Background,
	createEntity,
	DEFAULT_BACKGROUND,
	Color,
	Geometry,
	GeometryType,
	getParentEntity,
	ItemIndex,
	parseColor,
	Position,
	resizeEntity,
	getEntityChildren,
	DocumentRoot,
	Root,
	Source,
	setCameraMatrix,
} from '@diffusionstudio/runtime';
import { SOURCE_ATTR } from '@diffusionstudio/jsx';

import type { PropValue } from '@diffusionstudio/jsx';
import type { CameraMatrix } from '@diffusionstudio/runtime';
import type { Entity, World } from 'koota';
import type { ProjectDocument } from './host';

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

/**
 * A property the editor changed, in the vocabulary of the JSX rather than of
 * the traits it was written to: `source` is the element it belongs to (its
 * SOURCE_ATTR stamp) and `value` is what a project would have written there.
 * Whoever mounts the document decides what to do with these — writing them
 * back to disk is the point, but nothing here knows about a disk.
 */
export interface EntityEdit {
	source: string;
	name: string;
	value: PropValue;
}

export class RuntimeDocument implements ProjectDocument<SceneNode> {
	/** The mount root. Both it and the <stage> element stand for the document root entity. */
	public readonly stage: SceneNode;
	private readonly world: World;
	private sink?: (edit: EntityEdit) => void;

	public constructor(world: World) {
		this.world = world;
		this.stage = { entity: world.get(Root)! };
	}

	/**
	 * Listens for edits the editor makes through `editProperty`. One sink at a
	 * time — a second call replaces the first. Returns an unsubscribe.
	 */
	public onEdit(sink: (edit: EntityEdit) => void): () => void {
		this.sink = sink;
		return () => {
			if (this.sink === sink) {
				this.sink = undefined;
			}
		};
	}

	/**
	 * Writes an edit to the document and saves the changes to the source
	 */
	public editProperty(entity: Entity, name: string, value: PropValue): void {
		this.setProperty({ entity }, name, value);
		this.reportEdit(entity, name, value);
	}

	/**
	 * Reports an edit whose change the editor already made itself
	 */
	public reportEdit(entity: Entity, name: string, value: PropValue): void {
		const source = entity.get(Source)?.value;

		if (source) {
			this.sink?.({ source, name, value });
		}
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
			case SOURCE_ATTR: {
				if (typeof value !== 'string' || !value) {
					entity.remove(Source);
					return;
				}

				entity.add(Source);
				entity.set(Source, { value });
				return;
			}
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
				const color = parseColor(value);

				if (color === null) {
					entity.remove(Color);
					return;
				}

				entity.add(Color);
				entity.set(Color, { value: color });
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
			node.entity.set(Background, { value: DEFAULT_BACKGROUND });
			node.entity.remove(Source);
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
