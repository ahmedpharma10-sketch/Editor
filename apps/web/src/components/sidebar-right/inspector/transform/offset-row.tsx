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
import { useEngine } from "@/context/engine";
import { useEntityState, addComponent, setComponent } from "@/components/engine";
import { Keyframe } from "@/components/ui/keyframe-bitecs";


export type OffsetRowProps = {
  nodeEid: number;
  onRemoveAddon(): void;
};

export function OffsetRow(props: OffsetRowProps) {
  const { world } = useEngine();
  const c = world.components;

  const offsetX = useEntityState(c.Computed.offsetX, props.nodeEid, 0);
  const offsetY = useEntityState(c.Computed.offsetY, props.nodeEid, 0);

  const isDefault = createMemo(() => (offsetX() === 0 && offsetY() === 0));

  const updateOffsetX = (x: number) => {
    addComponent(world, props.nodeEid, c.Offset);
    setComponent(world, props.nodeEid, c.Offset, { x });
  };

  const updateOffsetY = (y: number) => {
    addComponent(world, props.nodeEid, c.Offset);
    setComponent(world, props.nodeEid, c.Offset, { y });
  };

  const handleResetToDefault = () => {
    updateOffsetX(0);
    updateOffsetY(0);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger<typeof ControlRow>
        as={ControlRow}
        label="Offset"
        contentClass="grid grid-cols-2 gap-2"
      >
        <ControlledTextField
          icon={<Icon name="prop-x-position" />}
          value={offsetX()}
          onNumber={updateOffsetX}
          step={1}
          autoSelect
          sliderEnabled
          keyframe={<Keyframe target={props.nodeEid} property="offset.x" />}
        />
        <ControlledTextField
          icon={<Icon name="prop-y-position" />}
          value={offsetY()}
          onNumber={updateOffsetY}
          step={1}
          autoSelect
          sliderEnabled
          keyframe={<Keyframe target={props.nodeEid} property="offset.y" />}
        />
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
