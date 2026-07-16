/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createSignal, For, Show } from "solid-js";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuItemDetail,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PRESET_CATEGORIES,
} from "@/lib/layout-presets";
import { getNextName, persistWorldState, GeometryType, PaintType, createEntity, switchActiveScene, addComponent, appendChild, setComponent, resizeEntity, clearComponent } from "../engine";
import { useEngine } from "@/context/engine";
import { MAIN_CANVAS_ID } from "./canvas";
import { assert } from "@/utils";
import { getAllEntities } from "bitecs";

import type { LayoutPreset } from "@/lib/layout-presets";


const DEFAULT_NAME = "New Scene";
const DEFAULT_PRESET: LayoutPreset = { label: "Long-form 16:9", width: 1920, height: 1080 };

type DropOverlayProps = {
  onDrop(event: DragEvent): void;
  onDragOver(event: DragEvent): void;
};

export function SceneInitOverlay(props: DropOverlayProps) {
  const { world, initialized } = useEngine();
  const c = world.components;

  const [editing, setEditing] = createSignal(false);
  const [selectedPreset, setSelectedPreset] = createSignal<LayoutPreset>(DEFAULT_PRESET);
  const [sceneName, setSceneName] = createSignal(DEFAULT_NAME);

  let buttonRef: HTMLButtonElement | undefined;

  const showOverlay = createMemo(() => {
    return initialized() && world.timelineIndex().root === null && getAllEntities(world).length === 0;
  });

  const aspectRatio = () => {
    const p = selectedPreset();
    return `${p.width} / ${p.height}`;
  };

  const isVertical = () => {
    const p = selectedPreset();
    return p.width <= p.height;
  };

  const handleFocus = (e: FocusEvent) => {
    setEditing(true);
    const el = e.currentTarget as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const handleBlur = (e: FocusEvent) => {
    const el = e.currentTarget as HTMLElement;
    const text = el.textContent?.trim() || DEFAULT_NAME;
    setSceneName(text);
    el.textContent = text;
    setEditing(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    }
  };

  const handleInitializeScene = () => {
    const buttonRect = buttonRef?.getBoundingClientRect();
    if (!buttonRect) return;

    const template = selectedPreset();
    const worldX = Math.round(-template.width / 2);
    const worldY = Math.round(-template.height / 2);

    const name = sceneName() != DEFAULT_NAME
      ? sceneName()
      : getNextName(world, 'Scene');

    let sceneEntity!: number;
    world.history.untrack(() => {
      const canvas = document.getElementById(MAIN_CANVAS_ID);
      const canvasRect = canvas?.parentElement?.getBoundingClientRect();
      assert(canvasRect, 'Canvas rect not found');

      // Screen position of the button relative to the canvas container
      const screenX = buttonRect.left - canvasRect.left;
      const screenY = buttonRect.top - canvasRect.top;
      const scale = buttonRect.width / template.width;

      world.camera.a = scale;
      world.camera.b = 0;
      world.camera.c = 0;
      world.camera.d = scale;
      world.camera.e = screenX - worldX * scale;
      world.camera.f = screenY - worldY * scale;

      persistWorldState(world);

      sceneEntity = createEntity(world);
      setComponent(world, sceneEntity, c.Geometry, GeometryType.RECT);
      addComponent(world, sceneEntity, c.Scene);
      addComponent(world, sceneEntity, c.ClipsContent);
      setComponent(world, sceneEntity, c.Playback, {});
      setComponent(world, sceneEntity, c.Name, name);
      setComponent(world, sceneEntity, c.Position, { x: worldX, y: worldY });
      resizeEntity(world, sceneEntity, {
        width: template.width,
        height: template.height,
      });

      // append a solid fill to the scene
      const fillEntity = createEntity(world);
      setComponent(world, fillEntity, c.Paint, PaintType.SOLID);
      setComponent(world, fillEntity, c.Color, 0x000000);
      appendChild(world, fillEntity, sceneEntity);

      switchActiveScene(world, sceneEntity);
      clearComponent(world, c.Selected);
      addComponent(world, sceneEntity, c.Selected);
    });

    return sceneEntity;
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    props.onDrop(e);
  }

  const handleDragOver = (e: DragEvent) => {
    props.onDragOver(e);
  }

  return (
    <Show when={showOverlay()}>
      <div
        class="absolute inset-0 z-2 flex items-center justify-center"
        on:drop={handleDrop}
        on:dragover={handleDragOver}
      >
        <div
          class="relative"
          style={{
            "aspect-ratio": aspectRatio(),
            [isVertical() ? "height" : "width"]: "clamp(0px, 70%, 560px)",
          }}
        >
          <div class="absolute left-0 right-0 bottom-full mb-0.5 flex items-center justify-between">
            <div
              contentEditable
              onFocus={handleFocus}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              class="whitespace-nowrap text-xs h-4.5 font-450 flex items-center text-muted-foreground justify-center leading-none focus-ring outline-none px-0.5 rounded-sm box-content"
              classList={{ 'text-foreground': editing() }}
            >
              {sceneName() ?? DEFAULT_NAME}
            </div>
            <DropdownMenu placement="right">
              <DropdownMenuTrigger
                as="button"
                type="button"
                class="flex items-center ursor-pointer bg-transparent border-none p-0 text-xs font-450 text-muted-foreground outline-none"
              >
                <span>{selectedPreset().label}</span>
                <Icon name="chevron-down" class="size-6" />
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent class="w-60">
                  <For each={PRESET_CATEGORIES}>
                    {(category, index) => (
                      <>
                        <Show when={index() > 0}>
                          <DropdownMenuSeparator />
                        </Show>
                        <DropdownMenuGroup>
                          <DropdownMenuGroupLabel>{category.label}</DropdownMenuGroupLabel>
                          <For each={category.items}>
                            {(item) => (
                              <DropdownMenuItem onSelect={() => setSelectedPreset(item)}>
                                <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                                  {item.label}
                                </span>
                                <DropdownMenuItemDetail>
                                  {item.width}x{item.height}
                                </DropdownMenuItemDetail>
                              </DropdownMenuItem>
                            )}
                          </For>
                        </DropdownMenuGroup>
                      </>
                    )}
                  </For>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenu>
          </div>
          <button
            type="button"
            class="w-full h-full bg-accent/50 border border-border overflow-hidden flex items-center justify-center hover:bg-accent hover:border-input active:bg-muted active:border-input"
            onClick={handleInitializeScene}
            ref={buttonRef}
          >
            <Icon name="plus-add" class="size-6 text-muted-foreground" />
          </button>
        </div>

      </div>
    </Show>
  );
}
