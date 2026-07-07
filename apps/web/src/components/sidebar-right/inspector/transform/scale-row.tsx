/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, Show } from "solid-js";
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
import { useEntityState, setComponent, useEntityTag, removeComponent, removeKeyframeTrack } from "@/components/engine";
import { Keyframe } from "@/components/ui/keyframe";
import { SegmentedIconTabs } from "@/components/ui/segmented-icon-tabs";
import { hasComponent } from "bitecs";

export type ScaleRowProps = {
  nodeEid: number;
  onRemoveAddon(): void;
};

type ScaleMode = 'uniform' | 'separate';

const SCALE_MODE_ITEMS = [
  {
    value: 'uniform' as ScaleMode,
    label: 'Uniform scale',
    icon: 'unified-values',
  },
  {
    value: 'separate' as ScaleMode,
    label: 'Separate scale',
    icon: 'scale-individual-axes',
  },
] as const;

export function ScaleRow(props: ScaleRowProps) {
  const { world } = useEngine();
  const c = world.components;

  const eid = () => props.nodeEid;
  const mixedScale = useEntityTag(c.Scale, eid);

  const scaleX = useEntityState(c.Computed.scaleX, eid, 1);
  const scaleY = useEntityState(c.Computed.scaleY, eid, 1);
  const scaleMode = createMemo(() => mixedScale() ? 'separate' : 'uniform');

  const isDefault = createMemo(() => (scaleX() === 1 && scaleY() === 1));

  const scale = createMemo(() => {
    if (scaleY() !== scaleX()) {
      return "Mixed";
    }
    return Math.round(scaleX() * 100);
  });

  const updateScaleX = (x: number) => setComponent(world, props.nodeEid, c.Scale, { x });
  const updateScaleY = (y: number) => setComponent(world, props.nodeEid, c.Scale, { y });
  const updateScale = (scale: number) => {
    if (hasComponent(world, props.nodeEid, c.UniformScale)) {
      setComponent(world, props.nodeEid, c.UniformScale, scale)
    } else {
      setComponent(world, props.nodeEid, c.Scale, { x: scale, y: scale });
    }
  };

  const handleScaleModeChange = (mode: ScaleMode) => {
    if (mode === 'uniform') {
      world.history.transaction('Change scale mode to uniform', () => {
        removeComponent(world, props.nodeEid, c.Scale);
        setComponent(world, props.nodeEid, c.UniformScale, scaleX());
        removeKeyframeTrack(world, props.nodeEid, 'scale.x');
        removeKeyframeTrack(world, props.nodeEid, 'scale.y');
      });
    }

    if (mode === 'separate') {
      world.history.transaction('Change scale mode to separate', () => {
        removeComponent(world, props.nodeEid, c.UniformScale);
        setComponent(world, props.nodeEid, c.Scale, { x: scaleX(), y: scaleY() });
        removeKeyframeTrack(world, props.nodeEid, 'scale');
      });
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger<typeof ControlRow>
        as={ControlRow}
        label="Scale"
        contentClass="grid grid-cols-2 gap-2"
      >
        <ControlledTextField
          icon={<Icon name="scale-size" />}
          value={scale()}
          onNumber={(value) => updateScale(value / 100)}
          step={1}
          unit="%"
          autoSelect
          sliderEnabled
          limitEvents
          keyframe={<Keyframe target={props.nodeEid} property="scale" />}
        />
        <SegmentedIconTabs
          value={() => scaleMode()}
          onChange={handleScaleModeChange}
          items={SCALE_MODE_ITEMS}
        />
        <Show when={mixedScale()}>
          <ControlledTextField
            icon={<Icon name="prop-x-position" />}
            value={Math.round(scaleX() * 100)}
            onNumber={(value) => updateScaleX(value / 100)}
            step={1}
            unit="%"
            autoSelect
            sliderEnabled
            limitEvents
            keyframe={<Keyframe target={props.nodeEid} property="scale.x" />}
          />
          <ControlledTextField
            icon={<Icon name="prop-y-position" />}
            value={Math.round(scaleY() * 100)}
            onNumber={(value) => updateScaleY(value / 100)}
            step={1}
            unit="%"
            autoSelect
            sliderEnabled
            limitEvents
            keyframe={<Keyframe target={props.nodeEid} property="scale.y" />}
          />
        </Show>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={isDefault()}
          onSelect={() => {
            updateScaleX(1);
            updateScaleY(1);
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
