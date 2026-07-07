/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Index } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useEngine } from '@/context/engine';
import { useEntityTag } from '@/components/engine';
import { KeyframeLayer } from './keyframe';
import { NodeLayer } from './node';
import { SubItemLayer } from './sub-item';

import type { Component } from 'solid-js';
import type { TimelineNode, TimelineNodeKind } from '@/components/engine/api/timeline-index';

type LayerProps = {
  layer: TimelineNode;
  depth?: number;
  ancestorSelected?: boolean;
}

type LayerRowProps = {
  layer: TimelineNode;
  depth: number;
  expanded: boolean;
  ancestorSelected: boolean;
}

const LAYER_ROWS: Record<TimelineNodeKind, Component<LayerRowProps>> = {
  'geometry': NodeLayer,
  'sub-item': SubItemLayer,
  'keyframe-track': KeyframeLayer,
};

export function Layer(props: LayerProps) {
  const { world } = useEngine();

  const c = world.components;
  const eid = () => props.layer.eid;

  const depth = () => props.depth ?? 0;
  const ancestorSelected = () => props.ancestorSelected ?? false;
  const selected = useEntityTag(c.Selected, eid);

  return (
    <>
      <Dynamic
        component={LAYER_ROWS[props.layer.kind]}
        layer={props.layer}
        depth={depth()}
        expanded={props.layer.expanded}
        ancestorSelected={ancestorSelected()}
      />
      <Index each={props.layer.children}>
        {(child) => <Layer layer={child()} depth={depth() + 1} ancestorSelected={ancestorSelected() || selected()} />}
      </Index>
    </>
  )
}
