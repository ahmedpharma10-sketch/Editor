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

export interface Directory {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  createdAt: string;
  lastAccessedAt: string;
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
