/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createSignal, For, Show } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorTitle,
} from "@/components/ui/floating-inspector";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ColorOpacityRow } from "@/components/ui/color-opacity-row";
import { ColorOpacityPicker } from "@/components/ui/color-opacity-picker";
import { CaptionType, useEntityState, ChildOf, deleteEntity, type EngineWorld, setComponent } from "../../engine";
import { useEngine } from "@/context/engine";
import { query } from 'bitecs';

type CaptionSettingsProps = {
  selection: Set<number>;
};

type CaptionColorSlot = {
  label: string;
  defaultColor: number;
};

type CaptionPreset = {
  value: CaptionType;
  label: string;
  slots: CaptionColorSlot[];
};

const CAPTION_PRESETS: CaptionPreset[] = [
  {
    value: CaptionType.CLASSIC,
    label: "Classic",
    slots: [],
  },
  {
    value: CaptionType.CASCADE,
    label: "Cascade",
    slots: [],
  },
  {
    value: CaptionType.SPOTLIGHT,
    label: "Spotlight",
    slots: [
      { label: 'Highlight', defaultColor: 0x24D5FF }
    ],
  },
  {
    value: CaptionType.WHISPER,
    label: "Whisper",
    slots: [],
  },
  {
    value: CaptionType.PAPER,
    label: "Paper",
    slots: []
  },
  {
    value: CaptionType.GUINEA,
    label: "Guinea",
    slots: [
      { label: 'Color 1', defaultColor: 0xF55353 },
      { label: 'Color 2', defaultColor: 0xFEB139 },
      { label: 'Color 3', defaultColor: 0xF6F54D },
    ],
  },
  {
    value: CaptionType.STARK,
    label: "Stark",
    slots: [],
  },
];

export function CaptionSettings(props: CaptionSettingsProps) {
  const { world } = useEngine();
  const c = world.components;

  const eid = () => props.selection.values().next().value!;
  const type = useEntityState<CaptionType>(c.Caption.type, eid, CaptionType.CLASSIC);
  const colors = useEntityState<number[]>(c.Caption.colors, eid, []);

  let anchorRef!: HTMLDivElement;

  const currentPreset = createMemo(
    () => CAPTION_PRESETS.find((p) => p.value === type()) ?? CAPTION_PRESETS[0]
  );

  const slots = createMemo(
    () => CAPTION_PRESETS.find((p) => p.value === type())?.slots ?? []
  );

  const [openSlot, setOpenSlot] = createSignal<number | null>(null);

  const handlePresetChange = (preset: CaptionPreset | null) => {
    if (!preset) return;

    clearText(world, eid());
    setOpenSlot(null);
    setComponent(world, eid(), c.Caption, { type: preset.value });
  };

  const getSlotColor = (index: number | null) => {
    const current = colors();
    const slot = slots()[index ?? 0];
    return current[index ?? 0] ?? slot.defaultColor;
  };

  const setSlotColor = (index: number | null, next: number) => {
    if (index === null) return;
    const max = slots().length;
    const current = colors();
    const nextColors = new Array<number>(max);
    for (let i = 0; i < max; i++) {
      nextColors[i] = current[i] ?? slots()[i].defaultColor;
    }
    nextColors[index] = next;
    setComponent(world, eid(), c.Caption, { colors: nextColors });
  };

  return (
    <PanelSection title="Caption" ref={anchorRef}>
      <ControlRow label="Preset">
        <Select<CaptionPreset>
          value={currentPreset()}
          onChange={handlePresetChange}
          options={CAPTION_PRESETS}
          optionValue="value"
          optionTextValue="label"
          itemComponent={(itemProps) => (
            <SelectItem item={itemProps.item}>
              {itemProps.item.rawValue.label}
            </SelectItem>
          )}
        >
          <SelectTrigger class="pl-1 gap-2">
            <div class="text-foreground size-5 rounded-sm flex items-center justify-center bg-primary overflow-clip shrink-0">
              <Icon name="captions" class="text-foreground" />
            </div>
            <SelectValue<CaptionPreset> class="text-xs">
              {(state) => state.selectedOption()?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectContent />
          </SelectPortal>
        </Select>
      </ControlRow>

      <For each={slots()}>
        {(slot, index) => (
          <ControlRow label={slot.label}>
            <ColorOpacityRow
              color={getSlotColor(index())}
              onChangeColor={(next) => setSlotColor(index(), next)}
              onClick={() =>
                setOpenSlot(openSlot() === index() ? null : index())
              }
            />
          </ControlRow>
        )}
      </For>

      <Show when={openSlot() !== null}>
        <FloatingInspector
          open={() => openSlot() !== null}
          anchorRef={anchorRef}
        >
          <FloatingInspectorHeader>
            <FloatingInspectorTitle>
              {slots()[openSlot() as number]?.label ?? "Color"}
            </FloatingInspectorTitle>
            <div class="ml-auto">
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  size="icon"
                  variant="ghost"
                  class="text-muted-foreground"
                  onClick={() => setOpenSlot(null)}
                >
                  <Icon name="close-remove" class="size-6" />
                </TooltipTrigger>
                <TooltipContent>Close</TooltipContent>
              </Tooltip>
            </div>
          </FloatingInspectorHeader>
          <FloatingInspectorContent class="p-0">
            <ColorOpacityPicker
              color={getSlotColor(openSlot())}
              opacity={1}
              onColorChange={(next) => setSlotColor(openSlot(), next)}
              onBeginChange={(label) => world.history.startTransaction(label)}
              onEndChange={() => world.history.commitTransaction()}
              withoutOpacity
            />
          </FloatingInspectorContent>
        </FloatingInspector>
      </Show>
    </PanelSection>
  );
}

export function clearText(world: EngineWorld, parentEid: number) {
  const c = world.components;

  for (const rid of query(world, [ChildOf(parentEid)])) {
    deleteEntity(world, rid);
  }

  c.Cache.textRanges[parentEid] = [];
  c.Caption.colors[parentEid] = [];
}
