/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { ElectronFileHandle } from '@/lib/electron-file-handle';
import { ElectronWritableFileHandle } from '@/lib/electron-file-writable';
import { trpc } from '@/lib/trpc';
import { uploadBlob, visualizeAsset, loadAsset, removeAsset, describeFileAsset, getAssetFile, formatTimestamp } from '@/components/engine';
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
import type { AssetAnalyzeRequest, AssetAnalyzeResult, AssetExportResult, AssetFrameRequest, AssetListResult, AssetMoveResult, AssetProbeRequest, AssetRecord, AssetRef, AssetsExportRequest, AssetTranscribeRequest, AssetTranscribeResult, AssetTreeEntry, AssetVisualizeRequest, AssetVisualizeResult, TranscriptSegment } from "@diffusionstudio/cli/channels";
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
        : { status: "fulfilled", ...toAssetRecord(r.value) }
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
        const blob = await getAssetFile(asset);
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
    for (; ;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write({ type: "write", data: value, position });
      position += value.byteLength;
    }
    await writer.close();
  } catch (e) {
    await handle.dispose().catch(() => { });
    throw e;
  }
}

/**
 * Resolves a command target: an id looks up the project's asset library, a
 * path describes the file in place as an ephemeral asset (never added to the
 * library). Ephemeral assets carry the path as their id.
 */
async function resolveAssetRef(world: Engine["world"], ref: AssetRef): Promise<Asset> {
  if ("path" in ref) return describeFileAsset(new ElectronFileHandle(ref.path));
  const asset = world.assets.get(ref.id);
  assert(asset, `Asset ${ref.id} not found.`);
  return asset;
}

const PROBE_SAMPLE_PACKETS = 200;

