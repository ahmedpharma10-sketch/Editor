/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Folder model actions (was api/folders.ts, model only). Pure in-memory tree
// operations over the Folders/Assets world traits; the app persists the
// returned records and keeps its own panel navigation state.

import { Assets, Folders } from '../traits';
import { allocateId } from './assets';

import type { World } from 'koota';
import type { Asset, Folder } from '../assets/types';

/**
 * A folder's effective parent: its stored parentId, or root when the parent
 * record no longer exists (dangling references degrade to root instead of
 * hiding the folder).
 */
export function effectiveParentId(world: World, folder: Folder): string | null {
	const folders = world.get(Folders)!;
	return folder.parentId !== null && folders.has(folder.parentId)
		? folder.parentId
		: null;
}

/**
 * The folder an asset effectively lives in: its stored folderId, or root when
 * that folder no longer exists.
 */
export function assetFolderId(world: World, asset: Asset): string | null {
	const folderId = asset.folderId ?? null;
	return folderId !== null && world.get(Folders)!.has(folderId) ? folderId : null;
}

/**
 * True when `id` is a descendant of `ancestorId` in the folder tree.
 */
export function isDescendantFolder(world: World, id: string, ancestorId: string): boolean {
	const folders = world.get(Folders)!;
	const visited = new Set<string>();
	let current = folders.get(id);
	while (current && current.parentId !== null && !visited.has(current.id)) {
		if (current.parentId === ancestorId) return true;
		visited.add(current.id);
		current = folders.get(current.parentId);
	}
	return false;
}

/**
 * The next free `base`/`base N` name among a parent's children.
 */
export function uniqueFolderName(world: World, base: string, parentId: string | null): string {
	const names = new Set(
		Array.from(world.get(Folders)!.values())
			.filter(folder => effectiveParentId(world, folder) === parentId)
			.map(folder => folder.name),
	);
	let name = base;
	for (let i = 2; names.has(name); i++) name = `${base} ${i}`;
	return name;
}

/**
 * The next free "New folder"/"New folder N" name among a parent's children.
 */
export function nextFolderName(world: World, parentId: string | null): string {
	return uniqueFolderName(world, 'New folder', parentId);
}

/**
 * Finds a direct child folder of `parentId` by name (case-insensitive),
 * creating it when missing.
 */
export function ensureFolder(world: World, name: string, parentId: string | null = null): Folder {
	const target = name.trim().toLowerCase();
	for (const folder of world.get(Folders)!.values()) {
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
 * Creates a folder under `parentId` (null = root).
 */
export function createFolder(world: World, name: string, parentId: string | null = null): Folder {
	const folders = world.get(Folders)!;
	const folder: Folder = {
		id: allocateId(world),
		name,
		parentId: parentId !== null && folders.has(parentId) ? parentId : null,
		createdAt: new Date().toISOString(),
	};

	folders.set(folder.id, folder);
	return folder;
}

/**
 * Renames a folder. Returns the updated record, or null when nothing changed.
 */
export function renameFolder(world: World, id: string, name: string): Folder | null {
	const folders = world.get(Folders)!;
	const folder = folders.get(id);
	if (!folder || folder.name === name) return null;

	const next = { ...folder, name };
	folders.set(id, next);
	return next;
}

/**
 * Moves assets into a folder (null = root). Ignores unknown asset ids and
 * unknown target folders. Returns the updated assets.
 */
export function moveAssetsToFolder(world: World, ids: string[], folderId: string | null): Asset[] {
	if (folderId !== null && !world.get(Folders)!.has(folderId)) return [];

	const assets = world.get(Assets)!;
	const moved: Asset[] = [];
	for (const id of ids) {
		const asset = assets.get(id);
		if (!asset || (asset.folderId ?? null) === folderId) continue;
		const next = { ...asset, folderId };
		assets.set(id, next);
		moved.push(next);
	}
	return moved;
}

/**
 * Re-parents a folder (null = root). Returns the updated record, or null when
 * the move is invalid (unknown folder/target, or a cycle: dropping a folder
 * into itself or one of its descendants).
 */
export function moveFolder(world: World, id: string, parentId: string | null): Folder | null {
	const folders = world.get(Folders)!;
	const folder = folders.get(id);
	if (!folder) return null;
	if (parentId === id) return null;
	if (parentId !== null) {
		if (!folders.has(parentId)) return null;
		if (isDescendantFolder(world, parentId, id)) return null;
	}
	if (folder.parentId === parentId) return folder;

	const next = { ...folder, parentId };
	folders.set(id, next);
	return next;
}

/**
 * Deletes a folder subtree with its contents from the in-memory model.
 * Returns the removed folder and asset ids so the app can persist the
 * deletions (and navigate out of the doomed subtree first).
 */
export function deleteFolder(world: World, id: string): { folderIds: string[]; assetIds: string[] } {
	const folders = world.get(Folders)!;
	if (!folders.has(id)) return { folderIds: [], assetIds: [] };

	const subtree = new Set([id]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const candidate of folders.values()) {
			if (candidate.parentId !== null && subtree.has(candidate.parentId) && !subtree.has(candidate.id)) {
				subtree.add(candidate.id);
				grew = true;
			}
		}
	}

	const assets = world.get(Assets)!;
	const assetIds = Array.from(assets.values())
		.filter(asset => asset.folderId != null && subtree.has(asset.folderId))
		.map(asset => asset.id);

	for (const assetId of assetIds) assets.delete(assetId);
	for (const folderId of subtree) folders.delete(folderId);

	return { folderIds: [...subtree], assetIds };
}
