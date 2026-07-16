/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, Show } from 'solid-js';
import { hasComponent } from 'bitecs';
import { Icon } from '@/components/ui/icon';
import { useEngine } from '@/context/engine';
import { addComponent, clearComponent, removeComponent, useEntityTag, EffectType, PaintType } from '@/components/engine';
import { EFFECT_DEFAULTS } from '@/components/sidebar-right/inspector/effects-inspector';
import { NESTED_INDENT_PX } from './config';

import type { TimelineNode } from '@/components/engine/api/timeline-index';
import { KEYFRAME_TRACK_HEIGHT } from '@/components/engine/timeline/config';

type SubItemLayerProps = {
  layer: TimelineNode;
  depth?: number;
  expanded: boolean;
  ancestorSelected: boolean;
}

export function SubItemLayer(props: SubItemLayerProps) {
  const { world } = useEngine();

  const c = world.components;

  const eid = () => props.layer.eid;

  const depth = () => props.depth ?? 0;
  const canExpand = () => props.layer.expandable;
  const hovering = useEntityTag(c.Hovering, eid);
  const selected = useEntityTag(c.Selected, eid);
  const name = createMemo(() => {
    if (c.Name[eid()]) return c.Name[eid()];
    if (hasComponent(world, eid(), c.Stroke)) return 'Stroke';
    if (hasComponent(world, eid(), c.Shadow)) return 'Shadow';
    if (hasComponent(world, eid(), c.Paint)) {
      if (c.Paint[eid()] === PaintType.LINEAR_GRADIENT) return 'Gradient';
      if (c.Paint[eid()] === PaintType.RADIAL_GRADIENT) return 'Gradient';
      if (c.Paint[eid()] === PaintType.SOLID) return 'Solid';
      if (c.Paint[eid()] === PaintType.IMAGE) return 'Image';
      if (c.Paint[eid()] === PaintType.VIDEO) return 'Video';
      if (c.Paint[eid()] === PaintType.SEQUENCE) return 'Sequence';
      if (c.Paint[eid()] === PaintType.WAVEFORM) return 'Waveform';
      return 'Fill';
    }
    if (hasComponent(world, eid(), c.ColorStop)) return 'Stop';
    if (hasComponent(world, eid(), c.Effect)) {
      const type = c.Effect.type[eid()] as Exclude<EffectType, EffectType.DROP_SHADOW>;
      return EFFECT_DEFAULTS[type]?.label ?? `Sub-item ${eid()}`;
    }
    return `Sub-item ${eid()}`;
  });

  const toggleExpanded = () => {
    const eid = props.layer.eid;
    if (hasComponent(world, eid, c.Expanded)) {
      removeComponent(world, eid, c.Expanded);
    } else {
      addComponent(world, eid, c.Expanded);
    }
  }

  const handlePointerEnter = () => {
    clearComponent(world, c.Hovering, false);
    addComponent(world, props.layer.eid, c.Hovering, false);
  }
  const handlePointerLeave = () => {
    clearComponent(world, c.Hovering, false);
    removeComponent(world, props.layer.eid, c.Hovering, false);
  }

  return (
    <div
      class="w-full pl-0.5 pr-2 flex items-center text-muted-foreground justify-between"
      classList={{
        'bg-accent': selected(),
        'bg-accent/70': !selected() && hovering(),
        'bg-accent/40': !selected() && !hovering() && props.ancestorSelected,
      }}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      style={{ height: KEYFRAME_TRACK_HEIGHT + 'px' }}
    >
      <div data-layer-label class="flex-1 min-w-0 overflow-hidden">
        <div
          class="flex items-center gap-0.5 w-max"
          style={{
            'padding-left': `${depth() * NESTED_INDENT_PX}px`,
            transform: 'translateX(calc(var(--layer-x, 0px) * -1))',
          }}
        >
          <button
            disabled={!canExpand()}
            onClick={toggleExpanded}
            class="size-4 shrink-0 flex items-center justify-center overflow-clip invisible group-hover/layers:visible focus-ring rounded-sm mr-0.5">
            <Show when={canExpand()}>
              <Icon name={props.expanded ? "chevron-down" : "chevron-right"} class="size-6 hover:text-foreground" />
            </Show>
          </button>
          <span class="text-xs px-0.5 shrink-0 whitespace-nowrap text-foreground">
            {name()}
          </span>
        </div>
      </div>
    </div>
  )
}
