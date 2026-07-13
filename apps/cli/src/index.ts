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
import type { AssetRef, EncoderConfigInput, FrameQuality, NodePatch } from "./protocol";

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

type CaptureOptions = { time?: string[]; timestamp?: boolean };

async function nodeCapture(id: string, opts: CaptureOptions): Promise<void> {
  const eid = parseNodeIds([id])[0];

  let times: number[] | undefined;
  let frames: number[] | undefined;
  if (opts.time !== undefined) {
    times = opts.time.map((t) => parseTimeArg(t, "--time"));
    frames = times.map((t) => Math.round(t * TIME_FPS));
  }

  try {
    const shots = await editor.node.capture.query({ id: eid, frames, timestamp: opts.timestamp });
    for (const [i, { base64 }] of shots.entries()) {
      const path = join(tmpdir(), `${randomUUID()}.png`);
      writeFileSync(path, Buffer.from(base64, "base64"));
      console.log(JSON.stringify({ time: times ? times[i] : null, path }));
    }
  } catch (e) {
    handleSocketError(e);
  }
}

const FRAME_QUALITIES: FrameQuality[] = ["small", "medium", "large", "fullres"];

// Guardrail against accidentally decoding a huge number of frames; --uncapped lifts it.
const FRAME_CAP = 100;

type MediaFrameOptions = {
  time?: string[];
  count?: string;
  start?: string;
  end?: string;
  quality?: string;
  timestamp?: boolean;
  uncapped?: boolean;
  output?: string;
  auto?: boolean;
};

