/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { toast } from "somoto";
import { getAssetFile } from "@/components/engine";

import type { Asset } from "@/components/engine/db";

/**
 * Download an asset file and handle user-facing failure feedback.
 */
export async function downloadAsset(asset: Asset): Promise<void> {
  let url: string | null = null;

  try {
    const file = await getAssetFile(asset);
    url = URL.createObjectURL(file);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = asset.name;
    anchor.click();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown download error";
    toast("Failed to download", { description: message });
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