export function handleAssetProbe(engine: Accessor<Engine>) {
  return async (req: AssetProbeRequest): Promise<unknown> => {
    const { world } = engine();
    const asset = await resolveAssetRef(world, req);

    const blob = await getAssetFile(asset);
    const base = {
      id: asset.id,
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

// Default cap on the pixel count of each decoded frame (384x384). Keeps frames
// small enough for vision models without the caller having to know the aspect ratio.
export const DEFAULT_FRAME_PIXEL_BUDGET = 384 * 384;

export function handleAssetFrame(engine: Accessor<Engine>) {
  return async (req: AssetFrameRequest) => {
    const { times, resolution } = req;
    const { world } = engine();
    const asset = await resolveAssetRef(world, req);
    const id = asset.id;
    assert(asset.type === "VIDEO", `Asset ${id} is not a video.`);

    const requested = times && times.length ? times : [0];
    for (const t of requested) {
      assert(t <= asset.duration, `--time ${t}s is past the asset's duration (${asset.duration.toFixed(2)}s).`);
    }

    // A budget of 0 means "native resolution"; anything else caps the pixel count.
    const budget = resolution ?? DEFAULT_FRAME_PIXEL_BUDGET;

    const blob = await getAssetFile(asset);
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    try {
      const track = await input.getPrimaryVideoTrack();
      assert(track, `Asset ${id} has no video track.`);

      // Track timestamps may not start at 0; offset content time by the first.
      const firstTimestamp = (await track.getFirstTimestamp()) ?? 0;

      // Downscale to fit the pixel budget while preserving aspect ratio; setting
      // only the width lets the sink derive a matching height.
      const displayWidth = await track.getDisplayWidth();
      const displayHeight = await track.getDisplayHeight();
      let width: number | undefined;
      if (budget > 0 && displayWidth * displayHeight > budget) {
        width = Math.max(1, Math.round(displayWidth * Math.sqrt(budget / (displayWidth * displayHeight))));
      }

      // Decode in ascending order (the sink's fast path), remember each
      // entry's original slot so output mirrors the requested order.
      const ordered = requested.map((time, index) => ({ time, index })).sort((a, b) => a.time - b.time);

      // No pool: each yielded canvas is fresh, so converting to PNG can't race
      // the generator's read-ahead reusing a pooled canvas.
      const sink = new CanvasSink(track, width !== undefined ? { width } : undefined);
      const timestamps = ordered.map(({ time }) => firstTimestamp + time);

      const result: Array<{ time: number; base64: string }> = new Array(requested.length);
      let i = 0;
      for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
        const { time, index } = ordered[i++];
        assert(wrapped, `No frame found at ${time}s.`);

        const ctx = wrapped.canvas.getContext("2d");

        if (ctx) {
          const label = formatTimestamp(time, asset.frameRate)
          const bandHeight = Math.max(20, Math.round(wrapped.canvas.height * 0.06));
          const fontSize = Math.round(bandHeight * 0.72);
          const paddingLeft = Math.round(bandHeight * 0.4);
          const y = paddingLeft + bandHeight / 2;

          ctx.font = `normal ${fontSize}px sans-serif`;
          ctx.textBaseline = "middle";
          ctx.textAlign = "left";

          ctx.lineJoin = "round";
          ctx.lineWidth = Math.max(2, Math.round(fontSize / 3));
          ctx.strokeStyle = "#000";
          ctx.strokeText(label, paddingLeft, y);
          ctx.fillStyle = "#FFF";
          ctx.fillText(label, paddingLeft, y);
        }

        result[index] = { time, base64: await canvasToPngBase64(wrapped.canvas) };
      }
      return result;
    } finally {
      input.dispose();
    }
  };
}

const transcripts = new Map<string, TranscriptSegment[]>();

export function handleAssetTranscribe(engine: Accessor<Engine>) {
  return async (req: AssetTranscribeRequest): Promise<AssetTranscribeResult> => {
    const { start, end } = req;
    const { world } = engine();
    const asset = await resolveAssetRef(world, req);
    const id = asset.id;
    assert(
      asset.type === "AUDIO" || asset.type === "VIDEO",
      `Asset ${id} is not a video or audio asset.`,
    );

    let transcript = transcripts.get(asset.hash);
    if (!transcript) {
      const uploadId = crypto.randomUUID();
      const audioFile = await transcodeForTranscription(asset);
      const fileRef = await uploadBlob(audioFile, uploadId);
      if (!fileRef) throw new Error(`Failed to upload asset ${id} for transcription.`);

      ({ results: transcript } = await trpc.transcribe.mutate({ audio: fileRef }));
      if (!transcript.length || transcript.every((s) => s.words.length === 0)) {
        throw new Error("No speech detected. The audio does not appear to contain recognizable speech.");
      }

      transcripts.set(asset.hash, transcript);
    }

    return { segments: sliceTranscript(transcript, start, end) };
  };
}

function sliceTranscript(segments: TranscriptSegment[], start?: number, end?: number): TranscriptSegment[] {
  if (start === undefined && end === undefined) return segments;
  const from = start ?? 0;
  const to = end ?? Infinity;
  const sliced: TranscriptSegment[] = [];
  for (const segment of segments) {
    const words = segment.words.filter((w) => w.end > from && w.start < to);
    if (!words.length) continue;
    sliced.push(
      words.length === segment.words.length
        ? segment
        : { text: words.map((w) => w.text).join(" "), words },
    );
  }
  return sliced;
}

export function handleAssetVisualize(engine: Accessor<Engine>) {
  return async (req: AssetVisualizeRequest): Promise<AssetVisualizeResult> => {
    const { world } = engine();
    const asset = await resolveAssetRef(world, req);
    const { dataUrl, ...rest } = await visualizeAsset(asset, { start: req.start, end: req.end, scale: req.scale });
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return { base64, ...rest };
  };
}

export function handleAssetAnalyze(engine: Accessor<Engine>) {
  return async (req: AssetAnalyzeRequest): Promise<AssetAnalyzeResult> => {
    const { prompt, start, end } = req;
    let { stripVideo } = req;
    const { world } = engine();
    const asset = await resolveAssetRef(world, req);
    const id = asset.id;
    assert(
      asset.type === "AUDIO" || asset.type === "VIDEO",
      `Asset ${id} is not a video or audio asset.`,
    );

    const hasWindow = start !== undefined || end !== undefined;
    stripVideo = stripVideo !== false && asset.type === "VIDEO";

    const contentType =
      asset.type === "VIDEO" ? (stripVideo ? "audio/ogg" : "video/mp4") : "audio/ogg";

    const window = hasWindow ? `-${start ?? 0}-${end ?? "end"}` : "";
    const key = world.assets.has(id) ? id : asset.hash;
    const uploadId = `${world.projectId}-${key}-analyze${stripVideo ? "-audio" : ""}${window}`
      .replace(/[^A-Za-z0-9._-]/g, "_");
    const { uploadUrl, fileRef } = await trpc.getUploadUrl.mutate({
      action: "resumable",
      id: uploadId,
      contentType,
    });

    // Transcoding pending
    if (uploadUrl) {
      const transcoder = await transcodeForAnalysis(asset, { start, end, stripVideo });
      const sessionUrl = await startResumableSession(uploadUrl, contentType);
      const uploadPromise = uploadResumableStream(transcoder.readable, sessionUrl);
      await transcoder.run?.();
      await uploadPromise;
    }

    const { analysis } = await trpc.analyze.mutate({ media: fileRef, prompt });

    return { analysis, start, end };
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
