/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ControlRow } from "@/components/ui/control-group";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Select,
  SelectContent,
  SelectIconTrigger,
  SelectItem,
  SelectPortal,
} from "@/components/ui/select";
import { SliderInput } from "@/components/ui/slider-input";
import { ControlledTextField } from "@/components/ui/text-field";
import { PanelSection } from "@/components/ui/panel-section";
import { Show, createMemo, createSignal } from "solid-js";
import { Icon } from "@/components/ui/icon";
import { SegmentedIconTabs } from "@/components/ui/segmented-icon-tabs";
import { useEntityState, useEntityTag, BlendMode, isRect, addComponent, removeComponent, setComponent, isAudio, removeKeyframeTrack } from "@/components/engine";
import { useEngine } from "@/context/engine";
import { Keyframe } from "@/components/ui/keyframe";
import { hasComponent } from 'bitecs';
import { BLEND_MODE_ORDER, BLEND_MODE_SEPARATORS } from "./blend-mode-menu";

type AppearanceSettingsProps = {
  selection: Set<number>;
};

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function displayBlendMode(mode: string) {
  if (mode === String(BlendMode.SOURCE_OVER)) return "Normal";

  return capitalize(mode.replace("_", " "));
};

function round(v: number) {
  return Math.round(v * 100) / 100;
}

type RadiusMode = 'uniform' | 'separate';

const RADIUS_MODE_ITEMS = [
  {
    value: 'uniform' as RadiusMode,
    label: 'Uniform radius',
    icon: 'corner-radius-all-single',
  },
  {
    value: 'separate' as RadiusMode,
    label: 'Separate corner radii',
    icon: 'corner-radius-all-separate',
  },
] as const;

