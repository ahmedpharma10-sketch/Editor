/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Wire-level channels — the only raw ipcRenderer/ipcMain channels in play for
// the main↔renderer request/event protocol. Everything else multiplexes
// through these via an envelope carrying the logical MAIN_CHANNELS name and
// (for requests) a UUID for correlation.
//
// CLI traffic uses a separate wire pair (CLI_WIRE in @diffusionstudio/cli/protocol);
// main forwards it opaquely without inspecting channel names.
import type { LogEntry, ScreenshotResult } from "@diffusionstudio/cli/protocol";

export const MAIN_WIRE = {
  REQUEST: "main:request",
  RESPONSE: "main:response",
  EVENT: "main:event",
} as const;

export type MainWireChannel = (typeof MAIN_WIRE)[keyof typeof MAIN_WIRE];

// Logical channels. Two categories:
//   • Renderer→Main requests (request + response)
//   • Main→Renderer events   (push, no response)
// Renderer-state queries used to live here; they now answer CLI requests
// directly via the CLI bridge.
export const MAIN_CHANNELS = {
  // Renderer→Main requests
  APP_OPEN_EXTERNAL: "app:open-external",
  AUTH_GET_PENDING_CALLBACK: "auth:get-pending-callback",
  CHECKOUT_GET_PENDING_CALLBACK: "checkout:get-pending-callback",
  WINDOW_IS_FULLSCREEN: "window:is-fullscreen",
  WINDOW_CAPTURE: "window:capture",
  FILE_TRANSFER: "file:transfer",
  FILE_WRITE_OPEN: "file:write-open",
  FILE_WRITE_CHUNK: "file:write-chunk",
  FILE_WRITE_CLOSE: "file:write-close",
  FILE_WRITE_ABORT: "file:write-abort",
  HEADLESS_GET_MODE: "headless:get-mode",
  LOGS_GET: "logs:get",
  PROJECTS_PICK_ROOT: "projects:pick-root",
  PROJECTS_LIST: "projects:list",
  PROJECTS_CREATE: "projects:create",
  PROJECTS_COMPILE: "projects:compile",
  PROJECTS_WATCH: "projects:watch",
  PROJECTS_UNWATCH: "projects:unwatch",

  // Main→Renderer events
  AUTH_CALLBACK: "auth:callback",
  CHECKOUT_CALLBACK: "checkout:callback",
  WINDOW_FULLSCREEN_CHANGE: "window:fullscreen-change",
  HEADLESS_MODE: "headless:mode",
  PROJECTS_CHANGED: "projects:changed",
} as const;

/** A project folder under the projects root: a real npm package with a JSX entry. */
export type ProjectInfo = {
  /** Folder name, doubles as the project id. */
  name: string;
  /** Absolute path of the project folder. */
  dir: string;
  /** Entry file relative to `dir` (index.tsx, index.ts, index.jsx or index.js). */
  entry: string;
  /** mtime of the entry file, ISO string. */
  modifiedAt: string;
  /** birthtime of the folder, ISO string. */
  createdAt: string;
};

export type CompileResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

export type MainChannel = (typeof MAIN_CHANNELS)[keyof typeof MAIN_CHANNELS];

// Events fed by a `diffusion://` deep link. Main routes each link to exactly
// one of these by its host, so auth and checkout never consume each other's.
export type DeepLinkChannel =
  | typeof MAIN_CHANNELS.AUTH_CALLBACK
  | typeof MAIN_CHANNELS.CHECKOUT_CALLBACK;

export type MainRequestMap = {
  [MAIN_CHANNELS.APP_OPEN_EXTERNAL]: { request: { url: string }; response: void };
  [MAIN_CHANNELS.AUTH_GET_PENDING_CALLBACK]: { request: void; response: string | null };
  [MAIN_CHANNELS.CHECKOUT_GET_PENDING_CALLBACK]: { request: void; response: string | null };
  [MAIN_CHANNELS.WINDOW_IS_FULLSCREEN]: { request: void; response: boolean };
  [MAIN_CHANNELS.WINDOW_CAPTURE]: { request: void; response: ScreenshotResult };
  [MAIN_CHANNELS.FILE_TRANSFER]: {
    request: { selector: string; absolutePath: string };
    response: void;
  };
  [MAIN_CHANNELS.FILE_WRITE_OPEN]: {
    request: { path: string; exclusive?: boolean };
    response: { id: string };
  };
  [MAIN_CHANNELS.FILE_WRITE_CHUNK]: {
    request: { id: string; data: Uint8Array; position: number };
    response: void;
  };
  [MAIN_CHANNELS.FILE_WRITE_CLOSE]: {
    request: { id: string };
    response: void;
  };
  [MAIN_CHANNELS.FILE_WRITE_ABORT]: {
    request: { id: string };
    response: void;
  };
  [MAIN_CHANNELS.HEADLESS_GET_MODE]: { request: void; response: boolean };
  [MAIN_CHANNELS.LOGS_GET]: { request: void; response: LogEntry[] };
  [MAIN_CHANNELS.PROJECTS_PICK_ROOT]: { request: void; response: string | null };
  [MAIN_CHANNELS.PROJECTS_LIST]: { request: { root: string }; response: ProjectInfo[] };
  [MAIN_CHANNELS.PROJECTS_CREATE]: {
    request: { root: string; name: string };
    response: ProjectInfo;
  };
  [MAIN_CHANNELS.PROJECTS_COMPILE]: { request: { dir: string }; response: CompileResult };
  [MAIN_CHANNELS.PROJECTS_WATCH]: { request: { dir: string }; response: void };
  [MAIN_CHANNELS.PROJECTS_UNWATCH]: { request: { dir: string }; response: void };
};
export type MainRequestChannel = keyof MainRequestMap;

export type MainEventMap = {
  [MAIN_CHANNELS.AUTH_CALLBACK]: { url: string };
  [MAIN_CHANNELS.CHECKOUT_CALLBACK]: { url: string };
  [MAIN_CHANNELS.WINDOW_FULLSCREEN_CHANGE]: { fullscreen: boolean };
  [MAIN_CHANNELS.HEADLESS_MODE]: { active: boolean };
  // A file inside a watched project folder changed (path relative to `dir`).
  [MAIN_CHANNELS.PROJECTS_CHANGED]: { dir: string; path: string };
};
export type MainEventChannel = keyof MainEventMap;

export type MainRequest = {
  id: string;
  channel: MainRequestChannel;
  data: unknown;
};

export type MainEvent = {
  channel: MainEventChannel;
  data: unknown;
};

export type MainReply =
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; error: string };
