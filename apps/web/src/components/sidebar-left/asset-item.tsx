/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, onMount, onCleanup, Show, createMemo } from "solid-js";
import { toast } from "somoto";
import { downloadAsset } from "@/components/assets/actions";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { AssetThumbnail } from "../ui/asset-thumbnail";
import { formatAssetDuration } from "@/utils";
import { useEngine } from "@/context/engine";
import { insertAssetInTimeline, replaceAssetHandle, removeAsset, saveAsset } from "@/components/engine";

import type { Asset } from "@/components/engine/db";


export type LazyAssetItemProps = {
  asset: Asset;
  selected: boolean;
  onSelect(): void;
};

/**
 * A lazy loaded asset item. Clears the buffer when not visible.
 */
export function LazyAssetItem(props: LazyAssetItemProps) {
  const { world } = useEngine();

  const [isVisible, setIsVisible] = createSignal(false);
  const [isRenaming, setIsRenaming] = createSignal(false);
  const assetDuration = createMemo(() => formatAssetDuration(props.asset));

  let ref: HTMLDivElement | undefined;

  onMount(() => {
    if (!ref) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { rootMargin: "100px" }
    );

    observer.observe(ref);
    onCleanup(() => observer.disconnect());
  });

  const handleDeleteAsset = async () => {
    try {
      await removeAsset(world, props.asset.id);
    } catch (e) {
      toast.error("Failed to delete", { description: (e as Error).message });
    }
  };

  const handleDragStart = (event: DragEvent) => {
    event.dataTransfer?.setData("application/x-asset-id", props.asset.id);
  };

  const handleRename = () => {
    setIsRenaming(true);
  };

  const commitRename = async (nextName: string) => {
    if (!isRenaming()) return;
    setIsRenaming(false);
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === props.asset.name) return;
    try {
      await saveAsset(world, { ...props.asset, name: trimmed });
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
      setIsRenaming(false);
    }
  };

  const handleFocusElement = (el: HTMLInputElement) => {
    queueMicrotask(() => {
      el.focus();
      el.select();
    });
  };

  const handleDownloadMedia = () => downloadAsset(props.asset);
  const handleReplaceMedia = () => replaceAssetHandle(world, props.asset);
  const handleInsertToTimeline = () => insertAssetInTimeline(world, props.asset, 'playhead');

  return (
    <ContextMenu>
      <ContextMenuTrigger
        as="div"
        class="flex flex-col gap-1 text-left"
        data-asset-id={props.asset.id}
        draggable={true}
        onDragStart={handleDragStart}
        onClick={props.onSelect}
        onContextMenu={props.onSelect}>
        <div
          ref={ref}
          data-selected={props.selected}
          class="relative aspect-video w-full overflow-clip rounded bg-muted after:pointer-events-none after:absolute after:inset-0 after:rounded after:opacity-0 after:ring-2 after:ring-inset after:ring-ring after:z-10 data-[selected=true]:after:opacity-100"
        >
          <Show when={isVisible()}>
            <AssetThumbnail asset={props.asset} class="h-full w-full" />
          </Show>
          <Show when={assetDuration()}>
            {(duration) => (
              <div class="absolute left-1 top-1 z-20 flex h-4 items-center justify-center rounded bg-overlay px-1">
                <span class="text-xxs text-primary-foreground">
                  {duration()}
                </span>
              </div>
            )}
          </Show>
        </div>
        <Show
          when={isRenaming()}
          fallback={
            <div class="text-xs text-foreground truncate select-none">
              {props.asset.name}
            </div>
          }
        >
          <input
            ref={handleFocusElement}
            type="text"
            name="asset-name"
            autocomplete="off"
            value={props.asset.name}
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
        <ContextMenuContent class="w-[180px]">
          <ContextMenuItem onSelect={handleInsertToTimeline}>
            Insert at playhead
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleRename}>
            Rename
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleReplaceMedia}>
            Replace
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleDownloadMedia}>
            Download
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleDeleteAsset}>
            Delete
            <ContextMenuShortcut>⌫</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  );
}
