/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { For, Show, Match, Switch, createMemo, createResource, createSignal, type Accessor } from "solid-js";
import {
  formatAspectRatio,
  formatBytes,
  formatChannels,
  formatDuration,
  formatMimeTypeLabel,
  formatAssetDate
} from "@/utils/formatters";
import { AssetInfoPreview } from "./asset-info-preview";
import { supabase } from "@/lib/supabase";
import { toClientConfig } from "@/components/genai/use-generation-records";
import { insertAssetInTimeline, replaceAssetHandle, useAssets } from "@/components/engine";
import { useEngine } from "@/context/engine";

import type { Asset } from "@/components/engine/db";


export function AssetInfoPanel() {
  const { world } = useEngine();
  const assets = useAssets(world);

  const [nameExpanded, setNameExpanded] = createSignal(false);

  const selectedAsset = () => assets.selected().values().next().value;

  const handleReplace = () => {
    const asset = selectedAsset();
    if (!asset) return;
    replaceAssetHandle(world, asset);
  };

  const handleInsert = () => {
    const asset = selectedAsset();
    if (!asset) return;
    insertAssetInTimeline(world, asset, 'playhead');
  };

  const metadataRows = useAssetMetadataRows(selectedAsset);

  return (
    <div class="flex flex-col w-full px-4 border-t border-border">
      <div class="h-12 flex items-center justify-between">
        <span class="text-base font-strong">Information</span>
        {/* <Button class="text-muted-foreground" size="icon" variant="ghost">
          <Icon name="more-three-dots-small" />
        </Button> */}
      </div>
      <Show when={selectedAsset()}>
        {asset => <AssetInfoPreview asset={asset()} />}
      </Show>

      <div class="flex flex-col gap-2 my-2">
        <Button variant="default" class="w-full" onClick={handleInsert}>
          Insert at playhead
        </Button>
        <Button variant="secondary" class="w-full" onClick={handleReplace}>
          Replace source
        </Button>
      </div>

      <button
        type="button"
        onClick={() => setNameExpanded((v) => !v)}
        class="py-3 border-t border-b border-border mt-2 text-left outline-none"
      >
        <span
          class="text-xs leading-none block"
          classList={{
            "truncate": !nameExpanded(),
            "break-all": nameExpanded(),
          }}
        >
          {selectedAsset()?.name ?? 'Untitled'}
        </span>
      </button>
      <div class="flex flex-col gap-1 my-2">
        <For each={metadataRows().filter((row) => row.value != null)}>
          {(row) => (
            <Switch>
              <Match when={row.label === "Prompt"}>
                <div class="flex flex-col gap-2 py-1 text-xs text-muted-foreground">
                  <span class="w-20 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {row.label}
                  </span>
                  <span class="min-w-0 text-left wrap-break-words">
                    {row.value}
                  </span>
                </div>
              </Match>
              <Match when={row.label !== "Prompt"}>
                <div class="flex h-7 items-center gap-2 text-xs text-muted-foreground">
                  <span class="w-20 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {row.label}
                  </span>
                  <span class="min-w-0 flex-1 text-right overflow-hidden text-ellipsis whitespace-nowrap">
                    {row.value}
                  </span>
                </div>
              </Match>
            </Switch>
          )}
        </For>
      </div>
    </div>
  );
}

export function useAssetMetadataRows(asset: Accessor<Asset | undefined>) {
  const generationId = createMemo(() => asset()?.generationId ?? null);

  const [config] = createResource(() => generationId(), async (id) => {
    if (!id || !supabase) return undefined;
    const { data, error } = await supabase
      .from("usage_records")
      .select("config")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("[asset-info] Failed to load generation record", error);
      return undefined;
    }
    return toClientConfig(data?.config);
  });

  return createMemo(() => {
    const a = asset();
    if (!a) return [];

    const dimensions =
      a.type === "IMAGE" || a.type === "VIDEO"
        ? `${a.width}\u00D7${a.height}`
        : null;
    const resolution = a.type === "VIDEO" ? `${a.height}p` : null;
    const aspectRatio =
      a.type === "IMAGE" || a.type === "VIDEO"
        ? formatAspectRatio(a.width, a.height)
        : null;
    const frameRate =
      a.type === "VIDEO"
        ? `${Math.round(a.frameRate)} FPS`
        : null;
    const duration =
      a.type === "VIDEO" || a.type === "AUDIO"
        ? formatDuration(a.duration)
        : null;
    const fileSize = a.size != null ? formatBytes(a.size) : null;
    const format = formatMimeTypeLabel(a.mimeType);
    const channels =
      a.type === "AUDIO" || a.type === "VIDEO"
        ? formatChannels(a.channels)
        : null;
    const imported = formatAssetDate(a.createdAt);
    const created = formatAssetDate(a.lastModified);
    const c = config();
    const prompt = c?.prompt ?? null;
    const model = c?.model ?? null;

    return [
      { label: "Dimensions", value: dimensions },
      { label: "Resolution", value: resolution },
      { label: "Aspect ratio", value: aspectRatio },
      { label: "Frame rate", value: frameRate },
      { label: "Duration", value: duration },
      { label: "File size", value: fileSize },
      { label: "Format", value: format },
      { label: "Channels", value: channels },
      { label: "Imported", value: imported },
      { label: "Created", value: created },
      { label: "Prompt", value: prompt },
      { label: "Model", value: model },
    ];
  });
}
