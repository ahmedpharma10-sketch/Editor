/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cx } from "@/lib/cva";
import {
  For,
  Show,
  Match,
  Switch,
  createMemo,
  createSignal,
  onCleanup,
  type Accessor,
} from "solid-js";

import {
  PROMPT_INPUT_IMAGE_MODEL_OPTIONS,
  PROMPT_INPUT_VIDEO_MODEL_OPTIONS,
  PROMPT_INPUT_VOICE_OPTIONS,
  PROMPT_INPUT_MODE_OPTIONS,
  PROMPT_INPUT_IMAGE_ASPECT_RATIO_OPTIONS,
  PROMPT_INPUT_VARIANT_COUNT_OPTIONS,
  ALL_VIDEO_ASPECT_RATIO_OPTIONS,
  ALL_DURATION_OPTIONS,
  PROMPT_INPUT_AUDIO_MODEL_OPTIONS,
  // PROMPT_INPUT_RESOLUTION_OPTIONS
} from "./config";
import { createStoredSignal } from "@/lib/store";
import { store } from "@/init";
import { toast } from "somoto";
import { useGenerateImage } from "./use-generate-image";
import { useGenerateVideo } from "./use-generate-video";
import { useGenerateVoice } from "./use-generate-voice";
import { useGenerateAudio } from "./use-generate-audio";
import { PromptInputActions } from "./prompt-input-actions";
import { useEngine } from "@/context/engine";
import { showFileDialog } from "@/utils";
import type {
  Asset,
  AspectRatio,
  GenerationConfig,
  ImageGenerationConfig,
  VideoGenerationConfig,
  VoiceGenerationConfig,
  AudioGenerationConfig,
} from "@/components/engine/db";
import { AssetThumbnail } from "@/components/ui/asset-thumbnail";
import { ChildOf, PaintType, removeComponent } from "@/components/engine";
import { useAssets, loadAsset } from "@/components/engine";
import { useECS } from "@/context/ecs";
import { Not, query } from 'bitecs';

export type PromptInputMode = "IMAGE" | "VIDEO" | "VOICE" | "AUDIO";

const DEFAULT_BUTTON_CLASS = "text-muted-foreground gap-0 pr-2 pl-0";
const MAX_IMAGE_REFERENCES = 5;

type GenerationConfgs = {
  IMAGE: ImageGenerationConfig;
  VIDEO: VideoGenerationConfig;
  VOICE: VoiceGenerationConfig;
  AUDIO: AudioGenerationConfig;
};

export function createDefaultConfig<K extends keyof GenerationConfgs>(mode: K, prompt = ""): GenerationConfgs[K] {
  switch (mode) {
    case "IMAGE":
      return {
        mode: "IMAGE",
        model: PROMPT_INPUT_IMAGE_MODEL_OPTIONS[0].id,
        prompt,
        aspectRatio: "16:9",
        count: 1,
      } as GenerationConfgs[K];
    case "VIDEO":
      return {
        mode: "VIDEO",
        model: PROMPT_INPUT_VIDEO_MODEL_OPTIONS[0].id,
        prompt,
        aspectRatio: "16:9",
        duration: 6,
        generateAudio: true,
      } as GenerationConfgs[K];
    case "VOICE":
      return {
        mode: "VOICE",
        model: "elevenlabs-v3",
        prompt,
        voice: PROMPT_INPUT_VOICE_OPTIONS[0].value,
      } as GenerationConfgs[K];
    case "AUDIO":
      return {
        mode: "AUDIO",
        model: PROMPT_INPUT_AUDIO_MODEL_OPTIONS[0].id,
        prompt,
      } as GenerationConfgs[K];
  }
}

export interface PromptInputProps {
  initialConfig?: GenerationConfig;
}

