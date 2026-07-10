/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ALL_FORMATS, AudioSampleSink, BlobSource, BufferTarget, CanvasSink, Conversion, Input, InputAudioTrack, Mp4OutputFormat, OggOutputFormat, Output, StreamTarget } from 'mediabunny';
import { assert } from '@/utils';
import { getAssetFile } from '../api/assets';
import type { StreamTargetChunk } from 'mediabunny';
import type { Asset } from '../db';

export async function transcodeForTranscription(asset: Asset): Promise<File> {
  const blob = await getAssetFile(asset);
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const output = new Output({ format: new OggOutputFormat(), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      video: { discard: true },
      audio: { codec: "opus", numberOfChannels: 1, sampleRate: 16000 },
    });
    if (!conversion.isValid || conversion.utilizedTracks.length === 0) {
      throw new Error("No audio found. The asset has no audio track to transcribe.");
    }
    await conversion.execute();

    const buffer = output.target.buffer;
    assert(buffer, "Transcoding produced no output.");
    return new File([buffer], `${crypto.randomUUID()}.ogg`, { type: "audio/ogg" });
  } finally {
    input.dispose();
  }
}

export async function transcodeForAnalysis(asset: Asset, window?: TimeWindow & { stripVideo?: boolean }) {
  const blob = await getAssetFile(asset);
  const hasWindow = window?.start !== undefined || window?.end !== undefined;

  const isVideo = asset.type === "VIDEO" && !window?.stripVideo;
  const trim = hasWindow ? resolveWindow(asset.duration, window) : undefined;

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });

  const { writable, readable } = new TransformStream<StreamTargetChunk, Uint8Array<ArrayBuffer>>({
    transform: (chunk, controller) => controller.enqueue(chunk.data),
  });

  const target = new StreamTarget(writable);
  const format = isVideo
    ? new Mp4OutputFormat({ fastStart: "fragmented" })
    : new OggOutputFormat();
  const output = new Output({ format, target });

  const conversion = await Conversion.init({
    input,
    output,
    trim: (trim && { start: trim.start, end: trim.end }),
    video: { width: 640, frameRate: 24, bitrate: 500_000, discard: !isVideo },
    audio: { codec: isVideo ? undefined : "opus", numberOfChannels: 1, sampleRate: 16_000 },
  });

  if (!conversion.isValid || conversion.utilizedTracks.length === 0) {
    input.dispose();
    throw new Error("Nothing to analyze. The asset has no usable video or audio track.");
  }

  const run = async () => {
    try {
      await conversion.execute();
    } finally {
      input.dispose();
    }
  };

  return { readable, run };
}

const MAX_IMAGE_SIZE = 560 ** 2;
const PATCH_SIZE = 28;
const MAX_WIDTH_IN_TOKENS = 52; // 92
const MAX_HEIGHT_IN_TOKENS = 52;
const THUMBNAIL_HEIGHT_IN_TOKENS = 5;
const WAVEFORM_HEIGHT_IN_TOKENS = 3;
const RULER_HEIGHT_IN_TOKENS = 1;
const AUDIO_WAVEFORM_HEIGHT_IN_TOKENS = 6;
const AUDIO_COLUMN_WIDTH_IN_TOKENS = 6;
const WAVEFORM_SAMPLE_WIDTH = 2; // pixels per peak; wider = less noisy
const SILENCE_THRESHOLD = 12; // peak value (0-255) at/below which audio counts as silent
const SILENCE_MIN_SECONDS = 0.4;
const AUDIO_RULER_FRAME_RATE = 30;

export function formatTimestamp(seconds: number, frameRate: number): string {
  const fps = Math.max(1, Math.round(frameRate));
  const totalFrames = Math.round(seconds * fps);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  return [hh, mm, ss, frames].map((v) => String(v).padStart(2, '0')).join(':');
}

export type AssetVisualization = {
  dataUrl: string;
} & Record<string, unknown>;

export type TimeWindow = { start?: number; end?: number };

