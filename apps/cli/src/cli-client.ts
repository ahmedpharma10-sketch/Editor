/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { connect } from "node:net";
import { randomUUID } from "node:crypto";
import { CLI_CHANNELS, SOCKET_PATH } from "./protocol";
import type {
  CliReply,
  CliRequest,
  CliRequestChannel,
  CliRequestMap,
  ModelsRequest,
  EncoderConfigInput,
  MountRequest,
  NodeGrepRequest,
  NodeInsertRequest,
  NodePatch,
} from "./protocol";

const DEFAULT_TIMEOUT_MS = 60000;
const GENERATE_TIMEOUT_MS = 600000;

export function cliRequest<C extends CliRequestChannel>(
  channel: C,
  data: CliRequestMap[C]["request"],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<CliRequestMap[C]["response"]> {
  return new Promise((resolve, reject) => {
    const sock = connect(SOCKET_PATH);
    let buf = "";
    let settled = false;
    const envelope: CliRequest = {
      id: randomUUID(),
      channel,
      data,
    };

    // Destroy the socket explicitly on completion. Without this, lingering
    // socket handles (idle timer, half-closed state) can keep the Node event
    // loop alive past `console.log(result)`, preventing the CLI from exiting.
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      fn();
    };

    sock.setEncoding("utf8");
    sock.setTimeout(timeoutMs, () =>
      settle(() => reject(new Error("Timed out waiting for response"))),
    );
    sock.on("connect", () => sock.end(JSON.stringify(envelope)));
    sock.on("data", (chunk) => {
      buf += chunk;
    });
    sock.on("end", () => {
      let reply: CliReply;
      try {
        reply = JSON.parse(buf) as CliReply;
      } catch (e) {
        settle(() => reject(e instanceof Error ? e : new Error(String(e))));
        return;
      }
      if (reply.ok) {
        settle(() => resolve(reply.data as CliRequestMap[C]["response"]));
      } else {
        settle(() => reject(new Error(reply.error)));
      }
    });
    sock.on("error", (err) => settle(() => reject(err)));
  });
}

