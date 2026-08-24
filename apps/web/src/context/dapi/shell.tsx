/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { onCleanup } from "solid-js";
import { useNavigate } from "@solidjs/router";

import { t, m, createRouterCaller } from "@/lib/cli-rpc";
import { cliBridge } from "@/lib/ipc";
import { openProjectFolder } from "@/projects";
import { projectRoute } from "@/hooks/use-project-route";

import type { Navigator } from "@solidjs/router";

type ShellRouterDeps = {
  navigate: Navigator;
};

/**
 * The CLI procedures that outlive any one project: what `dapi` can ask of the
 * app while it sits at the dashboard, or before anything is open at all. The
 * editor's own router (see ./api) mounts per project; this one is registered
 * for as long as the app runs, which is what lets `ping` prove the app is up
 * and `open` bring a project in from nothing.
 */
export function createShellRouter({ navigate }: ShellRouterDeps) {
  return t.router({
    ping: t.procedure.query(() => {}),
    open: m(async ({ dir }: { dir: string }) => {
      const project = await openProjectFolder(dir);
      navigate(projectRoute(project.id || project.name));
      return { id: project.id, name: project.displayName, dir: project.dir };
    }),
  });
}

export type ShellRouter = ReturnType<typeof createShellRouter>;

/** Registers the shell router for the app's lifetime. Renders nothing; must sit inside the router tree for `useNavigate`. */
export function ShellApi() {
  const navigate = useNavigate();
  onCleanup(cliBridge.register(createRouterCaller(createShellRouter({ navigate }))));
  return null;
}
