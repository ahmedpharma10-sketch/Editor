/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Engine } from "@/components/engine";
import type { Accessor } from "solid-js";

import { createProject, deleteProject, getProject, getProjectName, listRecentProjects, DEFAULT_PROJECT_ID } from "@/components/engine/db";
import { whenProjectReady } from "@/context/engine";
import { useSearchParams } from "@solidjs/router";

export function handleProjectActive(engine: Accessor<Engine>) {
  return async () => {
    const { world } = engine();
    const id = world.projectId;
    if (!id || id === DEFAULT_PROJECT_ID) return null;
    const name = await getProjectName(id);
    return { id, name };
  }
}

export function handleProjectList() {
  return async () => {
    const entries = await listRecentProjects(Number.MAX_SAFE_INTEGER);
    return entries.map(({ id, name, createdAt, lastAccessedAt }) => ({
      id,
      name,
      createdAt,
      lastAccessedAt,
    }));
  }
}

export function handleProjectCreate(_engine: Accessor<Engine>, setParams: ReturnType<typeof useSearchParams>[1]) {
  return async ({ name }: { name?: string }) => {
    const entry = await createProject(name);
    setParams({ project: entry.id, dashboard: undefined }, { replace: true });
    // Opening is a search param write; the engine for the new project mounts
    // and restores after it. Hold the reply until that lands so the next CLI
    // command can't run against the outgoing project's world.
    await whenProjectReady(entry.id);
    return { id: entry.id, name: entry.name };
  }
}

export function handleProjectDelete(engine: Accessor<Engine>, setParams: ReturnType<typeof useSearchParams>[1]) {
  return async ({ id }: { id: string }) => {
    const { world } = engine();
    if (id === DEFAULT_PROJECT_ID) {
      throw new Error("Cannot delete the default project");
    }
    const name = await getProjectName(id);
    await deleteProject(id);
    if (world.projectId === id) {
      setParams({ project: undefined, dashboard: "projects" }, { replace: true });
    }
    return { id, name };
  }
}

export function handleProjectOpen(_engine: Accessor<Engine>, setParams: ReturnType<typeof useSearchParams>[1]) {
  return async ({ id }: { id: string }) => {
    const entry = await getProject(id);
    if (!entry) return null;
    setParams({ project: entry.id, dashboard: undefined }, { replace: true });
    await whenProjectReady(entry.id);
    return { id: entry.id, name: entry.name };
  }
}
