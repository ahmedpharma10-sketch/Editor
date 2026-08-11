/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createContext, useContext, onCleanup, onMount } from "solid-js";
import { toast } from "somoto";
import { assert, downloadObject } from "@/utils";
import { useEngine } from "@/context/engine";
import { useProjectId } from "@/hooks/use-project-id";
import { getProjectName } from "@/components/engine/db/global-db";
import { track } from "@/lib/analytics";
import { ExportProgress, type ExportConfig } from "@/components/sidebar-right/inspector/export-progress";
import { renderScene, renderOverlay, cancelRender } from "@/context/render";
import {
  MIME_TYPES,
  getDefaultExportTemplate,
} from "@/components/sidebar-right/inspector/export-templates";

import type { JSX, Accessor } from "solid-js";

type ExportContextValue = {
  exportScene: (sceneEid: number, config: ExportConfig) => Promise<void>;
  exportCurrentFrame: () => Promise<void>;
  exporting: Accessor<boolean>;
};

const ExportContext = createContext<ExportContextValue>();

export function ExportProvider(props: { children: JSX.Element }) {
  const engine = useEngine();
  const { world } = engine;
  const projectId = useProjectId();

  const exporting = () => !!renderOverlay();

  const sceneDurationSeconds = (sceneEid: number) =>
    world.components.Computed.duration[sceneEid] / world.frameRate;

  const exportScene: ExportContextValue["exportScene"] = async (sceneEid, config) => {
    if (!sceneEid) return;

    const format = config.format ?? "mp4";
    const mimeType = MIME_TYPES[format];

    const name = (await getProjectName(projectId()))
      .replace(/\s+/g, "-")
      .toLowerCase();

    let target: FileSystemFileHandle;
    try {
      target = await window.showSaveFilePicker({
        suggestedName: `${name}.${format}`,
        types: [
          {
            description: format,
            accept: {
              [mimeType]: [`.${format}`],
            } as Record<`${string}/${string}`, `.${string}`[]>,
          },
        ],
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      toast.error("Failed to start export", {
        description: (e as Error).message,
      });
      return;
    }

    track('export_started', {
      format,
      resolution: config.video?.resolution,
      fps: config.video?.fps,
      video_codec: config.video?.codec,
      audio_codec: config.audio?.codec,
      scene_duration_s: Math.round(sceneDurationSeconds(sceneEid)),
    });
    const startedAt = performance.now();

    try {
      const result = await renderScene(engine, { scene: sceneEid, target, config });

      if (result.type === "error") {
        console.error("Export failed:", result.error);
        toast.error("Export failed", {
          description: result.error.message,
        });
        track('export_failed', {
          format,
          duration_ms: Math.round(performance.now() - startedAt),
          error: result.error.message?.slice(0, 200) ?? 'unknown',
        });
      } else if (result.type === "success") {
        toast("Export complete", {
          description: "Your video has been successfully exported",
        });
        track('export_completed', {
          format,
          resolution: config.video?.resolution,
          fps: config.video?.fps,
          scene_duration_s: Math.round(sceneDurationSeconds(sceneEid)),
          duration_ms: Math.round(performance.now() - startedAt),
        });
      }
    } catch (e) {
      console.error("Export failed:", e);
      toast.error("Export failed", {
        description: (e as Error).message,
      });
      track('export_failed', {
        format,
        duration_ms: Math.round(performance.now() - startedAt),
        error: (e as Error).message?.slice(0, 200) ?? 'unknown',
      });
    }
  };

  const exportCurrentFrame: ExportContextValue["exportCurrentFrame"] = async () => {
    const canvas = engine.world.canvas;
    if (!(canvas instanceof HTMLCanvasElement)) {
      toast("Canvas is not ready");
      return;
    }

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/png");
    });

    if (!blob) {
      toast.error("Failed to capture frame");
      return;
    }

    const projectName = (await getProjectName(projectId()))
      .replace(/\s+/g, "-")
      .toLowerCase();
    await downloadObject(blob, `${projectName}-frame.png`);
  };

  const handleExportSceneEvent = () => {
    const sid = world.selection.scene;
    if (sid === null) {
      return toast("No active scene to export");
    }
    exportScene(sid, getDefaultExportTemplate());
  };

  const handleExportFrameEvent = () => exportCurrentFrame();

  onMount(() => {
    // TODO: Event bus would be better here
    window.addEventListener("engine:export-scene", handleExportSceneEvent);
    window.addEventListener("engine:export-frame", handleExportFrameEvent);
  });

  onCleanup(() => {
    window.removeEventListener("engine:export-scene", handleExportSceneEvent);
    window.removeEventListener("engine:export-frame", handleExportFrameEvent);
  });

  return (
    <ExportContext.Provider value={{ exportScene, exportCurrentFrame, exporting }}>
      {props.children}
      <ExportProgress
        open={!!renderOverlay()}
        progress={renderOverlay()?.progress ?? 0}
        remaining={renderOverlay()?.remaining}
        config={renderOverlay()?.config as ExportConfig | undefined}
        duration={renderOverlay()?.duration ?? 0}
        onCancel={cancelRender}
      />
    </ExportContext.Provider>
  );
}

export function useExport() {
  const ctx = useContext(ExportContext);
  assert(ctx, "useExport must be used within ExportProvider");
  return ctx;
}
