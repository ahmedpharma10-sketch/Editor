/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { ElectronFileHandle } from '@/lib/electron-file-handle';
import { trpc } from '@/lib/trpc';
import { uploadBlob, filmstripAsset, waveformAsset, describeFileAsset, getAssetFile, formatTimestamp } from '@/components/engine';
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

// Default cap on the pixel count of each decoded frame (384x384). Keeps frames
// small enough for vision models without the caller having to know the aspect ratio.
export const DEFAULT_FRAME_PIXEL_BUDGET = 384 * 384;

export function handleMediaFrame(engine: Accessor<Engine>) {
  return async (req: MediaFrameRequest) => {
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
