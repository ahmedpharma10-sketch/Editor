#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { extname, isAbsolute, join, resolve } from "node:path";
import { Command } from "commander";
import { version } from "../../../package.json";
import { parseTime, TIME_FPS } from "@diffusionstudio/jsx";
import { editor, errnoCode, waitForCliSocket, GENERATE_TIMEOUT_MS } from "./cli-client";
import { compileProject } from "./compile-project";
import { listLocalFonts } from "./fonts";
import { openFolder } from "./open-folder";
import { fetchVideo } from "./ytdlp";
import type { AssetRef, EncoderConfigInput, NodePatch } from "./protocol";

// Long-running commands (renders, AI generation) override the default 60s.
const GENERATE = { context: { timeoutMs: GENERATE_TIMEOUT_MS } };

const APP_NAME = "Diffusion Studio";
const PROTOCOL = "diffusion";

// Forwarded to the app's process.argv;
const HIDDEN_FLAG = "--hidden";

function openApp(target?: string, background = false): void {
  const isUrl = !!target && target.startsWith(`${PROTOCOL}://`);
  const os = platform();

  if (os === "darwin") {
    const args: string[] = [];
    if (background) args.push("-g");
    if (isUrl) {
      args.push(target!);
    } else {
      args.push("-a", process.env.DIFFUSION_APP_PATH ?? APP_NAME);
      if (target) args.push(target);
    }

    if (background) {
      args.push("--args", HIDDEN_FLAG);
    }

    spawn("open", args, { detached: true, stdio: "ignore" }).unref();
    return;
  }

  if (os === "win32") {
    const arg = target ?? APP_NAME;
    const args = ["/c", "start", "", arg];
    if (background) args.push(HIDDEN_FLAG);
    spawn("cmd", args, { detached: true, stdio: "ignore" }).unref();
    return;
  }

  const candidates = [
    "/usr/bin/diffusion-studio",
    "/usr/local/bin/diffusion-studio",
    join(process.env.HOME ?? "", ".local/bin/diffusion-studio"),
  ];
  const bin = candidates.find((p) => existsSync(p));
  if (bin) {
    const args = target ? [target] : [];
    if (background) args.push(HIDDEN_FLAG);
    spawn(bin, args, { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (isUrl) {
    spawn("xdg-open", [target!], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  console.error(`Could not locate "${APP_NAME}" on this system.`);
  process.exit(1);
}

async function openTarget(target: string | undefined, background: boolean): Promise<void> {
  if (target && !target.startsWith(`${PROTOCOL}://`)) {
    const absPath = isAbsolute(target) ? target : resolve(process.cwd(), target);
    if (!existsSync(absPath)) {
      console.error(`Path not found: ${absPath}`);
      process.exit(1);
    }
    if (statSync(absPath).isDirectory()) {
      openApp(undefined, background);
      try {
        await waitForCliSocket();
        const result = await openFolder(absPath);
        console.log(JSON.stringify(result));
      } catch (e) {
        console.error((e as Error).message);
        process.exit(1);
      }
      return;
    }
  }
  openApp(target, background);
}

function handleSocketError(e: unknown): never {
  const code = errnoCode(e);
  if (code === "ENOENT" || code === "ECONNREFUSED") {
    console.error(`${APP_NAME} is not running. Launch the app first, then retry.`);
  } else {
    console.error((e as Error).message);
  }
  process.exit(1);
}

// Node ids are entity ids — integers. argv is always string, so the
// conversion belongs here, at the one boundary, with a strict check. Coercing
// app-side with Number() would silently accept "0x1f", "1e3", " 7 ", "" → 0.
function parseNodeIds(ids: string[]): number[] {
  return ids.map((id) => {
    if (!/^\d+$/.test(id)) {
      console.error(`Invalid node id: ${JSON.stringify(id)} (expected a non-negative integer)`);
      process.exit(1);
    }
    return Number(id);
  });
}

type AssetAddOptions = { folder?: string };

async function addAssets(paths: string[], opts: AssetAddOptions): Promise<void> {
  if (paths.length === 0) {
    console.error("No file paths provided.");
    process.exit(1);
  }

  const absolutePaths = paths.map((p) => (isAbsolute(p) ? p : resolve(process.cwd(), p)));
  for (const p of absolutePaths) {
    if (!existsSync(p)) {
      console.error(`File not found: ${p}`);
      process.exit(1);
    }
    if (!statSync(p).isFile()) {
      console.error(`Not a file: ${p}`);
      process.exit(1);
    }
  }

  try {
    const results = await editor.asset.add.mutate({ paths: absolutePaths, folderId: opts.folder });
    for (const result of results) console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

async function listAssets(ids: string[]): Promise<void> {
  try {
    // No ids → every asset in the library; with ids → those specific assets.
    const results = await editor.asset.list.query({ ids: ids.length ? ids : undefined });
    let failed = false;
    for (const result of results) {
      if (result.status === "fulfilled") {
        console.log(JSON.stringify(result.asset));
      } else {
        console.error(result.error);
        failed = true;
      }
    }
    if (failed) process.exit(1);
  } catch (e) {
    handleSocketError(e);
  }
}

type AssetTreeOptions = { folder?: string; depth?: string };

async function assetTree(opts: AssetTreeOptions): Promise<void> {
  let depth: number | undefined;
  if (opts.depth !== undefined) {
    const n = Number(opts.depth);
    if (!Number.isInteger(n) || n <= 0) {
      console.error(`--depth must be a positive integer (got "${opts.depth}")`);
      process.exit(1);
    }
    depth = n;
  }

  try {
    const results = await editor.asset.tree.query({ folderId: opts.folder, depth });
    for (const result of results) console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

async function deleteAssets(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    console.error("No ids provided.");
    process.exit(1);
  }
  try {
    const results = await editor.asset.delete.mutate({ ids });
    for (const result of results) console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

type MoveOptions = { to?: string };

async function moveAssets(ids: string[], opts: MoveOptions): Promise<void> {
  if (ids.length === 0) {
    console.error("No ids provided.");
    process.exit(1);
  }
  try {
    const results = await editor.asset.move.mutate({ ids, to: opts.to });
    for (const result of results) console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

type AssetExportOptions = { output?: string };

async function exportAssets(ids: string[], opts: AssetExportOptions): Promise<void> {
  if (ids.length === 0) {
    console.error("No ids provided.");
    process.exit(1);
  }

  let output: string;
  let isDir: boolean;
  if (opts.output === undefined) {
    output = tmpdir();
    isDir = true;
  } else {
    output = isAbsolute(opts.output) ? opts.output : resolve(process.cwd(), opts.output);
    // A trailing separator always means a directory; so do multiple ids.
    const wantsDir = /[\\/]$/.test(opts.output) || ids.length > 1;
    if (existsSync(output) && statSync(output).isFile()) {
      if (wantsDir) {
        console.error(`--output must be a directory here, but resolves to an existing file: ${output}`);
        process.exit(1);
      }
      isDir = false;
    } else if (existsSync(output)) {
      isDir = true;
    } else {
      isDir = wantsDir;
      if (isDir) mkdirSync(output, { recursive: true });
    }
  }

  const stop = startSpinner(ids.length > 1 ? "Exporting assets" : "Exporting asset");
  try {
    const results = await editor.asset.export.mutate({ ids, output, isDir }, GENERATE);
    stop();
    for (const result of results) console.log(JSON.stringify(result));
  } catch (e) {
    stop();
    handleSocketError(e);
  }
}

async function listFolders(parentId: string | undefined): Promise<void> {
  try {
    const results = await editor.folder.list.query({ parentId });
    for (const result of results) console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

type FolderCreateOptions = { parent?: string };

async function createFolder(name: string, opts: FolderCreateOptions): Promise<void> {
  try {
    const result = await editor.folder.create.mutate({ name, parentId: opts.parent });
    console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

async function renameFolder(id: string, name: string): Promise<void> {
  try {
    const result = await editor.folder.rename.mutate({ id, name });
    console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

async function moveFolders(ids: string[], opts: MoveOptions): Promise<void> {
  if (ids.length === 0) {
    console.error("No ids provided.");
    process.exit(1);
  }
  try {
    const results = await editor.folder.move.mutate({ ids, to: opts.to });
    for (const result of results) console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

async function deleteFolders(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    console.error("No ids provided.");
    process.exit(1);
  }
  try {
    const results = await editor.folder.delete.mutate({ ids });
    for (const result of results) console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

async function listSelection(): Promise<void> {
  try {
    const results = await editor.selection.list.query();
    for (const result of results) console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

async function setSelection(ids: string[]): Promise<void> {
  try {
    const results = await editor.selection.set.mutate({ ids: parseNodeIds(ids) });
    for (const result of results) console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

async function focusSelection(): Promise<void> {
  try {
    const results = await editor.selection.focus.mutate();
    for (const result of results) console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

async function listNodes(ids: string[]): Promise<void> {
  try {
    // No ids → root scenes; with ids → those specific nodes.
    const results = await editor.node.list.query({ ids: ids.length ? parseNodeIds(ids) : undefined });
    let failed = false;
    for (const result of results) {
      if (result.status === "fulfilled") {
        console.log(JSON.stringify(result.node));
      } else {
        console.error(result.error);
        failed = true;
      }
    }
    if (failed) process.exit(1);
  } catch (e) {
    handleSocketError(e);
  }
}

type TreeOptions = { depth?: string };

async function nodeTree(id: string | undefined, opts: TreeOptions): Promise<void> {
  const eid = id !== undefined ? parseNodeIds([id])[0] : undefined;

  let depth: number | undefined = 3;
  if (opts.depth !== undefined) {
    const n = Number(opts.depth);
    if (!Number.isInteger(n) || n < 0) {
      console.error(`--depth must be a non-negative integer (got "${opts.depth}")`);
      process.exit(1);
    }
    depth = n === 0 ? undefined : n;
  }

  try {
    const results = await editor.node.tree.query({ id: eid, depth });
    for (const result of results) {
      console.log(JSON.stringify(result));
    }
  } catch (e) {
    handleSocketError(e);
  }
}

type NodeGrepOptions = {
  ignoreCase?: boolean;
  type?: string[];
  component?: string[];
  refsOnly?: boolean;
  count?: boolean;
};

async function grepNodes(pattern: string, id: string | undefined, opts: NodeGrepOptions): Promise<void> {
  // Validate the regex here so a bad pattern fails before the app is contacted.
  try {
    new RegExp(pattern);
  } catch (e) {
    console.error(`Invalid pattern: ${(e as Error).message}`);
    process.exit(1);
  }
  const eid = id !== undefined ? parseNodeIds([id])[0] : undefined;

  try {
    const results = await editor.node.grep.query({
      pattern,
      ignoreCase: opts.ignoreCase,
      id: eid,
      types: opts.type,
      components: opts.component,
    });
    if (opts.count) {
      console.log(JSON.stringify(results.length));
      return;
    }
    for (const result of results) {
      if (opts.refsOnly) {
        const { matches, ...ref } = result;
        console.log(JSON.stringify(ref));
      } else {
        console.log(JSON.stringify(result));
      }
    }
  } catch (e) {
    handleSocketError(e);
  }
}

type ScreenshotOptions = { time?: string };

async function nodeScreenshot(id: string | undefined, opts: ScreenshotOptions): Promise<void> {
  const eid = id !== undefined ? parseNodeIds([id])[0] : undefined;

  let frame: number | undefined;
  if (opts.time !== undefined) {
    frame = Math.round(parseTimeArg(opts.time, "--time") * TIME_FPS);
  }

  try {
    const { base64 } = await editor.node.screenshot.query({ id: eid, frame });
    const path = join(tmpdir(), `${randomUUID()}.png`);
    writeFileSync(path, Buffer.from(base64, "base64"));
    console.log(JSON.stringify({ path }));
  } catch (e) {
    handleSocketError(e);
  }
}

type AssetFrameOptions = { time?: string[]; resolution?: string; output?: string };

async function assetFrame(ref: string, opts: AssetFrameOptions): Promise<void> {
  let times: number[] | undefined;
  if (opts.time !== undefined) {
    times = opts.time.map((t) => parseTimeArg(t, "--time"));
  }

  let resolution: number | undefined;
  if (opts.resolution !== undefined) {
    resolution = Number(opts.resolution);
    if (!Number.isInteger(resolution) || resolution < 0) {
      console.error(`--resolution must be a non-negative integer pixel count, or 0 for native (got "${opts.resolution}")`);
      process.exit(1);
    }
  }

  const target = resolveAssetRef(ref);
  const dir = opts.output ?? tmpdir();
  try {
    const frames = await editor.asset.frame.query({ ...target, times, resolution });
    for (const { time, base64 } of frames) {
      const path = join(dir, `${randomUUID()}.png`);
      writeFileSync(path, Buffer.from(base64, "base64"));
      console.log(JSON.stringify({ time, path }));
    }
  } catch (e) {
    handleSocketError(e);
  }
}

function resolveAssetRef(ref: string): AssetRef {
  if (/^[A-Za-z0-9]+$/.test(ref)) return { id: ref };

  const absPath = isAbsolute(ref) ? ref : resolve(process.cwd(), ref);
  if (!existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }
  if (!statSync(absPath).isFile()) {
    console.error(`Not a file: ${absPath}`);
    process.exit(1);
  }
  return { path: absPath };
}

async function assetProbe(ref: string): Promise<void> {
  const target = resolveAssetRef(ref);
  const stop = startSpinner("Probing asset");
  try {
    const result = await editor.asset.probe.query(target);
    stop();
    console.log(JSON.stringify(result));
  } catch (e) {
    stop();
    handleSocketError(e);
  }
}

type AssetTranscribeOptions = { start?: string; end?: string };

async function assetTranscribe(ref: string, opts: AssetTranscribeOptions): Promise<void> {
  const start = opts.start !== undefined ? parseTimeArg(opts.start, "--start") : undefined;
  const end = opts.end !== undefined ? parseTimeArg(opts.end, "--end") : undefined;
  if (start !== undefined && end !== undefined && start >= end) {
    console.error(`--start (${start}s) must be less than --end (${end}s).`);
    process.exit(1);
  }

  const target = resolveAssetRef(ref);
  const stop = startSpinner("Transcribing asset");
  try {
    const result = await editor.asset.transcribe.query({ ...target, start, end }, GENERATE);
    stop();
    console.log(JSON.stringify(result));
  } catch (e) {
    stop();
    handleSocketError(e);
  }
}

type AssetAnalyzeOptions = { prompt?: string; start?: string; end?: string; keepVideo?: boolean };

async function assetAnalyze(ref: string, opts: AssetAnalyzeOptions): Promise<void> {
  const start = opts.start !== undefined ? parseTimeArg(opts.start, "--start") : undefined;
  const end = opts.end !== undefined ? parseTimeArg(opts.end, "--end") : undefined;
  if (start !== undefined && end !== undefined && start >= end) {
    console.error(`--start (${start}s) must be less than --end (${end}s).`);
    process.exit(1);
  }

  const target = resolveAssetRef(ref);
  const stop = startSpinner("Analyzing asset");
  try {
    const result = await editor.asset.analyze.query(
      { ...target, prompt: opts.prompt, start, end, stripVideo: !opts.keepVideo },
      GENERATE,
    );
    stop();
    console.log(JSON.stringify(result));
  } catch (e) {
    stop();
    handleSocketError(e);
  }
}

type AssetVisualizeOptions = { start?: string; end?: string; scale?: string; output?: string };

function parseTimeArg(value: string, flag: string): number {
  const seconds = parseTime(value);
  if (seconds === undefined || seconds < 0) {
    console.error(
      `${flag} must be a non-negative Time — seconds ("1.5"), frames ("45f"), or "MM:SS" (got "${value}")`,
    );
    process.exit(1);
  }
  return seconds;
}

async function assetVisualize(ref: string, opts: AssetVisualizeOptions): Promise<void> {
  const start = opts.start !== undefined ? parseTimeArg(opts.start, "--start") : undefined;
  const end = opts.end !== undefined ? parseTimeArg(opts.end, "--end") : undefined;
  if (start !== undefined && end !== undefined && start >= end) {
    console.error(`--start (${start}s) must be less than --end (${end}s).`);
    process.exit(1);
  }

  let scale: number | undefined;
  if (opts.scale !== undefined) {
    scale = Number(opts.scale);
    if (!Number.isFinite(scale) || scale <= 0) {
      console.error(`--scale must be a positive number (got "${opts.scale}")`);
      process.exit(1);
    }
  }

  const target = resolveAssetRef(ref);
  const path = opts.output ?? join(tmpdir(), `${randomUUID()}.png`);
  const stop = startSpinner("Rendering visualization");
  try {
    const { base64, ...rest } = await editor.asset.visualize.query({ ...target, start, end, scale });
    stop();
    writeFileSync(path, Buffer.from(base64, "base64"));
    console.log(JSON.stringify({ path, ...rest }));
  } catch (e) {
    stop();
    handleSocketError(e);
  }
}

const MOUNT_EXTENSIONS = new Set([".tsx", ".jsx", ".ts", ".js"]);

type MountOptions = { code?: string };

// Validates the (<path> | --code) pair shared by `mount` and `node insert`,
// then compiles the module. Compile errors fail here, before the app is contacted.
async function compileProjectInput(path: string | undefined, code: string | undefined): Promise<string> {
  if ((path === undefined) === (code === undefined)) {
    console.error(`Provide exactly one of <path> or --code <str>.`);
    process.exit(1);
  }

  let input: { path: string } | { code: string };
  if (path !== undefined) {
    const absPath = isAbsolute(path) ? path : resolve(process.cwd(), path);
    if (!existsSync(absPath) || !statSync(absPath).isFile()) {
      console.error(`File not found: ${absPath}`);
      process.exit(1);
    }
    if (!MOUNT_EXTENSIONS.has(extname(absPath).toLowerCase())) {
      console.error(`Entry module must be a .tsx, .jsx, .ts, or .js file (got "${extname(absPath)}")`);
      process.exit(1);
    }
    input = { path: absPath };
  } else {
    input = { code: code! };
  }

  try {
    return await compileProject(input);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

async function mountProject(path: string | undefined, opts: MountOptions): Promise<void> {
  const code = await compileProjectInput(path, opts.code);

  const stop = startSpinner("Mounting project");
  try {
    const result = await editor.mount.mutate({ code }, GENERATE);
    stop();
    if (result.status === "rejected") {
      console.error(result.error);
      process.exit(1);
    }
  } catch (e) {
    stop();
    handleSocketError(e);
  }
}

type NodeInsertOptions = MountOptions & { index?: string };

async function nodeInsert(parentId: string, path: string | undefined, opts: NodeInsertOptions): Promise<void> {
  const [eid] = parseNodeIds([parentId]);

  let index: number | undefined;
  if (opts.index !== undefined) {
    const n = Number(opts.index);
    if (!Number.isInteger(n) || n < 0) {
      console.error(`--index must be a non-negative integer (got "${opts.index}")`);
      process.exit(1);
    }
    index = n;
  }

  const code = await compileProjectInput(path, opts.code);

  const stop = startSpinner("Inserting entities");
  try {
    const result = await editor.node.insert.mutate({ code, parentId: eid, index }, GENERATE);
    stop();
    if (result.status === "rejected") {
      console.error(result.error);
      process.exit(1);
    }
  } catch (e) {
    stop();
    handleSocketError(e);
  }
}

async function deleteNodes(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    console.error("No ids provided.");
    process.exit(1);
  }
  try {
    const results = await editor.node.delete.mutate({ ids: parseNodeIds(ids) });
    for (const result of results) console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

type JsonPayloadOptions = { json?: string };

/**
 * Unified JSON payload input, mirroring `mount`'s shape: a positional .json
 * file path, or an inline --json string.
 */
function readJsonPayload(
  path: string | undefined,
  json: string | undefined,
  required: boolean,
): unknown {
  if (path !== undefined && json !== undefined) {
    console.error(`Provide only one of <path> or --json <str>.`);
    process.exit(1);
  }
  if (path === undefined && json === undefined) {
    if (!required) return undefined;
    console.error(`Provide exactly one of <path> or --json <str>.`);
    process.exit(1);
  }
  let raw: string;
  if (path !== undefined) {
    const absPath = isAbsolute(path) ? path : resolve(process.cwd(), path);
    if (!existsSync(absPath) || !statSync(absPath).isFile()) {
      console.error(`File not found: ${absPath}`);
      process.exit(1);
    }
    if (extname(absPath).toLowerCase() !== ".json") {
      console.error(`Payload must be a .json file (got "${extname(absPath)}")`);
      process.exit(1);
    }
    raw = readFileSync(absPath, "utf8");
  } else {
    raw = json!;
  }
  try {
    return JSON.parse(raw);
  } catch {
    console.error(`Payload is not valid JSON.`);
    process.exit(1);
  }
}

async function patchNodes(path: string | undefined, opts: JsonPayloadOptions): Promise<void> {
  const payload = readJsonPayload(path, opts.json, true);
  if (
    !Array.isArray(payload) ||
    payload.some(
      (p) =>
        typeof p !== "object" ||
        p === null ||
        !Number.isInteger((p as { id?: unknown }).id),
    )
  ) {
    console.error(`Payload must be an array of { id: number } with JSX props.`);
    process.exit(1);
  }
  try {
    const results = await editor.node.patch.mutate({ patches: payload as NodePatch[] });
    for (const result of results) console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

async function duplicateNodes(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    console.error("No ids provided.");
    process.exit(1);
  }
  try {
    const results = await editor.node.duplicate.mutate({ ids: parseNodeIds(ids) });
    for (const result of results) console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

type NodeRenderOptions = JsonPayloadOptions & { output?: string };

async function nodeRender(
  idArg: string | undefined,
  configArg: string | undefined,
  opts: NodeRenderOptions,
): Promise<void> {
  // Node ids are integers, so a lone non-numeric positional is the config file.
  let id = idArg;
  let configPath = configArg;
  if (id !== undefined && configPath === undefined && !/^\d+$/.test(id)) {
    configPath = id;
    id = undefined;
  }
  const eid = id !== undefined ? parseNodeIds([id])[0] : undefined;

  const config = readJsonPayload(configPath, opts.json, false) as EncoderConfigInput | undefined;
  if (config !== undefined && (typeof config !== "object" || config === null || Array.isArray(config))) {
    console.error(`Encode config must be a JSON object.`);
    process.exit(1);
  }

  const format = config?.format ?? "mp4";
  const output = opts.output !== undefined
    ? (isAbsolute(opts.output) ? opts.output : resolve(process.cwd(), opts.output))
    : join(tmpdir(), `${randomUUID()}.${format}`);

  const stop = startSpinner("Rendering scene");
  try {
    const { path } = await editor.node.render.mutate({ id: eid, output, config }, GENERATE);
    stop();
    console.log(JSON.stringify({ path }));
  } catch (e) {
    stop();
    handleSocketError(e);
  }
}

async function activeProject(): Promise<void> {
  try {
    const result = await editor.project.active.query();
    console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

async function listProjects(): Promise<void> {
  try {
    const result = await editor.project.list.query();
    for (const project of result) console.log(JSON.stringify(project));
  } catch (e) {
    handleSocketError(e);
  }
}

async function createProject(name?: string): Promise<void> {
  try {
    const result = await editor.project.create.mutate({ name });
    console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

async function openProject(id: string): Promise<void> {
  try {
    const result = await editor.project.open.mutate({ id });
    console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

async function deleteProject(id: string): Promise<void> {
  try {
    const result = await editor.project.delete.mutate({ id });
    console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

async function context(): Promise<void> {
  try {
    const result = await editor.context.query();
    console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

async function whoami(): Promise<void> {
  try {
    const result = await editor.whoami.query();
    console.log(JSON.stringify(result));
  } catch (e) {
    handleSocketError(e);
  }
}

function startSpinner(label: string): () => void {
  if (!process.stderr.isTTY) {
    process.stderr.write(`${label}…\n`);
    return () => { };
  }
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const start = Date.now();
  let i = 0;
  const render = () => {
    const secs = Math.floor((Date.now() - start) / 1000);
    process.stderr.write(`\r${frames[i]} ${label}… ${secs}s`);
    i = (i + 1) % frames.length;
  };
  render();
  const timer = setInterval(render, 80);
  return () => {
    clearInterval(timer);
    process.stderr.write("\r\x1b[K"); // carriage return + clear to end of line
  };
}

async function listModels(type: string | undefined): Promise<void> {
  if (type !== undefined && type !== "image" && type !== "video" && type !== "audio") {
    console.error(`[type] must be one of "image", "video", "audio" (got "${type}")`);
    process.exit(1);
  }
  try {
    const models = await editor.models.query({ type: type as "image" | "video" | "audio" | undefined });
    for (const model of models) console.log(JSON.stringify(model));
  } catch (e) {
    handleSocketError(e);
  }
}

async function listVoices(): Promise<void> {
  try {
    const voices = await editor.voices.query();
    for (const voice of voices) console.log(JSON.stringify(voice));
  } catch (e) {
    handleSocketError(e);
  }
}

type ListFontsOptions = {
  family?: string;
  weight?: string[];
  style?: string;
  limit?: string;
  namesOnly?: boolean;
};

function listFonts(opts: ListFontsOptions): void {
  let style: "normal" | "italic" | undefined;
  if (opts.style !== undefined) {
    if (opts.style !== "normal" && opts.style !== "italic") {
      console.error(`--style must be "normal" or "italic" (got "${opts.style}")`);
      process.exit(1);
    }
    style = opts.style;
  }

  let limit: number | undefined;
  if (opts.limit !== undefined) {
    const n = Number(opts.limit);
    if (!Number.isInteger(n) || n <= 0) {
      console.error(`--limit must be a positive integer (got "${opts.limit}")`);
      process.exit(1);
    }
    limit = n;
  }

  try {
    const families = listLocalFonts({
      familyPattern: opts.family,
      weights: opts.weight,
      style,
      limit,
    });
    if (opts.namesOnly) {
      for (const family of families) console.log(family.family);
    } else {
      for (const family of families) console.log(JSON.stringify(family));
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

type FetchCliOptions = { output?: string; format?: string; audio?: boolean };

// `raw` is every operand after `url` — the yt-dlp passthrough placed after `--`.
// No spinner here: yt-dlp renders its own progress to the inherited stderr.
async function fetch(url: string, opts: FetchCliOptions, raw: string[]): Promise<void> {
  try {
    const paths = await fetchVideo(url, { ...opts, raw });
    for (const path of paths) console.log(JSON.stringify({ path }));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

const program = new Command();

// Appends the command's reference page to its help description.
const DOCS_BASE = "https://github.com/diffusionstudio/editor/blob/main/apps/cli/reference";
const docs = (page: string) => `\nReference: ${DOCS_BASE}/${page}.md`;

program
  .name("dapi")
  .description(
    `CLI for Diffusion Studio — understand, generate, and edit footage.
Analyze video/audio/images, generate them with AI, and compose video compositions.
Use for any media analysis, media generation, or video editing task. No ffmpeg needed.${docs("README")}`,
  )
  .version(version);

program
  .command("context")
  .alias("ctx")
  .description(`Print essential context about the open project${docs("context")}`)
  .action(() => context());

program
  .command("open")
  .description(`Open Diffusion Studio${docs("open")}`)
  .argument("[target]", `file path, folder path, or "${PROTOCOL}://" URL to open`)
  .option("-b, --background", "launch with the window hidden (headless)")
  .action((target: string | undefined, opts: { background?: boolean }) =>
    openTarget(target, opts.background ?? false));

program
  .command("mount")
  .description(`Compile a Solid JSX project module and mount it into the canvas${docs("mount")}`)
  .argument("[path]", "path to a .tsx / .jsx / .ts / .js entry module")
  .option("--code <str>", "inline module source; export default wrapper optional for bare JSX")
  .action((path: string | undefined, opts: MountOptions) => mountProject(path, opts));

const asset = program
  .command("asset")
  .alias("a")
  .description(
    "Manage, analyze, and generate assets in the open project — probe and export files, transcribe speech, decode frames, render visual previews, and analyze with VLMs.",
  );

asset
  .command("add")
  .description(`Add one or more local files as assets in the open project${docs("asset/add")}`)
  .argument("<paths...>", "absolute or relative file paths to add")
  .option("--folder <id>", "folder to place the new assets in (default: the library root)")
  .action((paths: string[], opts: AssetAddOptions) => addAssets(paths, opts));

asset
  .command("ls")
  .alias("get")
  .description(`Print raw asset records — every persisted property except the file handles; with no ids, lists every asset${docs("asset/ls")}`)
  .argument("[ids...]", "asset ids to list (optional)")
  .action((ids: string[]) => listAssets(ids));

asset
  .command("tree")
  .description(`Print the asset library of the open project as its folder tree${docs("asset/tree")}`)
  .option("--folder <id>", "folder whose contents to list (default: the library root)")
  .option("--depth <n>", "max depth to descend (positive integer; default = full tree)")
  .action((opts: AssetTreeOptions) => assetTree(opts));

asset
  .command("rm")
  .alias("remove")
  .description(`Delete one or more assets from the open project by id${docs("asset/rm")}`)
  .argument("<ids...>", "asset ids to delete")
  .action((ids: string[]) => deleteAssets(ids));

asset
  .command("mv")
  .alias("move")
  .description(`Move one or more assets into a folder${docs("asset/mv")}`)
  .argument("<ids...>", "asset ids to move")
  .option("--to <folderId>", "destination folder (default: the library root)")
  .action((ids: string[], opts: MoveOptions) => moveAssets(ids, opts));

asset
  .command("export")
  .description(`Write one or more assets' original file bytes to disk (no re-encode)${docs("asset/export")}`)
  .argument("<ids...>", "asset ids to export")
  .option("-o, --output <path>", "directory to write into, or an exact file path for a single id (default: system temp dir)")
  .action((ids: string[], opts: AssetExportOptions) => exportAssets(ids, opts));

asset
  .command("probe")
  .description(`Read the container and per-track technical metadata of an asset. Commonly useful for a quick, free technical read (container, duration, per-track codec params), e.g. checking codec compatibility or duration before cutting${docs("asset/probe")}`)
  .argument("<id|path>", "asset id, or a local file")
  .action((ref: string) => assetProbe(ref));

asset
  .command("transcribe")
  .description(`Transcribe the speech in a video or audio asset and print the timed transcript. Commonly useful for footage with speakers (talking head, interview), where the word-level times let you cut on a line. Note a transcript marks only speech; the gaps are not necessarily silent (music, score, applause)${docs("asset/transcribe")}`)
  .argument("<id|path>", "video or audio asset id, or a local file")
  .option("-s, --start <time>", `start of the range to print — seconds, "45f" frames, or "MM:SS" (default: 0)`)
  .option("-e, --end <time>", `end of the range to print — seconds, "45f" frames, or "MM:SS" (default: asset duration)`)
  .action((ref: string, opts: AssetTranscribeOptions) => assetTranscribe(ref, opts));

asset
  .command("grab")
  .description(`Decode one or more frames of a video asset and write them as PNGs. Commonly useful for pinning down scene transitions and exact cut timestamps or to sample visuals at the given timestamps${docs("asset/grab")}`)
  .argument("<id|path>", "video asset id, or a local video file to grab frames from")
  .option("-t, --time <time...>", `one or more timestamps to grab — seconds ("1.5"), frames ("45f"), or "MM:SS" (default: 0)`)
  .option("-r, --resolution <pixels>", "cap each frame to this many total pixels, preserving aspect ratio; 0 for native (default: 147456, i.e. 384x384)")
  .option("-o, --output <dir>", "directory to write the PNGs into (default: system temp dir)")
  .action((ref: string, opts: AssetFrameOptions) => assetFrame(ref, opts));

asset
  .command("visualize")
  .alias("viz")
  .description(`Render a compact visual preview of an asset to a PNG: a waveform for audio, a filmstrip plus waveform for video, or a thumbnail for an image. The primary tool for understanding a video; you can narrow the window to zoom into a region of interest. Fast and token-efficient. The waveform shows loudness over time and marks the silent stretches${docs("asset/visualize")}`)
  .argument("<id|path>", "image, audio, or video asset id, or a local file to visualize")
  .option("-s, --start <time>", `start of the window to visualize — seconds, "45f" frames, or "MM:SS" (default: 0)`)
  .option("-e, --end <time>", `end of the window to visualize — seconds, "45f" frames, or "MM:SS" (default: asset duration)`)
  .option("-x, --scale <factor>", "scale factor for the thumbnails; smaller thumbnails fit more rows and columns, larger fit fewer (default: 1)")
  .option("-o, --output <path>", "write the PNG here instead of a temp file")
  .action((ref: string, opts: AssetVisualizeOptions) => assetVisualize(ref, opts));

asset
  .command("analyze")
  .description(`Prompt a multimodal model for a semantic analysis of an asset and print its answer. Handles images, audio, and video, but shines on the semantics of audio: what it actually contains (the name of the music playing, who is speaking, the spoken content with second-granularity timestamps)${docs("asset/analyze")}`)
  .argument("<id|path>", "image, audio, or video asset id, or a local file to analyze")
  .option("-p, --prompt <str>", "question or instruction to guide the analysis")
  .option("-s, --start <time>", `start of the segment to analyze — seconds, "45f" frames, or "MM:SS" (default: 0); timestamps in the analysis are relative to this point`)
  .option("-e, --end <time>", `end of the segment to analyze — seconds, "45f" frames, or "MM:SS" (default: asset duration)`)
  .option("--keep-video", "include the video stream when analyzing a video; by default only the audio track is analyzed, which is significantly faster since the video stream is not uploaded")
  .action((ref: string, opts: AssetAnalyzeOptions) => assetAnalyze(ref, opts));

const folder = program
  .command("folder")
  .alias("fld")
  .description("Organize the asset library of the open project into folders");

folder
  .command("ls")
  .aliases(["list", "get"])
  .description(`List the direct child folders of a parent folder; with no id, the root-level folders${docs("folder/ls")}`)
  .argument("[parentId]", "parent folder id (optional; omitted = the library root)")
  .action((parentId: string | undefined) => listFolders(parentId));

folder
  .command("create")
  .description(`Create a folder${docs("folder/create")}`)
  .argument("<name>", "folder name")
  .option("-p, --parent <id>", "parent folder (default: the library root)")
  .action((name: string, opts: FolderCreateOptions) => createFolder(name, opts));

folder
  .command("rename")
  .description(`Rename a folder${docs("folder/rename")}`)
  .argument("<id>", "folder id")
  .argument("<name>", "new name")
  .action((id: string, name: string) => renameFolder(id, name));

folder
  .command("mv")
  .alias("move")
  .description(`Move one or more folders under a new parent${docs("folder/mv")}`)
  .argument("<ids...>", "folder ids to move")
  .option("--to <folderId>", "destination parent folder (default: the library root)")
  .action((ids: string[], opts: MoveOptions) => moveFolders(ids, opts));

folder
  .command("rm")
  .alias("remove")
  .description(`Delete one or more folders, including all nested folders and the assets inside${docs("folder/rm")}`)
  .argument("<ids...>", "folder ids to delete")
  .action((ids: string[]) => deleteFolders(ids));

const selection = program
  .command("selection")
  .alias("sel")
  .description("Read and mutate the current node selection");

selection
  .command("ls")
  .alias("get")
  .description(`List the currently selected nodes${docs("selection/ls")}`)
  .action(() => listSelection());

selection
  .command("set")
  .description(`Replace the current selection with exactly the given node ids; none = clear${docs("selection/set")}`)
  .argument("[ids...]", "node ids to select")
  .action((ids: string[]) => setSelection(ids));

selection
  .command("focus")
  .description(`Pan and zoom the canvas to fit the current selection in view${docs("selection/focus")}`)
  .action(() => focusSelection());

const node = program
  .command("node")
  .aliases(["n", "entity"])
  .description("Operate on one or more nodes in the open project");

node
  .command("ls")
  .alias("get")
  .description(`Print raw entity records — every component, as persisted; with no ids, lists the root scenes${docs("node/ls")}`)
  .argument("[ids...]", "entity ids to list (optional)")
  .action((ids: string[]) => listNodes(ids));

node
  .command("tree")
  .description(`Print an entity's subtree as a nested JSON object, sub-entities included; with no id, prints every top-level node's tree${docs("node/tree")}`)
  .argument("[id]", "root entity id (optional; omitted = every top-level node)")
  .option("--depth <n>", "max depth to descend (default: 3; 0 = full subtree)")
  .action((id: string | undefined, opts: TreeOptions) => nodeTree(id, opts));

node
  .command("grep")
  .description(`Search entity records for a regex and print the matching entities with the components that matched — the search corpus is the raw records node ls emits${docs("node/grep")}`)
  .argument("<pattern>", "regex to match against stringified component values")
  .argument("[id]", "root entity id to scope the search to a subtree (optional; omitted = the whole document)")
  .option("-i, --ignore-case", "case-insensitive matching")
  .option("-t, --type <types...>", "only match entities of these node types, e.g. -t text image")
  .option("-k, --component <names...>", "restrict matching to these components, e.g. -k Name Chars")
  .option("-l, --refs-only", "output only the matching entity refs, no match detail")
  .option("-c, --count", "output only the number of matching entities")
  .action((pattern: string, id: string | undefined, opts: NodeGrepOptions) => grepNodes(pattern, id, opts));

node
  .command("screenshot")
  .description(`Focus a node on the canvas and capture a screenshot as a PNG. Commonly useful to confirm what the viewer actually sees at a moment (layout, overlaps, text, timing), since the composited canvas is the truest "what plays at time T" check${docs("node/screenshot")}`)
  .argument("[id]", "node id to capture (optional; defaults to the canvas)")
  .option("-t, --time <time>", `timeline position to record at — seconds ("1.5"), frames ("45f"), or "MM:SS" (default: the current playhead)`)
  .action((id: string | undefined, opts: ScreenshotOptions) => nodeScreenshot(id, opts));

node
  .command("insert")
  .description(`Compile a Solid JSX project module and insert the rendered entities into a parent entity${docs("node/insert")}`)
  .argument("<parentId>", "entity id of the parent to insert into — a node, or a gradient paint for <colorStop> roots")
  .argument("[path]", "path to a .tsx / .jsx / .ts / .js entry module")
  .option("--code <str>", "inline module source; export default wrapper optional for bare JSX")
  .option("-i, --index <n>", "0-based position among the parent's existing children (node roots only; default: append at the end)")
  .action((parentId: string, path: string | undefined, opts: NodeInsertOptions) => nodeInsert(parentId, path, opts));

node
  .command("rm")
  .alias("remove")
  .description(`Delete one or more entities and all their descendants${docs("node/rm")}`)
  .argument("<ids...>", "entity ids to delete")
  .action((ids: string[]) => deleteNodes(ids));

node
  .command("cp")
  .alias("duplicate")
  .description(`Deep-clone one or more nodes, including all descendants${docs("node/cp")}`)
  .argument("<ids...>", "node ids to duplicate")
  .action((ids: string[]) => duplicateNodes(ids));

node
  .command("patch")
  .description(`Assign JSX props on one or more existing entities in a single call — the same properties, with the same value requirements, as mount. Renaming a node is patching its name${docs("node/patch")}`)
  .argument("[path]", "path to a .json file containing the patch array")
  .option("--json <str>", "inline JSON array of { id, ...jsx props }")
  .action((path: string | undefined, opts: JsonPayloadOptions) => patchNodes(path, opts));

node
  .command("render")
  .description(`Render a scene to a video file${docs("node/render")}`)
  .argument("[id]", "scene node id (optional; defaults to the active scene)")
  .argument("[config]", "path to a .json encode config (EncoderConfig)")
  .option("-o, --output <path>", "write the video here (default: a temp file)")
  .option("--json <str>", "inline JSON encode config (EncoderConfig)")
  .action((id: string | undefined, config: string | undefined, opts: NodeRenderOptions) =>
    nodeRender(id, config, opts));

const project = program
  .command("project")
  .alias("p")
  .description("Manage projects");

project
  .command("active")
  .description(`Print the currently active project, or null if none is open${docs("project/active")}`)
  .action(() => activeProject());

project
  .command("ls")
  .alias("list")
  .description(`List all projects, most recently accessed first${docs("project/ls")}`)
  .action(() => listProjects());

project
  .command("create")
  .description(`Create a new project and open it${docs("project/create")}`)
  .argument("[name]", "optional project name")
  .action((name?: string) => createProject(name));

project
  .command("set")
  .description(`Set the active project by id, or null if no project has that id${docs("project/set")}`)
  .argument("<id>", "project id to set active")
  .action((id: string) => openProject(id));

project
  .command("rm")
  .alias("remove")
  .description(`Delete a project by id${docs("project/rm")}`)
  .argument("<id>", "project id to delete")
  .action((id: string) => deleteProject(id));

program
  .command("models")
  .description(`List available AI generation models and their constraints (for generate.* declarations — see the JSX API)${docs("models")}`)
  .argument("[type]", `filter to one of "image", "video", "audio"`)
  .action((type: string | undefined) => listModels(type));

program
  .command("voices")
  .description(`List the speech voices available for generate.voice declarations (see the JSX API)${docs("voices")}`)
  .action(() => listVoices());

program
  .command("whoami")
  .description(`Print the authenticated account, or null if signed out${docs("whoami")}`)
  .action(() => whoami());

program
  .command("fonts")
  .description(`List the local fonts available on this machine${docs("fonts")}`)
  .option("-f, --family <pattern>", "filter to families whose name contains <pattern> (case-insensitive)")
  .option("-w, --weight <weights...>", "filter to variants with the given CSS weight(s), e.g. -w 400 700")
  .option("-s, --style <style>", `filter to variants with the given style: "normal" or "italic"`)
  .option("-l, --limit <n>", "output at most <n> families")
  .option("-n, --names-only", "output only family names (one per line, no variant detail)")
  .action((opts: ListFontsOptions) => listFonts(opts));

program
  .command("fetch")
  .description(`Download a video with yt-dlp (must be installed separately)${docs("fetch")}`)
  .argument("<url>", "video or page URL to download")
  .option("-o, --output <path>", "output file path or directory (yt-dlp -o template; default: yt-dlp's default)")
  .option("-f, --format <selector>", `yt-dlp format selector (default: prefer mp4), e.g. "bv*+ba/b"`)
  .option("-a, --audio", "extract audio only (yt-dlp -x)")
  .allowExcessArguments()
  .addHelpText("after", `\nForward raw yt-dlp flags after --, e.g. dapi fetch <url> -- --sponsorblock-remove all`)
  .action((url: string, opts: FetchCliOptions, cmd: Command) => fetch(url, opts, cmd.args.slice(1)));

// Explicit argv convention: the packaged wrapper runs this bundle on
// Electron in ELECTRON_RUN_AS_NODE mode, where commander would otherwise
// detect Electron and drop the script path from argv.
program.parse(process.argv, { from: "node" });
