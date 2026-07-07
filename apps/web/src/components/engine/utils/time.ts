/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hasComponent } from "bitecs";
import { PaintType } from "../components";
import { CONONICAL_TIME_BASE } from "../constants";

import type { EngineWorld } from "../api/world";

export function snapToMs(seconds: number) {
  return Math.round(seconds * CONONICAL_TIME_BASE) / CONONICAL_TIME_BASE;
}

export function snapToFps(seconds: number, fps: number = 30) {
  return Math.round(seconds * fps) / fps;
}

export function secondsToFrames(seconds: number = 0, fps: number = 30) {
  return Math.round(seconds * fps);
}

export function framesToSeconds(frames: number = 0, fps: number = 30) {
  return snapToMs(frames / fps);
}

/**
 * Computes the trim start frame (local) for a given entity,
 * based on the specified start frame (global) and playback rate.
 */
export function computeTrimStart(world: EngineWorld, eid: number, start: number) {
  const c = world.components;
  const delay = c.Computed.delay[eid] ?? 0;
  const playbackRate = c.PlaybackRate[eid] ?? 1;

  return Math.round((start - delay) * playbackRate);
}

/**
 * Computes the trim end frame (local) for a given entity,
 * based on the specified end frame (global) and playback rate.
 */
export function computeTrimEnd(world: EngineWorld, eid: number, end: number) {
  const c = world.components;
  const delay = c.Computed.delay[eid] ?? 0;
  const playbackRate = c.PlaybackRate[eid] ?? 1;

  return Math.round((end - delay) * playbackRate);
}

export function findGeometryAsset(world: EngineWorld, eid: number) {
  const c = world.components;

  if (hasComponent(world, eid, c.AssetId)) {
    const asset = world.assets.get(c.AssetId[eid] ?? '');

    if (asset) {
      return asset;
    }
  }


  for (const fid of c.Cache.fills[eid]) {
    if (hasComponent(world, fid, c.AssetId)) {
      const asset = world.assets.get(c.AssetId[fid] ?? '');
      if (asset) {
        return asset;
      }
    }
  }

  return null;
}

export function findAssetDuration(world: EngineWorld, eid: number) {
  const c = world.components;

  if (hasComponent(world, eid, c.Audio)) {
    const asset = world.assets.get(c.AssetId[eid] ?? '');

    if (asset?.type === 'AUDIO' || asset?.type === 'VIDEO') {
      return secondsToFrames(asset.duration, world.frameRate);
    }
  }


  for (const fid of c.Cache.fills[eid]) {
    if (c.Paint[fid] === PaintType.VIDEO || c.Paint[fid] === PaintType.SEQUENCE) {
      const asset = world.assets.get(c.AssetId[fid] ?? '');
      if (asset && (asset.type === 'VIDEO' || asset.type === 'SEQUENCE')) {
        return secondsToFrames(asset.duration, world.frameRate);
      }
    }
  }

  return null;
}
