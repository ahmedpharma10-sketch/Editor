/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";

export type HistoryEntry = {
	label: string;
	execute: () => void;
	reverse: () => void;
	/** Called after execute and reverse to enqueue persistence. */
	finalize?: () => void;
	/** Called when the entry is permanently evicted from history and can never be undone/redone. */
	dispose?: () => void;
};

export type HistoryTransaction = {
	label: string;
	entries: HistoryEntry[];
};

export type History = ReturnType<typeof createHistory>;

function disposeTransaction(tx: HistoryTransaction): void {
	for (const entry of tx.entries) {
		entry.dispose?.();
	}
}

export function createHistory(maxSize = 100) {
	const undoStack: HistoryTransaction[] = [];
	const redoStack: HistoryTransaction[] = [];
	const [dirty, setDirty] = createSignal(0);

	let activeTransaction: HistoryTransaction | null = null;
	// Nesting depth: an inner start/commit pair appends to the outermost
	// transaction and only the outermost commit flushes it to the stack.
	let txDepth = 0;
	let untracked = false;

	/**
	 * Push and immediately execute a history entry.
	 * If a transaction is active the entry is appended to it;
	 * otherwise it becomes its own single-entry transaction.
	 */
	function push(entry: HistoryEntry): void {
		entry.execute();
		entry.finalize?.();

		if (untracked) return;

		if (activeTransaction) {
			activeTransaction.entries.push(entry);
			return;
		}

		undoStack.push({ label: entry.label, entries: [entry] });
		if (undoStack.length > maxSize) {
			const evicted = undoStack.shift();
			if (evicted) {
				disposeTransaction(evicted);
			}
		}

		// Any new action kills the redo branch
		for (const tx of redoStack) {
			disposeTransaction(tx);
		}
		redoStack.length = 0;
		setDirty(d => d + 1);
	}

	/**
	 * Begin a transaction. All entries pushed until `commit()` are
	 * grouped as one undoable step.
	 */
	function startTransaction(label: string): void {
		if (activeTransaction) {
			// Nested: keep appending to the outer one; track depth so the
			// matching inner commit doesn't flush the outer transaction early.
			txDepth++;
			return;
		}
		activeTransaction = { label, entries: [] };
		txDepth = 1;
	}

	/** Commit the active transaction onto the undo stack. */
	function commitTransaction(): void {
		if (!activeTransaction) return;

		// Unwind one nesting level; only the outermost commit flushes.
		if (txDepth > 1) {
			txDepth--;
			return;
		}

		if (activeTransaction.entries.length > 0) {
			undoStack.push(activeTransaction);
			if (undoStack.length > maxSize) {
				const evicted = undoStack.shift();
				if (evicted) {
					disposeTransaction(evicted);
				}
			}
			for (const tx of redoStack) {
				disposeTransaction(tx);
			}
			redoStack.length = 0;
		}

		activeTransaction = null;
		txDepth = 0;
		setDirty(d => d + 1);
	}

	/** Discard the active transaction and reverse all its entries. */
	function rollbackTransaction(): void {
		if (!activeTransaction) return;

		const tx = activeTransaction;
		// Reverse in LIFO order. Suppress recording so observer reactions fired
		// inside reverse() don't push fresh entries.
		withUntracked(() => {
			for (let i = tx.entries.length - 1; i >= 0; i--) {
				tx.entries[i]?.reverse();
				tx.entries[i]?.finalize?.();
			}
		});

		activeTransaction = null;
		txDepth = 0;
		setDirty(d => d + 1);
	}

	/**
	 * Callback-style transaction: wraps `fn` in start/commit.
	 * Rolls back automatically if `fn` throws.
	 */
	function transaction<T>(label: string, fn: () => T): T {
		startTransaction(label);
		try {
			const result = fn();
			commitTransaction();
			return result;
		} catch (e) {
			rollbackTransaction();
			throw e;
		}
	}

	/** Undo the most recent action or transaction. */
	function undo(): void {
		const tx = undoStack.pop();
		if (!tx) return;

		// The recorded entries already replay the change. Observers fired inside
		// reverse() may call the primitives again — suppress recording so they
		// don't push new entries onto the stacks mid-undo.
		withUntracked(() => {
			for (let i = tx.entries.length - 1; i >= 0; i--) {
				tx.entries[i]?.reverse();
				tx.entries[i]?.finalize?.();
			}
		});

		redoStack.push(tx);
		setDirty(d => d + 1);
	}

	/** Redo the most recently undone action or transaction. */
	function redo(): void {
		const tx = redoStack.pop();
		if (!tx) return;

		withUntracked(() => {
			for (const entry of tx.entries) {
				entry.execute();
				entry.finalize?.();
			}
		});

		undoStack.push(tx);
		setDirty(d => d + 1);
	}

	/** Clear all history. */
	function clear(): void {
		for (const tx of undoStack) {
			disposeTransaction(tx);
		}
		for (const tx of redoStack) {
			disposeTransaction(tx);
		}
		undoStack.length = 0;
		redoStack.length = 0;
		activeTransaction = null;
		txDepth = 0;
		setDirty(d => d + 1);
	}

	/**
	 * Run `fn` with recording suppressed, restoring the previous flag after.
	 * Save/restore (rather than force-off) so nested calls — e.g. an ephemeral
	 * push inside an undo replay — don't re-enable recording mid-operation.
	 */
	function withUntracked<T>(fn: () => T): T {
		const prev = untracked;
		untracked = true;
		try {
			return fn();
		} finally {
			untracked = prev;
		}
	}

	/**
	 * Execute `fn` without recording any history entries.
	 * Calls inside still execute and finalize, but are not undoable.
	 */
	function untrack(fn: () => void): void {
		withUntracked(fn);
	}

	return {
		push,
		untrack,
		startTransaction,
		commitTransaction,
		rollbackTransaction,
		transaction,
		undo,
		redo,
		clear,
		get canUndo() {
			dirty();
			return undoStack.length > 0;
		},
		get canRedo() {
			dirty();
			return redoStack.length > 0;
		},
		get undoCount() {
			dirty();
			return undoStack.length;
		},
		get redoCount() {
			dirty();
			return redoStack.length;
		},
		get isTransacting() {
			dirty();
			return activeTransaction !== null;
		},
	};
}
