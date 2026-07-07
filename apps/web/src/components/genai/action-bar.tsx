/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { createMemo, Show } from "solid-js";
import { PaintType, isScene as isSceneEntity, isAudio } from "@/components/engine";
import { useEngine } from "@/context/engine";
import { useRemoveBackground } from "./use-remove-background";
import { useUpscaleImage } from "./use-upscale-image";
import { useUpscaleVideo } from "./use-upscale-video";
import { useAddAudioToVideo } from "./use-add-audio-to-video";
import { useGenerationRecords } from "./use-generation-records";
import { useGenerateImage } from "./use-generate-image";
import { useGenerateVideo } from "./use-generate-video";
import { useGenerateVoice } from "./use-generate-voice";
import { useGenerateAudio } from "./use-generate-audio";
import { useAutoCaptions } from "./use-auto-captions";
import { createDefaultConfig } from "./prompt-input";
import { toast } from "somoto";
import { useECS } from "@/context/ecs";

import type { EngineWorld } from "@/components/engine";

import type { GenerationConfig } from "@/components/engine/db";

function getNodeMediaType(world: EngineWorld, eid: number) {
  const c = world.components;
  if (isAudio(world, eid)) {
    return "AUDIO";
  }
  for (const fid of c.Cache.fills[eid]) {
    if (c.Paint[fid] === PaintType.VIDEO) {
      return "VIDEO";
    }
    if (c.Paint[fid] === PaintType.IMAGE) {
      return "IMAGE";
    }
  }
  return null;
}

interface ActionBarProps {
  openPromptInput?(config: GenerationConfig): void;
}

