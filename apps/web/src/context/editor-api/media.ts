/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { ElectronFileHandle } from '@/lib/electron-file-handle';
import { pickInformativeTimes } from './frame-triage';
import { trpc } from '@/lib/trpc';
import { uploadBlob, filmstripAsset, waveformAsset, describeFileAsset, getAssetFile, formatTimestamp, stampTimestampLabel } from '@/components/engine';
import { assert } from '@/utils';
import {
  transcodeForTranscription,
  transcodeForAnalysis,
  startResumableSession,
  uploadResumableStream,
} from '@/components/engine';

import type { Engine } from "@/components/engine";
import type { Asset } from "@/components/engine/db";
import type { MediaListenRequest, MediaListenResult, MediaFrameRequest, MediaProbeRequest, AssetRef, MediaTranscribeRequest, MediaTranscribeResult, MediaFilmstripRequest, MediaFilmstripResult, MediaWaveformRequest, MediaWaveformResult, TranscriptSegment } from "@diffusionstudio/cli/channels";
import type { Accessor } from "solid-js";

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

export function handleMediaProbe(engine: Accessor<Engine>) {
  return async (req: MediaProbeRequest): Promise<unknown> => {
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

// Named quality presets mapped to a per-frame total-pixel budget (aspect ratio
// preserved). A budget of 0 means native resolution. `small` keeps frames small
// enough for vision models and is the default.
const FRAME_QUALITY_BUDGETS = {
  small: 384 * 384,    // 147,456
  medium: 768 * 768,   // 589,824
  large: 1536 * 1536,  // 2,359,296
  fullres: 0,          // native
} as const;

// Default cap on frames returned by auto selection when `count` is not given.
const AUTO_MAX_FRAMES = 30;

export function handleMediaFrame(engine: Accessor<Engine>) {
  return async (req: MediaFrameRequest) => {
    const { times, count, start, end, quality, timestamp, auto } = req;
    const { world } = engine();
    const asset = await resolveAssetRef(world, req);
    const id = asset.id;
    assert(asset.type === "VIDEO", `Asset ${id} is not a video.`);

    // `count` samples evenly across a window (default the whole clip); `auto`
    // scans the window and keeps frames where the footage settles into a new
    // visual state, capped at `count` (resolved once the track is open).
    // Otherwise grab the explicit `times` (falling back to a single frame at 0).
    const from = Math.min(Math.max(start ?? 0, 0), asset.duration);
    const to = Math.min(Math.max(end ?? asset.duration, from), asset.duration);
    let requested: number[] = [];
    if (auto || count !== undefined) {
      assert(to > from, `The requested window is empty; start (${from.toFixed(2)}s) is at or past end (${to.toFixed(2)}s).`);
      if (!auto && count !== undefined) {
        const interval = (to - from) / count;
        requested = Array.from({ length: count }, (_, i) => from + i * interval);
      }
    } else {
      const raw = times && times.length ? times : [0];
      // A negative time is an offset back from the end of the clip: -1 is one
      // second before the end, -1f one frame before it.
      requested = raw.map((t) => {
        if (t >= 0) {
          assert(t <= asset.duration, `--time ${t}s is past the asset's duration (${asset.duration.toFixed(2)}s).`);
          return t;
        }
        const resolved = asset.duration + t;
        assert(resolved >= 0, `--time ${t} counts past the start of the clip (duration ${asset.duration.toFixed(2)}s).`);
        return resolved;
      });
    }

    const budget = FRAME_QUALITY_BUDGETS[quality ?? "small"];

    const blob = await getAssetFile(asset);
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    try {
      const track = await input.getPrimaryVideoTrack();
      assert(track, `Asset ${id} has no video track.`);

      // Track timestamps may not start at 0; offset content time by the first.
      const firstTimestamp = (await track.getFirstTimestamp()) ?? 0;

      if (auto) {
        const picked = await pickInformativeTimes(track, {
          from: firstTimestamp + from,
          to: firstTimestamp + to,
          max: count ?? AUTO_MAX_FRAMES,
        });
        requested = picked.map((t) => Math.max(0, t - firstTimestamp));
      }

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

        // The webgpu getContext overload muddies inference on the canvas union.
        const ctx = wrapped.canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

        if (ctx && timestamp !== false) {
          stampTimestampLabel(ctx, wrapped.canvas.height, formatTimestamp(time, asset.frameRate));
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

export function handleMediaTranscribe(engine: Accessor<Engine>) {
  return async (req: MediaTranscribeRequest): Promise<MediaTranscribeResult> => {
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

export function handleMediaFilmstrip(engine: Accessor<Engine>) {
  return async (req: MediaFilmstripRequest): Promise<MediaFilmstripResult> => {
    const { world } = engine();
    const asset = await resolveAssetRef(world, req);
    const { dataUrl, ...rest } = await filmstripAsset(asset, { start: req.start, end: req.end, scale: req.scale });
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return { base64, ...rest };
  };
}

export function handleMediaWaveform(engine: Accessor<Engine>) {
  return async (req: MediaWaveformRequest): Promise<MediaWaveformResult> => {
    const { world } = engine();
    const asset = await resolveAssetRef(world, req);
    const { dataUrl, ...rest } = await waveformAsset(asset, { start: req.start, end: req.end, scale: req.scale });
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return { base64, ...rest };
  };
}

export function handleMediaListen(engine: Accessor<Engine>) {
  return async (req: MediaListenRequest): Promise<MediaListenResult> => {
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

    return { result: analysis, start, end };
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
