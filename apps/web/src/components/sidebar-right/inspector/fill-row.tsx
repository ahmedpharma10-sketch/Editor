/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { FillItem } from "@/components/ui/fill-item";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { PaintType, useEntityState, useEntityTag, addComponent, removeComponent } from "@/components/engine";
import { useEngine } from "@/context/engine";
import { hasComponent } from 'bitecs';

type FillRowProps = {
  nodeEid: number;
  fillEid: number;
  onSelect(): void;
  onRemove(): void;
  onMoveUp?(): void;
  onMoveDown?(): void;
};

const FILL_TYPE_LABELS: Record<PaintType, string> = {
  [PaintType.SOLID]: 'Solid',
  [PaintType.IMAGE]: 'Image',
  [PaintType.VIDEO]: 'Video',
  [PaintType.SEQUENCE]: 'Sequence',
  [PaintType.LINEAR_GRADIENT]: 'Gradient',
  [PaintType.RADIAL_GRADIENT]: 'Gradient',
  [PaintType.WAVEFORM]: 'Waveform',
  [PaintType.HTML]: 'Html',
  [PaintType.SURFACE]: 'Surface',
  [PaintType.SHADER]: 'Shader',
};

export function FillRow(props: FillRowProps) {
  const { world } = useEngine();
  const c = world.components;

  const fillType = useEntityState(c.Paint, props.fillEid, PaintType.SOLID);
  const hidden = useEntityTag(c.Hidden, () => props.fillEid);

  const label = createMemo(() => (FILL_TYPE_LABELS[fillType() as PaintType] ?? 'Solid'));
  const toggleHidden = () => {
    if (hasComponent(world, props.fillEid, c.Hidden)) {
      removeComponent(world, props.fillEid, c.Hidden);
    } else {
      addComponent(world, props.fillEid, c.Hidden);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger<typeof ControlRow>
        as={ControlRow}
        label={label()}
        class={hidden() ? "opacity-50" : undefined}
      >
        <FillItem
          nodeEid={props.nodeEid}
          fillEid={props.fillEid}
          onClick={props.onSelect}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={props.onMoveUp}>
          Move Up
        </ContextMenuItem>
        <ContextMenuItem onSelect={props.onMoveDown}>
          Move Down
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={toggleHidden}>
          {hidden() ? "Unhide" : "Hide"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={props.onRemove}>
          Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
