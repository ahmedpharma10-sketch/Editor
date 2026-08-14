/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";

import { createEncoder } from "@/components/engine/encode/encoder";

import type { Engine } from "@/components/engine";
import type { EncoderConfig } from "@/components/engine/encode/interfaces";
import type { ExportResult } from "@/components/engine/encode/types";
import type { ExportConfig } from "@/components/sidebar-right/inspector/export-progress";

/**
 * Unified scene render path, used by the UI export (`ExportProvider.exportScene`):
 * the "Exporting Composition" overlay, the engine stop/start lifecycle, encoder
 * creation, progress reporting, and cancel wiring all live in {@link renderScene}.
 */

export type RenderOverlayState = {
  config?: Partial<ExportConfig>;
  duration: number;
  progress: number;
  remaining?: { minutes: number; seconds: number };
};

const [overlay, setOverlay] = createSignal<RenderOverlayState | null>(null);
let cancelActive: (() => void) | undefined;

/** Reactive overlay state; `null` when no render is in flight. Read by `<ExportProgress>`. */
export const renderOverlay = overlay;

/** Cancel the render currently in flight, if any. Wired to the overlay's Cancel button. */
export function cancelRender() {
  cancelActive?.();
}

export type RenderSceneOptions = {
  /** Scene entity to encode. */
  scene: number;
  /** Where to write the output (a save-picker handle in the UI, a file path handle from the CLI). */
  target: NonNullable<EncoderConfig["target"]>;
  /** Encoder settings (resolution, codecs, format, ...). */
  config?: Partial<EncoderConfig>;
};

export async function renderScene(
  engine: Engine,
  { scene, target, config }: RenderSceneOptions,
): Promise<ExportResult> {
  const w = engine.world;
  const duration = w.components.Computed.duration[scene] / w.frameRate;

  cancelActive = undefined;
  setOverlay({ config, duration, progress: 0, remaining: undefined });
  engine.stop();

  try {
    const encoder = await createEncoder(w, {
      ...config,
      scene,
      target,
      onProgress(p) {
        const percent = Math.round((p.progress / p.total) * 100);
        setOverlay((prev) =>
          prev
            ? {
                ...prev,
                progress: percent,
                remaining: {
                  minutes: p.remaining.getUTCMinutes(),
                  seconds: p.remaining.getUTCSeconds(),
                },
              }
            : prev,
        );
      },
    });

    cancelActive = encoder.cancel;
    return await encoder.render();
  } finally {
    cancelActive = undefined;
    setOverlay(null);
    engine.start();
  }
}
