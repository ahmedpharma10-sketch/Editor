/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { editor } from "./cli-client";

const MARKER_FILENAME = ".dapi";
const MARKER_VERSION = 1;

// Asset extensions broadly aligned with the engine's media types. Used to
// filter recursive folder scans during `dapi open <folder>`.
const SUPPORTED_ASSET_EXTENSIONS: ReadonlySet<string> = new Set([
  // images
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".avif", ".heic", ".heif",
  // video
  ".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi",
  // audio
  ".mp3", ".wav", ".m4a", ".ogg", ".opus", ".flac", ".aac",
]);

type MarkerFile = {
  version: number;
  projectId: string;
  createdAt: string;
};

type OpenFolderResult = {
  project: { id: string; name: string };
  created: boolean;
  imported: number;
};

function readMarker(folderPath: string): MarkerFile | null {
  const markerPath = join(folderPath, MARKER_FILENAME);
  if (!existsSync(markerPath)) return null;
  try {
    const raw = readFileSync(markerPath, "utf8");
    const parsed = JSON.parse(raw) as MarkerFile;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.projectId !== "string" ||
      parsed.projectId.length === 0
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeMarker(folderPath: string, projectId: string): void {
  const marker: MarkerFile = {
    version: MARKER_VERSION,
    projectId,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(
    join(folderPath, MARKER_FILENAME),
    JSON.stringify(marker, null, 2),
  );
}

type AssetDirectory = {
  // Path segments relative to the import root; [] is the root itself.
  segments: string[];
  paths: string[];
};

async function collectSupportedAssets(folderPath: string) {
  const results: AssetDirectory[] = [];

  async function walk(dir: string, segments: string[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    const paths: string[] = [];
    const subdirs: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        subdirs.push(entry.name);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === MARKER_FILENAME && segments.length === 0) continue;
      if (SUPPORTED_ASSET_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        paths.push(join(dir, entry.name));
      }
    }
    if (paths.length > 0) results.push({ segments, paths });
    for (const name of subdirs) {
      await walk(join(dir, name), [...segments, name]);
    }
  }

  await walk(folderPath, []);
  return results;
}

async function ensureFolder(segments: string[], cache: Map<string, string>): Promise<string | undefined> {
  if (segments.length === 0) return undefined; // the library root
  const key = segments.join("/");
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const parentId = await ensureFolder(segments.slice(0, -1), cache);
  const folder = await editor.folder.create.mutate({ name: segments[segments.length - 1]!, parentId });
  cache.set(key, folder.id);
  return folder.id;
}

async function waitForActiveProject(expectedId: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const active = await editor.project.active.query().catch(() => null);
    if (active?.id === expectedId) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for project ${expectedId} to become active`);
}

export async function openFolder(folderPath: string): Promise<OpenFolderResult> {
  if (!existsSync(folderPath)) {
    throw new Error(`Folder not found: ${folderPath}`);
  }
  if (!statSync(folderPath).isDirectory()) {
    throw new Error(`Not a directory: ${folderPath}`);
  }

  const marker = readMarker(folderPath);

  if (marker) {
    const opened = await editor.project.open.mutate({ id: marker.projectId });
    if (opened) {
      await waitForActiveProject(opened.id);
      return { project: opened, created: false, imported: 0 };
    }
    // Stale marker: fall through and run the first-time flow, overwriting it.
  }

  const assetDirs = await collectSupportedAssets(folderPath);
  const project = await editor.project.create.mutate({ name: basename(folderPath) });
  await waitForActiveProject(project.id);

  let imported = 0;
  const folderIds = new Map<string, string>();
  for (const { segments, paths } of assetDirs) {
    const folderId = await ensureFolder(segments, folderIds);
    const results = await editor.asset.add.mutate({ paths, folderId });
    if (Array.isArray(results)) {
      imported += results.filter(
        (r: { status?: string }) => r?.status === "fulfilled",
      ).length;
    }
  }

  writeMarker(folderPath, project.id);
  return { project, created: true, imported };
}
