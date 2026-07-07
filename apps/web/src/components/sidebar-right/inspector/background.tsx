/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ControlRow } from "@/components/ui/control-group";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorTitle,
} from "@/components/ui/floating-inspector";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { ColorOpacityPicker } from "@/components/ui/color-opacity-picker";
import { ColorOpacityRow } from "@/components/ui/color-opacity-row";
import { useEngine } from "@/context/engine";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createSignal } from "solid-js";
import { DEFAULT_BACKGROUND, persistWorldState, useWorldState } from "@/components/engine";

export function BackgroundSettings() {
  const { world } = useEngine();

  const [isPickerOpen, setIsPickerOpen] = createSignal(false);
  const color = useWorldState(w => w.background, DEFAULT_BACKGROUND);


  let anchorRef: HTMLDivElement | undefined;

  const assignColor = (next: number) => {
    world.background = next;
    persistWorldState(world);
  };

  return (
    <PanelSection title="Background" ref={anchorRef}>
      <ControlRow label="Color">
        <ColorOpacityRow
          color={color()}
          onChangeColor={assignColor}
          onClick={() => setIsPickerOpen(true)}
        />
      </ControlRow>

      <FloatingInspector
        open={isPickerOpen}
        anchorRef={anchorRef}
      >
        <FloatingInspectorHeader>
          <FloatingInspectorTitle>Color</FloatingInspectorTitle>
          <div class="ml-auto">
            <Tooltip>
              <TooltipTrigger
                as={Button}
                size="icon"
                variant="ghost"
                class="text-muted-foreground"
                onClick={() => setIsPickerOpen(false)}
              >
                <Icon name="close-remove" class="size-6" />
              </TooltipTrigger>
              <TooltipContent>Close</TooltipContent>
            </Tooltip>
          </div>
        </FloatingInspectorHeader>
        <FloatingInspectorContent class="p-0">
          <ColorOpacityPicker
            color={color()}
            opacity={1}
            onColorChange={assignColor}
            onBeginChange={(label) => world.history.startTransaction(label)}
            onEndChange={() => world.history.commitTransaction()}
            withoutOpacity
          />
        </FloatingInspectorContent>
      </FloatingInspector>
    </PanelSection>
  );
}
