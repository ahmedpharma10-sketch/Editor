/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import { MAIN_WIRE } from "./main-channels";
import { CLI_WIRE } from "@diffusionstudio/cli/channels";

const ALLOWED_RENDERER_TO_MAIN: ReadonlySet<string> = new Set([MAIN_WIRE.REQUEST]);

const ALLOWED_MAIN_TO_RENDERER: ReadonlySet<string> = new Set([
  MAIN_WIRE.RESPONSE,
  MAIN_WIRE.EVENT,
  CLI_WIRE.CONNECT,
]);

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  send,
  on,
});

function send(channel: string, payload: unknown): void {
  if (!ALLOWED_RENDERER_TO_MAIN.has(channel)) return;
  ipcRenderer.send(channel, payload);
}

function on(channel: string, cb: (payload: unknown) => void): () => void {
  if (!ALLOWED_MAIN_TO_RENDERER.has(channel)) return () => {};
  const listener = (_event: IpcRendererEvent, payload: unknown) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}