export const cliAPI = {
  context: () => cliRequest(CLI_CHANNELS.CONTEXT, undefined),
  addAssets: (paths: string[], folderId?: string) =>
    cliRequest(CLI_CHANNELS.ASSETS_ADD, { paths, folderId }),
  listAssets: (ids?: string[]) => cliRequest(CLI_CHANNELS.ASSETS_LIST, { ids }),
  assetTree: (folderId?: string, depth?: number) =>
    cliRequest(CLI_CHANNELS.ASSET_TREE, { folderId, depth }),
  deleteAssets: (ids: string[]) => cliRequest(CLI_CHANNELS.ASSETS_DELETE, { ids }),
  moveAssets: (ids: string[], to?: string) => cliRequest(CLI_CHANNELS.ASSETS_MOVE, { ids, to }),
  exportAssets: (ids: string[], output: string, isDir: boolean) =>
    cliRequest(CLI_CHANNELS.ASSETS_EXPORT, { ids, output, isDir }, GENERATE_TIMEOUT_MS),
  listFolders: (parentId?: string) => cliRequest(CLI_CHANNELS.FOLDERS_LIST, { parentId }),
  createFolder: (name: string, parentId?: string) =>
    cliRequest(CLI_CHANNELS.FOLDER_CREATE, { name, parentId }),
  renameFolder: (id: string, name: string) => cliRequest(CLI_CHANNELS.FOLDER_RENAME, { id, name }),
  moveFolders: (ids: string[], to?: string) => cliRequest(CLI_CHANNELS.FOLDERS_MOVE, { ids, to }),
  deleteFolders: (ids: string[]) => cliRequest(CLI_CHANNELS.FOLDERS_DELETE, { ids }),
  assetProbe: (id: string) => cliRequest(CLI_CHANNELS.ASSET_PROBE, { id }),
  assetFrame: (id: string, times?: number[]) => cliRequest(CLI_CHANNELS.ASSET_FRAME, { id, times }),
  assetTranscribe: (id: string) =>
    cliRequest(CLI_CHANNELS.ASSET_TRANSCRIBE, { id }, GENERATE_TIMEOUT_MS),
  assetVisualize: (id: string, start?: number, end?: number, scale?: number) =>
    cliRequest(CLI_CHANNELS.ASSET_VISUALIZE, { id, start, end, scale }),
  assetAnalyze: (id: string, prompt?: string, start?: number, end?: number) =>
    cliRequest(CLI_CHANNELS.ASSET_ANALYZE, { id, prompt, start, end }, GENERATE_TIMEOUT_MS),
  listSelection: () => cliRequest(CLI_CHANNELS.SELECTION_LIST, undefined),
  setSelection: (ids: number[]) => cliRequest(CLI_CHANNELS.SELECTION_SET, { ids }),
  focusSelection: () => cliRequest(CLI_CHANNELS.SELECTION_FOCUS, undefined),
  listNodes: (ids?: number[]) => cliRequest(CLI_CHANNELS.NODE_LIST, { ids }),
  nodeTree: (id?: number, depth?: number) => cliRequest(CLI_CHANNELS.NODE_TREE, { id, depth }),
  grepNodes: (req: NodeGrepRequest) => cliRequest(CLI_CHANNELS.NODE_GREP, req),
  nodeScreenshot: (id?: number, frame?: number) => cliRequest(CLI_CHANNELS.NODE_SCREENSHOT, { id, frame }),
  mount: (req: MountRequest) => cliRequest(CLI_CHANNELS.MOUNT, req, GENERATE_TIMEOUT_MS),
  insertNode: (req: NodeInsertRequest) =>
    cliRequest(CLI_CHANNELS.NODE_INSERT, req, GENERATE_TIMEOUT_MS),
  deleteNodes: (ids: number[]) => cliRequest(CLI_CHANNELS.NODE_DELETE, { ids }),
  patchNodes: (patches: NodePatch[]) => cliRequest(CLI_CHANNELS.NODE_PATCH, { patches }),
  duplicateNodes: (ids: number[]) => cliRequest(CLI_CHANNELS.NODE_DUPLICATE, { ids }),
  renderNode: (output: string, id?: number, config?: EncoderConfigInput) =>
    cliRequest(CLI_CHANNELS.NODE_RENDER, { id, output, config }, GENERATE_TIMEOUT_MS),
  activeProject: () => cliRequest(CLI_CHANNELS.PROJECT_ACTIVE, undefined),
  listProjects: () => cliRequest(CLI_CHANNELS.PROJECT_LIST, undefined),
  createProject: (name?: string) => cliRequest(CLI_CHANNELS.PROJECT_CREATE, { name }),
  deleteProject: (id: string) => cliRequest(CLI_CHANNELS.PROJECT_DELETE, { id }),
  openProject: (id: string) => cliRequest(CLI_CHANNELS.PROJECT_OPEN, { id }),
  models: (req: ModelsRequest) => cliRequest(CLI_CHANNELS.MODELS, req),
  voices: () => cliRequest(CLI_CHANNELS.VOICES, undefined),
  ping: () => cliRequest(CLI_CHANNELS.PING, undefined),
  whoami: () => cliRequest(CLI_CHANNELS.WHOAMI, undefined),
};

// Bridges the cold-start gap after launching the app. The `cli:ping` channel
// is handled by the renderer-side bridge and only completes once main has
// forwarded the request to a ready renderer — so a single round-trip is
// enough once the socket is up. The retry loop only handles the brief window
// before the socket itself binds (ENOENT/ECONNREFUSED).
export async function waitForCliSocket(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      await cliAPI.ping();
      return;
    } catch (e) {
      lastError = e;
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ECONNREFUSED") throw e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Timed out waiting for the app to start");
}
