/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SkillsInstallResult } from "./main-channels";

// The skills CLI (github.com/vercel-labs/skills) installs global skills into
// ~/<agent>/skills/. `editor` is this product's main skill, so its presence
// under any known agent directory counts as installed.
const AGENT_DIRS = [".claude", ".codex", ".cursor", ".gemini", ".copilot"];

export const SKILLS_INSTALL_COMMAND = "npx -y skills add diffusionstudio/skills -g -y --all";

const INSTALL_TIMEOUT_MS = 180_000;

export function isSkillsInstalled(): boolean {
  const home = homedir();
  return AGENT_DIRS.some((dir) => existsSync(join(home, dir, "skills", "editor")));
}

// npx comes from the user's own Node install, which a Finder-launched app
// doesn't have on PATH — so the command runs through the user's login shell.
export function installSkills(): Promise<SkillsInstallResult> {
  const shell = process.env.SHELL || "/bin/zsh";
  return new Promise((resolve) => {
    execFile(
      shell,
      ["-lc", SKILLS_INSTALL_COMMAND],
      { timeout: INSTALL_TIMEOUT_MS },
      (err, _stdout, stderr) => {
        if (!err) return resolve({ status: "installed" });
        const message = stderr.trim() || err.message;
        const npxMissing = /command not found|not recognized|ENOENT/i.test(message);
        resolve({ status: "error", error: message, npxMissing });
      },
    );
  });
}