export type VisualizeOptions = TimeWindow & { scale?: number };

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

function resolveScale(scale?: number): number {
  if (scale === undefined) return 1;
  assert(Number.isFinite(scale) && scale > 0, `scale must be a positive number (got ${scale}).`);
  return Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
}

// Clamp a requested [start, end] window (in seconds) to the asset's timeline.
// `start` defaults to 0 and `end` to the full duration.
function resolveWindow(duration: number, window?: TimeWindow): { start: number; end: number; duration: number } {
  const start = Math.min(Math.max(window?.start ?? 0, 0), duration);
  const end = Math.min(Math.max(window?.end ?? duration, start), duration);
  assert(end > start, `The requested window is empty; start (${start.toFixed(2)}s) is at or past the asset's end (${duration.toFixed(2)}s).`);
  return { start, end, duration: end - start };
}

export async function visualizeAsset(asset: Asset, options?: VisualizeOptions): Promise<AssetVisualization> {
  const blob = await getAssetFile(asset);
  const scale = resolveScale(options?.scale);

  if (asset.type === "IMAGE") {
    const pixelCount = asset.width * asset.height;
    const factor = Math.min(1, Math.sqrt(MAX_IMAGE_SIZE / pixelCount) * scale);

    const outputWidth = Math.floor(asset.width * factor);
    const outputHeight = Math.floor(asset.height * factor);

    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, outputWidth, outputHeight);
    bitmap.close();
    return { dataUrl: canvas.toDataURL('image/png') };
  }

  if (asset.type === "VIDEO") {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    const videoTrack = await input.getPrimaryVideoTrack();
    assert(videoTrack, "Video track not found");
    const audioTrack = await input.getPrimaryAudioTrack();
    const { start: windowStart, duration } = resolveWindow(asset.duration, options);
    const aspect = asset.width / asset.height;
    const frameRate = asset.frameRate;

    const fixedRowTokens = RULER_HEIGHT_IN_TOKENS + (audioTrack ? WAVEFORM_HEIGHT_IN_TOKENS : 0);
    const thumbnailHeightInTokens = Math.min(
      Math.max(Math.round(THUMBNAIL_HEIGHT_IN_TOKENS * scale), 1),
      MAX_HEIGHT_IN_TOKENS - fixedRowTokens,
    );
    const rowHeightInTokens = thumbnailHeightInTokens + fixedRowTokens;

    const columnWidthInTokens = Math.min(
      Math.max(Math.floor(thumbnailHeightInTokens * aspect), 1),
      MAX_WIDTH_IN_TOKENS,
    );

    const thumbnailWidthInPixels = columnWidthInTokens * PATCH_SIZE;
    const thumbnailHeightInPixels = thumbnailHeightInTokens * PATCH_SIZE;
    const rowHeightInPixels = rowHeightInTokens * PATCH_SIZE;

    const rows = Math.floor(MAX_HEIGHT_IN_TOKENS / rowHeightInTokens);
    const columns = Math.floor(MAX_WIDTH_IN_TOKENS / columnWidthInTokens);
    const cells = rows * columns;

    const secondsPerColumn = Math.max(duration / cells, 1 / frameRate);
    const secondsPerRow = secondsPerColumn * columns;

    const canvas = document.createElement('canvas');
    canvas.width = columnWidthInTokens * columns * PATCH_SIZE;
    canvas.height = rowHeightInTokens * rows * PATCH_SIZE;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const sink = new CanvasSink(videoTrack, {
      width: thumbnailWidthInPixels,
      height: thumbnailHeightInPixels,
      fit: 'cover',
      poolSize: 1,
    });

    const rulerHeight = RULER_HEIGHT_IN_TOKENS * PATCH_SIZE;

    const timestamps = Array.from({ length: cells }, (_, i) => windowStart + i * secondsPerColumn);
    const interator = sink.canvasesAtTimestamps(timestamps);
    for (let i = 0; i < cells; i++) {
      const wrapped = await interator.next();
      if (!wrapped.value?.canvas) continue;

      const column = i % columns;
      const row = Math.floor(i / columns);

      ctx.drawImage(
        wrapped.value.canvas,
        column * columnWidthInTokens * PATCH_SIZE,
        rulerHeight + row * rowHeightInTokens * PATCH_SIZE,
        thumbnailWidthInPixels,
        thumbnailHeightInPixels
      );
    }

    // Skip the waveform when the browser's AudioDecoder can't handle the codec
    if (audioTrack && await audioTrack.canDecode()) {
      const peaksPerSecond = Math.round(thumbnailWidthInPixels / secondsPerColumn / WAVEFORM_SAMPLE_WIDTH);
      const audioPeaks = await downsampleAudio(audioTrack, { peaksPerSecond, range: [windowStart, windowStart + duration] });

      drawWaveform(ctx, audioPeaks, {
        rows,
        rowWidth: columns * thumbnailWidthInPixels,
        rowHeightInPixels,
        waveformOffset: rulerHeight + thumbnailHeightInPixels,
        waveformHeight: WAVEFORM_HEIGHT_IN_TOKENS * PATCH_SIZE,
        peaksPerSecond,
        align: 'bottom',
      });
    }

    drawRuler(ctx, {
      cells,
      columns,
      columnWidthInPixels: columnWidthInTokens * PATCH_SIZE,
      rowHeightInPixels,
      rulerHeight,
      secondsPerColumn,
      frameRate,
      startOffset: windowStart,
    });

    return {
      dataUrl: canvas.toDataURL('image/png'),
      column: {
        width: thumbnailWidthInPixels,
        count: columns,
        duration: secondsPerColumn,
      },
      row: {
        height: rowHeightInPixels,
        count: rows,
        duration: secondsPerRow,
      },
    };
  }

  if (asset.type === "AUDIO") {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    try {
      const audioTrack = await input.getPrimaryAudioTrack();
      assert(audioTrack, "Audio track not found");
      assert(
        await audioTrack.canDecode(),
        `This browser's audio decoder can't handle the "${audioTrack.getCodec() ?? "unknown"}" codec, so no waveform can be rendered.`,
      );
      const { start: windowStart, duration } = resolveWindow(asset.duration, options);

      const waveformHeightInTokens = Math.min(
        Math.max(Math.round(AUDIO_WAVEFORM_HEIGHT_IN_TOKENS * scale), 1),
        MAX_HEIGHT_IN_TOKENS - RULER_HEIGHT_IN_TOKENS,
      );
      const rowHeightInTokens = waveformHeightInTokens + RULER_HEIGHT_IN_TOKENS;
      const columnWidthInTokens = Math.min(
        Math.max(Math.round(AUDIO_COLUMN_WIDTH_IN_TOKENS * scale), 1),
        MAX_WIDTH_IN_TOKENS,
      );

      const rows = Math.floor(MAX_HEIGHT_IN_TOKENS / rowHeightInTokens);
      const columns = Math.floor(MAX_WIDTH_IN_TOKENS / columnWidthInTokens);
      const cells = rows * columns;

      const secondsPerColumn = duration / cells;
      const secondsPerRow = secondsPerColumn * columns;

      const columnWidthInPixels = columnWidthInTokens * PATCH_SIZE;
      const rowHeightInPixels = rowHeightInTokens * PATCH_SIZE;
      const rulerHeight = RULER_HEIGHT_IN_TOKENS * PATCH_SIZE;
      const waveformHeight = waveformHeightInTokens * PATCH_SIZE;
      const rowWidth = columns * columnWidthInPixels;

      const canvas = document.createElement('canvas');
      canvas.width = rowWidth;
      canvas.height = rowHeightInPixels * rows;
      const ctx = canvas.getContext('2d')!;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const peaksPerSecond = Math.round(columnWidthInPixels / secondsPerColumn / WAVEFORM_SAMPLE_WIDTH);
      const audioPeaks = await downsampleAudio(audioTrack, { peaksPerSecond, range: [windowStart, windowStart + duration] });

      drawWaveform(ctx, audioPeaks, {
        rows,
        rowWidth,
        rowHeightInPixels,
        waveformOffset: rulerHeight,
        waveformHeight,
        peaksPerSecond,
        align: 'center',
      });

      drawRuler(ctx, {
        cells,
        columns,
        columnWidthInPixels,
        rowHeightInPixels,
        rulerHeight,
        secondsPerColumn,
        frameRate: AUDIO_RULER_FRAME_RATE,
        startOffset: windowStart,
      });

      return {
        dataUrl: canvas.toDataURL('image/png'),
        column: {
          width: columnWidthInPixels,
          count: columns,
          duration: secondsPerColumn,
        },
        row: {
          height: rowHeightInPixels,
          count: rows,
          duration: secondsPerRow,
        },
      };
    } finally {
      input.dispose();
    }
  }

  throw new Error(`Unsupported asset type: ${asset.type}`);
}

