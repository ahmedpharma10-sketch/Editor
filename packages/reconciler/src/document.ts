/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import {
	ActiveScene,
	appendChild,
	Background,
	ClipsContent,
	DEFAULT_BACKGROUND,
	Color,
	Geometry,
	GeometryType,
	getParentEntity,
	getParentNode,
	ItemIndex,
	Name,
	parseColor,
	Playback,
	Position,
	removeChild,
	resizeEntity,
	getEntityChildren,
	DocumentRoot,
	Root,
	Scene,
	Source,
	setCameraMatrix,
	switchActiveScene,
	Size,
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
		switch (tag) {
			case 'stage':
				return this.stage;
			case 'scene': {
				const entity = this.world.spawn(
					Geometry({ value: GeometryType.RECT }),
					Position({ x: 0, y: 0 }),
					Size({ width: 1920, height: 1080 }),
					Scene,
					ClipsContent,
					Playback,
				);
				return { entity };
			}
			case 'rect':
				const entity = this.world.spawn(
					Geometry({ value: GeometryType.RECT }),
					Position({ x: 0, y: 0 }),
					Size({ width: 100, height: 100 }),
				);
				return { entity };
			default:
				throw new Error(`<${tag}> is not supported yet (only <stage>, <scene> and <rect>).`);
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
			case 'name': {
				if (typeof value !== 'string' || !value) {
					entity.remove(Name);
					return;
				}

				entity.add(Name);
				entity.set(Name, { value });
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

	/**
	 * Node handles are minted per lookup, so every comparison here is between
	 * entities: two handles for the same node are never the same object.
	 */
	public insertNode(parent: SceneNode, node: SceneNode, anchor?: SceneNode): void {
		if (parent.entity === node.entity) return;

		// Scenes own a timeline, so one inside another has no coherent reading.
		if (node.entity.has(Scene) && !parent.entity.has(DocumentRoot)) {
			throw new Error('<scene> is only allowed as a direct child of <stage>.');
		}

		if (getParentEntity(node.entity) !== parent.entity) {
			// appendChild only takes top-level entities, so a move between two
			// parents goes back through the document on the way.
			const current = getParentNode(node.entity);
			if (current !== null) removeChild(this.world, node.entity, current);
			// <stage> is the document root, which is where entities spawn.
			if (!parent.entity.has(DocumentRoot)) {
				appendChild(this.world, node.entity, parent.entity);
			}
		}

		const siblings = this.childEntities(parent).filter((sibling) => sibling !== node.entity);
		const at = anchor ? siblings.indexOf(anchor.entity) : -1;
		if (at === -1) siblings.push(node.entity);
		else siblings.splice(at, 0, node.entity);
		for (const [index, sibling] of siblings.entries()) {
			sibling.add(ItemIndex);
			sibling.set(ItemIndex, { value: index });
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
		// The playhead cannot be left aimed at an entity that is going away.
		if (this.world.get(ActiveScene)?.entity === node.entity) {
			switchActiveScene(this.world, null);
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
		const siblings = this.childEntities(parent);
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
		return this.childEntities(parent).map((entity) => ({ entity }));
	}

	/** Children of `parent` in draw order. */
	private childEntities(parent: SceneNode): Entity[] {
		return getEntityChildren(this.world, parent.entity);
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
