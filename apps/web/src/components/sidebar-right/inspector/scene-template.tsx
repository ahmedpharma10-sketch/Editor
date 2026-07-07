/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createSignal } from "solid-js";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { useEngine } from "@/context/engine";
import { PaintType, GeometryType, ToolType, createEntity, switchActiveScene, addComponent, appendChild, setComponent, resizeEntity } from "@/components/engine";
import { screenToWorld } from "@/components/engine";
import { getNextName } from "@/components/engine";

import { PRESET_CATEGORIES, type LayoutPresetCategory, type LayoutPreset } from "@/lib/layout-presets";


export function SceneTemplatePanel() {
  const { world } = useEngine();
  const c = world.components;

  const createScene = (preset: LayoutPreset) => {
    // Place scene near center of viewport
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const worldCenter = screenToWorld(world, centerX, centerY);
    const sceneName = getNextName(world, "Scene");
    const sceneX = Math.round(worldCenter.x - preset.width / 2);
    const sceneY = Math.round(worldCenter.y - preset.height / 2);

    const eid = world.history.transaction('Add scene', () => {
      const sceneEid = createEntity(world);
      setComponent(world, sceneEid, c.Geometry, GeometryType.RECT);
      addComponent(world, sceneEid, c.Scene);
      addComponent(world, sceneEid, c.ClipsContent);
      setComponent(world, sceneEid, c.Playback, {});
      setComponent(world, sceneEid, c.Name, sceneName);
      setComponent(world, sceneEid, c.Position, { x: sceneX, y: sceneY });
      resizeEntity(world, sceneEid, { width: preset.width, height: preset.height });

      const fillEid = createEntity(world);
      setComponent(world, fillEid, c.Paint, PaintType.SOLID);
      setComponent(world, fillEid, c.Color, 0x000000);
      appendChild(world, fillEid, sceneEid);
      return sceneEid;
    });

    switchActiveScene(world, eid);
    world.selection.tool = ToolType.MOVE;
  };

  return (
    <PanelSection title="Scene" class="px-0 pt-0 pb-0 gap-0">
      <For each={PRESET_CATEGORIES}>
        {(category) => <PresetGroup category={category} onSelect={createScene} />}
      </For>
    </PanelSection>
  );
}

type PresetGroupProps = {
  category: LayoutPresetCategory;
  onSelect: (preset: LayoutPreset) => void;
};

function PresetGroup(props: PresetGroupProps) {
  const [open, setOpen] = createSignal(true);

  return (
    <div class="flex flex-col w-full">
      <button
        class="flex items-center text-muted-foreground h-8 w-full px-4 hover:bg-muted/50 transition-transform"
        onClick={() => setOpen(!open())}
      >
        <div classList={{ "-rotate-90": !open() }} class="flex items-center justify-center size-4 overflow-clip">
          <Icon name="chevron-down" class="min-h-6 min-w-6" />
        </div>
        <div class="flex items-center justify-center size-4 overflow-clip ml-0.5">
          <Icon name={props.category.icon} class="min-h-6 min-w-6" />
        </div>
        <span class="text-xs truncate ml-1.5">
          {props.category.label}
        </span>
      </button>
      <Show when={open()}>
        <For each={props.category.items}>
          {(preset) => (
            <button
              class="flex items-center gap-1 h-8 w-full pl-2 pr-4 hover:bg-muted/50"
              onClick={() => props.onSelect(preset)}
            >
              <div class="size-6 shrink-0" />
              <span class="flex-1 text-[11px] text-muted-foreground truncate text-left">
                {preset.label}
              </span>
              <span class="text-[11px] text-muted-foreground/55 shrink-0">
                {preset.width}&times;{preset.height}
              </span>
            </button>
          )}
        </For>
      </Show>
    </div>
  );
}
