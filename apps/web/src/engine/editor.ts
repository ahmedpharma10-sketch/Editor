/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The editing side of a mounted project: what an editor does to the document
 * (change a prop, add an element) and how those changes are reported back in
 * the vocabulary of the JSX, so whoever mounted the project can write them to
 * the source. The document itself only knows how to be rendered into; this is
 * where the commands live.
 */

import { Chars, getEntityChildren, getParentEntity, isText, Source } from '@diffusionstudio/runtime';
import { SOURCE_ATTR } from '@diffusionstudio/jsx';
import { createRoot } from 'solid-js';

import { getRuntimeDocument, insert, isSceneNode, withDocument } from '@diffusionstudio/reconciler';

import type { PropValue } from '@diffusionstudio/jsx';
import type { Entity, World } from 'koota';
import type { HostNode, ProjectDocument, RuntimeDocument } from '@diffusionstudio/reconciler';

/**
 * A property the editor changed, in the vocabulary of the JSX rather than of
 * the traits it was written to: `source` is the element it belongs to (its
 * SOURCE_ATTR stamp) and `value` is what a project would have written there.
 * Whoever mounts the document decides what to do with these — writing them
 * back to disk is the point, but nothing here knows about a disk.
 */
export interface PropEdit {
	kind: 'prop';
	source: string;
	name: string;
	value: PropValue;
}

/**
 * An element the editor added. The entity already exists in the world when
 * this is reported, stamped with the pending `source`; whoever writes it to
 * disk answers with the real one and re-stamps (see `isPendingSource`).
 * `parent` is the source of the element it was inserted under and `before`,
 * when present, the sibling it was placed in front of; without it, appended.
 * `text` is the literal content of a text element (its `children`), which is
 * not a prop and so travels separately.
 */
export interface InsertEdit {
	kind: 'insert';
	source: string;
	parent: string;
	tag: string;
	props: Record<string, PropValue>;
	before?: string;
	text?: string;
}

export type EntityEdit = PropEdit | InsertEdit;

/**
 * Sources of elements the editor created that no write has named yet. Shaped
 * so `parseSource` rejects them (no `:`): they must never reach a file as an
 * address, only as the key a write answers with the real source for.
 */
const PENDING_PREFIX = 'pending#';
let pendingCounter = 0;

export const isPendingSource = (source: string): boolean => source.startsWith(PENDING_PREFIX);

/** Whether a value is one a source file could spell: JSON, essentially. */
function isPropValue(value: unknown): value is PropValue {
	if (value === null) return true;
	switch (typeof value) {
		case 'string':
		case 'number':
		case 'boolean':
			return true;
		case 'object':
			return Array.isArray(value)
				? value.every(isPropValue)
				: Object.values(value as object).every(isPropValue);
		default:
			return false;
	}
}

/** What `insertElement` learns about each element while it renders. */
interface Recorded {
	tag: string;
	props: Record<string, PropValue>;
}

export class DocumentEditor {
	private readonly world: World;
	private sink?: (edit: EntityEdit) => void;

	public constructor(world: World) {
		this.world = world;
	}

	/** The document of the current mount. */
	private get document(): RuntimeDocument {
		return getRuntimeDocument(this.world);
	}

	/**
	 * Listens for edits made through this editor. One sink at a time — a
	 * second call replaces the first. Returns an unsubscribe.
	 */
	public onEdit(sink: (edit: EntityEdit) => void): () => void {
		this.sink = sink;
		return () => {
			if (this.sink === sink) {
				this.sink = undefined;
			}
		};
	}

	/** Writes a prop to the document and reports it. */
	public editProperty(entity: Entity, name: string, value: PropValue): void {
		this.document.setProperty({ entity }, name, value);
		this.reportEdit(entity, name, value);
	}

	/** Reports an edit whose change the editor already made itself. */
	public reportEdit(entity: Entity, name: string, value: PropValue): void {
		const source = entity.get(Source)?.value;

		if (source) {
			this.sink?.({ kind: 'prop', source, name, value });
		}
	}

