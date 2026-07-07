/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { existsSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { app, BrowserWindow, ipcMain } from "electron";
import { CLI_WIRE, SOCKET_PATH } from "@diffusionstudio/cli/protocol";
import type { CliReply, CliRequest } from "@diffusionstudio/cli/protocol";
import { mainBridge } from "./main-manager";
import { MAIN_CHANNELS } from "./main-channels";

let cliServer: Server | null = null;
let currentWindow: BrowserWindow | null = null;
let headless = false;

export function isHeadless(): boolean {
  return headless;
}

function enableHeadless(): void {
  if (headless) return;
  headless = true;
  if (currentWindow && !currentWindow.isDestroyed()) {
    mainBridge.emit(currentWindow, MAIN_CHANNELS.HEADLESS_MODE, { active: true });
  }
}

const pending = new Map<string, Socket>();
let forwardListenerBound = false;
let windowLifecycleBound = false;

function resetRenderer(reason: string): void {
  for (const [id, sock] of pending) {
    finish(id, { id, ok: false, error: reason }, sock);
  }
  pending.clear();
}

// Resolves once the current window has finished loading.
function waitForRendererReady(timeoutMs = 30000): Promise<void> {
  if (!currentWindow || currentWindow.isDestroyed()) {
    return Promise.reject(new Error("No window"));
  }

  if (currentWindow.webContents.isCrashed()) {
    return Promise.reject(new Error("Renderer crashed"));
  }
  if (!currentWindow.webContents.isLoading()) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.warn(`[cli-server] renderer not ready after ${timeoutMs}ms`);
      reject(new Error("App did not become ready in time"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      currentWindow?.webContents.off("did-finish-load", onLoad);
      currentWindow?.webContents.off("did-fail-load", onFail);
    };

    const onLoad = () => {
      cleanup();
      resolve();
    };

    const onFail = () => {
      cleanup();
      reject(new Error(`Renderer failed to load`));
    };

    currentWindow?.webContents.on("did-finish-load", onLoad);
    currentWindow?.webContents.on("did-fail-load", onFail);
  });
}

function attachWindowLifecycle(window: BrowserWindow): void {
  currentWindow = window;

  window.webContents.on("did-start-loading", () => resetRenderer("Renderer reloading"));
  window.webContents.on("render-process-gone", () => resetRenderer("Renderer crashed"));
  window.on("closed", () => {
    if (currentWindow === window) {
      currentWindow = null;
    }
    resetRenderer("Window closed");
  });
}

function bindWindowLifecycle(): void {
  if (windowLifecycleBound) return;
  windowLifecycleBound = true;
  app.on("browser-window-created", (_event, window) => attachWindowLifecycle(window));
  // Catch any window that was created before the server started.
  for (const window of BrowserWindow.getAllWindows()) {
    attachWindowLifecycle(window);
  }
}

function finish(id: string, reply: CliReply, sock?: Socket): void {
  const target = sock ?? pending.get(id);
  if (!target) return;
  pending.delete(id);
  if (!target.destroyed) target.end(JSON.stringify(reply));
}

function bindForwardListener(): void {
  if (forwardListenerBound) return;
  forwardListenerBound = true;
  ipcMain.on(CLI_WIRE.FORWARD_REPLY, (_event, reply: CliReply) => {
    finish(reply.id, reply);
  });
}

async function forwardToRenderer(req: CliRequest, sock: Socket): Promise<void> {
  pending.set(req.id, sock);
  sock.once("close", () => {
    // CLI hung up before we could reply — drop the entry so a late reply is
    // discarded rather than written to a destroyed socket.
    if (pending.get(req.id) === sock) {
      pending.delete(req.id);
    }
  });

  try {
    await waitForRendererReady();
    if (!currentWindow || currentWindow.isDestroyed()) {
      throw new Error("No window");
    }

    currentWindow.webContents.send(CLI_WIRE.FORWARD_REQ, req);
  } catch (err) {
    finish(req.id, { id: req.id, ok: false, error: (err as Error).message });
  }
}

export function startCliServer() {
  cleanupStaleSocket();
  bindForwardListener();
  bindWindowLifecycle();

  cliServer = createServer({ allowHalfOpen: true }, (sock: Socket) => {
    enableHeadless();
    let buf = "";
    sock.setEncoding("utf8");
    sock.setTimeout(60000, () => sock.destroy());
    sock.on("data", (chunk) => {
      buf += chunk;
    });
    sock.on("end", async () => {
      sock.setTimeout(0);
      let req: CliRequest;
      try {
        req = JSON.parse(buf) as CliRequest;
      } catch {
        sock.end(JSON.stringify({ id: "unknown", ok: false, error: "Invalid JSON request" }));
        return;
      }
      await forwardToRenderer(req, sock);
    });
    sock.on("error", () => {
      // Client hung up; nothing to do.
    });
  });

  cliServer.on("error", (err) => {
    console.error("CLI server error:", err);
  });

  cliServer.listen(SOCKET_PATH);
}

export function stopCliServer() {
  if (!cliServer) return;
  cliServer.close();
  cliServer = null;
  cleanupStaleSocket();
}

/**
 * Clean up a stale socket file (Unix). Safe because the single-instance lock
 * guarantees no other instance of ours is running.
 */
function cleanupStaleSocket() {
  try {
    if (process.platform !== "win32" && existsSync(SOCKET_PATH)) {
      unlinkSync(SOCKET_PATH);
    }
  } catch {
    // Best-effort.
  }
}