type WaveformLayout = {
  rows: number;
  rowWidth: number; // pixels spanning all columns of a row
  rowHeightInPixels: number;
  waveformOffset: number; // y offset within a row where the waveform begins
  waveformHeight: number;
  peaksPerSecond: number;
  align: 'center' | 'bottom';
};

function drawWaveform(ctx: CanvasRenderingContext2D, audioPeaks: Uint8ClampedArray, layout: WaveformLayout) {
  const { rows, rowWidth, rowHeightInPixels, waveformOffset, waveformHeight, peaksPerSecond, align } = layout;
  const peaksPerRow = Math.floor(rowWidth / WAVEFORM_SAMPLE_WIDTH);
  const fullHeight = align === 'bottom' ? waveformHeight : waveformHeight / 2;

  const waveformTopOf = (row: number) => row * rowHeightInPixels + waveformOffset;

  ctx.fillStyle = '#FFF';
  for (let row = 0; row < rows; row++) {
    const top = waveformTopOf(row);

    for (let col = 0; col < peaksPerRow; col++) {
      const peakIndex = row * peaksPerRow + col;
      if (peakIndex >= audioPeaks.length) break;

      const amplitude = (audioPeaks[peakIndex] / 255) * fullHeight;
      const x = col * WAVEFORM_SAMPLE_WIDTH;
      if (align === 'bottom') {
        const barHeight = Math.max(amplitude, 1);
        ctx.fillRect(x, top + waveformHeight - barHeight, WAVEFORM_SAMPLE_WIDTH, barHeight);
      } else {
        const centerY = top + fullHeight;
        ctx.fillRect(x, centerY - amplitude, WAVEFORM_SAMPLE_WIDTH, Math.max(amplitude * 2, 1));
      }
    }
  }

  const minSilencePeaks = Math.round(SILENCE_MIN_SECONDS * peaksPerSecond);
  const silentSpans: Array<{ start: number; end: number }> = [];
  let runStart = -1;
  for (let i = 0; i <= audioPeaks.length; i++) {
    const silent = i < audioPeaks.length && audioPeaks[i] <= SILENCE_THRESHOLD;
    if (silent && runStart === -1) {
      runStart = i;
    } else if (!silent && runStart !== -1) {
      if (i - runStart >= minSilencePeaks) {
        silentSpans.push({ start: runStart, end: i });
      }
      runStart = -1;
    }
  }

  for (const span of silentSpans) {
    let i = span.start;
    while (i < span.end) {
      const row = Math.floor(i / peaksPerRow);
      const segEnd = Math.min(span.end, (row + 1) * peaksPerRow);
      const x = (i % peaksPerRow) * WAVEFORM_SAMPLE_WIDTH;
      const width = (segEnd - i) * WAVEFORM_SAMPLE_WIDTH;
      const top = waveformTopOf(row);

      ctx.fillStyle = 'rgba(255, 64, 64, 0.4)';
      ctx.fillRect(x, top, width, waveformHeight);

      i = segEnd;
    }
  }
}