async function mediaFrame(ref: string, opts: MediaFrameOptions): Promise<void> {
  if (opts.time !== undefined && opts.count !== undefined) {
    console.error("Pass either --time or --count, not both.");
    process.exit(1);
  }
  if (opts.auto && opts.time !== undefined) {
    console.error("--auto picks its own timestamps; it cannot be combined with --time.");
    process.exit(1);
  }

  let times: number[] | undefined;
  if (opts.time !== undefined) {
    times = opts.time.map((t) => parseTimeArg(t, "--time", true));
  }

  let count: number | undefined;
  if (opts.count !== undefined) {
    count = Number(opts.count);
    if (!Number.isInteger(count) || count < 1) {
      console.error(`--count must be a positive integer (got "${opts.count}")`);
      process.exit(1);
    }
  }

  const start = opts.start !== undefined ? parseTimeArg(opts.start, "--start") : undefined;
  const end = opts.end !== undefined ? parseTimeArg(opts.end, "--end") : undefined;
  if (start !== undefined && end !== undefined && start >= end) {
    console.error(`--start (${start}s) must be less than --end (${end}s).`);
    process.exit(1);
  }
  if ((start !== undefined || end !== undefined) && count === undefined && !opts.auto) {
    console.error("--start and --end only apply together with --count or --auto.");
    process.exit(1);
  }

  const requested = count ?? times?.length ?? 1;
  if (!opts.uncapped && requested > FRAME_CAP) {
    console.error(`Grabbing ${requested} frames exceeds the ${FRAME_CAP}-frame cap; pass --uncapped to override.`);
    process.exit(1);
  }

  let quality: FrameQuality | undefined;
  if (opts.quality !== undefined) {
    if (!FRAME_QUALITIES.includes(opts.quality as FrameQuality)) {
      console.error(`--quality must be one of ${FRAME_QUALITIES.join(", ")} (got "${opts.quality}")`);
      process.exit(1);
    }
    quality = opts.quality as FrameQuality;
  }

  const target = resolveAssetRef(ref);
  const dir = opts.output ?? tmpdir();
  try {
    const frames = await editor.media.frame.query({ ...target, times, count, start, end, quality, timestamp: opts.timestamp, auto: opts.auto });
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

async function mediaProbe(ref: string): Promise<void> {
  const target = resolveAssetRef(ref);
  const stop = startSpinner("Probing asset");
  try {
    const result = await editor.media.probe.query(target);
    stop();
    console.log(JSON.stringify(result));
  } catch (e) {
    stop();
    handleSocketError(e);
  }
}

type MediaTranscribeOptions = { start?: string; end?: string };

async function mediaTranscribe(ref: string, opts: MediaTranscribeOptions): Promise<void> {
  const start = opts.start !== undefined ? parseTimeArg(opts.start, "--start") : undefined;
  const end = opts.end !== undefined ? parseTimeArg(opts.end, "--end") : undefined;
  if (start !== undefined && end !== undefined && start >= end) {
    console.error(`--start (${start}s) must be less than --end (${end}s).`);
    process.exit(1);
  }

  const target = resolveAssetRef(ref);
  const stop = startSpinner("Transcribing asset");
  try {
    const result = await editor.media.transcribe.query({ ...target, start, end }, GENERATE);
    stop();
    console.log(JSON.stringify(result));
  } catch (e) {
    stop();
    handleSocketError(e);
  }
}

type MediaListenOptions = { prompt?: string; start?: string; end?: string; keepVideo?: boolean };

async function mediaListen(ref: string, opts: MediaListenOptions): Promise<void> {
  const start = opts.start !== undefined ? parseTimeArg(opts.start, "--start") : undefined;
  const end = opts.end !== undefined ? parseTimeArg(opts.end, "--end") : undefined;
  if (start !== undefined && end !== undefined && start >= end) {
    console.error(`--start (${start}s) must be less than --end (${end}s).`);
    process.exit(1);
  }

  const target = resolveAssetRef(ref);
  const stop = startSpinner("Analyzing asset");
  try {
    const result = await editor.media.listen.query(
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

type MediaPreviewOptions = { start?: string; end?: string; scale?: string; output?: string };

function parseTimeArg(value: string, flag: string, allowNegative = false): number {
  const seconds = parseTime(value);
  if (seconds === undefined || (!allowNegative && seconds < 0)) {
    console.error(
      `${flag} must be a ${allowNegative ? "" : "non-negative "}Time — seconds ("1.5"), frames ("45f"), or "MM:SS" (got "${value}")`,
    );
    process.exit(1);
  }
  return seconds;
}

// Parse the window/scale flags shared by `filmstrip` and `waveform`.
function parsePreviewWindow(opts: MediaPreviewOptions): { start?: number; end?: number; scale?: number } {
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

  return { start, end, scale };
}

async function mediaFilmstrip(ref: string, opts: MediaPreviewOptions): Promise<void> {
  const { start, end, scale } = parsePreviewWindow(opts);
  const target = resolveAssetRef(ref);
  const path = opts.output ?? join(tmpdir(), `${randomUUID()}.png`);
  const stop = startSpinner("Rendering filmstrip");
  try {
    const { base64, ...rest } = await editor.media.filmstrip.query({ ...target, start, end, scale });
    stop();
    writeFileSync(path, Buffer.from(base64, "base64"));
    console.log(JSON.stringify({ path, ...rest }));
  } catch (e) {
    stop();
    handleSocketError(e);
  }
}

async function mediaWaveform(ref: string, opts: MediaPreviewOptions): Promise<void> {
  const { start, end, scale } = parsePreviewWindow(opts);
  const target = resolveAssetRef(ref);
  const path = opts.output ?? join(tmpdir(), `${randomUUID()}.png`);
  const stop = startSpinner("Rendering waveform");
  try {
    const { base64, ...rest } = await editor.media.waveform.query({ ...target, start, end, scale });
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

program
  .name("dapi")
  .description(
    `The Diffusion Studio CLI: understand, generate, and edit footage.
Analyze video/audio/images, generate them with AI, and compose assets.
Use for any media analysis, media generation, or video editing task. No ffmpeg needed.`,
  )
  .version(version);

program
  .command("context")
  .alias("ctx")
  .description(
    `Print essential context about the open project (project, entity count, scenes, active scene, playhead, font families); call this first to orient.`,
  )
  .action(() => context());

program
  .command("open")
  .description(
    `Launch Diffusion Studio, or open a target (does not require the app to be running). With no target, launches the app; a "${PROTOCOL}://" URL follows the deep link; a file path opens the file; a folder path creates a project from its contents (importing supported assets, mirroring subfolders) or reopens the one recorded in its .dapi marker.`,
  )
  .argument("[target]", `file path, folder path, or "${PROTOCOL}://" URL to open`)
  .option("-b, --background", "launch with the window hidden (headless)")
  .action((target: string | undefined, opts: { background?: boolean }) =>
    openTarget(target, opts.background ?? false));

program
  .command("mount")
  .description(
    `Compile a Solid JSX project module and mount its roots into the canvas. Re-mounting reconciles rather than duplicates: each top-level element carries a \`key\`, and a root replaces the node with that key or creates it (a new <scene key> becomes the active scene and the camera focuses it). Long-running when the module declares AI assets (blocks until generation finishes). Compile errors fail before the app is contacted; on success, inspect the result with \`dapi context\` or \`dapi node tree\`.`,
  )
  .argument("[path]", "path to a .tsx / .jsx / .ts / .js entry module")
  .option("--code <str>", "inline module source; export default wrapper optional for bare JSX")
  .action((path: string | undefined, opts: MountOptions) => mountProject(path, opts));

const asset = program
  .command("asset")
  .alias("a")
  .description(
    "Manage the asset library of the open project: add local files, list and organize records, and export original bytes.",
  );

asset
  .command("add")
  .description(`Add one or more local files as assets in the open project (paths resolve against CWD).`)
  .argument("<paths...>", "absolute or relative file paths to add")
  .option("--folder <id>", "folder to place the new assets in (default: the library root); fails before importing anything if it doesn't resolve to a folder")
  .action((paths: string[], opts: AssetAddOptions) => addAssets(paths, opts));

asset
  .command("ls")
  .aliases(["list", "get"])
  .description(
    `Print raw asset records: every persisted property except the file handles (name, type, mimeType, size, createdAt, folderId, per-type media metadata, any stored transcript).`,
  )
  .argument("[ids...]", "asset ids to list (optional). With no ids, lists every asset in the library.")
  .action((ids: string[]) => listAssets(ids));

asset
  .command("tree")
  .description(
    `Print the asset library as its folder tree: folders and assets interleaved, each folder carrying its contents (assets never do).`,
  )
  .option("--folder <id>", "folder whose contents to list (default: the library root); fails if it doesn't resolve to a folder")
  .option("--depth <n>", "max depth to descend (positive integer; default = full tree)")
  .action((opts: AssetTreeOptions) => assetTree(opts));

asset
  .command("rm")
  .alias("remove")
  .description(`Delete one or more assets from the open project by id.`)
  .argument("<ids...>", "asset ids to delete")
  .action((ids: string[]) => deleteAssets(ids));

asset
  .command("mv")
  .alias("move")
  .description(`Move one or more assets into a folder.`)
  .argument("<ids...>", "asset ids to move")
  .option("--to <folderId>", "destination folder (default: the library root); fails before moving anything if it doesn't resolve to a folder")
  .action((ids: string[], opts: MoveOptions) => moveAssets(ids, opts));

asset
  .command("export")
  .description(
    `Write one or more assets' original stored bytes to disk (no re-encode, no credits; any asset type except image sequences).`,
  )
  .argument("<ids...>", "asset ids to export")
  .option("-o, --output <path>", "where to write (default: system temp dir); a directory when it exists as one, ends with a path separator, or multiple ids are given (each asset written under its own name), otherwise an exact file path for a single id")
  .action((ids: string[], opts: AssetExportOptions) => exportAssets(ids, opts));

const media = program
  .command("media")
  .alias("m")
  .description(
    "Inspect a media file by asset id or local path, without adding it to the project: probe metadata, transcribe speech, grab frames, render visual previews, and analyze with multimodal models.",
  );

media
  .command("probe")
  .description(
    `Read the container and per-track technical metadata of a media file (local read, no credits): container format, duration, tags, and each track's codec params, without decoding. Commonly useful for a quick technical read, e.g. checking codec compatibility or duration before cutting. Packet stats (fps, bitrate) are estimated from a leading sample; images and transcripts report file-level info only.`,
  )
  .argument("<id|path>", "asset id, or a local file")
  .action((ref: string) => mediaProbe(ref));

media
  .command("transcribe")
  .description(
    `Transcribe the speech in a video or audio file and print the timed transcript, with word-level start/end times in seconds. Commonly useful for footage with speakers (talking head, interview), where the word times let you cut on a line. A transcript marks only speech; the gaps are not necessarily silent (music, score, applause).`,
  )
  .argument("<id|path>", "video or audio asset id, or a local file")
  .option("-s, --start <time>", `start of the range to print — seconds, "45f" frames, or "MM:SS" (default: 0); --start/--end only limit which words print, the whole asset is always transcribed`)
  .option("-e, --end <time>", `end of the range to print — seconds, "45f" frames, or "MM:SS" (default: asset duration)`)
  .action((ref: string, opts: MediaTranscribeOptions) => mediaTranscribe(ref, opts));

media
  .command("grab")
  .alias("sample")
  .description(
    `Decode frames of a video file and write them as PNGs (local render, no credits), each stamped in the top-left with its HH:MM:SS:FF timestamp. Grabs the asset's own pixels at full resolution, unlike \`node capture\` which renders the composited node. The recommended tool for understanding a video at the frame level.`,
  )
  .argument("<id|path>", "video asset id, or a local video file to grab frames from")
  .option("-t, --time <time...>", `one or more timestamps to grab — seconds ("1.5"), frames ("45f"), or "MM:SS"; negatives count back from the end, so -1 is one second before the end and -1f one frame before it (default: 0)`)
  .option("-c, --count <n>", "instead of --time, grab this many frames evenly spaced across the clip (or across the --start/--end window)")
  .option("-a, --auto", "scan the clip at 2fps and keep a frame each time the footage settles into a new visual state (transitions are waited out, so picks stay sharp); returns at most --count frames (default cap: 30), static footage like screen recordings returns far fewer; requires WebGPU")
  .option("-s, --start <time>", `with --count or --auto, start of the window to sample (seconds, "45f" frames, or "MM:SS"; default: 0)`)
  .option("-e, --end <time>", `with --count or --auto, end of the window to sample (seconds, "45f" frames, or "MM:SS"; default: asset duration)`)
  .option("-q, --quality <preset>", "frame resolution: small (384x384, default), medium (768x768), large (1536x1536), or fullres (native)")
  .option("--no-timestamp", "don't stamp each frame with its HH:MM:SS:FF timestamp label")
  .option("--uncapped", "lift the 100-frame safety cap (grabbing many frames is slow and token-heavy)")
  .option("-o, --output <dir>", "directory to write the PNGs into (default: system temp dir)")
  .action((ref: string, opts: MediaFrameOptions) => mediaFrame(ref, opts));

media
  .command("filmstrip")
  .alias("film")
  .description(
    `Render a grid of thumbnails sampled across the timeline to a PNG (local render, no credits), each row stamped with an HH:MM:SS:FF ruler. A fast, token-efficient video track preview; narrow the window to zoom into a region of interest. Video only (use \`media waveform\` for audio).`,
  )
  .argument("<id|path>", "video asset id, or a local video file to preview")
  .option("-s, --start <time>", `start of the window to preview — seconds, "45f" frames, or "MM:SS" (default: 0)`)
  .option("-e, --end <time>", `end of the window to preview — seconds, "45f" frames, or "MM:SS" (default: asset duration)`)
  .option("-x, --scale <factor>", "scale factor for the thumbnails; smaller thumbnails fit more rows and columns, larger fit fewer (default: 1)")
  .option("-o, --output <path>", "write the PNG here instead of a temp file")
  .action((ref: string, opts: MediaPreviewOptions) => mediaFilmstrip(ref, opts));

media
  .command("waveform")
  .alias("wave")
  .description(
    `Render the audio track of a video or audio file as a waveform PNG (local render, no credits) with a timestamp ruler: loudness over time, with silent stretches highlighted in red. A fast, token-efficient audio track preview; the silent spans are also returned as second ranges.`,
  )
  .argument("<id|path>", "video or audio asset id, or a local file to preview")
  .option("-s, --start <time>", `start of the window to preview — seconds, "45f" frames, or "MM:SS" (default: 0)`)
  .option("-e, --end <time>", `end of the window to preview — seconds, "45f" frames, or "MM:SS" (default: asset duration)`)
  .option("-x, --scale <factor>", "scale factor for the waveform; smaller fits more rows and columns, larger fits fewer (default: 1)")
  .option("-o, --output <path>", "write the PNG here instead of a temp file")
  .action((ref: string, opts: MediaPreviewOptions) => mediaWaveform(ref, opts));

media
  .command("listen")
  .description(
    `Prompt a multimodal model for a semantic analysis of an audio track and print its answer. Shines on audio semantics (the name of the music playing, who is speaking, the spoken content with second-granularity timestamps). Accepts an audio file or a video; by default only the audio track is analyzed.`,
  )
  .argument("<id|path>", "video or audio asset id, or a local file to analyze")
  .option("-p, --prompt <str>", "question or instruction to guide the analysis")
  .option("-s, --start <time>", `start of the segment to analyze — seconds, "45f" frames, or "MM:SS" (default: 0); timestamps in the analysis are relative to this point`)
  .option("-e, --end <time>", `end of the segment to analyze — seconds, "45f" frames, or "MM:SS" (default: media duration)`)
  .option("--keep-video", "for a video asset, keep the video track instead of stripping to audio, so the model also reads what is on screen (expensive: uploads the full video)")
  .action((ref: string, opts: MediaListenOptions) => mediaListen(ref, opts));

const folder = program
  .command("folder")
  .alias("fld")
  .description("Organize the asset library of the open project into folders");

folder
  .command("ls")
  .aliases(["list", "get"])
  .description(
    `List the direct child folders of a parent folder, sorted by name; with no id, the root-level folders. Folders nest arbitrarily, and assets reference their folder via folderId (null = library root).`,
  )
  .argument("[parentId]", "parent folder id (optional; omitted = the library root); fails if it doesn't resolve to a folder")
  .action((parentId: string | undefined) => listFolders(parentId));

folder
  .command("create")
  .description(`Create a folder.`)
  .argument("<name>", "folder name")
  .option("-p, --parent <id>", "parent folder (default: the library root); fails if it doesn't resolve to a folder")
  .action((name: string, opts: FolderCreateOptions) => createFolder(name, opts));

folder
  .command("rename")
  .description(`Rename a folder.`)
  .argument("<id>", "folder id")
  .argument("<name>", "new name")
  .action((id: string, name: string) => renameFolder(id, name));

folder
  .command("mv")
  .alias("move")
  .description(
    `Move one or more folders under a new parent. A folder cannot move into itself or a descendant; such a move rejects that id.`,
  )
  .argument("<ids...>", "folder ids to move")
  .option("--to <folderId>", "destination parent folder (default: the library root); fails before moving anything if it doesn't resolve to a folder")
  .action((ids: string[], opts: MoveOptions) => moveFolders(ids, opts));

folder
  .command("rm")
  .alias("remove")
  .description(
    `Delete one or more folders. Deletion cascades: every nested folder and every asset inside is deleted too (the result reports how many of each were removed).`,
  )
  .argument("<ids...>", "folder ids to delete")
  .action((ids: string[]) => deleteFolders(ids));

const selection = program
  .command("selection")
  .alias("sel")
  .description("Read and mutate the current node selection");

selection
  .command("ls")
  .aliases(["list", "get"])
  .description(
    `List the currently selected nodes. \`set\` and \`focus\` return the resulting selection in the same shape.`,
  )
  .action(() => listSelection());

selection
  .command("set")
  .description(`Replace the current selection with exactly the given node ids (none = clear).`)
  .argument("[ids...]", "node ids to select")
  .action((ids: string[]) => setSelection(ids));

selection
  .command("focus")
  .description(`Pan and zoom the canvas to fit the current selection in view (no-op if nothing is selected).`)
  .action(() => focusSelection());

const node = program
  .command("node")
  .aliases(["n", "entity"])
  .description("Operate on one or more nodes in the open project");

node
  .command("ls")
  .aliases(["list", "get"])
  .description(
    `Print raw entity records, exactly as persisted: every component the entity carries, keyed by component name (Name, Size, Position, Paint, Trim, ChildOf, ...). With no ids, lists the top-level nodes. Values are raw engine units: times are frames at 30 fps, colors packed 0xRRGGBB, volume in dB (0 = unity).`,
  )
  .argument("[ids...]", "entity ids to list (optional)")
  .action((ids: string[]) => listNodes(ids));

node
  .command("tree")
  .description(
    `Print an entity's subtree as a nested JSON object: structure and ids only, with each node's key traits folded into a compact \`description\` string (use \`node ls\` for exact values). Sub-entities (masks, paints, strokes, keyframes, ...) nest under named arrays. With no id, prints one tree per top-level node.`,
  )
  .argument("[id]", "root entity id (optional; omitted = every top-level node)")
  .option("--depth <n>", "max depth to descend (default: 3; 0 = full subtree)")
  .action((id: string | undefined, opts: TreeOptions) => nodeTree(id, opts));

node
  .command("grep")
  .description(
    `Search entity records for a regex and print the matching entities with the components that matched. The search corpus is the raw records \`node ls\` emits (stringified, so raw engine units), scoped to a subtree when [id] is given. The way to find ids to then read, select, or patch. Common case (find by name): \`dapi node grep -k Name Title\`.`,
  )
  .argument("<pattern>", "regex to match against stringified component values")
  .argument("[id]", "root entity id to scope the search to a subtree (optional; omitted = the whole document)")
  .option("-i, --ignore-case", "case-insensitive matching")
  .option("-t, --type <types...>", "only match entities of these node types, e.g. -t text image")
  .option("-k, --component <names...>", "restrict matching to these components, e.g. -k Name Chars")
  .option("-l, --refs-only", "output only the matching entity refs, no match detail")
  .option("-c, --count", "output only the number of matching entities")
  .action((pattern: string, id: string | undefined, opts: NodeGrepOptions) => grepNodes(pattern, id, opts));

node
  .command("capture")
  .description(
    `Render a node in isolation to PNGs, one per position, each stamped in the top-left with its HH:MM:SS:FF timestamp. The node is drawn offscreen at 720p height, tightly framed to its own bounds on a transparent background — siblings and overlapping scene content are not included, so capture a scene id to check composition ("what plays at time T": layout, overlaps, text, timing). For a video asset's own full-resolution pixels use \`media grab\`.`,
  )
  .argument("<id>", "node id to capture")
  .option("-t, --time <time...>", `one or more positions to capture, relative to the node's start (0 = its first visible frame) — seconds ("1.5"), frames ("45f"), or "MM:SS" (default: the node's frame under the current playhead)`)
  .option("--no-timestamp", "don't stamp each capture with its HH:MM:SS:FF timestamp label")
  .action((id: string, opts: CaptureOptions) => nodeCapture(id, opts));

node
  .command("insert")
  .description(
    `Compile a Solid JSX project module and insert its rendered roots as children of an existing entity: the same pipeline as \`mount\` (including AI asset generation), but it inserts fresh entities every run rather than reconciling by key, and deletes nothing. Roots must be valid children of the parent (a node takes any element or paint except <scene> and <colorStop>; a gradient paint takes only <colorStop> roots, which is how you add a stop to a gradient).`,
  )
  .argument("<parentId>", "entity id of the parent to insert into — a node, or a gradient paint for <colorStop> roots")
  .argument("[path]", "path to a .tsx / .jsx / .ts / .js entry module")
  .option("--code <str>", "inline module source; export default wrapper optional for bare JSX")
  .option("-i, --index <n>", "0-based position among the parent's existing children (node roots only; default: append at the end)")
  .action((parentId: string, path: string | undefined, opts: NodeInsertOptions) => nodeInsert(parentId, path, opts));

node
  .command("rm")
  .alias("remove")
  .description(`Delete one or more entities and all their descendants.`)
  .argument("<ids...>", "entity ids to delete")
  .action((ids: string[]) => deleteNodes(ids));

node
  .command("cp")
  .alias("duplicate")
  .description(`Deep-clone one or more nodes, including all descendants.`)
  .argument("<ids...>", "node ids to duplicate")
  .action((ids: string[]) => duplicateNodes(ids));

node
  .command("patch")
  .description(
    `Assign JSX props on one or more existing entities in a single call: the same properties, with the same value requirements, as \`mount\` (payload is an array of { id, ...props }, all optional; type PatchProps). Any live entity is addressable, not just nodes (paints and color stops too); renaming a node is patching its \`name\`, and \`fill\` recolors or creates the entity's solid fill.`,
  )
  .argument("[path]", "path to a .json file containing the patch array")
  .option("--json <str>", "inline JSON array of { id, ...jsx props }")
  .action((path: string | undefined, opts: JsonPayloadOptions) => patchNodes(path, opts));

node
  .command("render")
  .description(
    `Render a scene to a video file (local, no credits, no account needed); long-running, with a progress spinner on stderr so stdout stays clean. The optional encode config (EncoderConfig) sets the container and codecs; omit it for the defaults: mp4/H.264, 1080p, 10 Mbps video, AAC 128 kbps stereo audio, the scene's fps.`,
  )
  .argument("[id]", "scene node id (optional; defaults to the active scene)")
  .argument("[config]", "path to a .json encode config (EncoderConfig); its `format` may be mp4, webm, ogg, or mov, and `trim.end` caps the encode")
  .option("-o, --output <path>", "write the video here (default: a temp file); the extension follows the config's format")
  .option("--json <str>", "inline JSON encode config (EncoderConfig)")
  .action((id: string | undefined, config: string | undefined, opts: NodeRenderOptions) =>
    nodeRender(id, config, opts));

const project = program
  .command("project")
  .alias("p")
  .description("Manage projects");

project
  .command("active")
  .description(`Print the currently active project, or null if none is open.`)
  .action(() => activeProject());

project
  .command("ls")
  .alias("list")
  .description(`List all projects, most recently accessed first.`)
  .action(() => listProjects());

project
  .command("create")
  .description(`Create a new project and open it.`)
  .argument("[name]", "optional project name")
  .action((name?: string) => createProject(name));

project
  .command("set")
  .description(`Set the active project by id, opening it.`)
  .argument("<id>", "project id to set active (null result if no project has this id)")
  .action((id: string) => openProject(id));

project
  .command("rm")
  .alias("remove")
  .description(`Delete a project by id.`)
  .argument("<id>", "project id to delete")
  .action((id: string) => deleteProject(id));

program
  .command("models")
  .description(
    `List available AI generation models and their per-model constraints (durations, aspect ratios, features), for \`generate.*\` asset declarations in a project module (there is no CLI generate command; generation happens on mount).`,
  )
  .argument("[type]", `filter to one of "image", "video", "audio" (default: all three)`)
  .action((type: string | undefined) => listModels(type));

program
  .command("voices")
  .description(`List the speech voices available for \`generate.voice\` declarations in a project module.`)
  .action(() => listVoices());

program
  .command("whoami")
  .description(`Print the authenticated account, or null if signed out.`)
  .action(() => whoami());

program
  .command("fonts")
  .description(
    `List the local fonts available on this machine (macOS only; does not require the app). These family names are valid \`fontFamily\` values on <text>; each family lists its variants.`,
  )
  .option("-f, --family <pattern>", "filter to families whose name contains <pattern> (case-insensitive)")
  .option("-w, --weight <weights...>", "filter to variants with the given CSS weight(s), e.g. -w 400 700")
  .option("-s, --style <style>", `filter to variants with the given style: "normal" or "italic"`)
  .option("-l, --limit <n>", "output at most <n> families")
  .option("-n, --names-only", "output only family names (one per line, no variant detail)")
  .action((opts: ListFontsOptions) => listFonts(opts));

program
  .command("fetch")
  .description(
    `Download a video with yt-dlp (installed separately; does not require the app). Writes files to disk only (a single URL can yield several, e.g. a playlist); pull one into the project afterwards with \`dapi asset add <path>\`.`,
  )
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
