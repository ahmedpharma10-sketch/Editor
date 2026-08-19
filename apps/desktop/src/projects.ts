/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Projects on disk. A project is a plain folder that is a real npm package
// with a JSX entry file whose default export renders a <stage>. The user picks
// a root folder; every direct child folder holding an entry file is a project.
// The package.json is the project record (`displayName`, `main`); there is no
// registry elsewhere.
//
// Compilation bundles the entry with esbuild (which resolves node_modules for
// us) and runs project sources through babel-preset-solid's universal JSX
// transform, so the renderer can evaluate the resulting CommonJS bundle
// against its own solid-js instance and the koota-backed JSX host.

import { app, dialog, shell, type BrowserWindow } from "electron";
import { watch, type FSWatcher } from "node:fs";
import { cp, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { TransformOptions } from "@babel/core";
import type { BuildOptions, Plugin } from "esbuild";

import { mainBridge } from "./main-manager";
import { MAIN_CHANNELS } from "./main-channels";
import { applyEdits, stampProject } from "./edit";
import { sourcePlugin } from "./source";
import type { CompileResult, FsEntry, FsStat, ProjectInfo, SourceEdit, WriteResult } from "./main-channels";
import type { SourceContext } from "./edit";

/** Entry points looked up in a project folder, in order of preference. */
export const ENTRY_FILES = ["index.tsx", "index.ts", "index.jsx", "index.js"];

/** The module compiled project code imports its JSX runtime from. */
const RUNTIME_MODULE = "@diffusionstudio/jsx";

/**
 * Imports left for the renderer to resolve against its own module instances
 * (one solid-js reactive graph, one JSX host).
 */
const EXTERNAL = ["solid-js", "solid-js/*", RUNTIME_MODULE];

const BUILD_OPTIONS: BuildOptions = {
  bundle: true,
  write: false,
  format: "cjs",
  platform: "browser",
  target: "chrome130",
  external: EXTERNAL,
  logLevel: "silent",
};

// esbuild and babel are kept external to the main bundle (esbuild ships a
// native binary). In development they resolve from the workspace; a packaged
// app has no node_modules of its own, so they load from the CLI's staged
// runtime at Contents/Resources/cli/node_modules (see scripts/stage-cli.mjs).
let stagedRequire: NodeJS.Require | undefined;

function load<T>(name: string): T {
  if (!app.isPackaged) return require(name) as T;
  stagedRequire ??= createRequire(join(process.resourcesPath, "cli", "package.json"));
  return stagedRequire(name) as T;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

type PackageJson = { name?: string; displayName?: string; main?: string } & Record<string, unknown>;

async function readPackage(dir: string): Promise<PackageJson | null> {
  try {
    return JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

async function writePackage(dir: string, pkg: PackageJson): Promise<void> {
  await writeFile(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n", "utf8");
}

/** package.json `main` when it names a JSX/TS/JS file that exists, else the default lookup. */
async function findEntry(dir: string, pkg?: PackageJson | null): Promise<string | undefined> {
  const main = (pkg ?? (await readPackage(dir)))?.main;
  if (typeof main === "string" && /\.[jt]sx?$/.test(main) && (await exists(join(dir, main)))) {
    return main.split(sep).join("/");
  }
  for (const name of ENTRY_FILES) {
    if (await exists(join(dir, name))) return name;
  }
  return undefined;
}

const noEntryError = (): string =>
  `No entry found in this folder (package.json "main" or ${ENTRY_FILES.join(" / ")}).`;

async function describe(dir: string): Promise<ProjectInfo | null> {
  const pkg = await readPackage(dir);
  const entry = await findEntry(dir, pkg);
  if (!entry) return null;
  const name = basename(dir);
  const [folder, file] = await Promise.all([stat(dir), stat(join(dir, entry))]);
  return {
    name,
    displayName: pkg?.displayName?.trim() || name,
    dir,
    entry,
    modifiedAt: file.mtime.toISOString(),
    createdAt: folder.birthtime.toISOString(),
  };
}

export const getProject = (dir: string): Promise<ProjectInfo | null> => describe(dir);

export async function pickRoot(window: BrowserWindow | null): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: "Choose projects folder",
    properties: ["openDirectory", "createDirectory"],
  };
  const { canceled, filePaths } = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (canceled || !filePaths[0]) return null;
  return filePaths[0];
}

/** Every direct child folder of `root` that holds an entry file. */
export async function listProjects(root: string): Promise<ProjectInfo[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const projects = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
      .map((entry) => describe(join(root, entry.name))),
  );
  return projects.filter((project): project is ProjectInfo => project !== null);
}

// ---------------------------------------------------------------------------
// Scaffold

/** npm names: lowercase, url-safe, no leading dot or underscore, <= 214 chars. */
function packageName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 214);
  return cleaned || "diffusion-project";
}

