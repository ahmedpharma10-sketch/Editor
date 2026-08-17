/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import { getDocumentEditor } from '@/engine/editor';
import { toast } from 'somoto';

import { writeProject } from './host';

import type { EntityEdit, InsertEdit } from '@/engine/editor';
import type { SourceEdit, WriteResult } from './host';
import type { World } from 'koota';

/**
 * How long edits pile up before they are written. Long enough that a drag is
 * one write, short enough that letting go of a slider and looking at the file
 * shows the value that is on the canvas.
 */
const DEBOUNCE = 120;

class EditWriter {
	private readonly dir: string;
	private readonly world: World;

	// Inserts first, in the order they were made (a child's parent may be one
	// of them), then per element, per prop: the last value for a prop is the
	// only one worth writing, and an element written twice is written once.
	private inserts = new Map<string, InsertEdit>();
	private pending = new Map<string, InsertEdit['props']>();
	// Pending sources a write is out for: edits to them wait for the answer.
	private inflight = new Set<string>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;

	public constructor(dir: string, world: World) {
		this.dir = dir;
		this.world = world;
	}

	/** Records an edit; the write follows once edits stop arriving. */
	public push(edit: EntityEdit): void {
		if (this.disposed) return;

		if (edit.kind === 'insert') {
			this.inserts.set(edit.source, edit);
		} else {
			// A prop of an element still waiting to be inserted is part of how
			// it is inserted.
			const insert = this.inserts.get(edit.source);
			if (insert) insert.props = { ...insert.props, [edit.name]: edit.value };
			else this.pending.set(edit.source, { ...this.pending.get(edit.source), [edit.name]: edit.value });
		}

		this.schedule();
	}

	/** Writes what is pending and stops. */
	public dispose(): void {
		clearTimeout(this.timer);
		// The last edits still belong in the file, even though the entities
		// they came from are on their way out.
		this.flush();
		this.disposed = true;
	}

	private schedule(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.flush(), DEBOUNCE);
	}

	private flush(): void {
		this.timer = undefined;
		if (!this.inserts.size && !this.pending.size) return;

		// Anything addressed through an element whose insert is still out
		// waits for its name: edits to it, and inserts under or beside it.
		const waits = (source: string | undefined): boolean => source !== undefined && this.inflight.has(source);
		const heldInserts = new Map([...this.inserts].filter(([, insert]) => waits(insert.parent) || waits(insert.before)));
		const held = new Map([...this.pending].filter(([source]) => waits(source)));
		const edits: SourceEdit[] = [
			...[...this.inserts.values()]
				.filter((insert) => !heldInserts.has(insert.source))
				.map(({ kind, source, parent, tag, props, before, text }): SourceEdit => ({
					kind,
					source,
					parent,
					tag,
					props,
					...(before === undefined ? {} : { before }),
					...(text === undefined ? {} : { text }),
				})),
			...[...this.pending]
				.filter(([source]) => !held.has(source))
				.map(([source, props]): SourceEdit => ({ kind: 'set', source, props })),
		];
		if (!edits.length) return;

		this.inflight = new Set([...this.inflight, ...this.inserts.keys()].filter((source) => !heldInserts.has(source)));
		this.inserts = heldInserts;
		this.pending = held;

		writeProject(this.dir, edits)
			.then((result) => this.report(result))
			.catch((error: unknown) => {
				toast.error('Could not write to the project', { description: message(error) });
			});
	}

	private report(result: WriteResult): void {
		if (result.error) {
			toast.error('Could not write to the project', { description: result.error });
		} else if (result.skipped.length) {
			// Not a failure: the source computes these, and overwriting an
			// expression with the value it happened to produce would delete
			// someone's work.
			toast.warning('Some props are computed and stay as they are', {
				description: result.skipped.join(', '),
			});
		}

		if (this.disposed) return;
		const ids = result.ids ?? {};
		const editor = getDocumentEditor(this.world);
		editor.restamp(ids);

		// What piled up under a pending name while its write was out now
		// belongs to the real one, or to nothing if the file would not have it.
		const rename = (source: string): string | undefined => (this.inflight.has(source) ? ids[source] : source);
		for (const source of [...this.pending.keys()]) {
			const next = rename(source);
			if (next === source) continue;
			const props = this.pending.get(source)!;
			this.pending.delete(source);
			if (next) this.pending.set(next, { ...this.pending.get(next), ...props });
		}
		for (const [source, insert] of [...this.inserts]) {
			const parent = rename(insert.parent);
			if (parent === undefined) {
				// Its parent never made it into the file, so neither can it.
				this.inserts.delete(source);
				editor.discardPending(source);
				continue;
			}
			// An anchor that did not make it just means "last".
			const before = insert.before === undefined ? undefined : rename(insert.before);
			const { before: _, ...rest } = insert;
			this.inserts.set(source, { ...rest, parent, ...(before === undefined ? {} : { before }) });
		}
		for (const source of this.inflight) {
			if (!ids[source]) editor.discardPending(source);
		}
		this.inflight = new Set();

		// What was held back has its names now.
		if (this.inserts.size || this.pending.size) this.schedule();
	}
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Collects edits against the project in `dir` and writes them back.
 *
 * `world` is only read after a write returns, to answer the one thing a write
 * can tell the canvas: an element that had no `id` in the source has one now,
 * and the entity it produced has to be re-stamped with it. Without that, the
 * next edit to the same element would still address it by a position the
 * write itself may have invalidated.
 */
export function createEditWriter(dir: string, world: World): EditWriter {
	return new EditWriter(dir, world);
}

export type { EditWriter };
