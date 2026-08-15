/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { openDB } from 'idb';
import type * as idb from 'idb';
import { nanoid } from 'nanoid';

export const DEFAULT_PROJECT_ID = 'V1StGXR8_Z5jdHi6B-myT';

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
  },
});

/** Session-only project registry. */
const projects = new Map<string, ProjectEntry>();

function byLastAccessedDesc<T extends { lastAccessedAt: string }>(a: T, b: T): number {
  return b.lastAccessedAt.localeCompare(a.lastAccessedAt);
}

/**
 * Saves the root directory handle to the database.
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
 * Returns the most recently accessed root directory, or null if none exists.
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
 * Finds the last accessed directory handle, or falls back to the origin
 * private file system as a scratch location for asset files.
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

  const now = new Date().toISOString();
  const existing = projects.get(projectId);

  projects.set(projectId, {
    ...existing,
    id: projectId,
    name: existing?.name ?? generateProjectName(),
    createdAt: existing?.createdAt ?? now,
    lastAccessedAt: now,
  });
}

export async function createProject(name?: string): Promise<ProjectEntry> {
  const now = new Date().toISOString();
  const entry: ProjectEntry = {
    id: nanoid(),
    name: name?.trim() || generateProjectName(),
    createdAt: now,
    lastAccessedAt: now,
  };
  projects.set(entry.id, entry);
  return entry;
}

export async function getProjectName(projectId: string): Promise<string> {
  const project = projects.get(projectId);
  if (!project) return generateProjectName();

  return project.name;
}

export async function getProject(projectId: string): Promise<ProjectEntry | null> {
  if (!PROJECT_ID_PATTERN.test(projectId)) return null;
  return projects.get(projectId) ?? null;
}

export async function setProjectName(projectId: string, name: string): Promise<void> {
  if (!PROJECT_ID_PATTERN.test(projectId)) return;

  const existing = projects.get(projectId);
  const now = new Date().toISOString();

  projects.set(projectId, {
    ...existing,
    id: projectId,
    name,
    createdAt: existing?.createdAt ?? now,
    lastAccessedAt: now,
  });
}

export async function listRecentProjects(limit = 10): Promise<ProjectEntry[]> {
  return Array.from(projects.values()).sort(byLastAccessedDesc).slice(0, limit);
}

export async function setProjectThumbnail(projectId: string, thumbnail: Blob): Promise<void> {
  if (!PROJECT_ID_PATTERN.test(projectId) || projectId === DEFAULT_PROJECT_ID) return;

  const existing = projects.get(projectId);
  if (!existing) return;

  projects.set(projectId, { ...existing, thumbnail });
}

export async function getProjectThumbnail(projectId: string): Promise<Blob | null> {
  return projects.get(projectId)?.thumbnail ?? null;
}

export async function duplicateProject(projectId: string): Promise<ProjectEntry | null> {
  if (!PROJECT_ID_PATTERN.test(projectId)) return null;

  const source = projects.get(projectId);
  if (!source) return null;

  const newProjectId = nanoid();
  const now = new Date().toISOString();

  // TODO: copy the project's package/JSX contents once projects live on disk.
  const entry: ProjectEntry = {
    id: newProjectId,
    name: `${source.name} (Copy)`,
    createdAt: now,
    lastAccessedAt: now,
    thumbnail: source.thumbnail,
  };

  projects.set(newProjectId, entry);
  return entry;
}

export async function deleteProject(projectId: string): Promise<void> {
  if (!PROJECT_ID_PATTERN.test(projectId)) return;

  projects.delete(projectId);
}