// Types only: the editor supplies the runtime when it mounts the project.
const JSX_VERSION = "^0.1.0";
const SOLID_VERSION = "^1.9.10";

const packageJson = (name: string, displayName: string): PackageJson => ({
  name: packageName(name),
  displayName,
  private: true,
  type: "module",
  main: "index.tsx",
  devDependencies: {
    "@diffusionstudio/jsx": JSX_VERSION,
    "solid-js": SOLID_VERSION,
  },
});

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "jsxImportSource": "@diffusionstudio/jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
`;

/** What a project folder produces but should not check in: installs, and derived data (thumbnails, waveforms). */
const GITIGNORE = `node_modules/
cache/
`;

const STARTER = `export default function Project() {
  return (
    <stage background="#161616">
    </stage>
  )
}
`;

async function writeIfMissing(dir: string, name: string, content: string): Promise<void> {
  const path = join(dir, name);
  if (await exists(path)) return;
  await writeFile(path, content, "utf8");
}

/** Adds the record fields to a package.json that predates them; leaves everything else alone. */
async function ensurePackage(dir: string, name: string, displayName: string, entry: string): Promise<void> {
  const pkg = await readPackage(dir);
  if (!pkg) {
    await writePackage(dir, { ...packageJson(name, displayName), main: entry });
    return;
  }
  const next = { ...pkg };
  if (typeof next.displayName !== "string") next.displayName = displayName;
  if (typeof next.main !== "string") next.main = entry;
  if (next.displayName !== pkg.displayName || next.main !== pkg.main) await writePackage(dir, next);
}

/**
 * Turns `dir` into a starter TypeScript project: files the project owns are
 * written once, so opening an up-to-date project writes nothing. Types come
 * from @diffusionstudio/jsx (jsxImportSource), installed by the project.
 */
export async function scaffold(dir: string, displayName = basename(dir)): Promise<void> {
  const name = basename(dir);
  let entry = await findEntry(dir);
  // JavaScript projects are left alone.
  if (entry && !/\.tsx?$/.test(entry)) return;

  if (!entry) {
    await writeIfMissing(dir, "index.tsx", STARTER);
    entry = "index.tsx";
  }
  await ensurePackage(dir, name, displayName, entry);
  await writeIfMissing(dir, "tsconfig.json", TSCONFIG);
  await writeIfMissing(dir, ".gitignore", GITIGNORE);
}

/** Creates a fresh project folder under `root`. Fails if the folder exists. */
export async function createProject(root: string, name: string, displayName: string): Promise<ProjectInfo> {
  const dir = join(root, name);
  if (await exists(dir)) throw new Error(`"${name}" already exists in the projects folder.`);
  await mkdir(dir, { recursive: true });
  await scaffold(dir, displayName);
  const project = await describe(dir);
  if (!project) throw new Error("Failed to scaffold the project.");
  return project;
}

/** Sets the human name (package.json `displayName`). */
export async function renameProject(dir: string, displayName: string): Promise<ProjectInfo> {
  const pkg = (await readPackage(dir)) ?? packageJson(basename(dir), displayName);
  await writePackage(dir, { ...pkg, displayName: displayName.trim() || basename(dir) });
  const project = await describe(dir);
  if (!project) throw new Error("Not a project folder.");
  return project;
}

/** Copies the folder next to itself as `<name>-copy` (numbered when taken). */
export async function duplicateProject(dir: string): Promise<ProjectInfo> {
  const source = await describe(dir);
  if (!source) throw new Error("Not a project folder.");

  const root = dirname(dir);
  let name = `${source.name}-copy`;
  for (let i = 2; await exists(join(root, name)); i++) name = `${source.name}-copy-${i}`;
  const target = join(root, name);

  await cp(dir, target, { recursive: true, errorOnExist: true, force: false });
  await renameProject(target, `${source.displayName} (Copy)`);
  const project = await describe(target);
  if (!project) throw new Error("Failed to duplicate the project.");
  return project;
}

/** Moves the folder to the trash. */
export async function deleteProject(dir: string): Promise<void> {
  unwatchProject(dir);
  await shell.trashItem(dir);
}

// ---------------------------------------------------------------------------
// Compile

type Babel = typeof import("@babel/core");
type Esbuild = typeof import("esbuild");

/** A preset however its package exposes it (CJS `module.exports` or an ESM default). */
function preset(name: string): unknown {
  const loaded = load<{ default?: unknown }>(name);
  return loaded.default ?? loaded;
}

const babelOptions = (file: string, filename: string): TransformOptions => ({
  filename,
  babelrc: false,
  configFile: false,
  // Runs before the presets, which is what it needs: Solid's transform
  // replaces the JSX trees this stamps.
  plugins: [[sourcePlugin, { file }]],
  presets: [
    [preset("babel-preset-solid"), { generate: "universal", moduleName: RUNTIME_MODULE }],
    [preset("@babel/preset-typescript"), { onlyRemoveTypeImports: true }],
  ],
});

/** Runs project sources (not node_modules) through Solid's universal JSX transform. */
function solidLoader(root: string): Plugin {
  const { transformAsync } = load<Babel>("@babel/core");
  return {
    name: "solid-universal",
    setup(build) {
      build.onLoad({ filter: /\.[jt]sx?$/ }, async (args) => {
        const name = relative(root, args.path);
        if (name.startsWith("..") || name.includes(`${sep}node_modules${sep}`) || name.startsWith(`node_modules${sep}`)) {
          return undefined;
        }
        const source = await readFile(args.path, "utf8");
        // The project-relative name is half of every element's id, so it is
        // spelled the one way both directions of ./source spell it.
        const result = await transformAsync(source, babelOptions(name.split(sep).join("/"), args.path));
        return { contents: result?.code ?? "", loader: "js" };
      });
    },
  };
}

/** The `./edit` context for a project folder, wired to the watcher's self-write log. */
const sourceContext = (dir: string): SourceContext => ({
  dir,
  onWrite: (file) => markSelfWrite(dir, file),
});

export async function compileProject(dir: string): Promise<CompileResult> {
  const entry = await findEntry(dir);
  if (!entry) return { ok: false, error: noEntryError() };

  // Fills in package.json/tsconfig for folders that predate the record.
  await scaffold(dir);

  // Names every element before it is numbered, so the ids this compile hands
  // the canvas are durable ones. A fully keyed project is not written to.
  await stampProject(sourceContext(dir));

  // esbuild resolves symlinks, so the loader has to match on real paths.
  const root = await realpath(dir);

  try {
    const { build } = load<Esbuild>("esbuild");
    const result = await build({
      ...BUILD_OPTIONS,
      entryPoints: [join(root, entry)],
      plugins: [solidLoader(root)],
    });
    return { ok: true, code: result.outputFiles![0]!.text };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// Write

/**
 * Writes values the editor arrived at back into the JSX that produced them.
 * Deliberately not a compile: the canvas already shows these values, so this
 * is the file catching up with the scene rather than the other way round, and
 * the watcher is told to keep quiet about it (see `markSelfWrite`).
 */
export async function writeProject(dir: string, edits: SourceEdit[]): Promise<WriteResult> {
  try {
    return await applyEdits(sourceContext(dir), edits);
  } catch (error) {
    return { skipped: edits.map((edit) => edit.source), error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// Assets

/** The asset manifest's file name. */
export const MANIFEST_FILE = "assets.yml";

/**
 * A `source` of the asset library as an absolute path: absolute already, or
 * relative to the project. Refuses to leave the project for a relative one.
 */
function sourcePath(dir: string, source: string): string {
  if (isAbsolute(source)) return source;
  const path = resolve(dir, source);
  if (relative(dir, path).startsWith("..")) throw new Error(`Path leaves the project: ${source}`);
  return path;
}

/** The manifest as plain data, or null when the project has none. */
export async function readManifest(dir: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(join(dir, MANIFEST_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return parseYaml(text) ?? null;
}

/**
 * Writes the manifest as YAML. Atomic (temp file + rename), so a crash
 * mid-write leaves the old manifest, and marked as ours so the watcher does
 * not hand it back as a change.
 */
export async function writeManifest(dir: string, manifest: unknown): Promise<void> {
  const path = join(dir, MANIFEST_FILE);
  const temp = join(dir, `.${MANIFEST_FILE}.tmp`);
  const text = stringifyYaml(manifest, { lineWidth: 0 });
  markSelfWrite(dir, MANIFEST_FILE);
  markSelfWrite(dir, `.${MANIFEST_FILE}.tmp`);
  await writeFile(temp, `# Diffusion Studio asset library. Edited by the app; hand edits are read on the next load.
