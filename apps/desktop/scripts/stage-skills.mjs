/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Stages the agent skills into apps/desktop/skills so electron-forge can ship
// them as an app resource (Contents/Resources/skills). The app symlinks agent
// skill directories at these staged copies (see src/skills-install.ts), so
// auto-updates keep installed skills in lockstep with the dapi they document.
//
// Prefers a sibling checkout of diffusionstudio/skills next to the repo root
// (the dev setup); falls back to a shallow clone (CI).

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS_REPO = "https://github.com/diffusionstudio/skills.git";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(desktopDir, "..", "..");
const stageDir = join(desktopDir, "skills");
const sibling = join(repoRoot, "..", "skills");

let sourceDir = sibling;
let tempDir = null;
if (!existsSync(join(sibling, "editor", "SKILL.md"))) {
  tempDir = mkdtempSync(join(tmpdir(), "stage-skills-"));
  execFileSync("git", ["clone", "--depth", "1", SKILLS_REPO, tempDir], { stdio: "inherit" });
  sourceDir = tempDir;
}

// A skill is a top-level directory with a SKILL.md.
const skills = readdirSync(sourceDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("."))
  .filter((e) => existsSync(join(sourceDir, e.name, "SKILL.md")))
  .map((e) => e.name);

if (skills.length === 0) {
  throw new Error(`stage-skills: no skills found in ${sourceDir}`);
}

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
for (const name of skills) {
  cpSync(join(sourceDir, name), join(stageDir, name), { recursive: true });
}
if (tempDir) rmSync(tempDir, { recursive: true, force: true });

console.log(`stage-skills: staged ${skills.join(", ")} at ${stageDir}`);
