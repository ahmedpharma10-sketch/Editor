/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { openDB } from 'idb';
import type * as idb from 'idb';
import { nanoid } from 'nanoid';

const adjectives = ["Golden", "Silent", "Fast", "Bright", "Dark", "Wild", "Calm"];
const nouns = ["River", "Mountain", "Dream", "Storm", "Sunset", "Forest", "Ocean"];

function getRandomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function generateProjectName(): string {
  const adj = getRandomElement(adjectives);
  const noun = getRandomElement(nouns);
  const now = new Date();
  const day = now.getDate();
  const month = now.toLocaleString("en-US", { month: "short" });
  return `${adj} ${noun} ${day} ${month}`;
}

/**
 * A folder the user keeps projects in (desktop; see @/projects). A path
 * rather than a handle: on desktop the main process does the reading, and it
 * takes paths.
 *
 * Stored as a list because there will be several. The app works against one
 * at a time for now — the most recently used, so no separate "active" flag
 * can end up pointing at a root that was removed.
 */
export interface ProjectRoot {
  id: string;
  /** Absolute path of the folder. */
  path: string;
  /** Its last segment, for showing it. */
  name: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface GlobalDBSchema extends idb.DBSchema {
  roots: {
    value: ProjectRoot;
    key: string;
    indexes: {
      'by-path': string;
      'by-last-used': string;
    };
  };
}

const DB_NAME = 'diffusion-studio-idb';
const DB_VERSION = 1;

const dbPromise = openDB<GlobalDBSchema>(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('roots')) {
      const store = db.createObjectStore('roots', { keyPath: 'id' });
      store.createIndex('by-path', 'path', { unique: true });
      store.createIndex('by-last-used', 'lastUsedAt');
    }
  },
});


// ---------------------------------------------------------------------------
// Project roots

/** Last segment of a path, whichever separator it uses. */
const folderLabel = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/**
 * Records `path` as a projects root, or marks the one already recorded for it
 * as just used — which is what makes it the active one.
 */
export async function rememberProjectRoot(path: string): Promise<ProjectRoot> {
  const db = await dbPromise;
  const now = new Date().toISOString();
  const existing = await db.getFromIndex('roots', 'by-path', path);

  const root: ProjectRoot = existing
    ? { ...existing, name: folderLabel(path), lastUsedAt: now }
    : { id: nanoid(), path, name: folderLabel(path), createdAt: now, lastUsedAt: now };

  await db.put('roots', root);
  return root;
}

/** Every projects root, most recently used first. */
export async function listProjectRoots(): Promise<ProjectRoot[]> {
  const db = await dbPromise;
  return (await db.getAllFromIndex('roots', 'by-last-used')).reverse();
}

/** The root the app is working against: the one used last, or null when there is none. */
export async function lastUsedProjectRoot(): Promise<ProjectRoot | null> {
  const db = await dbPromise;
  const cursor = await db
    .transaction('roots', 'readonly')
    .store.index('by-last-used')
    .openCursor(null, 'prev');

  return cursor?.value ?? null;
}

/** Forgets a projects root. The folder itself is left alone. */
export async function forgetProjectRoot(id: string): Promise<void> {
  const db = await dbPromise;
  await db.delete('roots', id);
}
