/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { Show, For, createResource } from 'solid-js';
import { cx } from '@/lib/cva';
import { getAssetFile, getAudioPeaksAsync } from '@diffusionstudio/runtime';

import type { AudioAsset, VideoAsset } from '@diffusionstudio/assets';

/**
 * What a thumbnail needs of an asset: the runtime's `Asset` and the legacy
 * engine's both qualify.
 */
export type ThumbnailAsset = {
  id: string;
  type: string;
  mimeType: string;
  handle: { getFile(): Promise<File> };
  width?: number;
  height?: number;
  stat?: { mtime: number };
  lastModified?: number;
};

type Asset = ThumbnailAsset;

/** Re-renders a thumbnail when the asset, or the file behind it, changes. */
const keyOf = (asset: Asset): string => `${asset.id}:${asset.stat?.mtime ?? asset.lastModified ?? ''}`;

const DEFAULT_THUMBNAIL_SIZE = {
  width: 300,
  height: 168,
} as const;

type ThumbnailSize = {
  width: number;
  height: number;
};

function ImageThumbnail(props: { asset: Asset; size: ThumbnailSize }) {
  const [url] = createResource(
    () => keyOf(props.asset),
    async () => {
      const objectUrl = URL.createObjectURL(await getAssetFile(props.asset));
      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('Failed to load image'));
          img.src = objectUrl;
        });

        const canvas = document.createElement('canvas');
        canvas.width = props.size.width;
        canvas.height = props.size.height;
        const ctx = canvas.getContext('2d')!;

        const imgW = image.naturalWidth || props.asset.width || props.size.width;
        const imgH = image.naturalHeight || props.asset.height || props.size.height;
        const scale = Math.max(props.size.width / imgW, props.size.height / imgH);
        const scaledW = imgW * scale;
        const scaledH = imgH * scale;
        const dx = (props.size.width - scaledW) / 2;
        const dy = (props.size.height - scaledH) / 2;

        ctx.drawImage(image, dx, dy, scaledW, scaledH);
        const url = canvas.toDataURL('image/webp', 0.7);

        canvas.width = 0;
        canvas.height = 0;

        return url;
      } catch {
        return undefined;
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }
  );

  return (
    <Show when={url()}>
      <img
        src={url()!}
        alt=""

        class="w-full h-full object-cover select-none"
      />
    </Show>
  );
}

function VideoThumbnail(props: { asset: Asset; size: ThumbnailSize }) {
  const [src] = createResource(
    () => keyOf(props.asset),
    async () => {
      try {
        const file = await getAssetFile(props.asset);

        const input = new Input({
          formats: ALL_FORMATS,
          source: new BlobSource(file),
        });

        const track = await input.getPrimaryVideoTrack();
        if (!track) return;

        const sink = new CanvasSink(track, {
          width: props.size.width,
          height: props.size.height,
          fit: 'cover',
        });

        const ts = await track.getFirstTimestamp();
        const wrappedCanvas = await sink.getCanvas(ts + 0.3);
        if (!wrappedCanvas) return;

        const canvas = document.createElement('canvas');
        canvas.width = wrappedCanvas.canvas.width;
        canvas.height = wrappedCanvas.canvas.height;
        canvas.getContext('2d')?.drawImage(wrappedCanvas.canvas, 0, 0);
        const url = canvas.toDataURL('image/webp', 0.7);
        canvas.width = 0;
        canvas.height = 0;
        return url;
      } catch {
        return undefined;
      }
    }
  );

  return (
    <Show when={src()}>
      <img
        src={src()!}
        alt=""

        class="w-full h-full object-cover select-none"
      />
    </Show>
  );
}

function TranscriptThumbnail() {
  return (
    <div class="absolute inset-0 bg-caption-background overflow-clip rounded-sm">
      <div class="absolute top-1 left-1 h-4 px-1 flex items-center bg-overlay rounded-sm">
        <span class="text-xxs text-foreground">Captions</span>
      </div>
      <div class="absolute top-9 left-1 right-0 bottom-1 flex items-center gap-0.5 overflow-clip">
        <div class="bg-caption-accent h-full rounded-sm shrink-0" style={{ width: '37px', 'min-width': '16px' }} />
        <div class="bg-caption-accent h-full rounded-sm shrink-0" style={{ width: '16px' }} />
        <div class="bg-caption-accent h-full rounded-sm shrink-0" style={{ width: '36px', 'min-width': '16px' }} />
        <div class="bg-caption-accent h-full rounded-sm shrink-0" style={{ width: '37px', 'min-width': '16px' }} />
      </div>
    </div>
  );
}

function AudioThumbnail(props: { asset: Asset }) {
  const [bins] = createResource(
    () => keyOf(props.asset),
    () => getAudioPeaksAsync(props.asset as unknown as AudioAsset | VideoAsset),
  );

  return (
    <div class="absolute inset-0 pt-7 pb-1 bg-audio-background">
      <div class="flex items-center justify-center w-full h-full">
        <Show when={bins()}>
          <For each={Array.from(bins()!)}>
            {value => {
              const height = Math.min(Math.max(2, (value / 255) * 100), 98);
              return <div class="bg-audio-primary flex-1 rounded-sm" style={{ height: `${height}%` }} />;
            }}
          </For>
        </Show>
      </div>
    </div>
  );
}

type AssetThumbnailProps = {
  asset: Asset;
  class?: string;
  draggable?: boolean;
  size?: ThumbnailSize;
}

export function AssetThumbnail(props: AssetThumbnailProps) {
  const size = () => props.size ?? DEFAULT_THUMBNAIL_SIZE;

  return (
    <div class={cx(props.class, 'relative')} draggable={props.draggable}>
      <Show when={props.asset.mimeType.startsWith('image')}>
        <ImageThumbnail asset={props.asset} size={size()} />
      </Show>
      <Show when={props.asset.mimeType.startsWith('video')}>
        <VideoThumbnail asset={props.asset} size={size()} />
      </Show>
      <Show when={props.asset.mimeType.startsWith('audio')}>
        <AudioThumbnail asset={props.asset} />
      </Show>
      <Show when={props.asset.type === 'TRANSCRIPT'}>
        <TranscriptThumbnail />
      </Show>
      <div class="absolute inset-0 bg-transparent" />
    </div>
  );
}
