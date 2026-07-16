/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createSignal, Show } from "solid-js";
import { toast } from "somoto";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { Icon } from "../ui/icon";
import { useEngine } from "@/context/engine";
import {
  renameFolder,
  deleteFolder,
  moveFolder,
  moveAssetsToFolder,
  useAssets,
  useFolders,
  assetFolderId,
} from "@/components/engine";

import type { Folder } from "@/components/engine/db";

export const ASSET_DRAG_TYPE = "application/x-asset-id";
export const FOLDER_DRAG_TYPE = "application/x-folder-id";

function isAssetOrFolderDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types ?? [];
  return types.includes(ASSET_DRAG_TYPE) || types.includes(FOLDER_DRAG_TYPE);
}

/**
 * Handles a drop of an internal asset/folder drag onto the target folder
 * (null = root). Returns true when the event was an internal drag.
 */
export async function handleFolderDrop(
  world: ReturnType<typeof useEngine>["world"],
  event: DragEvent,
  targetFolderId: string | null,
): Promise<boolean> {
  const assetId = event.dataTransfer?.getData(ASSET_DRAG_TYPE);
  const folderId = event.dataTransfer?.getData(FOLDER_DRAG_TYPE);
  if (!assetId && !folderId) return false;

  if (assetId) {
    await moveAssetsToFolder(world, [assetId], targetFolderId);
  }
  if (folderId && folderId !== targetFolderId) {
    const moved = await moveFolder(world, folderId, targetFolderId);
    if (!moved) {
      toast("Cannot move a folder into itself");
    }
  }
  return true;
}

export type FolderItemProps = {
  folder: Folder;
  renaming: boolean;
  onRenameStart(): void;
  onRenameEnd(): void;
  onOpen(): void;
};

export function FolderItem(props: FolderItemProps) {
  const { world } = useEngine();
  const assets = useAssets(world);
  const folders = useFolders(world);

  const [isDropTarget, setIsDropTarget] = createSignal(false);

  const childCount = createMemo(() =>
    folders.childrenOf(props.folder.id).length +
    assets.all().filter((asset) => assetFolderId(world, asset) === props.folder.id).length
  );

  const handleDragStart = (event: DragEvent) => {
    event.dataTransfer?.setData(FOLDER_DRAG_TYPE, props.folder.id);
  };

  const handleDragOver = (event: DragEvent) => {
    if (!isAssetOrFolderDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDropTarget(true);
  };

  const handleDragLeave = () => {
    setIsDropTarget(false);
  };

  const handleDrop = async (event: DragEvent) => {
    if (!isAssetOrFolderDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDropTarget(false);
    await handleFolderDrop(world, event, props.folder.id);
  };

  const commitRename = async (nextName: string) => {
    if (!props.renaming) return;
    props.onRenameEnd();
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === props.folder.name) return;
    try {
      await renameFolder(world, props.folder.id, trimmed);
    } catch (e) {
      toast.error("Failed to rename", { description: (e as Error).message });
    }
  };

  const handleRenameKeyDown = (
    event: KeyboardEvent & { currentTarget: HTMLInputElement }
  ) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      props.onRenameEnd();
    }
  };

  const handleFocusElement = (el: HTMLInputElement) => {
    queueMicrotask(() => {
      el.focus();
      el.select();
    });
  };

  const handleDelete = async () => {
    try {
      await deleteFolder(world, props.folder.id);
    } catch (e) {
      toast.error("Failed to delete", { description: (e as Error).message });
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        as="div"
        class="flex flex-col gap-1 text-left"
        data-folder-id={props.folder.id}
        draggable={true}
        onDragStart={handleDragStart}
        on:dragover={handleDragOver}
        on:dragleave={handleDragLeave}
        on:drop={handleDrop}
        onClick={props.onOpen}
      >
        <div
          data-drop-target={isDropTarget()}
          class="relative aspect-video w-full overflow-clip rounded bg-muted flex items-center justify-center after:pointer-events-none after:absolute after:inset-0 after:rounded after:opacity-0 after:ring-2 after:ring-inset after:ring-ring after:z-10 data-[drop-target=true]:after:opacity-100"
        >
          <Icon name="folder-thumbnail" class="w-8 h-6 text-muted-foreground pointer-events-none" />
          <Show when={childCount() > 0}>
            <div class="absolute left-1 top-1 z-20 flex h-4 items-center justify-center rounded bg-overlay px-1">
              <span class="text-xxs text-primary-foreground">
                {childCount()}
              </span>
            </div>
          </Show>
        </div>
        <Show
          when={props.renaming}
          fallback={
            <div class="text-xs text-foreground truncate select-none">
              {props.folder.name}
            </div>
          }
        >
          <input
            ref={handleFocusElement}
            type="text"
            name="folder-name"
            autocomplete="off"
            value={props.folder.name}
            onKeyDown={handleRenameKeyDown}
            onBlur={(e) => commitRename(e.currentTarget.value)}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            class="text-xs text-foreground truncate bg-transparent rounded-sm outline-none ring-1 ring-primary px-0.5"
          />
        </Show>
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent class="w-[220px]">
          <ContextMenuItem onSelect={props.onOpen}>
            Open
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={props.onRenameStart}>
            Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleDelete}>
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  );
}
