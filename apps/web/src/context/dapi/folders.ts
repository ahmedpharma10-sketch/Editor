/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { assert } from '@/utils';
import {
  createFolder,
  deleteFolder,
  isDescendantFolder,
  moveFolder,
  renameFolder,
  useFolders,
} from '@/components/engine';

import type { Engine } from "@/components/engine";
import type { FolderDeleteResult, FolderInfo, FolderMoveResult } from "@diffusionstudio/cli/channels";
import type { Accessor } from "solid-js";

const toWire = (folder: { id: string; name: string }): FolderInfo => ({
  id: folder.id,
  name: folder.name,
  type: "folder",
});

export function handleFoldersList(engine: Accessor<Engine>) {
  return async ({ parentId }: { parentId?: string }): Promise<FolderInfo[]> => {
    const { world } = engine();
    if (parentId !== undefined) {
      assert(world.folders.has(parentId), `Folder ${parentId} not found.`);
    }
    return useFolders(world).childrenOf(parentId ?? null).map(toWire);
  }
}

export function handleFolderCreate(engine: Accessor<Engine>) {
  return async ({ name, parentId }: { name: string; parentId?: string }): Promise<FolderInfo> => {
    const { world } = engine();
    if (parentId !== undefined) {
      assert(world.folders.has(parentId), `Folder ${parentId} not found.`);
    }
    const folder = await createFolder(world, name, parentId ?? null);
    return toWire(folder);
  }
}

export function handleFolderRename(engine: Accessor<Engine>) {
  return async ({ id, name }: { id: string; name: string }): Promise<FolderInfo> => {
    const { world } = engine();
    assert(world.folders.has(id), `Folder ${id} not found.`);
    await renameFolder(world, id, name);
    return toWire(world.folders.get(id)!);
  }
}

export function handleFoldersMove(engine: Accessor<Engine>) {
  return async ({ ids, to }: { ids: string[]; to?: string }): Promise<FolderMoveResult[]> => {
    const { world } = engine();
    if (to !== undefined) {
      assert(world.folders.has(to), `Folder ${to} not found.`);
    }
    const parentId = to ?? null;
    // Validate every move before applying any, so a bad id changes nothing.
    for (const id of ids) {
      assert(world.folders.has(id), `No such folder: ${id}`);
      assert(
        parentId === null || (parentId !== id && !isDescendantFolder(world, parentId, id)),
        `Cannot move folder ${id} into itself or one of its descendants`,
      );
    }
    for (const id of ids) {
      await moveFolder(world, id, parentId);
    }
    return ids.map((id) => ({ id, parentId }));
  }
}

export function handleFoldersDelete(engine: Accessor<Engine>) {
  return async ({ ids }: { ids: string[] }): Promise<FolderDeleteResult[]> => {
    const { world } = engine();
    for (const id of ids) {
      assert(world.folders.has(id), `No such folder: ${id}`);
    }
    const results: FolderDeleteResult[] = [];
    for (const id of ids) {
      const { deletedFolders, deletedAssets } = await deleteFolder(world, id);
      results.push({ id, deletedFolders, deletedAssets });
    }
    return results;
  }
}
