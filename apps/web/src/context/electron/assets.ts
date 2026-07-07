/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { ElectronFileHandle } from '@/lib/electron-file-handle';
import { ElectronWritableFileHandle } from '@/lib/electron-file-writable';
import { trpc } from '@/lib/trpc';
import { uploadBlob, visualizeAsset, loadAsset, removeAsset, saveAsset } from '@/components/engine';
import { assert, mimeTypeToExtension } from '@/utils';
import {
  transcodeForTranscription,
  transcodeForAnalysis,
  startResumableSession,
  uploadResumableStream,
  assetFolderId,
  moveAssetsToFolder,
  useFolders,
} from '@/components/engine';

import type { Engine } from "@/components/engine";
import type { Asset } from "@/components/engine/db";
import type { AssetAnalyzeRequest, AssetAnalyzeResult, AssetExportResult, AssetListResult, AssetMoveResult, AssetProbeRequest, AssetRecord, AssetsExportRequest, AssetTranscribeResult, AssetTreeEntry, AssetVisualizeRequest, AssetVisualizeResult } from "@diffusionstudio/cli/channels";
import type { Accessor } from "solid-js";

export function handleAssetsAdd(engine: Accessor<Engine>) {
  return async ({ paths, folderId }: { paths: string[]; folderId?: string }) => {
    const { world } = engine();
    if (folderId !== undefined) {
      assert(world.folders.has(folderId), `Folder ${folderId} not found.`);
    }
    const settled = await Promise.allSettled(
      paths.map((path) => loadAsset(world, new ElectronFileHandle(path), { folderId }))
    );

    const results = settled.map((r, i) =>
      r.status === 'rejected'
        ? { status: "rejected", path: paths[i], error: (r.reason as Error)?.message ?? String(r.reason) }
        : { status: "fulfilled", ...r.value }
    );
    return results;
  }
}

/**
 * The persisted asset record minus the props that can't cross the wire
 */
function toAssetRecord(asset: Asset): AssetRecord {
  const record: Record<string, unknown> = { ...asset };
  delete record.handle;
  delete record.directoryHandle;
  delete record.hash;
  delete record.transcript;
  return record as AssetRecord;
}

export function handleAssetsList(engine: Accessor<Engine>) {
  return async ({ ids }: { ids?: string[] }): Promise<AssetListResult[]> => {
    const { world } = engine();

    // No ids → every asset in the library
    if (ids === undefined || ids.length === 0) {
      return Array.from(world.assets.values()).map((asset) => ({
        status: "fulfilled",
        asset: toAssetRecord(asset),
      }));
    }

    return ids.map((id) => {
      const asset = world.assets.get(id);
      return asset
        ? { status: "fulfilled", asset: toAssetRecord(asset) }
        : { status: "rejected", id, error: `No such asset: ${id}` };
    });
  };
}

export function handleAssetTree(engine: Accessor<Engine>) {
  return async ({ folderId, depth }: { folderId?: string; depth?: number }): Promise<AssetTreeEntry[]> => {
    const { world } = engine();
    if (folderId !== undefined) {
      assert(world.folders.has(folderId), `Folder ${folderId} not found.`);
    }

    const { childrenOf } = useFolders(world);
    const assets = Array.from(world.assets.values());

    // Visited set guards against parentId cycles in corrupt data.
    const visited = new Set<string>();
    const entries = (parentId: string | null, remaining: number | undefined): AssetTreeEntry[] => {
      const folderEntries = childrenOf(parentId)
        .filter((folder) => !visited.has(folder.id))
        .map((folder) => {
          visited.add(folder.id);
          const next = remaining === undefined ? undefined : remaining - 1;
          const children = next === undefined || next > 0 ? entries(folder.id, next) : [];
          return {
            id: folder.id,
            name: folder.name,
            type: "folder",
            ...(children.length > 0 && { children }),
          };
        });
      const assetEntries = assets
        .filter((asset) => assetFolderId(world, asset) === parentId)
        .map((asset) => ({ id: asset.id, name: asset.name, type: asset.type }));
      return [...folderEntries, ...assetEntries];
    };

    return entries(folderId ?? null, depth);
  }
}

export function handleAssetsMove(engine: Accessor<Engine>) {
  return async ({ ids, to }: { ids: string[]; to?: string }): Promise<AssetMoveResult[]> => {
    const { world } = engine();
    if (to !== undefined) {
      assert(world.folders.has(to), `Folder ${to} not found.`);
    }
    const folderId = to ?? null;
    const results: AssetMoveResult[] = ids.map((id) =>
      world.assets.has(id)
        ? { status: "fulfilled", id, folderId }
        : { status: "rejected", id, error: "Not found" });
    const foundIds = results.filter((r) => r.status === "fulfilled").map((r) => r.id);
    if (foundIds.length > 0) await moveAssetsToFolder(world, foundIds, folderId);
    return results;
  }
}

