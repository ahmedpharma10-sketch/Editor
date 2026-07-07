/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { openDB } from 'idb';
import type * as idb from 'idb';
import { nanoid } from 'nanoid';
import { DEFAULT_PROJECT_ID, deleteProjectDB, getProjectDB } from './project-db';

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

export interface Directory {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  createdAt: string;
  lastAccessedAt: string;
}

export interface ProjectEntry {
  id: string;
  name: string;
  createdAt: string;
  lastAccessedAt: string;
  thumbnail?: Blob;
}

export interface GlobalDBSchema extends idb.DBSchema {
  directories: {
    value: Directory;
    key: string;
    indexes: {
      'by-name': string;
      'by-last-accessed': string;
    };
  };
  projects: {
    value: ProjectEntry;
    key: string;
    indexes: {
      'by-name': string;
      'by-last-accessed': string;
    };
  };
}

const DB_NAME = 'global-db';
const DB_VERSION = 1;

const dbPromise = openDB<GlobalDBSchema>(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('directories')) {
      const store = db.createObjectStore('directories', {
        keyPath: 'id',
      });
      store.createIndex('by-name', 'name');
      store.createIndex('by-last-accessed', 'lastAccessedAt');
    }

    if (!db.objectStoreNames.contains('projects')) {
      const store = db.createObjectStore('projects', {
        keyPath: 'id',
      });
      store.createIndex('by-name', 'name');
      store.createIndex('by-last-accessed', 'lastAccessedAt');
    }
  },
});

/**
 * Saves a directory handle to the database.
 * If the same handle already exists, it will be updated.
 */
export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle) {
  const db = await dbPromise;
  const now = new Date().toISOString();

  let id = nanoid();
  let createdAt = now;

  const existingEntries = await db.getAll('directories');
  for (const entry of existingEntries) {
    if (typeof entry.handle?.isSameEntry !== 'function') continue;
    if (await entry.handle.isSameEntry(handle)) {
      id = entry.id;
      createdAt = entry.createdAt;
      break;
    }
  }

  const entry: Directory = {
    id,
    name: handle.name,
    handle,
    createdAt,
    lastAccessedAt: now,
  };

  await db.put('directories', entry);
  return entry;
}

/**
 * Returns the most recently accessed directory handle, or null if none exists.
 */
export async function retrieveLastAccessedDirectory(): Promise<Directory | null> {
  const db = await dbPromise;
  const cursor = await db
    .transaction('directories', 'readonly')
    .store.index('by-last-accessed')
    .openCursor(null, 'prev');

  return cursor?.value ?? null;
}

/**
 * Finds the last accessed directory handle, or creates a new one if none exists.
 * Uses OPFS as a fallback if the indexeddb is not available.
 * @returns The directory handle.
 */
export async function retrieveDirectoryHandle() {
  const lastAccessed = await retrieveLastAccessedDirectory();
  if (lastAccessed) {
    return lastAccessed.handle;
  }

  return await navigator.storage.getDirectory();
}

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{21}$/;

export async function markProjectOpened(projectId: string): Promise<void> {
  if (!PROJECT_ID_PATTERN.test(projectId) || projectId === DEFAULT_PROJECT_ID) return;

  const db = await dbPromise;
  const now = new Date().toISOString();
  const tx = db.transaction('projects', 'readwrite');
  const existing = await tx.store.get(projectId);

  const entry: ProjectEntry = {
    id: projectId,
    name: existing?.name ?? generateProjectName(),
    createdAt: existing?.createdAt ?? now,
    lastAccessedAt: now,
  };

  await tx.store.put(entry);
  await tx.done;
}

export async function createProject(name?: string): Promise<ProjectEntry> {
  const db = await dbPromise;
  const now = new Date().toISOString();
  const entry: ProjectEntry = {
    id: nanoid(),
    name: name?.trim() || generateProjectName(),
    createdAt: now,
    lastAccessedAt: now,
  };
  await db.put('projects', entry);
  return entry;
}

export async function getProjectName(projectId: string): Promise<string> {
  const db = await dbPromise;

  const project = await db.get('projects', projectId)
  if (!project) return generateProjectName();

  return project.name;
}

export async function getProject(projectId: string): Promise<ProjectEntry | null> {
  if (!PROJECT_ID_PATTERN.test(projectId)) return null;
  const db = await dbPromise;
  return (await db.get('projects', projectId)) ?? null;
}

export async function setProjectName(projectId: string, name: string): Promise<void> {
  if (!PROJECT_ID_PATTERN.test(projectId)) return;

  const db = await dbPromise;
  const tx = db.transaction('projects', 'readwrite');
  const existing = await tx.store.get(projectId);
  const now = new Date().toISOString();

  const entry: ProjectEntry = {
    id: projectId,
    name,
    createdAt: existing?.createdAt ?? now,
    lastAccessedAt: now,
  };

  await tx.store.put(entry);
  await tx.done;
}

export async function listRecentProjects(limit = 10): Promise<ProjectEntry[]> {
  const db = await dbPromise;

  const tx = db.transaction('projects', 'readonly');
  let cursor = await tx.store.index('by-last-accessed').openCursor(null, 'prev');

  const entries: ProjectEntry[] = [];
  while (cursor && entries.length < limit) {
    entries.push(cursor.value);
    cursor = await cursor.continue();
  }

  await tx.done;
  return entries;
}

export async function setProjectThumbnail(projectId: string, thumbnail: Blob): Promise<void> {
  if (!PROJECT_ID_PATTERN.test(projectId) || projectId === DEFAULT_PROJECT_ID) return;

  const db = await dbPromise;
  const tx = db.transaction('projects', 'readwrite');
  const existing = await tx.store.get(projectId);
  if (!existing) {
    await tx.done;
    return;
  }

  existing.thumbnail = thumbnail;
  await tx.store.put(existing);
  await tx.done;
}

export async function getProjectThumbnail(projectId: string): Promise<Blob | null> {
  const db = await dbPromise;
  const project = await db.get('projects', projectId);
  return project?.thumbnail ?? null;
}

export async function duplicateProject(projectId: string): Promise<ProjectEntry | null> {
  if (!PROJECT_ID_PATTERN.test(projectId)) return null;

  const db = await dbPromise;
  const source = await db.get('projects', projectId);
  if (!source) return null;

  const newProjectId = nanoid();
  const now = new Date().toISOString();

  const sourceDB = await getProjectDB(projectId);
  const targetDB = await getProjectDB(newProjectId);

  const [entities, assets, folders, fonts] = await Promise.all([
    sourceDB.getAll('entities'),
    sourceDB.getAll('assets'),
    sourceDB.getAll('folders'),
    sourceDB.getAll('fonts'),
  ]);

  const tx = targetDB.transaction(['entities', 'assets', 'folders', 'fonts'], 'readwrite');
  await Promise.all([
    ...entities.map((entity) => tx.objectStore('entities').put(entity)),
    ...assets.map((asset) => tx.objectStore('assets').put(asset)),
    ...folders.map((folder) => tx.objectStore('folders').put(folder)),
    ...fonts.map((font) => tx.objectStore('fonts').put(font)),
    tx.done,
  ]);

  const entry: ProjectEntry = {
    id: newProjectId,
    name: `${source.name} (Copy)`,
    createdAt: now,
    lastAccessedAt: now,
    thumbnail: source.thumbnail,
  };

  await db.put('projects', entry);
  return entry;
}

export async function deleteProject(projectId: string): Promise<void> {
  if (!PROJECT_ID_PATTERN.test(projectId)) return;

  const db = await dbPromise;
  await db.delete('projects', projectId);

  await deleteProjectDB(projectId);
}
