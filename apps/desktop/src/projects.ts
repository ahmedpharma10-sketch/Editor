/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Projects on disk. A project is a plain folder that is a real npm package
// with a JSX entry file whose default export renders a <stage>. The user picks
// a root folder; every direct child folder holding an entry file is a project.
//
// Compilation bundles the entry with esbuild (which resolves node_modules for
// us) and runs project sources through babel-preset-solid's universal JSX
// transform, so the renderer can evaluate the resulting CommonJS bundle
// against its own solid-js instance and the koota-backed JSX host.

import { app, dialog, type BrowserWindow } from "electron";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";

import type { TransformOptions } from "@babel/core";
import type { BuildOptions, Plugin } from "esbuild";

import { mainBridge } from "./main-manager";
import { MAIN_CHANNELS } from "./main-channels";
import type { CompileResult, ProjectInfo } from "./main-channels";

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

async function findEntry(dir: string): Promise<string | undefined> {
  for (const name of ENTRY_FILES) {
    if (await exists(join(dir, name))) return name;
  }
  return undefined;
}

const noEntryError = (): string => `No ${ENTRY_FILES.join(" / ")} found in this folder.`;

async function describe(dir: string, name: string): Promise<ProjectInfo | null> {
  const entry = await findEntry(dir);
  if (!entry) return null;
  const [folder, file] = await Promise.all([stat(dir), stat(join(dir, entry))]);
  return {
    name,
    dir,
    entry,
    modifiedAt: file.mtime.toISOString(),
    createdAt: folder.birthtime.toISOString(),
  };
}

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
      .map((entry) => describe(join(root, entry.name), entry.name)),
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

const packageJson = (name: string): string => `{
  "name": "${packageName(name)}",
  "private": true,
  "type": "module",
  "devDependencies": {
    "solid-js": "^1.9.10"
  }
}
`;

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
`;

const STARTER = `export default function Scene() {
  return (
    <stage width={1920} height={1080}>
      <rect x={120} y={120} width={480} height={320} fill="#6366f1" />
    </stage>
  )
}
`;

// Types for the tags the editor renders. Owned by the app and re-synced on
// every open, so projects can't drift from the supported vocabulary.
const TYPES = `// Generated by Diffusion Studio. Types for the tags rendered on the canvas.
// Edits here are overwritten.

interface StageProps {
  x?: number
  y?: number
  width?: number
  height?: number
  children?: unknown
}

interface RectProps extends StageProps {
  fill?: string
}

declare namespace JSX {
  interface IntrinsicElements {
    stage: StageProps
    rect: RectProps
  }
}
`;

async function writeIfMissing(dir: string, name: string, content: string): Promise<void> {
  const path = join(dir, name);
  if (await exists(path)) return;
  await writeFile(path, content, "utf8");
}

async function writeIfChanged(dir: string, name: string, content: string): Promise<void> {
  const path = join(dir, name);
  const current = await readFile(path, "utf8").catch(() => undefined);
  if (current === content) return;
  await writeFile(path, content, "utf8");
}

/**
 * Turns `dir` into a starter TypeScript project: files the project owns are
 * written once, the generated types are kept in sync. Opening an up-to-date
 * project writes nothing.
 */
export async function scaffold(dir: string, name: string): Promise<void> {
  const entry = await findEntry(dir);
  // JavaScript projects are left alone.
  if (entry && !/\.tsx?$/.test(entry)) return;

  if (!entry) await writeIfMissing(dir, "index.tsx", STARTER);
  await writeIfMissing(dir, "package.json", packageJson(name));
  await writeIfMissing(dir, "tsconfig.json", TSCONFIG);
  await writeIfChanged(dir, "jsx.d.ts", TYPES);
}

/** Creates a fresh project folder under `root`. Fails if the folder exists. */
export async function createProject(root: string, name: string): Promise<ProjectInfo> {
  const dir = join(root, name);
  if (await exists(dir)) throw new Error(`"${name}" already exists in the projects folder.`);
  await mkdir(dir, { recursive: true });
  await scaffold(dir, name);
  const project = await describe(dir, name);
  if (!project) throw new Error("Failed to scaffold the project.");
  return project;
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

const babelOptions = (filename: string): TransformOptions => ({
  filename,
  babelrc: false,
  configFile: false,
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
        const result = await transformAsync(source, babelOptions(args.path));
        return { contents: result?.code ?? "", loader: "js" };
      });
    },
  };
}

export async function compileProject(dir: string): Promise<CompileResult> {
  const entry = await findEntry(dir);
  if (!entry) return { ok: false, error: noEntryError() };

  // Generated types may have drifted since the project was created.
  await scaffold(dir, dir.split(sep).pop() ?? "project");

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
// Watch

const watchers = new Map<string, FSWatcher>();

export function watchProject(window: BrowserWindow | null, dir: string): void {
  if (watchers.has(dir)) return;
  const watcher = watch(dir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    // Project-relative and `/`-separated; installs churn node_modules constantly.
    const path = filename.split(sep).join("/");
    if (path.startsWith("node_modules/") || path === "node_modules") return;
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