export function handleAssetsDelete(engine: Accessor<Engine>) {
  return async ({ ids }: { ids: string[] }) => {
    const { world } = engine();
    const results = ids.map((id) => {
      const asset = world.assets.get(id);
      return asset
        ? { status: "fulfilled", id, name: asset.name }
        : { status: "rejected", id, error: "Not found" };
    });
    const foundIds = results.filter((r) => r.status === "fulfilled").map((r) => r.id);
    if (foundIds.length > 0) await removeAsset(world, ...foundIds);
    return results;
  }
}

export function handleAssetsExport(engine: Accessor<Engine>) {
  return async ({ ids, output, isDir }: AssetsExportRequest): Promise<AssetExportResult[]> => {
    const { world } = engine();
    const results: AssetExportResult[] = [];
    for (const id of ids) {
      try {
        const asset = world.assets.get(id);
        assert(asset, `Asset ${id} not found.`);
        assert(asset.type !== "SEQUENCE", `Asset ${id} is an image sequence; export is not supported.`);
        const blob = await asset.handle.getFile();
        const path = isDir
          ? await streamBlobToDir(blob, output, exportFileName(asset))
          : await streamBlobToFile(blob, output);
        results.push({ status: "fulfilled", id, path });
      } catch (e) {
        results.push({ status: "rejected", id, error: (e as Error)?.message ?? String(e) });
      }
    }
    return results;
  };
}

/**
 * Strips characters that are path separators or invalid on Windows
 */
function exportFileName(asset: Asset): string {
  // eslint-disable-next-line no-control-regex -- control chars are stripped deliberately
  const sanitized = asset.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  const name = sanitized || asset.id;
  return /\.[^.\s]{1,8}$/.test(name) ? name : name + mimeTypeToExtension(asset.mimeType);
}

const MAX_UNIQUIFY = 1000;

async function streamBlobToDir(blob: Blob, dir: string, fileName: string): Promise<string> {
  // Joining with "/" is safe on Windows too — node's fs accepts it.
  const base = dir.replace(/[\\/]+$/, "");
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  for (let n = 0; n < MAX_UNIQUIFY; n++) {
    const path = `${base}/${n === 0 ? fileName : `${stem} (${n})${ext}`}`;
    const handle = new ElectronWritableFileHandle(path);
    let writable: WritableStream;
    try {
      writable = await handle.createWritable({ exclusive: true });
    } catch (e) {
      if (/EEXIST/.test((e as Error)?.message ?? "")) continue; // name taken — try the next suffix
      throw e;
    }
    await pumpBlob(blob, writable, handle);
    return path;
  }
  throw new Error(`Could not find a free file name for "${fileName}" in ${base}.`);
}

async function streamBlobToFile(blob: Blob, path: string): Promise<string> {
  const handle = new ElectronWritableFileHandle(path);
  await pumpBlob(blob, await handle.createWritable(), handle);
  return path;
}

/**
 * Streams the blob chunk-by-chunk to the open writable 
 */
async function pumpBlob(
  blob: Blob,
  writable: WritableStream,
  handle: ElectronWritableFileHandle,
): Promise<void> {
  const writer = writable.getWriter();
  const reader = blob.stream().getReader();
  let position = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write({ type: "write", data: value, position });
      position += value.byteLength;
    }
    await writer.close();
  } catch (e) {
    await handle.dispose().catch(() => {});
    throw e;
  }
}

const PROBE_SAMPLE_PACKETS = 200;

export function handleAssetProbe(engine: Accessor<Engine>) {
  return async ({ id }: AssetProbeRequest): Promise<unknown> => {
    const { world } = engine();
    const asset = world.assets.get(id);
    assert(asset, `Asset ${id} not found.`);

    const blob = await asset.handle.getFile();
    const base = {
      id,
      name: asset.name,
      type: asset.type,
      mimeType: asset.mimeType,
      size: blob.size,
      ...("width" in asset && { width: asset.width, height: asset.height }),
    };

    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    try {
      const format = await input.getFormat();
      const mimeType = await input.getMimeType();
      const duration = await input.computeDuration();
      const { images, ...tags } = await input.getMetadataTags();
      delete tags.raw;

      const tracks: Array<Record<string, unknown>> = [];
      for (const track of await input.getTracks()) {
        const stats = await track.computePacketStats(PROBE_SAMPLE_PACKETS);
        tracks.push({
          id: track.id,
          type: track.type,
          codec: track.codec,
          language: track.languageCode,
          firstTimestamp: await track.getFirstTimestamp(),
          duration: await track.computeDuration(),
          ...stats,
          ...(track.isVideoTrack() && {
            codedWidth: track.codedWidth,
            codedHeight: track.codedHeight,
            displayWidth: track.displayWidth,
            displayHeight: track.displayHeight,
            rotation: track.rotation,
          }),
          ...(track.isAudioTrack() && {
            sampleRate: track.sampleRate,
            channels: track.numberOfChannels,
          }),
        });
      }

      return {
        ...base,
        format: format.name,
        mimeType,
        duration,
        tags: { ...tags, ...(images?.length && { attachedImages: images.length }) },
        tracks,
      };
    } catch {
      return { ...base, format: null, tracks: [] };
    } finally {
      input.dispose();
    }
  };
}

