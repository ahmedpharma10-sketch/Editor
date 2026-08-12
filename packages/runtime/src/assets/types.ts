/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Asset and folder metadata model. The runtime only needs what resolves
// durations, dimensions, and file bytes; the app layers persistence (zod
// schemas, IndexedDB records) on top with structurally compatible shapes.

/** Whatever hands out the asset's bytes: a FileSystemFileHandle in the
 *  browser, a path-backed handle in Electron or node. */
export interface AssetFileHandle {
	getFile(): Promise<File>;
}

/** Directory of numbered frame files backing a SEQUENCE asset. Typed to the
 *  web FileSystemDirectoryHandle surface the decoders iterate. */
export interface AssetDirectoryHandle {
	entries(): AsyncIterableIterator<[string, { kind: string; getFile?: () => Promise<File> }]>;
}

export type TranscriptWord = { text: string; start: number; end: number };

export type Transcript = { text: string; words: TranscriptWord[] }[];

interface AssetBase {
	id: string;
	hash: string;
	createdAt: string;
	lastModified?: number;
	name: string;
	mimeType: string;
	size?: number;
	handle: AssetFileHandle;
	generationId?: string | null;
	generationKey?: string | null;
	folderId?: string | null;
}

export interface ImageAsset extends AssetBase {
	type: 'IMAGE';
	width: number;
	height: number;
}

export interface AudioAsset extends AssetBase {
	type: 'AUDIO';
	duration: number;
	sampleRate: number;
	channels: number;
	transcript?: Transcript;
}

export interface VideoAsset extends AssetBase {
	type: 'VIDEO';
	duration: number;
	width: number;
	height: number;
	frameRate: number;
	bitRate: number;
	sampleRate?: number;
	channels?: number;
	transcript?: Transcript;
}

export interface TranscriptAsset extends AssetBase {
	type: 'TRANSCRIPT';
}

export interface ScriptAsset extends AssetBase {
	type: 'SCRIPT';
}

// `handle` points to the first frame's file so generic preview code works.
export interface SequenceAsset extends AssetBase {
	type: 'SEQUENCE';
	width: number;
	height: number;
	frameRate: number;
	duration: number;
	directoryHandle: AssetDirectoryHandle;
}

export type Asset =
	| ImageAsset
	| AudioAsset
	| VideoAsset
	| TranscriptAsset
	| ScriptAsset
	| SequenceAsset;

export interface Folder {
	id: string;
	name: string;
	parentId: string | null;
	createdAt: string;
}
