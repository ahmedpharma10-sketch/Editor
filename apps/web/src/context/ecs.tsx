/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hasComponent, Or } from 'bitecs';
import { createContext, createMemo, useContext, type Accessor, type JSX } from 'solid-js';
import { assert } from '@/utils';
import { useEntityState, useQuery, useWorldState } from '@/components/engine/hooks';
import { ToolType } from '@/components/engine';
import { useEngine } from './engine';

type ECSContextValue = {
  selectedTool: Accessor<ToolType>;
  selectedNodes: Accessor<Set<number>>;
  selectedKeyframes: Accessor<Set<number>>;
  now: Accessor<number>;
  playing: Accessor<number>;
  looping: Accessor<number>;
};

const ECSContext = createContext<ECSContextValue>();

export function ECSProvider(props: { children: JSX.Element }) {
  const { world } = useEngine();
  const c = world.components;

  const scene = () => world.timelineIndex().root;

  // Node selection: filter Selected to scene nodes — geometries or groups
  // (excludes selected keyframes).
  const selection = useQuery([c.Selected, Or(c.Geometry, c.Group, c.AdjustmentLayer, c.Keyframe)]);

  const selectedNodes = createMemo(() => {
    const nodes = selection().filter(eid =>
      hasComponent(world, eid, c.Geometry)
      || hasComponent(world, eid, c.Group)
      || hasComponent(world, eid, c.AdjustmentLayer));
    return new Set(nodes);
  });
  const selectedKeyframes = createMemo(() => {
    const keyframes = selection().filter(eid => hasComponent(world, eid, c.Keyframe));
    return new Set(keyframes);
  });

  const selectedTool = useWorldState(w => w.selection.tool, ToolType.HAND);
  const now = useEntityState(c.Computed.localTime, scene, 0);
  const playing = useEntityState(c.Playback.playing, scene, 0);
  const looping = useEntityState(c.Playback.loop, scene, 0);

  return (
    <ECSContext.Provider
      value={{
        selectedTool,
        selectedNodes,
        selectedKeyframes,
        playing,
        looping,
        now,
      }}>
      {props.children}
    </ECSContext.Provider>
  );
}

export function useECS() {
  const ctx = useContext(ECSContext);
  assert(ctx, 'useECS must be used within ECSProvider');
  return ctx;
}
