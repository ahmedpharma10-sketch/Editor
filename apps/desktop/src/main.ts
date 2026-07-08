/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { app, BrowserWindow, session, shell } from "electron";
import { join } from "node:path";
import { open, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { updateElectronApp } from "update-electron-app";
import { startCliServer, stopCliServer, isHeadless } from "./cli-server";
import { setupAppMenu } from "./menu";
import { mainBridge } from "./main-manager";
import { MAIN_CHANNELS } from "./main-channels";

const DEV_URL = "http://localhost:5173";
const AUTH_PROTOCOL = "diffusion";

if (app.isPackaged && !process.argv.includes("--hidden")) {
  updateElectronApp({ repo: "diffusionstudio/editor" });
}

const openWrites = new Map<string, { handle: FileHandle; path: string }>();

let mainWindow: BrowserWindow | null = null;
let pendingAuthUrl: string | null = null;

function findProtocolUrl(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${AUTH_PROTOCOL}://`)) ?? null;
}

function isHiddenLaunch(argv: string[]): boolean {
  return argv.includes("--hidden");
}

function deliverAuthUrl(url: string) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) {
    pendingAuthUrl = url;
    return;
  }

  mainBridge.emit(mainWindow, MAIN_CHANNELS.AUTH_CALLBACK, { url });
}

async function setFileInputFiles(selector: string, absolutePath: string) {
  if (!mainWindow) throw new Error("No main window");
  const wc = mainWindow.webContents;
  const wasAttached = wc.debugger.isAttached();
  if (!wasAttached) wc.debugger.attach("1.3");
  try {
    const { root } = await wc.debugger.sendCommand("DOM.getDocument");
    const { nodeId } = await wc.debugger.sendCommand("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
    if (!nodeId) throw new Error(`Selector not found: ${selector}`);
    await wc.debugger.sendCommand("DOM.setFileInputFiles", {
      files: [absolutePath],
      nodeId,
    });
  } finally {
    if (!wasAttached) {
      try {
        wc.debugger.detach();
      } catch { /** ignore */ }
    }
  }
}

function createWindow(show = true) {
  mainWindow = new BrowserWindow({
    show,
    width: 1200,
    height: 800,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: "#1c1c1c",
    webPreferences: {
      preload: join(app.getAppPath(), "dist", "preload.js"),
    },
  });

  mainWindow.webContents.on("did-finish-load", () => {
    if (pendingAuthUrl) {
      mainBridge.emit(mainWindow, MAIN_CHANNELS.AUTH_CALLBACK, { url: pendingAuthUrl });
    }
    pendingAuthUrl = null;
  });

  mainWindow.on("enter-full-screen", () => {
    mainBridge.emit(mainWindow, MAIN_CHANNELS.WINDOW_FULLSCREEN_CHANGE, { fullscreen: true });
  });
  mainWindow.on("leave-full-screen", () => {
    mainBridge.emit(mainWindow, MAIN_CHANNELS.WINDOW_FULLSCREEN_CHANGE, { fullscreen: false });
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (!app.isPackaged) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(join(app.getAppPath(), "web", "index.html"));
  }
}

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(AUTH_PROTOCOL, process.execPath, [
    join(process.cwd(), process.argv[1]!),
  ]);
} else {
  app.setAsDefaultProtocolClient(AUTH_PROTOCOL);
}

if (app.requestSingleInstanceLock()) {
  app.on("second-instance", (_event, argv) => {
    const url = findProtocolUrl(argv);
    if (url) deliverAuthUrl(url);

    const hidden = isHiddenLaunch(argv);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (hidden) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow(!hidden);
    }
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    deliverAuthUrl(url);
  });

  mainBridge.handle(MAIN_CHANNELS.APP_OPEN_EXTERNAL, ({ url }) => shell.openExternal(url));
  mainBridge.handle(MAIN_CHANNELS.AUTH_GET_PENDING_CALLBACK, () => {
    const url = pendingAuthUrl;
    pendingAuthUrl = null;
    return url;
  });
  mainBridge.handle(MAIN_CHANNELS.WINDOW_IS_FULLSCREEN, () => mainWindow?.isFullScreen() ?? false);
  mainBridge.handle(MAIN_CHANNELS.HEADLESS_GET_MODE, () => isHeadless());
  mainBridge.handle(MAIN_CHANNELS.FILE_TRANSFER, ({ selector, absolutePath }) =>
    setFileInputFiles(selector, absolutePath),
  );
  
  mainBridge.handle(MAIN_CHANNELS.FILE_WRITE_OPEN, async ({ path, exclusive }) => {
    const handle = await open(path, exclusive ? "wx" : "w");
    const id = randomUUID();
    openWrites.set(id, { handle, path });
    return { id };
  });

  mainBridge.handle(MAIN_CHANNELS.FILE_WRITE_CHUNK, async ({ id, data, position }) => {
    const entry = openWrites.get(id);
    if (!entry) throw new Error(`No open file for write id ${id}`);
    await entry.handle.write(data, 0, data.byteLength, position);
  });

  mainBridge.handle(MAIN_CHANNELS.FILE_WRITE_CLOSE, async ({ id }) => {
    const entry = openWrites.get(id);
    if (!entry) return;
    openWrites.delete(id);
    await entry.handle.close();
  });

  // Abort: close the fd and delete the partial file (cancel / error cleanup).
  mainBridge.handle(MAIN_CHANNELS.FILE_WRITE_ABORT, async ({ id }) => {
    const entry = openWrites.get(id);
    if (!entry) return;
    openWrites.delete(id);
    try {
      await entry.handle.close();
    } finally {
      await unlink(entry.path).catch(() => {});
    }
  });

  app.whenReady().then(() => {
    setupAppMenu();
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(true));
    session.defaultSession.setPermissionCheckHandler(() => true);
    session.defaultSession.setDevicePermissionHandler(() => true);

    const url = findProtocolUrl(process.argv);
    if (url) pendingAuthUrl = url;

    startCliServer();
    createWindow(!isHiddenLaunch(process.argv));
  });

  app.on("before-quit", () => {
    stopCliServer();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
} else {
  app.quit();
}
