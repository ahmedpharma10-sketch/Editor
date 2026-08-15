/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MeterScale, VolumeControl, VolumeMeter } from './volume-meter';
import { useEntityState, setComponent } from '@/components/engine';
import { useEngine } from '@/context/engine';
import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useECS } from '@/context/ecs';
import { hasComponent } from 'bitecs';

export function Soundboard() {
  const { world } = useEngine();
  const { playing } = useECS();

  const c = world.components;
  const scene = () => world.timelineIndex().root;
  const masterVolume = useEntityState(c.Volume, scene, 0);

  // Only audio-bearing clips can be metered.
  const audioLayers = createMemo(() =>
    world
      .timelineIndex()
      .layers
      .map((layer) => layer.eid)
      .filter((eid) => hasComponent(world, eid, c.AudioBus) || hasComponent(world, eid, c.Volume))
  );

  const [leftMeterEid, setLeftMeterEid] = createSignal<number | undefined>(audioLayers()[1]);
  const [rightMeterEid, setRightMeterEid] = createSignal<number | undefined>(audioLayers()[0]);

  const leftOptions = () => audioLayers().filter((eid) => eid !== rightMeterEid());
  const rightOptions = () => audioLayers().filter((eid) => eid !== leftMeterEid());

  createEffect(() => {
    const list = audioLayers();
    let left = leftMeterEid();
    let right = rightMeterEid();

    // Drop selections whose layer no longer exists.
    if (left !== undefined && !list.includes(left)) left = undefined;
    if (right !== undefined && !list.includes(right)) right = undefined;

    // Auto-fill empty slots, preferring a layer not already shown in the sibling
    // so the two meters never collapse onto the same layer.
    if (right === undefined) right = list.find((eid) => eid !== left);
    if (left === undefined) left = list.find((eid) => eid !== right);

    setRightMeterEid(right);
    setLeftMeterEid(left);
  }, { defer: true });

  const masterBus = createMemo(() => {
    playing();
    const sceneEid = scene();
    return c.AudioBus[sceneEid ?? -1];
  });

  const leftMeterNode = createMemo(() => {
    playing();
    scene();
    const eid = leftMeterEid();
    if (eid === undefined) return;
    return c.AudioBus[eid]?.getGain();
  });

  const leftMeterVolume = useEntityState(c.Volume, leftMeterEid, 0);

  const rightMeterNode = createMemo(() => {
    playing();
    scene();
    const eid = rightMeterEid();
    if (eid === undefined) return;
    return c.AudioBus[eid]?.getGain();
  });

  const rightMeterVolume = useEntityState(c.Volume, rightMeterEid, 0);

  const masterNode = createMemo(() => {
    playing();
    scene();

    return masterBus()?.getGain();
  });

  const handleMasterVolumeChange = (volume: number) => {
    const sceneEid = scene();
    if (sceneEid === null) return;
    setComponent(world, sceneEid, c.Volume, volume);
  };

  const handleLeftMeterVolumeChange = (volume: number) => {
    const eid = leftMeterEid();
    if (eid === undefined) return;
    setComponent(world, eid, c.Volume, volume);
  };

  const handleRightMeterVolumeChange = (volume: number) => {
    const eid = rightMeterEid();
    if (eid === undefined) return;
    setComponent(world, eid, c.Volume, volume);
  };

  const handleLeftMeterLayerChange = (eid: number | null) => {
    if (eid === null) return;
    if (audioLayers().includes(eid)) setLeftMeterEid(eid);
  }

  const handleRightMeterLayerChange = (eid: number | null) => {
    if (eid === null) return;
    if (audioLayers().includes(eid)) setRightMeterEid(eid);
  }

  const layerName = (eid: number) => c.Name[eid] ?? `Layer ${eid}`;

  return (
    <div class="soundboard flex items-stretch h-full w-full justify-between px-4 pt-4 pb-1">
      <div class="flex flex-col items-center h-full gap-2">
        <div class="flex flex-1 min-h-0">
          <VolumeControl
            volume={leftMeterVolume()}
            disabled={!leftMeterNode()}
            onVolumeChange={handleLeftMeterVolumeChange}
          />
          <VolumeMeter audioNode={leftMeterNode()} />
          <MeterScale />
        </div>
        <div class="h-6 flex items-center justify-center shrink-0">
          <Show when={leftMeterEid() !== undefined}>
            <Select<number>
              value={leftMeterEid()}
              onChange={handleLeftMeterLayerChange}
              options={leftOptions()}
              disabled={leftOptions().length <= 1}
              itemComponent={(itemProps) => (
                <SelectItem item={itemProps.item}>{layerName(itemProps.item.rawValue)}</SelectItem>
              )}
            >
              <SelectTrigger class="text-xs text-muted-foreground hover:text-foreground bg-transparent hover:bg-transparent w-20 focus-visible:after:opacity-0">
                <SelectValue<number>>{(state) => layerName(state.selectedOption() ?? -1)}</SelectValue>
              </SelectTrigger>
              <SelectPortal>
                <SelectContent />
              </SelectPortal>
            </Select>
          </Show>
        </div>
      </div>
      <div class="flex flex-col items-center h-full gap-2">
        <div class="flex flex-1 min-h-0">
          <VolumeControl
            volume={rightMeterVolume()}
            disabled={!rightMeterNode()}
            onVolumeChange={handleRightMeterVolumeChange}
          />
          <VolumeMeter audioNode={rightMeterNode()} />
          <MeterScale />
        </div>
        <div class="h-6 flex items-center justify-center shrink-0">
          <Show when={rightMeterEid() !== undefined}>
            <Select<number>
              value={rightMeterEid()}
              onChange={handleRightMeterLayerChange}
              options={rightOptions()}
              disabled={rightOptions().length <= 1}
              itemComponent={(itemProps) => (
                <SelectItem item={itemProps.item}>{layerName(itemProps.item.rawValue)}</SelectItem>
              )}
            >
              <SelectTrigger class="text-xs text-muted-foreground hover:text-foreground bg-transparent hover:bg-transparent w-20 focus-visible:after:opacity-0">
                <SelectValue<number>>{(state) => layerName(state.selectedOption() ?? -1)}</SelectValue>
              </SelectTrigger>
              <SelectPortal>
                <SelectContent />
              </SelectPortal>
            </Select>
          </Show>
        </div>
      </div>
      <div class="flex flex-col items-center h-full gap-2">
        <div class="flex flex-1 min-h-0">
          <VolumeControl
            volume={masterVolume()}
            disabled={!masterNode()}
            onVolumeChange={handleMasterVolumeChange}
          />
          <VolumeMeter audioNode={masterNode()} />
          <MeterScale />
        </div>
        <div class="h-6 flex items-center justify-center shrink-0">
          <span class="text-base text-muted-foreground">Master</span>
        </div>
      </div>
    </div>
  );
}