export function handleAssetFrame(engine: Accessor<Engine>) {
  return async ({ id, times }: { id: string; times?: number[] }) => {
    const { world } = engine();
    const asset = world.assets.get(id);
    assert(asset, `Asset ${id} not found.`);
    assert(asset.type === "VIDEO", `Asset ${id} is not a video.`);

    const requested = times && times.length ? times : [0];
    for (const t of requested) {
      assert(t <= asset.duration, `--time ${t}s is past the asset's duration (${asset.duration.toFixed(2)}s).`);
    }

    const blob = await asset.handle.getFile();
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    try {
      const track = await input.getPrimaryVideoTrack();
      assert(track, `Asset ${id} has no video track.`);

      // Track timestamps may not start at 0; offset content time by the first.
      const firstTimestamp = (await track.getFirstTimestamp()) ?? 0;

      // Decode in ascending order (the sink's fast path), remember each
      // entry's original slot so output mirrors the requested order.
      const ordered = requested.map((time, index) => ({ time, index })).sort((a, b) => a.time - b.time);

      // No pool: each yielded canvas is fresh, so converting to PNG can't race
      // the generator's read-ahead reusing a pooled canvas.
      const sink = new CanvasSink(track);
      const timestamps = ordered.map(({ time }) => firstTimestamp + time);

      const result: Array<{ time: number; base64: string }> = new Array(requested.length);
      let i = 0;
      for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
        const { time, index } = ordered[i++];
        assert(wrapped, `No frame found at ${time}s.`);
        result[index] = { time, base64: await canvasToPngBase64(wrapped.canvas) };
      }
      return result;
    } finally {
      input.dispose();
    }
  };
}

export function handleAssetTranscribe(engine: Accessor<Engine>) {
  return async ({ id }: { id: string }): Promise<AssetTranscribeResult> => {
    const { world } = engine();
    const asset = world.assets.get(id);
    assert(asset, `Asset ${id} not found.`);
    assert(
      asset.type === "AUDIO" || asset.type === "VIDEO",
      `Asset ${id} is not a video or audio asset.`,
    );

    if (asset.transcript) {
      return { id, segments: asset.transcript };
    }

    const uploadId = crypto.randomUUID();
    const audioFile = await transcodeForTranscription(asset);
    const fileRef = await uploadBlob(audioFile, uploadId);
    if (!fileRef) throw new Error(`Failed to upload asset ${id} for transcription.`);

    const { results: transcript } = await trpc.transcribe.mutate({ audio: fileRef });
    if (!transcript.length || transcript.every((s) => s.words.length === 0)) {
      throw new Error("No speech detected. The audio does not appear to contain recognizable speech.");
    }

    await saveAsset(world, { ...asset, transcript });

    return { id, segments: transcript };
  };
}

export function handleAssetVisualize(engine: Accessor<Engine>) {
  return async (req: AssetVisualizeRequest): Promise<AssetVisualizeResult> => {
    const { world } = engine();
    const asset = world.assets.get(req.id);
    assert(asset, `Asset ${req.id} not found.`);
    const { dataUrl, ...rest } = await visualizeAsset(asset, { start: req.start, end: req.end, scale: req.scale });
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return { base64, ...rest };
  };
}

export function handleAssetAnalyze(engine: Accessor<Engine>) {
  return async ({ id, prompt, start, end }: AssetAnalyzeRequest): Promise<AssetAnalyzeResult> => {
    const { world } = engine();
    const asset = world.assets.get(id);
    assert(asset, `Asset ${id} not found.`);
    assert(
      asset.type === "IMAGE" || asset.type === "AUDIO" || asset.type === "VIDEO",
      `Asset ${id} is not an image, audio, or video asset.`,
    );

    const hasWindow = start !== undefined || end !== undefined;

    let contentType = asset.mimeType;
    if (asset.type === "VIDEO") {
      contentType = "video/mp4";
    } else if (asset.type === "AUDIO") {
      contentType = "audio/ogg";
    }

    const window = hasWindow ? `-${start ?? 0}-${end ?? "end"}` : "";
    const uploadId = `${world.projectId}-${asset.id}-analyze${window}`;
    const { uploadUrl, fileRef } = await trpc.getUploadUrl.mutate({
      action: "resumable",
      id: uploadId,
      contentType,
    });

    // Transcoding pending
    if (uploadUrl) {
      const transcoder = await transcodeForAnalysis(asset, { start, end });
      const sessionUrl = await startResumableSession(uploadUrl, contentType);
      const uploadPromise = uploadResumableStream(transcoder.readable, sessionUrl);
      await transcoder.run?.();
      await uploadPromise;
    }

    const { analysis } = await trpc.analyze.mutate({ media: fileRef, prompt });

    return { id, analysis, start, end };
  };
}

async function canvasToPngBase64(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<string> {
  if (canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return base64FromArrayBuffer(await blob.arrayBuffer());
  }
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

function base64FromArrayBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// hmr-probe-test
