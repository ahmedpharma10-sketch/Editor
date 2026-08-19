/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// File actions on the library, with the user told how they went: the
// mechanics live in @diffusionstudio/assets.

import { toast } from "somoto";
import { importFiles as importFilesInto, pickFiles, saveAssetAs as saveAs } from "@diffusionstudio/assets";
import { AssetId, reactToAssetChange } from "@diffusionstudio/runtime";
import { insertAsset } from "./insert-asset";

import type { SequenceAsset } from "@diffusionstudio/assets";
import type { World } from "koota";

import type { Asset, AssetLibrary } from "@diffusionstudio/assets";

export { droppedFiles, pickFiles } from "@diffusionstudio/assets";

/** Saves a copy of an asset's file where the user says; reports failure. */
export async function saveAssetAs(asset: Pick<Asset, "handle" | "mimeType" | "path">): Promise<void> {
  try {
    await saveAs(asset);
  } catch (error) {
    toast.error("Failed to save", { description: (error as Error).message });
  }
}

/** Links files into the library at `folder` and reports whatever was skipped or refused. */
export async function importFiles(library: AssetLibrary, files: ReadonlyArray<File>, folder: string): Promise<Asset[]> {
  const report = await importFilesInto(library, files, folder);

  if (report.unnamed.length) {
    toast("Some files could not be imported", { description: "Only files on this computer can be added to the library." });
  }
  for (const { source, error } of report.failed) {
    toast.error(`Could not import ${source.split(/[\\/]/).pop()}`, { description: error.message });
  }
  return report.assets;
}

/** Opens the file picker and imports what the user picks into `folder`. */
export async function pickAndImport(library: AssetLibrary, folder: string): Promise<Asset[]> {
  return importFiles(library, await pickFiles(), folder);
}

/**
 * Lets the user pick another file for `asset` and points it there; the JSX
 * keeps naming it by path. Returns the relinked asset, or null when the
 * picker was dismissed, the host cannot tell the file's path, or the relink
 * failed (reported).
 */
export async function replaceAssetSource(library: AssetLibrary, asset: Asset): Promise<Asset | null> {
  const [file] = await pickFiles({ multiple: false });
  const path = file ? library.fs.pathOf?.(file) : null;
  if (!path) return null;
  try {
    return await library.relink(asset, path);
  } catch (error) {
    toast.error("Failed to replace", { description: (error as Error).message });
    return null;
  }
}

/** Inserts `asset` at the playhead of the active scene; tells the user when there is nowhere to put it. */
export function insertAssetAtPlayhead(world: World, asset: Asset): void {
  if (!insertAsset(world, asset)) {
    toast("Nothing to insert into", { description: "Open a project first." });
  }
}

/**
 * Sets the rate an image sequence plays its frames at. The frame count is
 * what the sequence is, so its duration follows; every clip showing it is
 * re-derived (the asset length is one of the caps on a clip's span).
 */
export function setSequenceFrameRate(world: World, library: AssetLibrary, asset: SequenceAsset, frameRate: number): void {
  const clamped = Math.max(1, Math.min(240, Math.round(frameRate)));
  if (clamped === asset.frameRate) return;

  const frames = Math.max(1, Math.round(asset.duration * asset.frameRate));
  library.update(asset, { frameRate: clamped, duration: frames / clamped });

  for (const entity of world.query(AssetId)) {
    if (entity.get(AssetId)?.value === asset.id) reactToAssetChange(world, entity);
  }
}
