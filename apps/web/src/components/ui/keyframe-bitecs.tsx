/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useEngine } from "@/context/engine";
import { findKeyframeTargetNode } from "@/components/engine/api";
import { cx } from "@/lib/cva";
import { createMemo, Show } from "solid-js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { getParentEntity, toggleKeyframeTrack, useEntityState, type PropertyPath } from "../engine";

type KeyframeProps = {
  target: number;
  property: PropertyPath;
  disabled?: boolean;
  class?: string;
};

export function Keyframe(props: KeyframeProps) {
  const { world } = useEngine();
  const c = world.components;

  const nodeEid = createMemo(() => findKeyframeTargetNode(world, props.target));
  const isAvailable = createMemo(() => getParentEntity(world, props.target) !== null && nodeEid() !== null);

  const tracks = useEntityState(c.Cache.keyframeTracks, nodeEid, []);
  const localFrame = useEntityState(c.Computed.localTime, nodeEid, 0);

  const matchedTrack = createMemo(() => {
    for (const tid of tracks()) {
      if (c.KeyframeTrack.property[tid] !== props.property) continue;
      if (c.KeyframeTrack.target[tid] !== props.target) continue;
      return tid;
    }
    return null;
  });

  const hasTrack = createMemo(() => matchedTrack() !== null);

  const keyframes = useEntityState(c.Cache.keyframes, matchedTrack, []);

  const isActive = createMemo(() => {
    return keyframes().some(kf => Math.round(c.Keyframe.time[kf]) === localFrame());
  });

  const toggleKeyframe = () => toggleKeyframeTrack(world, props.target, props.property);

  return (
    <Show when={isAvailable()}>
      <Tooltip openDelay={600} disabled={props.disabled}>
        <TooltipTrigger
          as="button"
          type="button"
          class={cx("flex items-center size-6 justify-center transition-colors group disabled:cursor-not-allowed disabled:opacity-50", props.class)}
          onClick={toggleKeyframe}
          disabled={props.disabled}
        >
          <div
            class={cx(
              "size-1.5 rotate-45 border transition-colors",
              isActive()
                ? "bg-primary"
                : "bg-transparent group-hover:border-foreground",
              hasTrack()
                ? "border-primary"
                : "border-muted-foreground"
            )}
          />
        </TooltipTrigger>
        <TooltipContent>{isActive() ? "Remove keyframe" : "Add keyframe"}</TooltipContent>
      </Tooltip>
    </Show>
  )
}
