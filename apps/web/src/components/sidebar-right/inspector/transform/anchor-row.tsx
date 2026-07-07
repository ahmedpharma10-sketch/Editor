/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { ControlledTextField } from "@/components/ui/text-field";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { AnchorPointPicker } from "./anchor-picker";
import { useEngine } from "@/context/engine";
import { useEntityState, setComponent } from "@/components/engine";


export type AnchorRowProps = {
  nodeEid: number;
  onRemoveAddon(): void;
};

export function AnchorRow(props: AnchorRowProps) {
  const { world } = useEngine();
  const c = world.components;

  const anchorX = useEntityState(c.Anchor.x, props.nodeEid, 0.5);
  const anchorY = useEntityState(c.Anchor.y, props.nodeEid, 0.5);

  const isDefault = createMemo(() => (anchorX() === 0.5 && anchorY() === 0.5));

  const assignAnchor = (x: number | undefined, y: number | undefined) => {
    setComponent(world, props.nodeEid, c.Anchor, { x, y });
  };

  const handleResetToDefault = () => assignAnchor(0.5, 0.5);

  return (
    <ContextMenu>
      <ContextMenuTrigger<typeof ControlRow>
        as={ControlRow}
        label="Anchor"
        class="items-start"
        labelClass="pt-1.5"
        contentClass="flex gap-2 items-center"
      >
        <div class="flex flex-col gap-2 flex-1 min-w-0">
          <ControlledTextField
            icon={<Icon name="prop-x-position" />}
            value={Math.round(anchorX() * 100)}
            onNumber={(value) => assignAnchor(value / 100, undefined)}
            step={1}
            unit="%"
            autoSelect
            sliderEnabled
          />
          <ControlledTextField
            icon={<Icon name="prop-y-position" />}
            value={Math.round(anchorY() * 100)}
            onNumber={(value) => assignAnchor(undefined, value / 100)}
            step={1}
            unit="%"
            autoSelect
            sliderEnabled
          />
        </div>
        <AnchorPointPicker nodeEid={props.nodeEid} />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={isDefault()}
          onSelect={handleResetToDefault}
        >
          Reset to Default
        </ContextMenuItem>
        <ContextMenuItem onSelect={props.onRemoveAddon}>
          Remove row
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
