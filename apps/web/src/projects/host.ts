/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Renderer half of on-disk projects. Projects live as folders under a root
// the user picks once (persisted); each project's package.json is its record
// (`projectId`, `displayName`, `main`). The desktop main process scans,
// scaffolds, renames, copies, trashes, compiles, and watches them. Desktop
// only for now: without the bridge every call rejects and the root is null.
//
// A project is addressed by its folder — an absolute path, which is what main
// takes — and identified by its id, which is what the app's URLs carry and
// what survives the folder being renamed. `resolveProject` is the one bridge
// between the two; callers get the folder from the `ProjectInfo` it answers
// with (and the open project's from `@/context/project`).

import { createSignal } from 'solid-js';

import { MAIN_CHANNELS } from '@desktop/main-channels';
import { mainBridge } from '@/lib/ipc';
import { lastUsedProjectRoot, rememberProjectRoot } from '@/components/engine/db';

import type { CompileResult, ProjectInfo, SourceEdit, WriteResult } from '@desktop/main-channels';

export type { CompileResult, ProjectInfo, SourceEdit, WriteResult };

// The roots live in the app's IndexedDB (see @/components/engine/db) as a list
// keyed by path. The app works against one of them — the one used last — but
// the store is already the list several roots will need, so growing into them
// is UI rather than a migration.
//
// Reading a database is asynchronous, so the root starts null and arrives a
// tick later. Every call here waits for it, leaving only the UI to tell "no
// root yet" from "no root picked" — which is what `rootsReady` is for.

const [projectsRoot, setProjectsRoot] = createSignal<string | null>(null);
const [rootsReady, setRootsReady] = createSignal(false);

/** The projects root folder: null until one is picked, and until `rootsReady`. */
export { projectsRoot };

/** Whether the roots have been read back from the database yet. */
export { rootsReady };

const ready = new Promise<void>((resolve) => {
	lastUsedProjectRoot()
		.then((root) => setProjectsRoot(root?.path ?? null))
		.catch((error) => console.error('[projects] could not read the projects roots', error))
		.finally(() => {
			setRootsReady(true);
			resolve();
		});
});

export const isDesktop = (): boolean => !!window.desktop;

/** Opens the native folder picker and remembers the chosen root. */
export async function pickProjectsRoot(): Promise<string | null> {
	const root = await mainBridge.call(MAIN_CHANNELS.PROJECTS_PICK_ROOT, undefined);
	if (!root) return null;

	await rememberProjectRoot(root);
	setProjectsRoot(root);
	return root;
}

/**
 * The root to work against, waited for and — when there is none to wait for —
 * asked of the user. Null when they decline, or off the desktop, where there
 * is no folder to pick.
 */
export async function ensureProjectsRoot(): Promise<string | null> {
	if (!isDesktop()) return null;
	await ready;
	return projectsRoot() ?? pickProjectsRoot();
}

export async function listProjects(): Promise<ProjectInfo[]> {
	await ready;
	const root = projectsRoot();
	if (!root || !isDesktop()) return [];
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_LIST, { root });
}

/** Creates a project folder under the root, named after `displayName`. */
export async function createProject(displayName: string): Promise<ProjectInfo> {
	await ready;
	const root = projectsRoot();
	if (!root) throw new Error('No projects folder selected.');
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_CREATE, { root, displayName });
}

/**
 * The project `ref` names under the root: its id, or — for links made before
 * ids existed, and folders opened by name — its folder name. What comes back
 * always carries an id, so the app can put that in the URL.
 */
export async function resolveProject(ref: string): Promise<ProjectInfo | null> {
	await ready;
	const root = projectsRoot();
	if (!root || !isDesktop()) return null;
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_RESOLVE, { root, ref });
}

/** The project in the folder `dir`, or null when there is none. */
export async function getProject(dir: string): Promise<ProjectInfo | null> {
	if (!dir || !isDesktop()) return null;
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_GET, { dir });
}

/**
 * Renames the project: `displayName` in the record, and the folder with it.
 * The folder moves, so the answer says where the project now lives — hold on
 * to it. Its id has not changed, and neither has its URL.
 */
export async function renameProject(dir: string, displayName: string): Promise<ProjectInfo> {
	if (!dir) throw new Error('No project folder.');
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_RENAME, { dir, displayName });
}

/** Copies the project in `dir` next to itself and returns the copy (a new id). */
export async function duplicateProject(dir: string): Promise<ProjectInfo> {
	if (!dir) throw new Error('No project folder.');
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_DUPLICATE, { dir });
}

/** Moves the project in `dir` to the trash. */
export async function deleteProject(dir: string): Promise<void> {
	if (!dir) throw new Error('No project folder.');
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_DELETE, { dir });
}

/**
 * What to put in a project's URL: its id, or its folder name while it has
 * none (a folder that predates ids gets one the next time it is opened).
 */
export const projectKey = (project: ProjectInfo): string => project.id || project.name;

export function compileProject(dir: string): Promise<CompileResult> {
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_COMPILE, { dir });
}

/**
 * Writes changed props back into the project's JSX. No compile follows: the
 * canvas is already showing these values, and main keeps the write from
 * reaching the watcher (see `markSelfWrite` in the desktop's projects.ts).
 */
export function writeProject(dir: string, edits: SourceEdit[]): Promise<WriteResult> {
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_WRITE, { dir, edits });
}

/** The project's config (the `diffusion` field of its package.json), unparsed; null when absent. */
export function readProjectConfig(dir: string): Promise<unknown> {
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_CONFIG_READ, { dir });
}

/** Replaces the project's config (null removes the field). Kept from the watcher like `writeProject`. */
export function writeProjectConfig(dir: string, config: unknown): Promise<void> {
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_CONFIG_WRITE, { dir, config });
}

/**
 * Watches a project folder and calls `onChange` (debounced) when a file
 * inside it changes. Returns the unwatch function.
 */
export function watchProject(dir: string, onChange: (path: string) => void, debounceMs = 80): () => void {
	if (!isDesktop()) return () => {};

	let pending: ReturnType<typeof setTimeout> | undefined;
	let last = '';
	const stop = mainBridge.handle(MAIN_CHANNELS.PROJECTS_CHANGED, (event) => {
		if (event.dir !== dir) return;
		last = event.path;
		clearTimeout(pending);
		pending = setTimeout(() => onChange(last), debounceMs);
	});
	void mainBridge.call(MAIN_CHANNELS.PROJECTS_WATCH, { dir });

	return () => {
		clearTimeout(pending);
		stop();
		void mainBridge.call(MAIN_CHANNELS.PROJECTS_UNWATCH, { dir }).catch(() => {});
	};
}