export function ActionBar(props: ActionBarProps) {
  const { world } = useEngine();
  const { selectedNodes } = useECS();

  const { generate: upscaleImage } = useUpscaleImage();
  const { generate: upscaleVideo } = useUpscaleVideo();
  const { generate: addAudioToVideo } = useAddAudioToVideo();
  const { generate: removeBackground } = useRemoveBackground();
  const { generate: generateImage } = useGenerateImage();
  const { generate: generateVideo } = useGenerateVideo();
  const { generate: generateVoice } = useGenerateVoice();
  const { generate: generateAudio } = useGenerateAudio();
  const { generate: autoCaptions, status: autoCaptionsStatus } = useAutoCaptions();
  const { isGenerated, totalCredits, firstConfig } = useGenerationRecords();

  const autoCaptionsStatusText = createMemo(() => {
    switch (autoCaptionsStatus()) {
      case "encoding": return "Encoding audio…";
      case "uploading": return "Uploading audio…";
      case "transcribing": return "Transcribing audio…";
      default: return "";
    }
  });

  const isImage = createMemo(() => {
    return Array.from(selectedNodes()).some(eid => {
      const mediaType = getNodeMediaType(world, eid);
      return mediaType === "IMAGE";
    });
  });

  const isVideo = createMemo(() => {
    return Array.from(selectedNodes()).some(eid => {
      const mediaType = getNodeMediaType(world, eid);
      return mediaType === "VIDEO";
    });
  });

  const isScene = createMemo(() => {
    return Array.from(selectedNodes()).some(eid => isSceneEntity(world, eid));
  });

  const visible = createMemo(() => {
    return isImage() || isVideo() || isScene();
  })

  const handleRerun = () => {
    const config = firstConfig();
    if (!config) {
      toast("No generation config found", { description: "This asset wasn't generated with a prompt." });
      return;
    }

    const promise = (() => {
      switch (config.mode) {
        case "IMAGE":
          return generateImage(config);
        case "VIDEO":
          return generateVideo(config);
        case "VOICE":
          return generateVoice(config);
        case "AUDIO":
          return generateAudio(config);
      }
    })();

    promise.catch((err) => {
      toast("Rerun failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    });
  };

  const handleEditWithPrompt = () => {
    props.openPromptInput?.(createDefaultConfig("IMAGE"));
  };

  const handleMakeVideo = () => {
    props.openPromptInput?.(createDefaultConfig("VIDEO"));
  };

  const handleReuse = () => {
    const config = firstConfig();
    if (!config) {
      toast("No generation config found", { description: "This asset wasn't generated with a prompt." });
      return;
    }
    props.openPromptInput?.(config);
  };

  const handleAutoCaptions = async () => {
    for (const eid of selectedNodes()) {
      if (isSceneEntity(world, eid)) {
        await autoCaptions(eid);
      }
    }
  };

  return (
    <>
      <Dialog open={autoCaptionsStatus() !== null}>
        <DialogPortal>
          <DialogContent class="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Auto-Captions</DialogTitle>
            </DialogHeader>
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon name="spinner-loader" class="size-6 animate-spin" />
              {autoCaptionsStatusText()}
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>
      <Show when={visible()}>
        <div class="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 rounded-xl p-1 bg-background border border-border flex gap-1 items-center">
          <Show when={isScene()}>
            <Button variant="ghost" class="gap-0 pl-0.5 text-muted-foreground" onClick={handleAutoCaptions}>
              <Icon name="captions" />
              Auto-Captions
            </Button>
          </Show>
          <Show when={isImage()}>
            <div class="flex gap-1 items-center">
              <Button variant="ghost" class="gap-0 pl-0.5 text-muted-foreground" onClick={removeBackground}>
                <Icon name="ai-generate" />
                Remove background
              </Button>
              <Button variant="ghost" class="gap-0 pl-0.5 text-muted-foreground" onClick={upscaleImage}>
                <Icon name="arrow-scale" />
                Upscale
              </Button>
            </div>
            <Separator orientation="vertical" class="min-h-5" />
            <div class="flex gap-1 items-center">
              <Button variant="ghost" class="gap-0 pl-0.5 text-muted-foreground" onClick={handleEditWithPrompt}>
                <Icon name="ai-generate" />
                Edit with prompt
              </Button>
              <Show when={isGenerated()}>
                <DropdownMenu placement="right">
                  <DropdownMenuTrigger<typeof Button>
                    as={(triggerProps) => (
                      <Button {...triggerProps} variant="ghost" class="gap-0 pr-0.5 text-muted-foreground">
                        More
                        <Icon name="chevron-down" />
                      </Button>
                    )}
                  />
                  <DropdownMenuPortal>
                    <DropdownMenuContent>
                      <div class="flex items-center gap-1 px-0 pr-2 h-7">
                        <Icon name="ai-generate" class="size-6 text-muted-foreground" />
                        <span class="text-xs text-muted-foreground">{totalCredits()} AI credits used</span>
                      </div>
                      <Separator class="my-1" />
                      <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={handleMakeVideo}>
                          <Icon name="film-video-export" class="size-6 mr-2 text-foreground" />
                          Make video
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={handleRerun}>
                          <Icon name="rerun" class="size-6 mr-2 text-foreground" />
                          Rerun
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={handleReuse}>
                          <Icon name="reuse-settings" class="size-6 mr-2 text-foreground" />
                          Reuse
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenu>
              </Show>
            </div>
          </Show>
          <Show when={isVideo()}>
            <div class="flex gap-1 items-center">
              <Button variant="ghost" class="gap-0 pl-0.5 text-muted-foreground" onClick={addAudioToVideo}>
                <Icon name="generate-audio" />
                Add audio
              </Button>
              <Button variant="ghost" class="gap-0 pl-0.5 text-muted-foreground" onClick={upscaleVideo}>
                <Icon name="arrow-scale" />
                Upscale
              </Button>
              <Show when={isGenerated()}>
                <Separator orientation="vertical" class="min-h-5" />
                <DropdownMenu placement="right">
                  <DropdownMenuTrigger<typeof Button>
                    as={(triggerProps) => (
                      <Button {...triggerProps} variant="ghost" class="gap-0 pr-0.5 text-muted-foreground">
                        More
                        <Icon name="chevron-down" />
                      </Button>
                    )}
                  />
                  <DropdownMenuPortal>
                    <DropdownMenuContent>
                      <div class="flex items-center gap-1 px-0 pr-2 h-7">
                        <Icon name="ai-generate" class="size-6 text-muted-foreground" />
                        <span class="text-xs text-muted-foreground">{totalCredits()} AI credits used</span>
                      </div>
                      <Separator class="my-1" />
                      <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={handleRerun}>
                          <Icon name="rerun" class="size-6 mr-2 text-foreground" />
                          Rerun
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenu>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </>
  );
}