	/**
	 * Adds elements the way a project would author them, under `parent` and in
	 * front of `anchor` (or last):
	 *
	 *     editor.insertElement(scene, () => <Rect x={10} width={200} height={300} />)
	 *
	 * `element` is rendered like a piece of a project (the PascalCase
	 * components of "./elements", since an app's own JSX compiles for the DOM),
	 * so the entities are real from this call on: same recipe, traits, and
	 * ordering a compiled render gets. What they lack is a name in the file, so
	 * each is stamped with a pending source that `restamp` replaces once the
	 * write answers, and reported as an insert in creation order (parents
	 * before children, so a nested tree lands in one write). Returns the
	 * top-level entities created; nothing when the parent has no source to be
	 * written under.
	 */
	public insertElement(parent: Entity, element: () => unknown, anchor?: Entity): Entity[] {
		if (!parent.get(Source)?.value) return [];

		const created = new Map<Entity, Recorded>();
		const dispose = createRoot((dispose) => {
			withDocument(this.recording(created), () =>
				insert({ entity: parent }, element, anchor ? { entity: anchor } : null),
			);
			return dispose;
		});
		// Nothing here stays reactive: the values were the tool's, and the
		// entities outlive the graph that produced them (as on unmount).
		dispose();

		for (const [entity, { tag, props }] of created) {
			const parentEntity = getParentEntity(entity);
			const parentSource = parentEntity?.get(Source)?.value;
			if (!parentEntity || !parentSource) continue;

			// Placed in front of the next sibling that was already there. New
			// siblings are skipped: they are appended after this one, or share
			// its anchor, and either way the order in the file comes out right.
			const siblings = getEntityChildren(this.world, parentEntity);
			const before = siblings
				.slice(siblings.indexOf(entity) + 1)
				.find((sibling) => !created.has(sibling))
				?.get(Source)?.value;

			// A text element's content arrived as text nodes, which the document
			// has already folded into Chars; that is what the file gets.
			const text = isText(entity) ? entity.get(Chars)?.value : undefined;

			this.sink?.({
				kind: 'insert',
				source: entity.get(Source)!.value,
				parent: parentSource,
				tag,
				props,
				...(before ? { before } : {}),
				...(text === undefined ? {} : { text }),
			});
		}

		return [...created.keys()].filter((entity) => !created.has(getParentEntity(entity)!));
	}

	/**
	 * Re-stamps entities whose element earned a name, as `old source -> new`.
	 * Queried rather than remembered: the entities that survived are the ones
	 * the world still holds.
	 */
	public restamp(ids: Record<string, string>): void {
		for (const entity of this.world.query(Source)) {
			const next = ids[entity.get(Source)!.value];
			if (next) entity.set(Source, { value: next });
		}
	}

	/**
	 * Takes back an element whose insert could not be written: it has no
	 * place in the file, so it has no place on the canvas either.
	 */
	public discardPending(source: string): void {
		if (!isPendingSource(source)) return;
		const document = this.document;
		// Snapshot: destroying cascades through the subtree, and a live query
		// would hand back children that went with their parent.
		const doomed = [...this.world.query(Source)].filter((entity) => entity.get(Source)?.value === source);
		for (const entity of doomed) {
			if (!entity.isAlive()) continue;
			const parent = getParentEntity(entity);
			document.removeNode({ entity: parent ?? document.stage.entity }, { entity });
		}
	}

	/**
	 * The document as `insertElement` renders into it: the same host, with
	 * every element created stamped pending and its tag and literal props
	 * noted in `created`. The document itself never learns it was watched.
	 */
	private recording(created: Map<Entity, Recorded>): ProjectDocument<HostNode> {
		const document = this.document;
		return {
			stage: document.stage,
			createElement: (tag) => {
				const node = document.createElement(tag);
				if (node !== document.stage) {
					document.setProperty(node, SOURCE_ATTR, `${PENDING_PREFIX}${++pendingCounter}`);
					created.set(node.entity, { tag: tag.charAt(0).toLowerCase() + tag.slice(1), props: {} });
				}
				return node;
			},
			setProperty: (node, name, value) => {
				const recorded = isSceneNode(node) ? created.get(node.entity) : undefined;
				if (recorded && name !== SOURCE_ATTR && name !== 'children' && name !== 'ref' && isPropValue(value)) {
					recorded.props[name] = value;
				}
				document.setProperty(node, name, value);
			},
			createTextNode: (text) => document.createTextNode(text),
			replaceText: (node, text) => document.replaceText(node, text),
			isTextNode: (node) => document.isTextNode(node),
			insertNode: (parent, node, anchor) => document.insertNode(parent, node, anchor),
			removeNode: (parent, node) => document.removeNode(parent, node),
			getParentNode: (node) => document.getParentNode(node),
			getFirstChild: (node) => document.getFirstChild(node),
			getNextSibling: (node) => document.getNextSibling(node),
		};
	}
}

const editors = new WeakMap<World, DocumentEditor>();

/** The editor for `world`, created on first use. Outlives mounts: it reads the current document per call. */
export function getDocumentEditor(world: World): DocumentEditor {
	let editor = editors.get(world);
	if (!editor) {
		editor = new DocumentEditor(world);
		editors.set(world, editor);
	}
	return editor;
}
