/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Icon } from "@/components/ui/icon";
import { useEngine } from "@/context/engine";
import { DEFAULT_TIMELINE_RESOLUTION, TIMELINE_RESOLUTION_RANGE, TIMELINE_PADDING_LEFT } from "../engine/timeline/config";
import { createEffect, createSignal } from "solid-js";
import { SliderThumb, SliderFill, SliderTrack, Slider } from "../ui/slider";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { clamp } from "@/utils";
import { useAuth } from "@/context/auth";

const MIN_RES = 1 / TIMELINE_RESOLUTION_RANGE[1];
const MAX_RES = 1 / TIMELINE_RESOLUTION_RANGE[0];
const LOG_MIN = Math.log(MIN_RES);
const LOG_MAX = Math.log(MAX_RES);

function resToSlider(resolution: number): number {
  const clamped = Math.max(MIN_RES, Math.min(MAX_RES, resolution));
  return ((Math.log(clamped) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 100;
}

function sliderToRes(value: number): number {
  return Math.exp(LOG_MIN + (value / 100) * (LOG_MAX - LOG_MIN));
}

export function Footer() {
  const { world } = useEngine();
  const auth = useAuth();

  const c = world.components;

  const [value, setValue] = createSignal(25);

  createEffect(() => {
    const sid = world.timelineIndex().root;
    if (sid === null) return;
    setValue(resToSlider(c.Timeline.resolution[sid] ?? DEFAULT_TIMELINE_RESOLUTION));
  });

  createEffect(() => {
    const sid = world.timelineIndex().root;
    if (sid === null) return;

    const oldResolution = c.Timeline.resolution[sid] || DEFAULT_TIMELINE_RESOLUTION;
    const newResolution = sliderToRes(value());
    if (oldResolution === newResolution) return;

    // Zoom towards the playhead by adjusting scrollX
    const scrollX = c.Timeline.scrollX[sid] ?? 0;
    const playheadFrame = world.components.Computed.localTime[sid];
    const focalPixelX = (playheadFrame - scrollX) * oldResolution;

    let newScrollX = scrollX + focalPixelX / oldResolution - focalPixelX / newResolution;
    const minScrollX = -TIMELINE_PADDING_LEFT / newResolution;
    newScrollX = Math.max(minScrollX, newScrollX);

    c.Timeline.resolution[sid] = newResolution;
    c.Timeline.scrollX[sid] = newScrollX;
  }, { defer: true });

  const handleValueChange = (values: number[]) => setValue(clamp(values[0]!, 0, 100));

  return (
    <div class="bg-background flex items-center gap-px h-full col-full">
      {/* Left - Logo */}
      <div class="flex items-center gap-2 px-2 w-[264px] shrink-0">
        <div class="w-6 flex items-center justify-center">
          <Icon name="ds-mark-vector" class="size-3 text-muted-foreground" />
        </div>
        <span class="text-muted-foreground text-xs">
          {auth.isPro() ? "Diffusion Studio Pro" : "Diffusion Studio"}
        </span>
      </div>

      <div class="flex items-center gap-1.5 px-2">
        <Tooltip>
          <TooltipTrigger
            as={Button}
            variant="ghost"
            size="icon"
            class="size-3 flex items-center justify-center rounded-[2px]"
            onClick={() => handleValueChange([value() - 10])}
          >
            <Icon name="small-timeline" class="size-3 text-muted-foreground shrink-0" />
          </TooltipTrigger>
          <TooltipContent>Zoom out timeline</TooltipContent>
        </Tooltip>

        <Slider value={[value()]} step={1} maxValue={100} class="w-[120px]" onChange={handleValueChange}>
          <SliderTrack>
            <SliderFill />
            <SliderThumb />
          </SliderTrack>
        </Slider>

        <Tooltip>
          <TooltipTrigger
            as={Button}
            variant="ghost"
            size="icon"
            class="size-3 flex items-center justify-center rounded-[2px]"
            onClick={() => handleValueChange([value() + 10])}
          >
            <Icon name="large-timeline" class="size-3 text-muted-foreground shrink-0" />
          </TooltipTrigger>
          <TooltipContent>Zoom in timeline</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
