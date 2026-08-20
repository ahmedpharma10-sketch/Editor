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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorTitle,
} from "@/components/ui/floating-inspector";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SegmentedIconTabs } from "@/components/ui/segmented-icon-tabs";
import { ColorOpacityRow } from "@/components/ui/color-opacity-row";
import { ColorOpacityPicker } from "@/components/ui/color-opacity-picker";
import { useTrait } from "@diffusionstudio/koota-solid";
import { Caption, CaptionAlign, colorToHex } from "@diffusionstudio/runtime";
import { useEditor } from "@/engine/hooks";
import {
  CAPTION_PRESET_OPTIONS,
  DEFAULT_CAPTION_PRESET,
  captionPresetOption,
} from "./caption-types";

import type { CaptionPresetOption } from "./caption-types";
import type { Entity } from "koota";

type CaptionSettingsProps = {
  selection: Entity[];
};

const VERTICAL_ALIGN_TABS = [
  { value: 'top', label: 'Align top', icon: 'vertical-align-top' },
  { value: 'center', label: 'Align center', icon: 'vertical-align-center' },
  { value: 'bottom', label: 'Align bottom', icon: 'vertical-align-bottom' },
];

/** The prop's spelling for a `CaptionAlign`, for the tabs to compare against. */
const ALIGN_NAMES: Record<CaptionAlign, string> = {
  [CaptionAlign.TOP]: 'top',
  [CaptionAlign.CENTER]: 'center',
  [CaptionAlign.BOTTOM]: 'bottom',
};

/**
 * What a `<captions>` element says for itself: which preset draws it
 * (`preset`), the colors filling that preset's slots (`colors`) and where the
 * block sits (`verticalAlign`). Everything else about a caption's look — the
 * font, the box, the paints and shadows it is drawn with — is the preset's,
 * authored onto the entity by its decoder and not in the file at all, which
 * is why this panel is as short as it is.
 */
export function CaptionSettings(props: CaptionSettingsProps) {
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  let anchorRef!: HTMLDivElement;

  const caption = useTrait(entity, Caption);
  const preset = createMemo(() => captionPresetOption(caption()?.type));
  const slots = () => preset().slots;
  const colors = () => caption()?.colors ?? [];
  const align = () => caption()?.verticalAlign;
  // No tab is active while the placement is the preset's own, which is not one
  // of the three the prop can say.
  const alignName = () => {
    const current = align();
    return current === undefined ? '' : ALIGN_NAMES[current];
  };

  const [openSlot, setOpenSlot] = createSignal<number | null>(null);

  const handlePresetChange = (next: CaptionPresetOption | null) => {
    if (!next || next === preset()) return;

    setOpenSlot(null);
    // The slots belong to the preset, so the colors filling them go with it.
    editor.editProperty(entity(), "colors", false);
    editor.editProperty(
      entity(),
      "preset",
      next === DEFAULT_CAPTION_PRESET ? false : next.name,
    );
  };

  /** A slot the file has not filled shows what the preset's decoder falls back to. */
  const slotColor = (index: number) => colors()[index] ?? slots()[index]?.defaultColor ?? 0;

  /**
   * `colors` is positional, so setting one slot spells every slot the preset
   * has: a sparse write would read back as the ones before it.
   */
  const setSlotColor = (index: number, next: number) => {
    const values = slots().map((_, i) => colorToHex(i === index ? next : slotColor(i)));
    editor.editProperty(entity(), "colors", values);
  };

  const handleAlignChange = (name: string) => {
    editor.editProperty(entity(), "verticalAlign", name);
  };

  return (
    <PanelSection title="Caption" ref={anchorRef}>
      <ControlRow label="Preset">
        <Select<CaptionPresetOption>
          value={preset()}
          onChange={handlePresetChange}
          options={CAPTION_PRESET_OPTIONS}
          optionValue="name"
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
            <SelectValue<CaptionPresetOption> class="text-xs">
              {(state) => state.selectedOption()?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectContent />
          </SelectPortal>
        </Select>
      </ControlRow>

      <ContextMenu>
        <ContextMenuTrigger<typeof ControlRow> as={ControlRow} label="Align">
          <SegmentedIconTabs
            value={alignName}
            onChange={handleAlignChange}
            items={VERTICAL_ALIGN_TABS}
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            disabled={align() === undefined}
            onSelect={() => editor.editProperty(entity(), "verticalAlign", false)}
          >
            Reset to Default
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <For each={slots()}>
        {(slot, index) => (
          <ControlRow label={slot.label}>
            <ColorOpacityRow
              color={slotColor(index())}
              onChangeColor={(next) => setSlotColor(index(), next)}
              onClick={() => setOpenSlot(openSlot() === index() ? null : index())}
            />
          </ControlRow>
        )}
      </For>

      <Show when={openSlot() !== null}>
        <FloatingInspector open anchorRef={anchorRef}>
          <FloatingInspectorHeader>
            <FloatingInspectorTitle>
              {slots()[openSlot()!]?.label ?? "Color"}
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
              color={slotColor(openSlot()!)}
              opacity={1}
              onColorChange={(next) => setSlotColor(openSlot()!, next)}
              withoutOpacity
            />
          </FloatingInspectorContent>
        </FloatingInspector>
      </Show>
    </PanelSection>
  );
}