export function PromptInput(props: PromptInputProps) {
  const { world } = useEngine();
  const assets = useAssets(world);
  const { selectedNodes } = useECS();
  const c = world.components;
  const { generate: generateImage } = useGenerateImage();
  const { generate: generateVideo } = useGenerateVideo();
  const { generate: generateVoice } = useGenerateVoice();
  const { generate: generateAudio } = useGenerateAudio();

  let textareaRef!: HTMLTextAreaElement;
  let dragCounter = 0;
  const [isDragging, setIsDragging] = createSignal(false);

  const [config, setConfig] = createSignal<GenerationConfig>(
    props.initialConfig ?? createDefaultConfig("IMAGE"),
  );

  /** Shallow-merge updates into the current config. */
  const patch = (updates: Partial<GenerationConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }) as GenerationConfig);
  };

  const mode = () => config().mode;
  const prompt = () => config().prompt;

  // These are only read inside their matching <Match when={mode() === …}>
  // blocks, so the narrowing is sound.
  const imageConfig = () => {
    const c = config();
    return c.mode === "IMAGE" ? c : undefined;
  };
  const videoConfig = () => {
    const c = config();
    return c.mode === "VIDEO" ? c : undefined;
  };
  const voiceConfig = () => {
    const c = config();
    return c.mode === "VOICE" ? c : undefined;
  };

  const currentVideoModel = createMemo(() =>
    PROMPT_INPUT_VIDEO_MODEL_OPTIONS.find((m) => m.id === config().model),
  );

  const videoDurationOptions = createMemo(() => {
    const model = currentVideoModel();
    return model ? ALL_DURATION_OPTIONS.filter((o) => model.durations.includes(o.value)) : [];
  });

  const videoAspectRatioOptions = createMemo(() => {
    const model = currentVideoModel();
    return model ? ALL_VIDEO_ASPECT_RATIO_OPTIONS.filter((o) => model.aspectRatios.includes(o.value)) : [];
  });

  const selectedImageEntries = createMemo(() => {
    const entries: { assetId: string; eid: number }[] = [];
    const AssetId = world.components.AssetId;
    for (const eid of selectedNodes()) {
      for (const fid of query(world, [c.Paint, ChildOf(eid), Not(c.Deleted), Not(c.Hidden)])) {
        if (c.Paint[fid] === PaintType.IMAGE) {
          const assetId = AssetId[fid];
          if (!assetId) continue;
          entries.push({ assetId, eid });
          break; // we just need the first image fill
        }
      }
    }
    return entries;
  });

  const selectedImageIds = createMemo(() =>
    selectedImageEntries().map((e) => e.assetId),
  );

  const effectiveImageRefIds = createMemo(() => {
    const local = imageConfig()?.imageRefIds ?? [];
    const selected = selectedImageIds().filter((id) => !local.includes(id));
    return [...local, ...selected]
      .filter((id) => assets.get(id))
      .slice(0, MAX_IMAGE_REFERENCES);
  });

  const effectiveStartFrameId = createMemo(() => {
    const id = videoConfig()?.startFrameImageId ?? selectedImageIds()[0] ?? null;
    return id && assets.get(id) ? id : null;
  });

  const effectiveEndFrameId = createMemo(() => {
    const id = videoConfig()?.endFrameImageId ?? selectedImageIds()[1] ?? null;
    return id && assets.get(id) ? id : null;
  });

  const [recentPrompts, setRecentPrompts] = createStoredSignal(
    store.define<string[]>("prompt-input.recent-prompts", []),
  );
  const [slashMenuDismissed, setSlashMenuDismissed] = createSignal(false);
  const [slashMenuIndex, setSlashMenuIndex] = createSignal(-1);
  const [settingsVisible, setSettingsVisible] = createStoredSignal(
    store.define("prompt-input.settings-visible", false),
  );

  const hasPromptText = () => prompt().trim().length > 0;
  const showSlashMenu = () =>
    prompt().startsWith("/") && !slashMenuDismissed() && recentPrompts().length > 0;

  const handlePromptInput = (event: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    patch({ prompt: event.currentTarget.value });
    setSlashMenuDismissed(false);
    setSlashMenuIndex(-1);
    resizeTextarea();
  };

  const handleModeChange = (value: string) => {
    const newMode = value as PromptInputMode;
    if (newMode === mode()) return;
    setConfig(createDefaultConfig(newMode, prompt()));
  };

  const removeImageReference = (assetId: string) => {
    const refs = imageConfig()?.imageRefIds ?? [];
    if (refs.includes(assetId)) {
      patch({ imageRefIds: refs.filter((id) => id !== assetId) });
      return;
    }
    const entry = selectedImageEntries().find((e) => e.assetId === assetId);
    if (entry) {
      removeComponent(world, entry.eid, c.Selected, false);
    }
  };

  const openImageReferencesPicker = async () => {
    if (effectiveImageRefIds().length >= MAX_IMAGE_REFERENCES) return;
    const handles = await showFileDialog("image/*");
    if (handles.length === 0) return;

    try {
      const loadedAssets = await Promise.all(handles.map((handle) => loadAsset(world, handle)));
      const imageAssets = loadedAssets.filter((a) => a.type === "IMAGE");
      const current = imageConfig()?.imageRefIds ?? [];
      patch({
        imageRefIds: [...current, ...imageAssets.map((a) => a.id)].slice(0, MAX_IMAGE_REFERENCES),
      });
    } catch (e) {
      toast("Failed to import assets", {
        description: (e as Error).message,
      });
    }
  };

  const openVideoFramePicker = async (frame: "start" | "end") => {
    const handles = await showFileDialog("image/*", false);
    if (handles.length !== 1) return;

    try {
      const loadedAsset = await loadAsset(world, handles[0]!);
      if (loadedAsset.type !== "IMAGE") return;
      if (frame === "start") {
        patch({ startFrameImageId: loadedAsset.id });
      } else {
        patch({ endFrameImageId: loadedAsset.id });
      }
    } catch (e) {
      toast("Failed to import assets", {
        description: (e as Error).message,
      });
    }
  };

  const swapVideoFrameImages = () => {
    const c = videoConfig();
    patch({
      startFrameImageId: c?.endFrameImageId,
      endFrameImageId: c?.startFrameImageId,
    });
  };

  const clearVideoFrame = (frame: "start" | "end") => {
    const explicitId =
      frame === "start" ? videoConfig()?.startFrameImageId : videoConfig()?.endFrameImageId;
    if (explicitId) {
      patch(frame === "start" ? { startFrameImageId: undefined } : { endFrameImageId: undefined });
      return;
    }
    // The frame is being shown from a selected canvas entity, so clearing it
    // means deselecting that entity (mirrors removeImageReference).
    const entry = frame === "start" ? selectedImageEntries()[0] : selectedImageEntries()[1];
    if (entry) {
      removeComponent(world, entry.eid, c.Selected, false);
    }
  };

  const resizeTextarea = () => {
    textareaRef.style.height = "auto";
    textareaRef.style.height = `${textareaRef.scrollHeight}px`;
  };

  const handleSelectRecentPrompt = (prompt: string) => {
    patch({ prompt });
    setSlashMenuDismissed(true);
    resizeTextarea();
  };

  const handleClearHistory = () => {
    setRecentPrompts([]);
  };

  const handleSubmit = async () => {
    if (!hasPromptText()) return;

    const currentConfig = { ...config(), prompt: prompt().trim() };

    // Add to recent prompts
    const filtered = recentPrompts().filter((p) => p !== currentConfig.prompt);
    setRecentPrompts([currentConfig.prompt, ...filtered].slice(0, 10));

    patch({ prompt: "" });
    resizeTextarea();

    const promise = (() => {
      switch (currentConfig.mode) {
        case "IMAGE":
          return generateImage({
            ...currentConfig,
            imageRefIds: effectiveImageRefIds(),
          });
        case "VIDEO":
          return generateVideo({
            ...currentConfig,
            startFrameImageId: effectiveStartFrameId() || undefined,
            endFrameImageId: effectiveEndFrameId() || undefined,
          });
        case "VOICE":
          return generateVoice(currentConfig);
        case "AUDIO":
          return generateAudio(currentConfig);
      }
    })();

    promise.catch((err) => {
      toast("Generation failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    });
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (showSlashMenu()) {
      const count = recentPrompts().length;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashMenuIndex((i) => (i <= 0 ? count - 1 : i - 1));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashMenuIndex((i) => (i >= count - 1 ? 0 : i + 1));
      } else if (e.key === "Enter" && slashMenuIndex() >= 0) {
        e.preventDefault();
        handleSelectRecentPrompt(recentPrompts()[slashMenuIndex()]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSlashMenuDismissed(true);
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDragEnter = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter++;
    setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      setIsDragging(false);
    }
  };

  const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter = 0;
    setIsDragging(false);

    const assetIdData = event.dataTransfer?.getData("application/x-asset-id");
    const existingAssetIds = assetIdData?.split(",").filter(Boolean) ?? [];

    const fileItems = Array.from(event.dataTransfer?.items ?? []).filter(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    );

    if (existingAssetIds.length === 0 && fileItems.length === 0) return;

    try {
      let newAssetIds =
        existingAssetIds.length > 0
          ? existingAssetIds
          : (await Promise.all(fileItems.map((item) => loadAsset(world, item)))).map((a) => a.id);

      newAssetIds = newAssetIds.filter((id) => world.assets.get(id)?.type === "IMAGE");

      if (mode() === "VIDEO") {
        const c = videoConfig();
        if (!c?.startFrameImageId && newAssetIds[0]) {
          patch({ startFrameImageId: newAssetIds[0] });
        }
        if (!c?.endFrameImageId && newAssetIds[1]) {
          patch({ endFrameImageId: newAssetIds[1] });
        }
      } else {
        const current = imageConfig()?.imageRefIds ?? [];
        patch({
          imageRefIds: [...current, ...newAssetIds].slice(0, MAX_IMAGE_REFERENCES),
        });
      }
    } catch (e) {
      toast("Failed to import assets", {
        description: (e as Error).message,
      });
    }
  };

  const handleVideoModelChange = (id: string) => {
    const model = PROMPT_INPUT_VIDEO_MODEL_OPTIONS.find((m) => m.id === id);
    if (!model) return;

    const c = videoConfig() ?? createDefaultConfig("VIDEO");
    const durationStr = `${c.duration}s`;

    setConfig({
      ...c,
      model: id,
      endFrameImageId: model.features.includes("end-frame") ? c.endFrameImageId : undefined,
      generateAudio: model.features.includes("audio") ? c.generateAudio : true,
      duration: model.durations.includes(durationStr) ? c.duration : parseInt(model.durations[0], 10),
      aspectRatio: model.aspectRatios.includes(c.aspectRatio)
        ? c.aspectRatio
        : (model.aspectRatios[0] as AspectRatio),
    });
  };

  // ── Accessors for UI menus (string ↔ config conversions) ────────────
  const aspectRatioAccessor: Accessor<string> = () =>
    imageConfig()?.aspectRatio ?? videoConfig()?.aspectRatio ?? "16:9";
  const variantCountAccessor: Accessor<string> = () => String(imageConfig()?.count ?? 1);
  const durationAccessor: Accessor<string> = () => `${videoConfig()?.duration ?? 6}s`;
  const modelAccessor: Accessor<string> = () => config().model;
  const voiceAccessor: Accessor<string> = () => voiceConfig()?.voice ?? PROMPT_INPUT_VOICE_OPTIONS[0].value;
  const audioEnabledAccessor = () => videoConfig()?.generateAudio ?? true;

  return (
    <div
      class="absolute w-xl bottom-16 z-10 mx-auto left-1/2 -translate-x-1/2 flex flex-col gap-2 rounded-xl border border-border bg-background p-2"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <PromptInputActions />
      <Switch>
        <Match when={mode() === "IMAGE"}>
          <div class="flex w-full items-start gap-2 overflow-x-auto">
            <For each={effectiveImageRefIds()}>
              {(assetId) => (
                <PromptInputReferenceImageButton
                  asset={assets.get(assetId)!}
                  class="size-16"
                  size={{ width: 64, height: 64 }}
                  onRemove={() => removeImageReference(assetId)}
                />
              )}
            </For>
            <Show when={effectiveImageRefIds().length < MAX_IMAGE_REFERENCES}>
              <PromptInputAttachButton
                icon="attachment"
                label="Image references"
                class="w-36"
                onClick={openImageReferencesPicker}
              />
            </Show>
          </div>
        </Match>

        <Match when={mode() === "VIDEO"}>
          <div class="flex w-full items-center gap-2 overflow-x-auto">
            <Show when={currentVideoModel()?.features.includes("start-frame")}>
              <Show
                when={effectiveStartFrameId()}
                fallback={
                  <PromptInputAttachButton
                    icon="image"
                    label="Start frame"
                    class="w-28"
                    onClick={() => openVideoFramePicker("start")}
                  />
                }
              >
                {(src) => (
                  <PromptInputReferenceImageButton
                    asset={assets.get(src())!}
                    class="h-16 w-28"
                    size={{ width: 112, height: 64 }}
                    onRemove={() => clearVideoFrame("start")}
                  />
                )}
              </Show>
            </Show>
            <Show when={currentVideoModel()?.features.includes("end-frame")}>
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  variant="ghost"
                  size="icon-square"
                  class="text-muted-foreground"
                  onClick={swapVideoFrameImages}
                >
                  <Icon name="switch-flip" class="size-6" />
                </TooltipTrigger>
                <TooltipContent>Swap frames</TooltipContent>
              </Tooltip>
              <Show
                when={effectiveEndFrameId()}
                fallback={
                  <PromptInputAttachButton
                    icon="image"
                    label="End frame"
                    class="w-28"
                    onClick={() => openVideoFramePicker("end")}
                  />
                }
              >
                {(src) => (
                  <PromptInputReferenceImageButton
                    asset={assets.get(src())!}
                    class="h-16 w-28"
                    size={{ width: 112, height: 64 }}
                    onRemove={() => clearVideoFrame("end")}
                  />
                )}
              </Show>
            </Show>
          </div>
        </Match>
      </Switch>



      <div class="relative flex min-h-14 w-full items-start p-1">
        <Show when={showSlashMenu()}>
          <div class="absolute bottom-full left-0 w-96 max-w-full gap-1 pt-0 text-xs text-muted-foreground flex flex-col rounded-xl border border-border bg-background p-2">
            <div class="flex h-10 items-center justify-between border-b border-border px-1">
              <span class="font-450">Recents</span>
              <button
                type="button"
                class="hover:text-foreground"
                onClick={handleClearHistory}
              >
                Clear history
              </button>
            </div>
            <div class="flex flex-col">
              <For each={recentPrompts()}>
                {(prompt, index) => (
                  <button
                    type="button"
                    class={cx(
                      "flex h-8 w-full items-center rounded-md px-2 text-left hover:bg-input",
                      slashMenuIndex() === index() && "bg-input",
                    )}
                    onClick={() => handleSelectRecentPrompt(prompt)}
                  >
                    <span class="truncate">{prompt}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
        <textarea
          ref={textareaRef}
          class="min-h-8 max-h-32 w-full resize-none overflow-y-auto bg-transparent px-1 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none"
          placeholder="Describe what you want to create. Type / to open prompt history."
          value={prompt()}
          onInput={handlePromptInput}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div class="flex min-h-4 w-full items-center justify-between">
        <div class="flex min-w-0 items-center gap-1 overflow-x-auto pr-1">
          <PromptInputCompactMenu
            aria-label="Select prompt mode"
            menuLabel="Generate"
            value={() => mode()}
            options={PROMPT_INPUT_MODE_OPTIONS}
            onChange={handleModeChange}
          />
          <Tooltip>
            <TooltipTrigger
              as={Button}
              variant="ghost"
              size="icon-square"
              class="text-muted-foreground"
              onClick={() => setSettingsVisible(!settingsVisible())}
            >
              <Icon name="preferences-adjust" class="size-6" />
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
          <Show when={settingsVisible()}>
            <Separator orientation="vertical" class="min-h-5" />
            <Switch>
              <Match when={mode() === "IMAGE"}>
                <>
                  <ModelMenu
                    searchPlaceholder="Search in image models"
                    options={PROMPT_INPUT_IMAGE_MODEL_OPTIONS}
                    value={modelAccessor}
                    onChange={(v) => patch({ model: v })}
                  />
                  <PromptInputCompactMenu
                    aria-label="Select aspect ratio"
                    menuLabel="Aspect ratio"
                    value={aspectRatioAccessor}
                    options={PROMPT_INPUT_IMAGE_ASPECT_RATIO_OPTIONS}
                    onChange={(v) => patch({ aspectRatio: v as AspectRatio })}
                    triggerIcon="aspect-ratio-16-9"
                  />
                  <PromptInputCompactMenu
                    aria-label="Select amount of variants"
                    menuLabel="Amount of variants"
                    value={variantCountAccessor}
                    options={PROMPT_INPUT_VARIANT_COUNT_OPTIONS}
                    onChange={(v) => patch({ count: Number(v) })}
                    triggerIcon="variants"
                  />
                </>
              </Match>
              <Match when={mode() === "VIDEO"}>
                <>
                  <ModelMenu
                    searchPlaceholder="Search in video models"
                    options={PROMPT_INPUT_VIDEO_MODEL_OPTIONS}
                    value={modelAccessor}
                    onChange={handleVideoModelChange}
                  />
                  <PromptInputCompactMenu
                    aria-label="Select aspect ratio"
                    menuLabel="Aspect ratio"
                    value={aspectRatioAccessor}
                    options={videoAspectRatioOptions()}
                    onChange={(v) => patch({ aspectRatio: v as AspectRatio })}
                    triggerIcon="aspect-ratio-16-9"
                  />
                  {/* <PromptInputCompactMenu
                    aria-label="Select resolution"
                    menuLabel="Resolution"
                    value={resolution}
                    options={PROMPT_INPUT_RESOLUTION_OPTIONS}
                    onChange={setResolution}
                    triggerIcon="resolution"
                  /> */}
                  <PromptInputCompactMenu
                    aria-label="Select duration"
                    menuLabel="Duration"
                    value={durationAccessor}
                    options={videoDurationOptions()}
                    onChange={(v) => patch({ duration: parseInt(v) })}
                    triggerIcon="duration"
                  />
                  <Show when={currentVideoModel()?.features.includes("audio")}>
                    <Button
                      variant="ghost"
                      onClick={() => patch({ generateAudio: !audioEnabledAccessor() })}
                      class={DEFAULT_BUTTON_CLASS}
                    >
                      <Icon
                        name={audioEnabledAccessor() ? "audio-on" : "audio-off"}
                        class="size-6"
                      />
                      {audioEnabledAccessor() ? "On" : "Off"}
                    </Button>
                  </Show>
                </>
              </Match>
              <Match when={mode() === "VOICE"}>
                <VoiceMenu
                  options={PROMPT_INPUT_VOICE_OPTIONS}
                  value={voiceAccessor}
                  onChange={(v) => patch({ voice: v })}
                />
              </Match>
              <Match when={mode() === "AUDIO"}>
                <ModelMenu
                  searchPlaceholder="Search in audio models"
                  options={PROMPT_INPUT_AUDIO_MODEL_OPTIONS}
                  value={modelAccessor}
                  onChange={(v) => patch({ model: v })}
                />
              </Match>
            </Switch>
          </Show>
        </div>
        <Tooltip>
          <TooltipTrigger
            as={Button}
            variant="default"
            size="icon-square"
            disabled={!hasPromptText()}
            onClick={handleSubmit}
          >
            <Icon name="arrow-right" class="-rotate-90 size-6" />
          </TooltipTrigger>
          <TooltipContent shortcut="↵">Generate</TooltipContent>
        </Tooltip>
      </div>
      <Show when={isDragging()}>
        <div class="absolute inset-0 z-20 rounded-xl bg-background border border-primary p-2 overflow-hidden">
          <div class="absolute inset-0 bg-accent/40 rounded-xl" />
          <div class="flex size-full items-center justify-center rounded-md border border-dashed border-border-input">
            <Icon name="attachment" class="size-6 text-muted-foreground" />
            <span class="text-xs font-450 text-muted-foreground">Drop images here</span>
          </div>
        </div>
      </Show>
    </div>
  );
}


type PromptInputCompactMenuProps = {
  menuLabel: string;
  value: Accessor<string>;
  options: { value: string; label: string; triggerLabel?: string; icon?: string }[];
  onChange: (value: string) => void;
  triggerIcon?: string;
}

function PromptInputCompactMenu(props: PromptInputCompactMenuProps) {
  const selectedOption = () =>
    props.options.find((option) => option.value === props.value()) ?? props.options[0];
  const selectedIcon = () => selectedOption()?.icon ?? props.triggerIcon ?? "chevron-down";
  const selectedLabel = () => selectedOption()?.triggerLabel ?? selectedOption()?.label ?? "";

  return (
    <DropdownMenu placement="top-start">
      <DropdownMenuTrigger<typeof Button>
        as={(triggerProps) => (
          <Button
            {...triggerProps}
            variant="ghost"
            class={DEFAULT_BUTTON_CLASS}
          >
            <Icon name={selectedIcon()} class="size-6" />
            {selectedLabel()}
          </Button>
        )}
      />
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-40 gap-0 p-2">
          <div class="flex h-8 items-center px-1 text-xs text-muted-foreground">
            {props.menuLabel}
          </div>
          <DropdownMenuGroup>
            <For each={props.options}>
              {(option) => {
                const selected = () => props.value() === option.value;

                return (
                  <DropdownMenuItem
                    tone="neutral"
                    class="h-8 px-0 data-highlighted:bg-input"
                    onSelect={() => props.onChange(option.value)}
                  >
                    <Show when={option.icon}>
                      {(icon) => (
                        <span class="grid h-7 w-7 shrink-0 place-items-center overflow-clip">
                          <Icon name={icon()} class="size-6 text-muted-foreground" />
                        </span>
                      )}
                    </Show>
                    <span
                      class={cx(
                        "min-w-0 flex-1 truncate",
                        selected() ? "text-foreground" : "text-muted-foreground",
                        !option.icon && "pl-2",
                      )}
                    >
                      {option.label}
                    </span>
                    <span class="grid h-7 w-7 shrink-0 place-items-center overflow-clip">
                      <Show when={selected()}>
                        <Icon name="confirm-check" class="size-6 text-foreground" />
                      </Show>
                    </span>
                  </DropdownMenuItem>
                );
              }}
            </For>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}

type ModelMenuProps = {
  searchPlaceholder: string;
  options: { id: string; name: string; description: string; icon: string }[];
  value: Accessor<string>;
  onChange(value: string): void;
}

function ModelMenu(props: ModelMenuProps) {
  const [query, setQuery] = createSignal("");

  const filteredOptions = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return props.options;
    return props.options.filter(
      (o) => o.name.toLowerCase().includes(q) || o.description.toLowerCase().includes(q),
    );
  });

  const handleOpenChange = (open: boolean) => {
    if (!open) setQuery("");
  };

  const icon = createMemo(() => {
    const option = props.options.find((o) => o.id === props.value());
    return option?.icon ?? props.options[0].icon;
  });

  const name = createMemo(() => {
    const option = props.options.find((o) => o.id === props.value());
    return option?.name ?? props.options[0].name;
  });

  return (
    <DropdownMenu placement="top-start" onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger<typeof Button>
        as={(triggerProps) => (
          <Button
            {...triggerProps}
            variant="ghost"
            class={DEFAULT_BUTTON_CLASS}
          >
            <Icon name={icon()} class="size-6" />
            {name()}
          </Button>
        )}
      />
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-[340px] p-0">
          <SearchInput
            placeholder={props.searchPlaceholder}
            value={query()}
            onValue={setQuery}
          />
          <div class="flex flex-col gap-2 px-2 py-1">
            <For each={filteredOptions()}>
              {(option) => {
                const selected = props.value() === option.id;

                return (
                  <DropdownMenuItem
                    tone="neutral"
                    class="h-[42px] gap-2 rounded-md px-1 py-1 group"
                    onSelect={() => props.onChange(option.id)}
                    classList={{
                      "data-highlighted:bg-muted": selected,
                    }}
                  >
                    <div class="grid size-8 shrink-0 place-items-center overflow-hidden rounded-sm" >
                      <Icon name={option.icon!} class="size-6 text-muted-foreground" />
                    </div>
                    <div class="min-w-0 flex-1 text-muted-foreground">
                      <div class="truncate font-450 group-hover:text-foreground" classList={{ "text-foreground": selected }}>{option.name}</div>
                      <div class="truncate">{option.description}</div>
                    </div>
                    <span class="grid size-7 place-items-center">
                      <Show when={selected}>
                        <Icon name="confirm-check" class="size-6 text-foreground" />
                      </Show>
                    </span>
                  </DropdownMenuItem>
                )
              }}
            </For>
          </div>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}


type VoiceMenuProps = {
  options: { value: string; label: string; thumbnail: string; description: string; previewUrl: string }[];
  value: Accessor<string>;
  onChange(value: string): void;
}

function VoiceMenu(props: VoiceMenuProps) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [playingVoice, setPlayingVoice] = createSignal<string | null>(null);

  let audioRef: HTMLAudioElement | undefined;

  const selectedLabel = () =>
    props.options.find((o) => o.value === props.value())?.label ?? props.value();

  const filteredOptions = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return props.options;
    return props.options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.description.toLowerCase().includes(q),
    );
  });

  const stopPlayback = () => {
    if (audioRef) {
      audioRef.pause();
      audioRef.src = "";
      audioRef = undefined;
    }
    setPlayingVoice(null);
  };

  const togglePreview = (voiceId: string) => {
    if (playingVoice() === voiceId) {
      stopPlayback();
      return;
    }

    stopPlayback();
    const url = props.options.find((o) => o.value === voiceId)?.previewUrl;
    if (!url) return;

    audioRef = new Audio(url);
    audioRef.addEventListener("ended", () => setPlayingVoice(null));
    audioRef.play();
    setPlayingVoice(voiceId);
  };

  const selectVoice = (voiceId: string) => {
    props.onChange(voiceId);
    setOpen(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setQuery("");
      stopPlayback();
    }
  };

  onCleanup(stopPlayback);

  return (
    <Popover placement="top-start" open={open()} onOpenChange={handleOpenChange}>
      <PopoverTrigger<typeof Button>
        as={(triggerProps) => (
          <Button
            {...triggerProps}
            variant="ghost"
            class={DEFAULT_BUTTON_CLASS}
          >
            <Icon name="user" class="size-6" />
            {selectedLabel()}
          </Button>
        )}
      />
      <PopoverPortal>
        <PopoverContent class="w-[340px] p-0 rounded-xl">
          <SearchInput
            placeholder="Search in voices"
            value={query()}
            onValue={setQuery}
          />
          <div class="flex flex-col gap-2 p-2 max-h-[320px] overflow-y-auto">
            <For each={filteredOptions()}>
              {(option) => {
                const selected = () => props.value() === option.value;
                const isPlaying = () => playingVoice() === option.value;

                return (
                  <button
                    type="button"
                    class="flex items-center gap-2 rounded-md px-1 py-1 h-[42px] w-full text-left group hover:bg-accent transition-colors"
                    classList={{ "bg-muted": selected() }}
                    onClick={() => selectVoice(option.value)}
                  >
                    <div
                      class="group/thumb relative grid size-8 rounded-full overflow-hidden shrink-0 place-items-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePreview(option.value);
                      }}
                    >
                      <img src={option.thumbnail} alt={option.label} class="w-full h-full object-cover" />
                      <div
                        class="absolute inset-0 grid place-items-center rounded-full bg-black/0 transition-colors group-hover/thumb:bg-black/60"
                        classList={{ "bg-black/60": isPlaying() }}
                      >
                        <Icon
                          name={isPlaying() ? "pause" : "play"}
                          class={cx("size-6 text-white transition-opacity group-hover/thumb:opacity-100", isPlaying() ? "opacity-100" : "opacity-0")}
                        />
                      </div>
                    </div>
                    <div class="min-w-0 flex-1 text-muted-foreground">
                      <div
                        class="truncate text-base font-450 group-hover:text-foreground"
                        classList={{ "text-foreground": selected() }}
                      >
                        {option.label}
                      </div>
                      <div class="truncate text-base">{option.description}</div>
                    </div>
                    <span class="grid size-7 place-items-center shrink-0">
                      <Show when={selected()}>
                        <Icon name="confirm-check" class="size-6 text-foreground" />
                      </Show>
                    </span>
                  </button>
                )
              }}
            </For>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

