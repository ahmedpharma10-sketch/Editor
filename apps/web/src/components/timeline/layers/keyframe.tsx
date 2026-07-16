/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, Show } from 'solid-js';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from '@/components/ui/tooltip';
import { Keyframe } from '@/components/ui/keyframe';
import { useEngine } from '@/context/engine';
import { useECS } from '@/context/ecs';
import { KEYFRAME_TRACK_HEIGHT } from '@/components/engine/timeline/config';
import { NESTED_INDENT_PX } from './config';

import { addComponent, removeComponent, useEntityTag, getParentEntity, type PropertyPath, type TimelineNode } from '@/components/engine';
import { findClosestParentGeometry } from '@/components/engine/api/utils';

type KeyframeLayerProps = {
  depth: number;
  layer: TimelineNode;
  ancestorSelected: boolean;
}

export function KeyframeLayer(props: KeyframeLayerProps) {
  const { world } = useEngine();
  const { now } = useECS();
  const c = world.components;

  const eid = () => props.layer.eid;

  const property = createMemo(() => c.KeyframeTrack.property[eid()]);
  const targetEid = createMemo(() => getParentEntity(world, eid()));
  const clipEid = createMemo(() => findClosestParentGeometry(world, eid()));
  const hovering = useEntityTag(c.Hovering, eid);
  const selected = useEntityTag(c.Selected, eid);

  const hasPrev = createMemo(() => {
    const cid = clipEid();
    if (cid === null) return false;
    const delay = c.Computed.delay[cid];
    const localNowFrame = now() - delay;
    return (c.Cache.keyframes[props.layer.eid] ?? []).some(kf => c.Keyframe.time[kf] < localNowFrame);
  });

  const handlePrev = () => {
    const sceneEid = world.selection.scene;
    const fps = world.frameRate;
    const cid = clipEid();
    if (sceneEid === null || cid === null) return;
    const delay = c.Computed.delay[cid];
    const nowFrame = c.Computed.localTime[sceneEid];
    const frames = (c.Cache.keyframes[props.layer.eid] ?? [])
      .map(kf => c.Keyframe.time[kf])
      .sort((a: number, b: number) => b - a);

    for (const frame of frames) {
      const absoluteFrame = delay + frame;
      if (absoluteFrame < nowFrame) {
        c.Computed.localTimeInSeconds[sceneEid] = absoluteFrame / fps;
        c.Computed.localTime[sceneEid] = absoluteFrame;
        break;
      }
    }
  }

  const hasNext = createMemo(() => {
    const cid = clipEid();
    if (cid === null) return false;
    const delay = c.Computed.delay[cid];
    const localNowFrame = now() - delay;
    return (c.Cache.keyframes[props.layer.eid] ?? []).some(kf => c.Keyframe.time[kf] > localNowFrame);
  });

  const handleNext = () => {
    const sceneEid = world.selection.scene;
    const fps = world.frameRate;
    const cid = clipEid();
    if (sceneEid === null || cid === null) return;
    const delay = c.Computed.delay[cid];
    const nowFrame = c.Computed.localTime[sceneEid];
    const frames = (c.Cache.keyframes[props.layer.eid] ?? [])
      .map(kf => c.Keyframe.time[kf])
      .sort((a: number, b: number) => a - b);

    for (const frame of frames) {
      const absoluteFrame = delay + frame;
      if (absoluteFrame > nowFrame) {
        c.Computed.localTimeInSeconds[sceneEid] = absoluteFrame / fps;
        c.Computed.localTime[sceneEid] = absoluteFrame;
        break;
      }
    }
  }

  const handlePointerEnter = () => addComponent(world, props.layer.eid, c.Hovering, false);
  const handlePointerLeave = () => removeComponent(world, props.layer.eid, c.Hovering, false);

  return (
    <div
      class="w-full flex items-center text-muted-foreground justify-between pl-0.5 pr-2"
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
            'padding-left': `${props.depth * NESTED_INDENT_PX}px`,
            transform: 'translateX(calc(var(--layer-x, 0px) * -1))',
          }}
        >
          <div class="size-4 shrink-0 mr-0.5 flex items-center justify-center overflow-clip">
            <Icon name="keyframe-indicator-default" class="size-6" />
          </div>
          <span class="text-xs px-0.5 shrink-0 whitespace-nowrap text-foreground">
            {formatProperty(c.KeyframeTrack.property[props.layer.eid])}
          </span>
        </div>
      </div>
      <div class="flex items-center gap-0.5 shrink-0">
        <Tooltip placement="top">
          <TooltipTrigger as={Button} variant="ghost" size="icon" disabled={!hasPrev()} onClick={handlePrev}>
            <Icon name="caret-left" class="size-6" />
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent>Previous keyframe</TooltipContent>
          </TooltipPortal>
        </Tooltip>
        <Show when={targetEid()}>
          {(target) => <Keyframe property={property() as PropertyPath} target={target()} />}
        </Show>
        <Tooltip placement="top">
          <TooltipTrigger as={Button} variant="ghost" size="icon" disabled={!hasNext()} onClick={handleNext}>
            <Icon name="caret-right" class="size-6" />
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent>Next keyframe</TooltipContent>
          </TooltipPortal>
        </Tooltip>
      </div>
    </div>
  )
}

const PATH_NAMES: Record<PropertyPath, string> = {
  'position.x': 'Position X',
  'position.y': 'Position Y',
  'offset.x': 'Offset X',
  'offset.y': 'Offset Y',
  'scale.x': 'Scale X',
  'scale.y': 'Scale Y',
  'scale': 'Scale',
  'rotation': 'Rotation',
  'skew.x': 'Skew X',
  'skew.y': 'Skew Y',
  'opacity': 'Opacity',
  'color': 'Color',
  'blur': 'Blur',
  'volume': 'Volume',
  'effect.value': 'Value',
  'width': 'Width',
  'height': 'Height',
  'stroke.width': 'Stroke Width',
  'vertexRadius': 'Radius',
  'mixedVertexRadius.topLeft': 'Radius TL',
  'mixedVertexRadius.topRight': 'Radius TR',
  'mixedVertexRadius.bottomRight': 'Radius BR',
  'mixedVertexRadius.bottomLeft': 'Radius BL',
  'stop.offset': 'Offset',
  'stop.color': 'Color',
  'stop.opacity': 'Opacity',
  'chars': 'Text',
};

export function formatProperty(property: string): string {
  return PATH_NAMES[property as PropertyPath]
    ?.split('.')
    ?.map(s => s.charAt(0).toUpperCase() + s.slice(1))
    ?.join(' ') ?? '';
}