type RulerLayout = {
  cells: number;
  columns: number;
  columnWidthInPixels: number;
  rowHeightInPixels: number;
  rulerHeight: number;
  secondsPerColumn: number;
  frameRate: number;
  startOffset?: number;
};

function drawRuler(ctx: CanvasRenderingContext2D, layout: RulerLayout) {
  const { cells, columns, columnWidthInPixels, rowHeightInPixels, rulerHeight, secondsPerColumn, frameRate, startOffset = 0 } = layout;

  const baseFontSize = Math.round(rulerHeight * 0.8);
  const leadFontSize = Math.round(rulerHeight * 0.9);
  const paddingLeft = 5;
  const paddingTop = 2;
  const tickHeight = Math.round(rulerHeight * 0.4);

  const rows = Math.ceil(cells / columns);
  const fullWidth = columns * columnWidthInPixels;
  ctx.strokeStyle = 'rgba(255, 64, 64, 1)';
  ctx.lineWidth = 2;
  for (let row = 1; row < rows; row++) {
    const y = row * rowHeightInPixels + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(fullWidth, y);
    ctx.stroke();
  }

  ctx.fillStyle = '#FFF';
  ctx.strokeStyle = '#FFF';
  ctx.lineWidth = 2;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (let i = 0; i < cells; i++) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    const columnX = column * columnWidthInPixels;
    const rowTop = row * rowHeightInPixels;

    ctx.beginPath();
    ctx.moveTo(columnX + 0.5, rowTop + rulerHeight - tickHeight);
    ctx.lineTo(columnX + 0.5, rowTop + rulerHeight);
    ctx.stroke();

    ctx.font = column === 0
      ? `bold ${leadFontSize}px sans-serif`
      : `${baseFontSize}px sans-serif`;
    ctx.fillText(formatTimestamp(startOffset + i * secondsPerColumn, frameRate), columnX + paddingLeft, (rowTop + rulerHeight / 2) + paddingTop);
  }
}