type PromptInputReferenceImageButtonProps = {
  asset: Asset;
  class?: string;
  size?: { width: number; height: number };
  onRemove(): void;
}

function PromptInputReferenceImageButton(props: PromptInputReferenceImageButtonProps) {
  return (
    <div class={cx("group relative shrink-0", props.class)}>
      <div class="size-full overflow-hidden rounded-md bg-input outline-none">
        <AssetThumbnail asset={props.asset} class="size-full" size={props.size} />
      </div>
      <Show when={props.onRemove}>
        <button
          type="button"
          class="absolute right-0 top-0 z-10 grid size-8 place-items-center opacity-0 transition-opacity group-hover:opacity-100"
          onClick={props.onRemove}
        >
          <div class="size-5 flex items-center justify-center overflow-hidden rounded-full border border-border bg-background">
            <Icon name="close-remove-small" class="size-6 min-w-6 min-h-6" />
          </div>
        </button>
      </Show>
    </div>
  );
}

type PromptInputAttachButtonProps = {
  icon: string;
  label: string;
  class?: string;
  onClick(): void;
}

export function PromptInputAttachButton(props: PromptInputAttachButtonProps) {
  return (
    <button
      type="button"
      class={cx(
        "flex h-16 shrink-0 items-center justify-center gap-1 overflow-clip rounded-md bg-secondary active:bg-secondary-pressing pl-3 pr-4 py-2 text-muted-foreground transition-colors hover:bg-muted",
        props.class,
      )}
      onClick={props.onClick}
    >
      <Icon name={props.icon} class="size-6" />
      <span class="whitespace-nowrap text-xs">
        {props.label}
      </span>
    </button>
  );
}