${text}`, "utf8");
  await rename(temp, path);
}

// ---------------------------------------------------------------------------
// Config

/** The package.json field the project's config lives under. */
const CONFIG_FIELD = "diffusion";

/** The project's config (package.json `diffusion`), or null when there is none. */
export async function readConfig(dir: string): Promise<unknown> {
  const pkg = await readPackage(dir);
  return pkg?.[CONFIG_FIELD] ?? null;
}

/**
 * Replaces the project's config in its package.json (removes the field for
 * null), leaving the rest of the record alone. The watcher is told to keep
 * quiet about it, like the manifest: the app already shows these values.
 */
export async function writeConfig(dir: string, config: unknown): Promise<void> {
  const pkg = (await readPackage(dir)) ?? packageJson(basename(dir), basename(dir));
  const next: PackageJson = { ...pkg };
  if (config === null || config === undefined) delete next[CONFIG_FIELD];
  else next[CONFIG_FIELD] = config;
  markSelfWrite(dir, "package.json");
  await writePackage(dir, next);
}

/** Entries of a directory; [] when it is missing or not a directory. */
export async function listEntries(dir: string, source: string): Promise<FsEntry[]> {
  const path = sourcePath(dir, source);
  let names: import("node:fs").Dirent[];
  try {
    names = await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
  const entries = await Promise.all(names.map(async (entry): Promise<FsEntry | null> => {
    if (!entry.isFile() && !entry.isDirectory()) return null;
    try {
      const info = await stat(join(path, entry.name));
      return { name: entry.name, kind: entry.isDirectory() ? "directory" : "file", size: info.size, mtime: info.mtimeMs };
    } catch {
      return null;
    }
  }));
  return entries.filter((entry): entry is FsEntry => entry !== null);
}

/** Size and mtime of a file, or null when it does not exist. */
export async function statEntry(dir: string, source: string): Promise<FsStat | null> {
  try {
    const info = await stat(sourcePath(dir, source));
    return { size: info.size, mtime: info.mtimeMs };
  } catch {
    return null;
  }
}

/** Removes a file or directory inside the project; missing is fine. */
export async function removeEntry(dir: string, path: string): Promise<void> {
  if (isAbsolute(path)) throw new Error("Only project files can be removed");
  markSelfWrite(dir, path.split(sep).join("/"));
  await rm(sourcePath(dir, path), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Watch

const watchers = new Map<string, FSWatcher>();

/** How long a file we wrote ourselves stays exempt from the watcher. */
const SELF_WRITE_GRACE = 1000;

/**
 * Writes made on behalf of the editor, by file and time. The watcher stays on
 * — anything else may be editing these files, and should still reach the
 * canvas — but our own writes must not come back as a change, or every key
 * stamp and every dragged rect would cost a recompile and a remount of the
 * scene the user is looking at.
 */
const selfWrites = new Map<string, number>();

const writeKey = (dir: string, path: string): string => `${dir}\n${path}`;

export function markSelfWrite(dir: string, path: string): void {
  selfWrites.set(writeKey(dir, path), Date.now());
}

/** `markSelfWrite` for an absolute path, against whichever watched project holds it. */
export function markSelfWriteAbsolute(path: string): void {
  for (const dir of watchers.keys()) {
    const rel = relative(dir, path);
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
      markSelfWrite(dir, rel.split(sep).join("/"));
    }
  }
}

function isSelfWrite(dir: string, path: string): boolean {
  const key = writeKey(dir, path);
  const at = selfWrites.get(key);
  if (at === undefined) return false;
  if (Date.now() - at > SELF_WRITE_GRACE) {
    selfWrites.delete(key);
    return false;
  }
  return true;
}

export function watchProject(window: BrowserWindow | null, dir: string): void {
  if (watchers.has(dir)) return;
  const watcher = watch(dir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    // Project-relative and `/`-separated; installs churn node_modules constantly.
    const path = filename.split(sep).join("/");
    if (path.startsWith("node_modules/") || path === "node_modules") return;
    if (isSelfWrite(dir, path)) return;
    mainBridge.emit(window, MAIN_CHANNELS.PROJECTS_CHANGED, { dir, path });
  });
  watcher.on("error", () => unwatchProject(dir));
  watchers.set(dir, watcher);
}

export function unwatchProject(dir: string): void {
  watchers.get(dir)?.close();
  watchers.delete(dir);
}

export function unwatchAll(): void {
  for (const dir of [...watchers.keys()]) unwatchProject(dir);
}
