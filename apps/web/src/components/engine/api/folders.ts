/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";
import { assert } from "@/utils";
import { getProjectDB } from "../db";
import { allocateId, assetsVersion, invalidateAssets, raiseIdCounter, saveAsset, removeAsset } from "./assets";

import type { Accessor, Setter } from "solid-js";
import type { EngineWorld } from "./world";
import type { Asset, Folder } from "../db";

type FolderState = {
  db: ReturnType<typeof getProjectDB>;
  currentId: Accessor<string | null>;
  setCurrentId: Setter<string | null>;
};

const folderStates = new WeakMap<object, FolderState>();

/**
 * Initializes the folder subsystem for a world. Call once, right after the
 * world is created. `world.folders` must already be an (empty) Map.
 */
export function initFolders(world: EngineWorld, projectId: string): void {
  const [currentId, setCurrentId] = createSignal<string | null>(null);

  folderStates.set(world, {
    db: getProjectDB(projectId),
    currentId,
    setCurrentId,
  });
}

function folderState(world: EngineWorld): FolderState {
  const state = folderStates.get(world);
  assert(state, 'Folders not initialized for this world; call initFolders() first');
  return state;
}

/**
 * A folder's effective parent: its stored parentId, or root when the parent
 * record no longer exists (dangling references degrade to root instead of
 * hiding the folder).
 */
function effectiveParentId(world: EngineWorld, folder: Folder): string | null {
  return folder.parentId !== null && world.folders.has(folder.parentId)
    ? folder.parentId
    : null;
}

/**
 * The folder an asset effectively lives in: its stored folderId, or root when
 * that folder no longer exists.
 */
export function assetFolderId(world: EngineWorld, asset: Asset): string | null {
  const folderId = asset.folderId ?? null;
  return folderId !== null && world.folders.has(folderId) ? folderId : null;
}

/**
 * True when `id` is a descendant of `ancestorId` in the folder tree.
 */
export function isDescendantFolder(world: EngineWorld, id: string, ancestorId: string): boolean {
  const visited = new Set<string>();
  let current = world.folders.get(id);
  while (current && current.parentId !== null && !visited.has(current.id)) {
    if (current.parentId === ancestorId) return true;
    visited.add(current.id);
    current = world.folders.get(current.parentId);
  }
  return false;
}

/**
 * Reactive view over the folder tree, for use inside Solid tracking scopes.
 * Folders share the asset version signal, so any folder or asset mutation
 * re-runs dependents.
 */
