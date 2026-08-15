/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useEngine } from "@/context/engine";
import { loadAsset, getAssetFile } from "@/components/engine";
import { Toolbar } from "./toolbar";
import { DrawOverlay } from "./draw-overlay";
import { DesktopAppBanner } from "./desktop-app-banner";
import { toast } from "somoto"
import { findSceneAt, screenToWorld, worldToLocal, secondsToFrames, GeometryType, PaintType, createEntity, addComponent, appendChild, setComponent, resizeEntity } from "../engine";
import { SceneInitOverlay } from "./scene-init-overlay";

import { CLASSIC_PRESET_HEIGHT, CLASSIC_PRESET_WIDTH } from "../engine/decoders/caption/classic";

import type { Asset } from "../engine/db";
import type { Transcript } from "@diffusionstudio/api-contract";

export const MAIN_CANVAS_ID = 'engine-canvas';

export function Canvas() {
  const engine = useEngine();
  const world = engine.world;
  const c = world.components;

  const handleDropEvent = async (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const worldPt = screenToWorld(world, event.clientX - rect.left, event.clientY - rect.top);
    const sceneEid = findSceneAt(world, worldPt.x, worldPt.y);

    const getTargetPosition = (size: { width: number, height: number }, eid: number | null) => {
      const localPt = eid === null
        ? worldPt
        : worldToLocal(world, eid, worldPt.x, worldPt.y);

      return {
        x: Math.round(localPt.x - size.width / 2),
        y: Math.round(localPt.y - size.height / 2),
      };
    };

    const placeAsset = async (asset: Asset) => {
      const parentEid: number | null = sceneEid;

      const size = { width: 400, height: 100 };

      if (asset.type === 'VIDEO' || asset.type === 'IMAGE' || asset.type === 'SEQUENCE') {
        size.width = Math.round(asset.width);
        size.height = Math.round(asset.height);
      }

      if (asset.type === 'TRANSCRIPT') {
        size.width = CLASSIC_PRESET_WIDTH;
        size.height = CLASSIC_PRESET_HEIGHT;
      }

      const position = getTargetPosition(size, parentEid);

      // Resolve async transcript data up front so all entity mutations run in
      // one synchronous, undoable transaction.
      let transcriptTrim: { start: number; end: number } | null = null;
      if (asset.type === 'TRANSCRIPT') {
        const file = await getAssetFile(asset);
        const transcript = JSON.parse(await file.text()) as Transcript;
        const lastWord = transcript.at(-1)?.words.at(-1);
        const firstWord = transcript.at(0)?.words.at(0);
        transcriptTrim = {
          start: secondsToFrames(firstWord?.start),
          end: secondsToFrames(lastWord?.end),
        };
      }

      world.history.transaction('Place asset', () => {
        const eid = createEntity(world);
        setComponent(world, eid, c.Position, { x: position.x, y: position.y });
        setComponent(world, eid, c.KeepAspectRatio, { width: size.width, height: size.height });
        setComponent(world, eid, c.Name, asset.name);

        if (asset.type === 'TRANSCRIPT') {
          setComponent(world, eid, c.Geometry, GeometryType.TEXT);
          setComponent(world, eid, c.Caption, {});
          if (transcriptTrim) setComponent(world, eid, c.Trim, transcriptTrim);
        } else {
          setComponent(world, eid, c.Geometry, GeometryType.RECT);

          // Other assets need a paint component
          let paint = PaintType.IMAGE;
          if (asset.type === 'SEQUENCE') paint = PaintType.SEQUENCE;
          if (asset.type === 'VIDEO') paint = PaintType.VIDEO;
          if (asset.type === 'AUDIO') paint = PaintType.WAVEFORM;
          const fillEid = createEntity(world);
          setComponent(world, fillEid, c.Paint, paint);
          setComponent(world, fillEid, c.AssetId, asset.id);
          appendChild(world, fillEid, eid);
        }

        if (asset.type === 'AUDIO') {
          addComponent(world, eid, c.Audio);
        }

        if (asset.type === 'AUDIO' || asset.type === 'TRANSCRIPT') {
          setComponent(world, eid, c.AssetId, asset.id);
        }

        if (asset.type === 'VIDEO' || asset.type === 'AUDIO' || asset.type === 'SEQUENCE') {
          setComponent(world, eid, c.Playback, {});
        }

        if (parentEid) {
          appendChild(world, eid, parentEid);
        }

        resizeEntity(world, eid, { width: size.width, height: size.height });
      });
    };

    const assetIds = event.dataTransfer?.getData('application/x-asset-id')?.split(',').filter(Boolean);
    if (assetIds && assetIds.length > 0) {
      for (const id of assetIds) {
        const asset = world.assets.get(id);
        if (asset) {
          await placeAsset(asset);
        }
      }
    }


    for (let i = 0; i < (event.dataTransfer?.items.length ?? 0); i++) {
      if (event.dataTransfer?.items[i]?.kind !== 'file') continue;

      try {
        const asset = await loadAsset(world, event.dataTransfer.items[i]);
        await placeAsset(asset);
      } catch (e) {
        toast("Failed to import assets", { description: (e as Error).message });
      }
    }
  }

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div class="relative size-full bg-background">
      <div class="absolute inset-0">
        <Toolbar />
        <DesktopAppBanner />
        <DrawOverlay />
        <SceneInitOverlay
          onDrop={handleDropEvent}
          onDragOver={handleDragOver}
        />
        <canvas
          id={MAIN_CANVAS_ID}
          class="absolute inset-0 z-1"
          on:drop={handleDropEvent}
          on:dragover={handleDragOver}
        />
      </div>
    </div>
  );
}
