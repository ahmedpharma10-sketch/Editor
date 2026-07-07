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
import { useEntityState, setComponent } from "@/components/engine";
import { Keyframe } from "@/components/ui/keyframe";


export type SkewRowProps = {
  nodeEid: number;
  onRemoveAddon(): void;
};

export function SkewRow(props: SkewRowProps) {
  const { world } = useEngine();
  const c = world.components;

  const skewX = useEntityState(c.Computed.skewX, props.nodeEid, 0);
  const skewY = useEntityState(c.Computed.skewY, props.nodeEid, 0);

  const isDefault = createMemo(() => (skewX() === 0 && skewY() === 0));

  const updateSkewX = (x: number) => {
    setComponent(world, props.nodeEid, c.Skew, { x });
  };

  const updateSkewY = (y: number) => {
    setComponent(world, props.nodeEid, c.Skew, { y });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger<typeof ControlRow>
        as={ControlRow}
        label="Skew"
        contentClass="grid grid-cols-2 gap-2"
      >
        <ControlledTextField
          icon={<Icon name="prop-x-position" />}
          value={skewX()}
          onNumber={updateSkewX}
          step={1}
          unit="°"
          autoSelect
          sliderEnabled
          limitEvents
          keyframe={<Keyframe target={props.nodeEid} property="skew.x" />}
        />
        <ControlledTextField
          icon={<Icon name="prop-y-position" />}
          value={skewY()}
          onNumber={updateSkewY}
          step={1}
          unit="°"
          autoSelect
          sliderEnabled
          limitEvents
          keyframe={<Keyframe target={props.nodeEid} property="skew.y" />}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={isDefault()}
          onSelect={() => {
            updateSkewX(0);
            updateSkewY(0);
          }}
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