export function useFolders(world: EngineWorld) {
  const state = folderState(world);
  return {
    /**
     * All folders, unordered.
     */
    all(): Folder[] {
      assetsVersion(world);
      return Array.from(world.folders.values());
    },
    /**
     * A single folder by id.
     */
    get(id: string): Folder | undefined {
      assetsVersion(world);
      return world.folders.get(id);
    },
    /**
     * Direct child folders of a parent (null = root), sorted by name.
     */
    childrenOf(parentId: string | null): Folder[] {
      assetsVersion(world);
      return Array.from(world.folders.values())
        .filter((folder) => effectiveParentId(world, folder) === parentId)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    /**
     * The id of the folder currently open in the asset panel (null = root).
     */
    currentId(): string | null {
      assetsVersion(world);
      const id = state.currentId();
      return id !== null && world.folders.has(id) ? id : null;
    },
    /**
     * Breadcrumb chain from the root down to the current folder.
     */
    path(): Folder[] {
      assetsVersion(world);
      const chain: Folder[] = [];
      const visited = new Set<string>();
      let current = state.currentId() !== null
        ? world.folders.get(state.currentId()!)
        : undefined;
      while (current && !visited.has(current.id)) {
        chain.unshift(current);
        visited.add(current.id);
        current = current.parentId !== null
          ? world.folders.get(current.parentId)
          : undefined;
      }
      return chain;
    },
  };
}

/** 
 * Opens a folder in the asset panel (null = back to root).
 */
export function openFolder(world: EngineWorld, id: string | null): void {
  folderState(world).setCurrentId(id);
}

/**
 * The folder currently open in the asset panel, for use outside tracking
 * scopes (event handlers, keyboard shortcuts). Reactive consumers should use
 * `useFolders(world).currentId()` instead.
 */
export function getCurrentFolderId(world: EngineWorld): string | null {
  const id = folderState(world).currentId();
  return id !== null && world.folders.has(id) ? id : null;
}

/**
 * The next free `base`/`base N` name among a parent's children.
 */
export function uniqueFolderName(world: EngineWorld, base: string, parentId: string | null): string {
  const names = new Set(
    Array.from(world.folders.values())
      .filter((folder) => effectiveParentId(world, folder) === parentId)
      .map((folder) => folder.name),
  );
  let name = base;
  for (let i = 2; names.has(name); i++) name = `${base} ${i}`;
  return name;
}

/**
 * The next free "New folder"/"New folder N" name among a parent's children.
 */
export function nextFolderName(world: EngineWorld, parentId: string | null): string {
  return uniqueFolderName(world, 'New folder', parentId);
}

/**
 * Finds a direct child folder of `parentId` by name (case-insensitive),
 * creating it when missing.
 */
export async function ensureFolder(
  world: EngineWorld,
  name: string,
  parentId: string | null = null,
): Promise<Folder> {
  const target = name.trim().toLowerCase();
  for (const folder of world.folders.values()) {
    if (
      effectiveParentId(world, folder) === parentId &&
      folder.name.trim().toLowerCase() === target
    ) {
      return folder;
    }
  }
  return createFolder(world, name, parentId);
}

/**
 * Creates a folder under `parentId` (null = root) and persists it.
 */
export async function createFolder(
  world: EngineWorld,
  name: string,
  parentId: string | null = null,
): Promise<Folder> {
  const folder: Folder = {
    id: allocateId(world),
    name,
    parentId: parentId !== null && world.folders.has(parentId) ? parentId : null,
    createdAt: new Date().toISOString(),
  };

  world.folders.set(folder.id, folder);
  invalidateAssets(world);

  const db = await folderState(world).db;
  await db.put('folders', folder);

  return folder;
}

/**
 * Renames a folder and persists it.
 */
export async function renameFolder(world: EngineWorld, id: string, name: string): Promise<void> {
  const folder = world.folders.get(id);
  if (!folder || folder.name === name) return;

  const next = { ...folder, name };
  world.folders.set(id, next);
  invalidateAssets(world);

  const db = await folderState(world).db;
  await db.put('folders', next);
}

/**
 * Moves assets into a folder (null = root). Ignores unknown asset ids and
 * unknown target folders.
 */
export async function moveAssetsToFolder(
  world: EngineWorld,
  ids: string[],
  folderId: string | null,
): Promise<void> {
  if (folderId !== null && !world.folders.has(folderId)) return;

  for (const id of ids) {
    const asset = world.assets.get(id);
    if (!asset || (asset.folderId ?? null) === folderId) continue;
    await saveAsset(world, { ...asset, folderId });
  }
}

/**
 * Re-parents a folder (null = root). Returns false when the move would create
 * a cycle (dropping a folder into itself or one of its descendants).
 */
export async function moveFolder(
  world: EngineWorld,
  id: string,
  parentId: string | null,
): Promise<boolean> {
  const folder = world.folders.get(id);
  if (!folder) return false;
  if (parentId === id) return false;
  if (parentId !== null) {
    if (!world.folders.has(parentId)) return false;
    if (isDescendantFolder(world, parentId, id)) return false;
  }
  if (folder.parentId === parentId) return true;

  const next = { ...folder, parentId };
  world.folders.set(id, next);
  invalidateAssets(world);

  const db = await folderState(world).db;
  await db.put('folders', next);
  return true;
}

/**
 * Deletes a folder with its contents.
 */
export async function deleteFolder(world: EngineWorld, id: string) {
  const folder = world.folders.get(id);
  if (!folder) return { deletedFolders: 0, deletedAssets: 0 };

  const state = folderState(world);

  // Navigate out of the doomed subtree before removing it.
  const currentId = state.currentId();
  if (currentId !== null && (currentId === id || isDescendantFolder(world, currentId, id))) {
    state.setCurrentId(folder.parentId);
  }

  const subtree = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const candidate of world.folders.values()) {
      if (candidate.parentId !== null && subtree.has(candidate.parentId) && !subtree.has(candidate.id)) {
        subtree.add(candidate.id);
        grew = true;
      }
    }
  }

  const assetIds = Array.from(world.assets.values())
    .filter((asset) => asset.folderId != null && subtree.has(asset.folderId))
    .map((asset) => asset.id);

  if (assetIds.length > 0) {
    await removeAsset(world, ...assetIds);
  }

  const db = await state.db;
  for (const folderId of subtree) {
    world.folders.delete(folderId);
    await db.delete('folders', folderId);
  }

  invalidateAssets(world);
  return { deletedFolders: subtree.size, deletedAssets: assetIds.length };
}

/**
 * Restores folders from IndexedDB into the in-memory store.
 * Call once during engine init.
 */
export async function restoreFolders(world: EngineWorld): Promise<void> {
  const db = await folderState(world).db;
  const records = await db.getAll('folders');
  if (records.length === 0) return;

  world.folders.clear();
  for (const record of records) {
    world.folders.set(record.id, record);
  }

  raiseIdCounter(world, records.map((record) => record.id));
  invalidateAssets(world);
}
