/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// One command to develop the desktop app from source. It:
//   1. builds the CLI, so a linked `dapi` (see symlink:create) runs the
//      latest code and the app's headless server matches it;
//   2. starts the web dev server (Vite on :5173);
//   3. waits for that server, then launches Electron, which loads it.
// Ctrl-C tears the whole tree down.

import { spawn, execFileSync } from "node:child_process";
import { get } from "node:http";

const DEV_URL = "http://localhost:5173";
const children = [];
let shuttingDown = false;

function run(name, args) {
  // Own process group (detached) so we can signal the npm process *and* its
  // grandchildren (vite, electron) in one shot on teardown.
  const child = spawn("npm", args, { stdio: "inherit", detached: true });
  child.on("exit", (code) => {
    if (shuttingDown) return;
    // A child dying on its own (e.g. Vite crashed) should bring the rest down.
    console.error(`\n[dev:desktop] ${name} exited (${code}); shutting down.`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  process.exit(code);
}

// Resolves once the dev server answers. Probes over HTTP against the same URL
// Electron loads, so we follow its host resolution (Vite binds localhost as
// IPv6 ::1) rather than guessing an address family.
function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = get(url, (res) => {
        res.destroy();
        resolve(); // Any response means the server is up.
      });
      req.once("error", () => {
        req.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Vite did not come up at ${url} in time`));
        } else {
          setTimeout(tryOnce, 200);
        }
      });
    };
    tryOnce();
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}

// 1. Build the CLI (blocking) so `dapi` and the app agree on the latest code.
console.log("[dev:desktop] building CLI…");
execFileSync("npm", ["run", "build", "--workspace=@diffusionstudio/cli"], { stdio: "inherit" });

// 2. Start the web dev server.
console.log("[dev:desktop] starting web dev server…");
run("web", ["run", "dev", "--workspace=@diffusionstudio/web"]);

// 3. Once it is up, launch Electron (its own build runs first, loads :5173).
try {
  await waitForServer(DEV_URL);
} catch (err) {
  console.error(`[dev:desktop] ${err.message}`);
  shutdown(1);
}
console.log("[dev:desktop] starting desktop app…");
run("desktop", ["run", "dev", "--workspace=@diffusionstudio/desktop"]);
