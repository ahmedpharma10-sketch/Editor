/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// File actions on the library, with the user told how they went: the
// mechanics live in @diffusionstudio/assets.

import { toast } from "somoto";
import { importFiles as importFilesInto, pickFiles, saveAssetAs as saveAs } from "@diffusionstudio/assets";

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
