/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, For, Show } from 'solid-js';
import { Icon } from '@/components/ui/icon';
import { anchorPositions } from './constants';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useEngine } from '@/context/engine';
import { useEntityState, setComponent } from '@/components/engine';


import type { AnchorPosition } from './constants';

export type AnchorPointPickerProps = {
  nodeEid: number;
};

export function AnchorPointPicker(props: AnchorPointPickerProps) {
  const { world } = useEngine();
  const c = world.components;
  const [hoveredIndex, setHoveredIndex] = createSignal<number | null>(null);

  const anchorX = useEntityState(c.Anchor.x, props.nodeEid, 0.5);
  const anchorY = useEntityState(c.Anchor.y, props.nodeEid, 0.5);

  const isActive = (pos: AnchorPosition) => {
    const ax = anchorX();
    const ay = anchorY();
    if (ax === undefined || ay === undefined) return false;

    return Math.abs(ax - pos.x) < 0.01 && Math.abs(ay - pos.y) < 0.01;
  };

  const assignAnchor = (x: number, y: number) => {
    setComponent(world, props.nodeEid, c.Anchor, { x, y });
  };

  return (
    <div class="flex-1 h-16 bg-input rounded-md overflow-hidden grid grid-cols-3 grid-rows-3">
      <For each={anchorPositions}>
        {(pos, index) => {
          const active = () => isActive(pos);
          const hovered = () => hoveredIndex() === index();

          return (
            <Tooltip>
              <TooltipTrigger
                as="button"
                type="button"
                class="w-full h-full relative rounded-md transition-colors flex items-center justify-center"
                onMouseEnter={() => setHoveredIndex(index())}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={() => assignAnchor(pos.x, pos.y)}
              >
                <Show
                  when={active() || hovered()}
                  fallback={
                    <div class="size-0.5 rounded-full bg-muted-foreground" />
                  }
                >
                  <div classList={{ "text-primary": active(), "text-muted-foreground": !active() }}>
                    <Icon name={pos.icon} />
                  </div>
                </Show>
              </TooltipTrigger>
              <TooltipContent>{pos.tooltip}</TooltipContent>
            </Tooltip>
          );
        }}
      </For>
    </div>
  );
}
