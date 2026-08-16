/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Renderer half of on-disk projects. Projects live as folders under a root
// the user picks once (persisted); each project's package.json is its record
// (`displayName`, `main`). The desktop main process scans, scaffolds, renames,
// copies, trashes, compiles, and watches them. Desktop only for now: without
// the bridge every call rejects and the root is null.

import { MAIN_CHANNELS } from '@desktop/main-channels';
import { mainBridge } from '@/lib/ipc';
import { store } from '@/init';
import { createStoredSignal } from '@/lib/store/signal';

import type { CompileResult, ProjectInfo, SourceEdit, WriteResult } from '@desktop/main-channels';

export type { CompileResult, ProjectInfo, SourceEdit, WriteResult };

const rootItem = store.define<string | null>('projects.root', null);
const [projectsRoot, setProjectsRoot] = createStoredSignal(rootItem);

/** The projects root folder, or null until the user picks one. */
export { projectsRoot };

export const isDesktop = (): boolean => !!window.desktop;

/** Opens the native folder picker and remembers the chosen root. */
export async function pickProjectsRoot(): Promise<string | null> {
	const root = await mainBridge.call(MAIN_CHANNELS.PROJECTS_PICK_ROOT, undefined);
	if (root) setProjectsRoot(root);
	return root;
}

export async function listProjects(): Promise<ProjectInfo[]> {
	const root = projectsRoot();
	if (!root || !isDesktop()) return [];
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_LIST, { root });
}

/** Creates a new project folder `name` (with `displayName` in its package.json) under the root. */
export async function createProject(name: string, displayName = name): Promise<ProjectInfo> {
	const root = projectsRoot();
	if (!root) throw new Error('No projects folder selected.');
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_CREATE, { root, name, displayName });
}

/** The project called `name` under the root, or null when there is none. */
export async function getProject(name: string): Promise<ProjectInfo | null> {
	const dir = projectDir(name);
	if (!dir || !isDesktop()) return null;
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_GET, { dir });
}

/** The human name of project `name` (its folder name when nothing else is known). */
export async function getProjectName(name: string): Promise<string> {
	return (await getProject(name).catch(() => null))?.displayName ?? name;
}

/** Sets the human name of project `name` (package.json `displayName`). */
export async function renameProject(name: string, displayName: string): Promise<ProjectInfo> {
	const dir = projectDir(name);
	if (!dir) throw new Error(`Unknown project "${name}".`);
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_RENAME, { dir, displayName });
}

/** Copies project `name` next to itself and returns the copy. */
export async function duplicateProject(name: string): Promise<ProjectInfo> {
	const dir = projectDir(name);
	if (!dir) throw new Error(`Unknown project "${name}".`);
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_DUPLICATE, { dir });
}

/** Moves project `name` to the trash. */
export async function deleteProject(name: string): Promise<void> {
	const dir = projectDir(name);
	if (!dir) throw new Error(`Unknown project "${name}".`);
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_DELETE, { dir });
}

/** Absolute folder of the project called `name` under the current root, or null. */
export function projectDir(name: string): string | null {
	const root = projectsRoot();
	if (!root) return null;
	// Names are folder names, never paths.
	if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) return null;
	const separator = root.includes('\\') ? '\\' : '/';
	return `${root}${separator}${name}`;
}

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
