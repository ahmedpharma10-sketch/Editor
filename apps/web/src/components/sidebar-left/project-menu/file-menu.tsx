/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { useSearchParams } from "@solidjs/router";
import { getAllEntities } from "bitecs";
import { For, Show, createMemo } from "solid-js";
import { nanoid } from "nanoid";
import { toast } from "somoto";
import { deleteProject, duplicateProject, DEFAULT_PROJECT_ID } from "@/components/engine/db";
import { Not } from "bitecs";
import { ChildOf, isScene, useQuery, loadAsset, changeAssetDirectory, removeAsset, getAssetFile } from "@/components/engine";
import { useProjectId } from "@/hooks/use-project-id";
import { useEngine } from "@/context/engine";
import { useExport } from "@/context/export";
import { getDefaultExportTemplate } from "@/components/sidebar-right/inspector/export-templates";
import { showFileDialog, mimeTypeToExtension } from "@/utils";

export function FileMenu() {
  const [, setParams] = useSearchParams();
  const projectId = useProjectId();
  const { world } = useEngine();

  const handleNewProject = () => {
    setParams({
      project: nanoid(),
      dashboard: undefined
    }, { replace: true });
  };

  const handleDuplicateProject = async () => {
    const currentId = projectId();
    if (currentId === DEFAULT_PROJECT_ID) return;

    try {
      const entry = await duplicateProject(currentId);
      if (!entry) return;
      setParams({
        project: entry.id,
        dashboard: undefined
      }, { replace: true });
    } catch {
      toast.error("Failed to duplicate project");
    }
  };

  const handleDeleteProject = async () => {
    const currentId = projectId();
    if (currentId === DEFAULT_PROJECT_ID) return;

    try {
      await deleteProject(currentId);
      setParams({
        project: undefined,
        dashboard: "projects",
      }, { replace: true });
    } catch {
      toast.error("Failed to delete project");
    }
  };

  const handleChangeProjectFolder = async () => {
    try {
      await changeAssetDirectory(world);
    } catch (e) {
      toast.error("Failed to change project folder", {
        description: (e as Error).message,
      });
    }
  };

  const handleImportFromComputer = async () => {
    try {
      const files = await showFileDialog();
      if (files.length === 0) return;
      await Promise.all(files.map((file) => loadAsset(world, file)));
    } catch (e) {
      toast.error("Failed to import assets", {
        description: (e as Error).message,
      });
    }
  };

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={handleNewProject}>
          New project
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={projectId() === DEFAULT_PROJECT_ID}
          onSelect={handleDuplicateProject}
        >
          Duplicate project
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={handleChangeProjectFolder}>
          Change project folder...
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={handleImportFromComputer}>
          Import from computer...
          <DropdownMenuShortcut>⌘I</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Asset</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[196px]">
              <FileAssetMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Export</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[246px]">
              <FileExportMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem
          disabled={projectId() === DEFAULT_PROJECT_ID}
          onSelect={handleDeleteProject}
        >
          Delete project
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function FileAssetMenu() {
  const { world } = useEngine();

  const handleDownloadAll = async () => {
    const all = Array.from(world.assets.values());
    if (all.length === 0) {
      toast("No assets to download");
      return;
    }

    let destination: FileSystemDirectoryHandle;
    try {
      destination = await window.showDirectoryPicker({
        mode: "readwrite",
        startIn: "downloads",
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      toast.error("Failed to download assets", {
        description: (e as Error).message,
      });
      return;
    }

    try {
      const usedNames = new Set<string>();
      await Promise.all(
        all.map(async (asset) => {
          const file = await getAssetFile(asset);
          const base = asset.name.match(/\.[^.]+$/)
            ? asset.name
            : asset.name + mimeTypeToExtension(asset.mimeType);

          let name = base;
          let i = 1;
          while (usedNames.has(name)) {
            const dot = base.lastIndexOf(".");
            name = dot === -1
              ? `${base} (${i})`
              : `${base.slice(0, dot)} (${i})${base.slice(dot)}`;
            i++;
          }
          usedNames.add(name);

          const fileHandle = await destination.getFileHandle(name, { create: true });
          const writable = await fileHandle.createWritable();
          try {
            await writable.write(file);
          } finally {
            await writable.close();
          }
        })
      );
      toast.success(`Downloaded ${all.length} asset${all.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error("Failed to download assets", {
        description: (e as Error).message,
      });
    }
  };

  const handleRemoveDuplicates = async () => {
    const all = Array.from(world.assets.values());
    const byHash = new Map<string, typeof all>();
    for (const asset of all) {
      const list = byHash.get(asset.hash) ?? [];
      list.push(asset);
      byHash.set(asset.hash, list);
    }

    const toRemove: string[] = [];
    for (const list of byHash.values()) {
      if (list.length <= 1) continue;
      list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const asset of list.slice(1)) toRemove.push(asset.id);
    }

    if (toRemove.length === 0) {
      toast("No duplicated media found");
      return;
    }

    try {
      await removeAsset(world, ...toRemove);
      toast.success(
        `Removed ${toRemove.length} duplicate${toRemove.length === 1 ? "" : "s"}`
      );
    } catch (e) {
      toast.error("Failed to remove duplicated media", {
        description: (e as Error).message,
      });
    }
  };

  const handleRemoveUnused = async () => {
    const referenced = new Set<string>();
    const AssetId = world.components.AssetId;
    for (const eid of getAllEntities(world)) {
      const id = AssetId[eid];
      if (id) referenced.add(id);
    }

    const toRemove = Array.from(world.assets.values())
      .filter((asset) => !referenced.has(asset.id))
      .map((asset) => asset.id);

    if (toRemove.length === 0) {
      toast("No unused media found");
      return;
    }

    try {
      await removeAsset(world, ...toRemove);
      toast.success(
        `Removed ${toRemove.length} unused asset${toRemove.length === 1 ? "" : "s"}`
      );
    } catch (e) {
      toast.error("Failed to remove unused media", {
        description: (e as Error).message,
      });
    }
  };

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={handleDownloadAll}>
          Download all assets...
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={handleRemoveDuplicates}>
          Remove duplicated media...
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleRemoveUnused}>
          Remove unused media...
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function FileExportMenu() {
  const { world } = useEngine();
  const { exportScene, exportCurrentFrame } = useExport();

  const handleExportScene = async () => {
    const sceneEid = world.selection.scene;
    if (sceneEid === null) {
      toast("No active scene to export");
      return;
    }
    await exportScene(sceneEid, getDefaultExportTemplate());
  };

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={handleExportScene}>
          Export scene...
          <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Export specific scene</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[172px]">
              <FileExportSpecificSceneMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={() => exportCurrentFrame()}>
          Export current frame as image
          <DropdownMenuShortcut>⇧⌘E</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function FileExportSpecificSceneMenu() {
  const { world } = useEngine();
  const { exportScene } = useExport();

  const c = world.components;
  const children = useQuery([c.Geometry, c.Playback, Not(ChildOf('*')), Not(c.Deleted)]);
  const scenes = createMemo(() => children().filter((eid) => isScene(world, eid)));

  const handleExport = async (sceneEid: number) => {
    await exportScene(sceneEid, getDefaultExportTemplate());
  };

  return (
    <DropdownMenuGroup>
      <Show
        when={scenes().length > 0}
        fallback={
          <DropdownMenuItem disabled>No scenes available</DropdownMenuItem>
        }
      >
        <For each={scenes()}>
          {(sceneEid, index) => (
            <DropdownMenuItem onSelect={() => handleExport(sceneEid)}>
              {world.components.Name[sceneEid] || `Scene ${index() + 1}`}
            </DropdownMenuItem>
          )}
        </For>
      </Show>
    </DropdownMenuGroup>
  );
}
