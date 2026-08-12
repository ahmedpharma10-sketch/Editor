/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { StreamTargetChunk } from 'mediabunny';

// The container format is part of the persisted document model (the
// ExportSettings trait), so the runtime owns the type.
export type { ContainerFormat } from '@diffusionstudio/runtime';

// Minimal FileSystemFileHandle-shaped target
export interface WritableFileTarget {
	createWritable(): Promise<WritableStream<StreamTargetChunk>>;
}

export type EncoderProgress = {
	total: number;
	progress: number;
	remaining: Date;
};

export type ExportResult =
	| {
		type: 'success';
		data: Blob | undefined;
	}
	| {
		type: 'canceled';
	}
	| {
		type: 'error';
		error: Error;
	};

/** Mount graphs re-executed into an offline world (see EncoderConfig.realizeMounts). */
export type RealizedMounts = { disposeAll(): void };
