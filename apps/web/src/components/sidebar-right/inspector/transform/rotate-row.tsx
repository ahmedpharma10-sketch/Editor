/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from 'solid-js';
import { ControlRow } from '@/components/ui/control-group';
import { Icon } from '@/components/ui/icon';
import { ControlledTextField } from '@/components/ui/text-field';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useEngine } from '@/context/engine';
import { useEntityState, setComponent } from '@/components/engine';
import { Keyframe } from '@/components/ui/keyframe';


type RotateRowProps = {
  nodeEid: number;
  onRemoveAddon(): void;
};

export function RotateRow(props: RotateRowProps) {
  const { world } = useEngine();
  const c = world.components;

  const rotation = useEntityState(c.Computed.rotation, props.nodeEid, 0);
  const flipX = useEntityState(c.Flip.x, props.nodeEid, 1);
  const flipY = useEntityState(c.Flip.y, props.nodeEid, 1);

  const isDefault = createMemo(() => (rotation() === 0 && flipX() === 1 && flipY() === 1));

  const updateRotation = (value: number) => {
    setComponent(world, props.nodeEid, c.Rotation, value);
  };

  const toggleFlipX = () => {
    setComponent(world, props.nodeEid, c.Flip, { x: flipX() === 1 ? -1 : 1 });
  };

  const toggleFlipY = () => {
    setComponent(world, props.nodeEid, c.Flip, { y: flipY() === 1 ? -1 : 1 });
  };

  const handleResetToDefault = () => {
    updateRotation(0);
    setComponent(world, props.nodeEid, c.Flip, { x: 1, y: 1 });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger<typeof ControlRow>
        as={ControlRow}
        label="Rotate"
        contentClass="flex gap-2 items-center"
      >
        <ControlledTextField
          class="flex-1"
          icon={<Icon name="rotate-angle" />}
          value={rotation()}
          onNumber={updateRotation}
          unit={'\u00B0'}
          autoSelect
          sliderEnabled
          limitEvents
          keyframe={<Keyframe target={props.nodeEid} property="rotation" />}
        />
        <div class="flex flex-1 gap-px rounded-md overflow-hidden">
          <Tooltip>
            <TooltipTrigger
              as="button"
              type="button"
              class="flex-1 h-7 bg-input flex items-center justify-center hover:bg-input/80 text-foreground"
              onClick={() => updateRotation((rotation() ?? 0) + 90)}
            >
              <Icon name="rotate-90" class="size-5" />
            </TooltipTrigger>
            <TooltipContent>Rotate 90</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              as="button"
              type="button"
              class="flex-1 h-7 bg-input flex items-center justify-center hover:bg-input/80 text-foreground"
              onClick={toggleFlipX}
            >
              <Icon name="flip-horizontal" class="size-5" />
            </TooltipTrigger>
            <TooltipContent>Flip Horizontal</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              as="button"
              type="button"
              class="flex-1 h-7 bg-input flex items-center justify-center hover:bg-input/80 text-foreground"
              onClick={toggleFlipY}
            >
              <Icon name="flip-vertical" class="size-5" />
            </TooltipTrigger>
            <TooltipContent>Flip Vertical</TooltipContent>
          </Tooltip>
        </div>
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