export function AppearanceSettings(props: AppearanceSettingsProps) {
  const { world } = useEngine();
  const c = world.components;
  const eid = () => props.selection.values().next().value!;

  const opacity = useEntityState(c.Computed.opacity, eid, 1);
  const blendMode = useEntityState(c.Appearance.blendMode, eid, 0);
  const hidden = useEntityTag(c.Hidden, eid);

  const vertexRadius = useEntityState(c.Computed.cornerRadius, eid, 0);
  const mixedTL = useEntityState(c.Computed.cornerRadiusTopLeft, eid, 0);
  const mixedTR = useEntityState(c.Computed.cornerRadiusTopRight, eid, 0);
  const mixedBR = useEntityState(c.Computed.cornerRadiusBottomRight, eid, 0);
  const mixedBL = useEntityState(c.Computed.cornerRadiusBottomLeft, eid, 0);

  const hasMixed = hasComponent(world, eid(), c.MixedCornerRadius);

  const [selectedBlendMode, setSelectedBlendMode] = createSignal(blendMode());
  const [radiusMode, setRadiusMode] = createSignal<RadiusMode>(hasMixed ? 'separate' : 'uniform');

  const handleOpacityChange = (v: number) => {
    setComponent(world, eid(), c.Appearance, { opacity: Math.round(v) / 100 });
  };

  const handleBlendModePointerEnter = (mode: number) => (c.Appearance.blendMode[eid()] = mode);

  const handleBlendModeSelect = (mode: number | null) => {
    if (mode === null) return;

    setSelectedBlendMode(mode);

    if (mode === blendMode()) return;

    setComponent(world, eid(), c.Appearance, { blendMode: mode });
  };

  const handleBlendModeOpenChange = (isOpen: boolean) => {
    if (isOpen) return;

    // Reset blend mode if it has not been changed.
    if (selectedBlendMode() !== blendMode()) {
      handleBlendModePointerEnter(selectedBlendMode());
    }
  };

  const handleVisibilityChange = () => {
    if (!hasComponent(world, eid(), c.Hidden)) {
      addComponent(world, eid(), c.Hidden);
    } else {
      removeComponent(world, eid(), c.Hidden);
    }
  }

  // Radius helpers
  const isRadiusDefault = createMemo(() => {
    if (radiusMode() === 'separate') {
      return mixedTL() === 0 && mixedTR() === 0 && mixedBR() === 0 && mixedBL() === 0;
    }
    return vertexRadius() === 0;
  });

  const handleUniformRadiusChange = (v: number) => {
    removeKeyframeTrack(world, eid(), 'mixedVertexRadius.topLeft');
    removeKeyframeTrack(world, eid(), 'mixedVertexRadius.topRight');
    removeKeyframeTrack(world, eid(), 'mixedVertexRadius.bottomRight');
    removeKeyframeTrack(world, eid(), 'mixedVertexRadius.bottomLeft');
    removeComponent(world, eid(), c.MixedCornerRadius);
    setComponent(world, eid(), c.CornerRadius, v);

    setRadiusMode('uniform');
  };

  const handleSeparateRadiusChange = (corner: 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft', v: number) => {
    removeKeyframeTrack(world, eid(), 'vertexRadius');
    setComponent(world, eid(), c.MixedCornerRadius, { [corner]: v });
  };

  const handleRadiusModeChange = (value: RadiusMode) => {
    setRadiusMode(value);
    if (value === 'separate') {
      const r = vertexRadius();
      removeKeyframeTrack(world, eid(), 'vertexRadius');
      removeComponent(world, eid(), c.CornerRadius);
      setComponent(world, eid(), c.MixedCornerRadius, {
        topLeft: r,
        topRight: r,
        bottomRight: r,
        bottomLeft: r,
      });
    } else {
      const avg = mixedTL();
      removeKeyframeTrack(world, eid(), 'mixedVertexRadius.topLeft');
      removeKeyframeTrack(world, eid(), 'mixedVertexRadius.topRight');
      removeKeyframeTrack(world, eid(), 'mixedVertexRadius.bottomRight');
      removeKeyframeTrack(world, eid(), 'mixedVertexRadius.bottomLeft');
      removeComponent(world, eid(), c.MixedCornerRadius);
      setComponent(world, eid(), c.CornerRadius, avg);
    }
  };

  return (
    <PanelSection
      title="Appearance"
      actions={
        <Tooltip>
          <TooltipTrigger
            as={Button}
            size="icon"
            variant="ghost"
            class="text-muted-foreground"
            onClick={handleVisibilityChange}
          >
            <Show when={!hidden()} fallback={<Icon name="eye-off" />}>
              <Icon name="eye-on" />
            </Show>
          </TooltipTrigger>
          <TooltipContent>{hidden() ? "Show" : "Hide"}</TooltipContent>
        </Tooltip>
      }
    >
      <ControlRow label="Opacity">
        <div class="flex gap-2 items-center">
          <SliderInput
            value={Math.round(opacity() * 100)}
            onChange={handleOpacityChange}
            format={(v) => `${v}%`}
            keyframe={<Keyframe target={eid()} property="opacity" />}
          />
        </div>
      </ControlRow>

      <ControlRow label="Blending">
        <div>
          <Select
            value={selectedBlendMode()}
            onChange={(value) => handleBlendModeSelect(value)}
            onOpenChange={handleBlendModeOpenChange}
            options={BLEND_MODE_ORDER}
            itemComponent={(itemProps) => (
              <>
                <Show when={BLEND_MODE_SEPARATORS.has(itemProps.item.rawValue)}>
                  <hr class="bg-border h-px w-full border-0" />
                </Show>
                <SelectItem
                  item={itemProps.item}
                  onPointerEnter={() => handleBlendModePointerEnter(itemProps.item.rawValue)}
                >
                  {displayBlendMode(BlendMode[itemProps.item.rawValue])}
                </SelectItem>
              </>
            )}
          >
            <SelectIconTrigger
              icon={<Icon name="blending-mode-default" class="size-5" />}
              valueClass="text-xxs flex-1"
            >
              {displayBlendMode(BlendMode[selectedBlendMode()])}
            </SelectIconTrigger>
            <SelectPortal>
              <SelectContent class="w-44 overscroll-contain" />
            </SelectPortal>
          </Select>
        </div>
      </ControlRow>

      <Show when={isRect(world, eid()) && !isAudio(world, eid())}>
        <ContextMenu>
          <ContextMenuTrigger<typeof ControlRow>
            as={ControlRow}
            label="Radius"
            contentClass="grid grid-cols-2 gap-2"
          >
            <ControlledTextField
              value={radiusMode() === 'separate' ? 'Mixed' : round(vertexRadius())}
              autoSelect
              step={1}
              min={0}
              onNumber={handleUniformRadiusChange}
              icon={<Icon name="corner-radius-all" />}
              sliderEnabled
              limitEvents
              keyframe={<Keyframe target={eid()} property="vertexRadius" />}
            />
            <SegmentedIconTabs
              value={() => radiusMode()}
              onChange={handleRadiusModeChange}
              items={RADIUS_MODE_ITEMS}
            />
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              disabled={isRadiusDefault()}
              onSelect={() => handleUniformRadiusChange(0)}
            >
              Reset to Default
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        <Show when={radiusMode() === 'separate'}>
          <ControlRow label="" contentClass="grid grid-cols-2 gap-2">
            <ControlledTextField
              icon={<Icon name="corner-radius-top-left" />}
              value={round(mixedTL())}
              autoSelect
              step={1}
              min={0}
              onNumber={(v) => handleSeparateRadiusChange('topLeft', v)}
              sliderEnabled
              limitEvents
              keyframe={<Keyframe target={eid()} property="mixedVertexRadius.topLeft" />}
            />
            <ControlledTextField
              icon={<Icon name="corner-radius-top-right" />}
              value={round(mixedTR())}
              autoSelect
              step={1}
              min={0}
              onNumber={(v) => handleSeparateRadiusChange('topRight', v)}
              sliderEnabled
              limitEvents
              keyframe={<Keyframe target={eid()} property="mixedVertexRadius.topRight" />}
            />
            <ControlledTextField
              icon={<Icon name="corner-radius-bottom-left" />}
              value={round(mixedBL())}
              autoSelect
              step={1}
              min={0}
              onNumber={(v) => handleSeparateRadiusChange('bottomLeft', v)}
              sliderEnabled
              limitEvents
              keyframe={<Keyframe target={eid()} property="mixedVertexRadius.bottomLeft" />}
            />
            <ControlledTextField
              icon={<Icon name="corner-radius-bottom-right" />}
              value={round(mixedBR())}
              autoSelect
              step={1}
              min={0}
              onNumber={(v) => handleSeparateRadiusChange('bottomRight', v)}
              sliderEnabled
              limitEvents
              keyframe={<Keyframe target={eid()} property="mixedVertexRadius.bottomRight" />}
            />
          </ControlRow>
        </Show>
      </Show>
    </PanelSection>
  );
}