type SamplerOptions = {
  peaksPerSecond: number;
  range?: [start: number, end: number]; // seconds; omitted = whole track
}

async function downsampleAudio(track: InputAudioTrack, options: SamplerOptions) {
  const sink = new AudioSampleSink(track);
  const iterator = options.range ? sink.samples(...options.range) : sink.samples();

  const peaks: Uint8ClampedArray<ArrayBuffer>[] = [];
  for await (const sample of iterator) {
    try {
      const size = sample.allocationSize({ format: 'f32', planeIndex: 0 });
      const floats = new Float32Array(size / Float32Array.BYTES_PER_ELEMENT);
      sample.copyTo(floats, { format: 'f32', planeIndex: 0 });

      const numChannels = sample.numberOfChannels;
      const numFrames = floats.length / numChannels;
      const duration = sample.duration;

      // Downsample to peaksPerSecond
      const targetPeaks = Math.ceil(duration * options.peaksPerSecond);
      const downsampledBytes = new Uint8ClampedArray(targetPeaks);

      // Downsample by calculating peaks directly for target positions
      const ratio = numFrames / targetPeaks;

      for (let i = 0; i < targetPeaks; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.floor((i + 1) * ratio);
        let max = 0;

        for (let frameIdx = start; frameIdx < end && frameIdx < numFrames; frameIdx++) {
          for (let ch = 0; ch < numChannels; ch++) {
            const floatIdx = frameIdx * numChannels + ch;
            max = Math.max(max, Math.sqrt(Math.abs(floats[floatIdx])));
          }
        }

        downsampledBytes[i] = Math.floor(255 * max);
      }

      peaks.push(downsampledBytes);
    } finally {
      sample.close();
    }
  }

  const length = peaks.reduce((acc, peak) => acc + peak.length, 0);
  const mergedPeaks = new Uint8ClampedArray(length);

  let offset = 0;
  for (const peak of peaks) {
    mergedPeaks.set(peak, offset);
    offset += peak.length;
  }

  return mergedPeaks;
}
