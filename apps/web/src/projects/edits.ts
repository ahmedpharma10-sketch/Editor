/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import { getDocumentEditor } from '@/engine/editor';
import { toast } from 'somoto';

import { writeProject } from './host';

import type { EntityEdit, InsertEdit, MoveEdit, RemoveEdit } from '@/engine/editor';
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
	// of them), then the moves, then per element, per prop: the last value for
	// a prop is the only one worth writing, an element written twice is
	// written once, and only where an element ended up is worth moving it to.
	// Removes last: nothing else addressed to a removed element is worth
	// writing, and once cut, an unnamed element's neighbours are elsewhere.
	private inserts = new Map<string, InsertEdit>();
	private moves = new Map<string, MoveEdit>();
	private pending = new Map<string, InsertEdit['props']>();
	private removes = new Set<string>();
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
		} else if (edit.kind === 'remove') {
			this.remove(edit);
		} else if (edit.kind === 'move') {
			// Where an element still waiting to be inserted goes is part of how
			// it is inserted, not a move of it.
			const insert = this.inserts.get(edit.source);

			if (insert) {
				const moved: InsertEdit = { ...insert, parent: edit.parent };
				if (edit.before === undefined) delete moved.before;
				else moved.before = edit.before;
				this.inserts.set(edit.source, moved);
			} else {
				this.moves.set(edit.source, edit);
			}
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

	/**
	 * Forgets everything owed to an element that is going, and to whatever
	 * was to be inserted under it: the entities went with it, so those inserts
	 * have no element to become. An element the file never had (an insert
	 * still waiting here) is simply not inserted; one it has, or that a write
	 * out right now is naming, is removed by name.
	 */
	private remove(edit: RemoveEdit): void {
		const doomed = new Set([edit.source]);
		let grew = true;
		while (grew) {
			grew = false;
			for (const insert of this.inserts.values()) {
				if (doomed.has(insert.parent) && !doomed.has(insert.source)) {
					doomed.add(insert.source);
					grew = true;
				}
			}
		}

		// An insert still waiting here never reached the file: dropping it is
		// the whole removal. Anything else the file has, or a write out right
		// now is naming, and it goes from there by name.
		if (!this.inserts.has(edit.source)) this.removes.add(edit.source);
		for (const source of doomed) {
			this.inserts.delete(source);
			this.pending.delete(source);
			this.moves.delete(source);
		}

		// Placement in front of an element that is gone means "last" now, the
		// same answer the write gives to an anchor it cannot find.
		for (const [source, insert] of this.inserts) {
			if (insert.before !== undefined && doomed.has(insert.before)) {
				const { before: _, ...rest } = insert;
				this.inserts.set(source, rest);
			}
		}
		for (const [source, move] of [...this.moves]) {
			if (doomed.has(move.parent)) this.moves.delete(source);
			else if (move.before !== undefined && doomed.has(move.before)) {
				const { before: _, ...rest } = move;
				this.moves.set(source, rest);
			}
		}
	}

	private schedule(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.flush(), DEBOUNCE);
	}

	private flush(): void {
		this.timer = undefined;
		if (!this.inserts.size && !this.moves.size && !this.pending.size && !this.removes.size) return;

		// Anything addressed through an element whose insert is still out
		// waits for its name: edits to it, and inserts or moves under or
		// beside it.
		const waits = (source: string | undefined): boolean => source !== undefined && this.inflight.has(source);
		const heldInserts = new Map([...this.inserts].filter(([, insert]) => waits(insert.parent) || waits(insert.before)));
		const heldMoves = new Map([...this.moves].filter(([source, move]) => waits(source) || waits(move.parent) || waits(move.before)));
		const held = new Map([...this.pending].filter(([source]) => waits(source)));
		const heldRemoves = new Set([...this.removes].filter(waits));
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
			// After the inserts: a move may be into an element this same write
			// is adding. Before the props, which then land on it where it is.
			...[...this.moves.values()]
				.filter((move) => !heldMoves.has(move.source))
				.map(({ kind, source, parent, before }): SourceEdit => ({
					kind,
					source,
					parent,
					...(before === undefined ? {} : { before }),
				})),
			...[...this.pending]
				.filter(([source]) => !held.has(source))
				.map(([source, props]): SourceEdit => ({ kind: 'set', source, props })),
			// Last: cutting an unnamed element moves the positions of everything
			// after it, and nothing above is addressed to what is being removed.
			...[...this.removes]
				.filter((source) => !heldRemoves.has(source))
				.map((source): SourceEdit => ({ kind: 'remove', source })),
		];
		if (!edits.length) return;

		this.inflight = new Set([...this.inflight, ...this.inserts.keys()].filter((source) => !heldInserts.has(source)));
		this.inserts = heldInserts;
		this.moves = heldMoves;
		this.pending = held;
		this.removes = heldRemoves;

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
		for (const [source, move] of [...this.moves]) {
			const next = rename(source);
			const parent = rename(move.parent);
			// Neither the element nor the place it was going made it into the
			// file; the insert's own discard takes the entity with it.
			if (next === undefined || parent === undefined) {
				this.moves.delete(source);
				continue;
			}
			const before = move.before === undefined ? undefined : rename(move.before);
			this.moves.delete(source);
			this.moves.set(next, { ...move, source: next, parent, ...(before === undefined ? {} : { before }) });
		}
		for (const source of [...this.removes]) {
			const next = rename(source);
			if (next === source) continue;
			this.removes.delete(source);
			// An element the file never had needs no removing from it.
			if (next) this.removes.add(next);
		}
		for (const source of this.inflight) {
			if (!ids[source]) editor.discardPending(source);
		}
		this.inflight = new Set();

		// What was held back has its names now.
		if (this.inserts.size || this.moves.size || this.pending.size || this.removes.size) this.schedule();
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
