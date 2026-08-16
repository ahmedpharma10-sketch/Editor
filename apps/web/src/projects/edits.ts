/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The path from an edit made in the editor to the JSX that produced it.
//
// Nothing here changes the composition — the document did that before the edit
// was reported, which is what makes writing cheap: no compile, no remount, and
// a dragged rect can report a hundred positions on the way to the one that
// ends up in the file. They collapse into a single write per element and prop,
// so what reaches disk is where things ended up rather than how they got there.

import { Source } from '@diffusionstudio/runtime';
import { toast } from 'somoto';

import { writeProject } from './host';

import type { EntityEdit } from '@diffusionstudio/reconciler';
import type { SourceEdit, WriteResult } from './host';
import type { World } from 'koota';

/**
 * How long edits pile up before they are written. Long enough that a drag is
 * one write, short enough that letting go of a slider and looking at the file
 * shows the value that is on the canvas.
 */
const DEBOUNCE = 120;

export interface EditWriter {
	/** Records an edit; the write follows once edits stop arriving. */
	push(edit: EntityEdit): void;
	/** Writes what is pending and stops. */
	dispose(): void;
}

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
	// Per element, then per prop: the last value for a prop is the only one
	// worth writing, and an element written twice is written once.
	const pending = new Map<string, Record<string, unknown>>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;

	const flush = (): void => {
		timer = undefined;
		if (!pending.size) return;

		const edits: SourceEdit[] = [...pending].map(([source, props]) => ({
			source,
			props: props as SourceEdit['props'],
		}));
		pending.clear();

		writeProject(dir, edits).then(report).catch((error: unknown) => {
			toast.error('Could not write to the project', { description: message(error) });
		});
	};

	const report = (result: WriteResult): void => {
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

		if (result.ids && !disposed) restamp(world, result.ids);
	};

	return {
		push(edit) {
			if (disposed) return;
			pending.set(edit.source, { ...pending.get(edit.source), [edit.name]: edit.value });
			clearTimeout(timer);
			timer = setTimeout(flush, DEBOUNCE);
		},
		dispose() {
			clearTimeout(timer);
			// The last edits still belong in the file, even though the entities
			// they came from are on their way out.
			flush();
			disposed = true;
		},
	};
}

/**
 * Re-stamps entities whose element earned a name, as `old id -> new id`.
 * Queried rather than remembered: the entities that survived the write are the
 * ones the world still holds.
 */
function restamp(world: World, ids: Record<string, string>): void {
	for (const entity of world.query(Source)) {
		const next = ids[entity.get(Source)!.value];
		if (next) entity.set(Source, { value: next });
	}
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
