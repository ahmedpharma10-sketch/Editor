/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { app, dialog, Menu } from "electron";
import { execFile } from "node:child_process";
import { join } from "node:path";
import type { MenuItemConstructorOptions } from "electron";

const CLI_LINK_PATH = "/usr/local/bin/dapi";

// Linking into /usr/local/bin needs elevation; osascript shows the standard
// macOS admin prompt so the app itself never asks for credentials.
function linkCli(): Promise<void> {
  const wrapper = join(process.resourcesPath, "cli", "bin", "dapi");
  const shell = `mkdir -p /usr/local/bin && ln -sf '${wrapper}' '${CLI_LINK_PATH}'`;
  const script = `do shell script "${shell.replaceAll('"', '\\"')}" with administrator privileges`;
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], (err) => (err ? reject(err) : resolve()));
  });
}

async function installCli() {
  try {
    await linkCli();
    await dialog.showMessageBox({
      type: "info",
      message: "The dapi command line tool was installed.",
      detail: `Linked at ${CLI_LINK_PATH}. Run "dapi --help" in a terminal to get started.`,
    });
  } catch (e) {
    const message = (e as Error).message ?? "";
    if (message.includes("-128")) return; // user cancelled the admin prompt
    await dialog.showMessageBox({
      type: "error",
      message: "Could not install the dapi command line tool.",
      detail: message,
    });
  }
}

export function setupAppMenu() {
  if (process.platform !== "darwin") return;

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Install dapi Command Line Tool…",
          enabled: app.isPackaged,
          click: installCli,
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
