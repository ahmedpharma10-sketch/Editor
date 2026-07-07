/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type * as idb from 'idb';
import type { DBEntity } from '../types';
import type { EngineDBSchema } from './project-db';

type Transaction = idb.IDBPTransaction<EngineDBSchema, ("entities" | "assets" | "folders" | "fonts" | "world")[], "versionchange">;

const LEGACY_FPS = 30;

export async function migrateToV2(tx: Transaction) {
  // v1 → v2: rename time/frame fields and convert seconds → frames.
  // Mappings:
  //   Workarea.start (s)          → Workarea.startFrame (f)
  //   Workarea.end (s)            → Workarea.stopFrame (f)
  //   Time.delay (s)              → Time.delayInFrames (f)
  //   Time.trimStart (s)          → Time.trimStartFrame (f)
  //   Time.trimEnd (s)            → Time.trimEndFrame (f)
  //   Timeline.currentTime (s)    → Timeline.currentTimeInSeconds (rename only)
  //   Transition.duration (s)     → Transition.durationInFrames (f)
  //   Animation.duration (s)      → Animation.durationInFrames (f)
  //   Keyframe.time (s)           → Keyframe.frame (f)
  const store = tx.objectStore('entities');
  let cursor = await store.openCursor();
  while (cursor) {
    const record = cursor.value as DBEntity & {
      Workarea?: { start?: number; end?: number; startFrame?: number; stopFrame?: number };
      Time?: {
        delay?: number; trimStart?: number; trimEnd?: number;
        delayInFrames?: number; trimStartFrame?: number; trimEndFrame?: number;
        playbackRate?: number;
      };
      Timeline?: { currentTime?: number; currentTimeInSeconds?: number; loop?: number };
      Transition?: { type?: number; duration?: number; durationInFrames?: number };
      Animation?: { type?: number; duration?: number; durationInFrames?: number; phase?: number };
      Keyframe?: { time?: number; frame?: number; value?: number; property?: string; easing?: string };
    };
    let changed = false;

    if (record.Workarea) {
      if (record.Workarea.start !== undefined) {
        record.Workarea.startFrame = Math.round(record.Workarea.start * LEGACY_FPS);
        delete record.Workarea.start;
        changed = true;
      }
      if (record.Workarea.end !== undefined) {
        record.Workarea.stopFrame = Math.round(record.Workarea.end * LEGACY_FPS);
        delete record.Workarea.end;
        changed = true;
      }
    }

    if (record.Time) {
      if (record.Time.delay !== undefined) {
        record.Time.delayInFrames = Math.round(record.Time.delay * LEGACY_FPS);
        delete record.Time.delay;
        changed = true;
      }
      if (record.Time.trimStart !== undefined) {
        record.Time.trimStartFrame = Math.round(record.Time.trimStart * LEGACY_FPS);
        delete record.Time.trimStart;
        changed = true;
      }
      if (record.Time.trimEnd !== undefined) {
        record.Time.trimEndFrame = Math.round(record.Time.trimEnd * LEGACY_FPS);
        delete record.Time.trimEnd;
        changed = true;
      }
    }

    if (record.Timeline && record.Timeline.currentTime !== undefined) {
      record.Timeline.currentTimeInSeconds = record.Timeline.currentTime;
      delete record.Timeline.currentTime;
      changed = true;
    }

    if (record.Transition && record.Transition.duration !== undefined) {
      record.Transition.durationInFrames = Math.round(record.Transition.duration * LEGACY_FPS);
      delete record.Transition.duration;
      changed = true;
    }

    if (record.Animation && record.Animation.duration !== undefined) {
      record.Animation.durationInFrames = Math.round(record.Animation.duration * LEGACY_FPS);
      delete record.Animation.duration;
      changed = true;
    }

    if (record.Keyframe && record.Keyframe.time !== undefined) {
      record.Keyframe.frame = Math.round(record.Keyframe.time * LEGACY_FPS);
      delete record.Keyframe.time;
      changed = true;
    }

    if (changed) {
      await cursor.update(record);
    }
    cursor = await cursor.continue();
  }
}

/** Legacy stage entity id used before the v3 refactor. */
const LEGACY_STAGE_EID = 1;

/**
 * v2 → v3: drop the deprecated stage entity (eid=1) and unparent anything
 * that pointed at it. Removing STAGE=0 from the NodeType enum also shifts
 * the remaining values down by one, so Node.type on every surviving record
 * is decremented to match. Camera and background fall back to defaults on
 * the next load — we don't bother carrying the stage's values over.
 */
export async function migrateToV3(tx: Transaction) {
  const entities = tx.objectStore('entities');

  let cursor = await entities.openCursor();
  while (cursor) {
    const record = cursor.value as DBEntity & { Node?: { type?: number } };

    if (record.eid === LEGACY_STAGE_EID) {
      await cursor.delete();
    } else {
      let changed = false;
      if (record.ChildOf === LEGACY_STAGE_EID) {
        delete record.ChildOf;
        changed = true;
      }
      if (record.Node?.type !== undefined && record.Node.type > 0) {
        record.Node.type -= 1;
        changed = true;
      }
      if (changed) await cursor.update(record);
    }

    cursor = await cursor.continue();
  }
}

/**
 * v4 → v5: drop the Tracks model. Each clip becomes its own layer (motion-
 * graphics style). For each entity record:
 *   - Rename `TrackIndex` → `ItemIndex` (preserving the integer value).
 *   - Drop the scene-level `Tracks` payload entirely — per-track mute/hide/
 *     volume/height are not preserved.
 *   - Assign `ClipHeight = DEFAULT_CLIP_HEIGHT` to every Node entity so the
 *     new render path has a height to fall back on.
 *   - Rename `Timeline` → `Playback`, keeping only `loop`. Time-tracking fields
 *     (currentTimeInSeconds, etc.) moved to Computed and are recomputed
 *     at runtime, so we drop any residual values from older shapes.
 *
 * Clips that previously shared a TrackIndex will share an ItemIndex after the
 * rename. In the new model that means they stack on the same row visually
 * (overlapping); the user can drag to fix.
 */
const DEFAULT_CLIP_HEIGHT_V5 = 32;
/** NodeType.SCENE — pinned so this migration survives enum reordering. */
const SCENE_NODE_TYPE_V5 = 0;
type LegacyEntity = DBEntity & {
  TrackIndex?: number;
  Tracks?: unknown;
  Timeline?: { loop?: number };
  Workarea?: { startFrame?: number; stopFrame?: number };
  Time?: {
    delayInFrames?: number;
    trimStartFrame?: number;
    trimEndFrame?: number;
    playbackRate?: number;
    mode?: number;
  };
  Node?: { type?: number };
  DelayInFrames?: number;
  PlaybackRate?: number;
  Trim?: { startFrame?: number; endFrame?: number };
};
export async function migrateToV5(tx: Transaction) {
  const entities = tx.objectStore('entities');
  let cursor = await entities.openCursor();
  while (cursor) {
    const record = cursor.value as LegacyEntity;
    let changed = false;

    if (record.TrackIndex !== undefined) {
      record.ItemIndex = record.TrackIndex;
      delete record.TrackIndex;
      changed = true;
    }

    if (record.Tracks !== undefined) {
      delete record.Tracks;
      changed = true;
    }

    if (record.Node !== undefined && record.ClipHeight === undefined) {
      record.ClipHeight = DEFAULT_CLIP_HEIGHT_V5;
      changed = true;
    }

    if (record.Timeline !== undefined) {
      record.Playback = { loop: record.Timeline.loop ?? 1 };
      delete record.Timeline;
      changed = true;
    }

    // Split the old Time record into separate scalar components plus an
    // optional Trim. The old Time held both placement (delay, rate) and
    // explicit bounds (trimStart, trimEnd); bounds now live in Trim, whose
    // absence means "auto-fit" (scenes) or "no inherent duration" (clips).
    if (record.Time) {
      record.DelayInFrames = record.Time.delayInFrames ?? 0;
      record.PlaybackRate = record.Time.playbackRate ?? 1;
      const isScene = record.Node?.type === SCENE_NODE_TYPE_V5;
      const hasExplicitTrim =
        !isScene ||
        record.Workarea !== undefined ||
        record.Time.mode === 0;
      if (hasExplicitTrim) {
        record.Trim = {
          startFrame: record.Workarea?.startFrame ?? record.Time.trimStartFrame ?? 0,
          endFrame: record.Workarea?.stopFrame ?? record.Time.trimEndFrame ?? 0,
        };
      }
      delete record.Time;
      changed = true;
    }

    if (record.Workarea) {
      delete record.Workarea;
      changed = true;
    }

    if (changed) await cursor.update(record);
    cursor = await cursor.continue();
  }
}

/** FillType enum value for SOLID — pinned to a constant so this migration
 *  keeps working if the runtime enum is later reordered. */
const SOLID_FILL_TYPE = 0;

/**
 * v5 → v6: drop the `Node` and `Fill` typed components in favour of flat
 * arrays and tag components.
 *
 *   Node    = { type } (NodeType enum)  → Geometry = number (RECT|TEXT)
 *                                         + Group / Audio tags as needed
 *                                         + ClipsContent for scenes
 *   Fill    = { type } (FillType enum)  → Paint    = number (PaintType enum)
 *
 * Old NodeType values are pinned below — they reflect the v5 enum order
 * (SCENE=0, SHAPE=1, TEXT=2, AUDIO=3, CAPTION=4, GROUP=5) and won't move
 * even if the live enum is later renamed/removed.
 *
 * The mapping (chosen with the user):
 *   SCENE   → Geometry=RECT, +Scene, +ClipsContent
 *   SHAPE   → Geometry=RECT
 *   TEXT    → Geometry=TEXT
 *   AUDIO   → Geometry=RECT, +Audio
 *   CAPTION → Geometry=TEXT, + ensure Caption preset component is present
 *   GROUP   → Geometry=RECT, +Group
 *
 * FillType values transfer 1:1 (no reordering) — WAVEFORM is appended to
 * PaintType but isn't emitted by any legacy data. We just copy the integer over.
 */
const V6_NODE_TYPE_SCENE = 0;
const V6_NODE_TYPE_SHAPE = 1;
const V6_NODE_TYPE_TEXT = 2;
const V6_NODE_TYPE_AUDIO = 3;
const V6_NODE_TYPE_CAPTION = 4;
const V6_NODE_TYPE_GROUP = 5;

const V6_GEOMETRY_RECT = 0;
const V6_GEOMETRY_TEXT = 1;

export async function migrateToV6(tx: Transaction) {
  const entities = tx.objectStore('entities');

  let cursor = await entities.openCursor();
  while (cursor) {
    const record = cursor.value as DBEntity & {
      Node?: { type?: number };
      Fill?: { type?: number };
    };
    let changed = false;

    if (record.Node !== undefined) {
      const nodeType = record.Node.type ?? V6_NODE_TYPE_SHAPE;

      // Both TEXT and CAPTION nodes get a text geometry — captions are
      // just text nodes with a Caption preset component attached.
      record.Geometry = nodeType === V6_NODE_TYPE_TEXT || nodeType === V6_NODE_TYPE_CAPTION
        ? V6_GEOMETRY_TEXT
        : V6_GEOMETRY_RECT;

      if (nodeType === V6_NODE_TYPE_SCENE) {
        record.Scene = {};
        record.ClipsContent = true;
      } else if (nodeType === V6_NODE_TYPE_GROUP) {
        record.Group = {};
      } else if (nodeType === V6_NODE_TYPE_AUDIO) {
        record.Audio = {};
      } else if (nodeType === V6_NODE_TYPE_CAPTION) {
        // Caption preset config is added on-demand by the sidebar; ensure
        // it's present so the new model can detect captions via hasComponent.
        if (record.Caption === undefined) {
          record.Caption = {};
        }
      }

      delete record.Node;
      changed = true;
    }

    if (record.Keyframe !== undefined) {
      delete record.Keyframe;
      changed = true;
    }

    if (record.Fill !== undefined) {
      record.Paint = record.Fill.type ?? 0;
      delete record.Fill;
      changed = true;
    }

    if (changed) {
      await cursor.update(record);
    }
    cursor = await cursor.continue();
  }
}

/**
 * v3 → v4: gradient fills changed shape. The old `ColorStops` aggregate (parallel
 * positions/colors/opacities arrays on the fill entity) was replaced by per-stop
 * `ColorStop` child entities. Rather than migrate the stops one-by-one (which
 * would need to allocate fresh eids and add ChildOf relations), we degrade
 * gradient fills to solid fills using the first stop's color. Users can rebuild
 * the gradient in the picker if needed.
 */
export async function migrateToV4(tx: Transaction) {
  const entities = tx.objectStore('entities');

  let cursor = await entities.openCursor();
  while (cursor) {
    const record = cursor.value as DBEntity & {
      ColorStops?: { positions?: number[]; colors?: number[]; opacities?: number[] };
      Fill?: { type?: number };
    };

    if (record.ColorStops !== undefined) {
      const firstColor = record.ColorStops.colors?.[0] ?? 0xFFFFFF;
      record.Color = firstColor;
      record.Fill = { type: SOLID_FILL_TYPE };
      delete record.ColorStops;
      await cursor.update(record);
    }

    cursor = await cursor.continue();
  }
}

/**
 * v6 → v7: drop the redundant `Frame`/`InFrames` unit suffix from time fields
 * now that frames are the default unit. Pure key renames — values are already
 * in frames, so no numeric conversion is needed.
 *   DelayInFrames                 → Delay
 *   Trim.startFrame               → Trim.start
 *   Trim.endFrame                 → Trim.end
 *   Transition.durationInFrames   → Transition.duration
 *   Animation.durationInFrames    → Animation.duration
 *   Animation.delayInFrames       → Animation.delay
 *   Keyframe.frame                → Keyframe.time
 */
export async function migrateToV7(tx: Transaction) {
  const entities = tx.objectStore('entities');
  let cursor = await entities.openCursor();
  while (cursor) {
    const record = cursor.value as DBEntity & {
      DelayInFrames?: number;
      Delay?: number;
      Trim?: { startFrame?: number; endFrame?: number; start?: number; end?: number };
      Transition?: { type?: number; durationInFrames?: number; duration?: number };
      Animation?: {
        type?: number; phase?: number;
        durationInFrames?: number; delayInFrames?: number;
        duration?: number; delay?: number;
      };
      Keyframe?: { frame?: number; time?: number; value?: number; easing?: string };
    };
    let changed = false;

    if (record.DelayInFrames !== undefined) {
      record.Delay = record.DelayInFrames;
      delete record.DelayInFrames;
      changed = true;
    }

    if (record.Trim) {
      if (record.Trim.startFrame !== undefined) {
        record.Trim.start = record.Trim.startFrame;
        delete record.Trim.startFrame;
        changed = true;
      }
      if (record.Trim.endFrame !== undefined) {
        record.Trim.end = record.Trim.endFrame;
        delete record.Trim.endFrame;
        changed = true;
      }
    }

    if (record.Transition && record.Transition.durationInFrames !== undefined) {
      record.Transition.duration = record.Transition.durationInFrames;
      delete record.Transition.durationInFrames;
      changed = true;
    }

    if (record.Animation) {
      if (record.Animation.durationInFrames !== undefined) {
        record.Animation.duration = record.Animation.durationInFrames;
        delete record.Animation.durationInFrames;
        changed = true;
      }
      if (record.Animation.delayInFrames !== undefined) {
        record.Animation.delay = record.Animation.delayInFrames;
        delete record.Animation.delayInFrames;
        changed = true;
      }
    }

    if (record.Keyframe && record.Keyframe.frame !== undefined) {
      record.Keyframe.time = record.Keyframe.frame;
      delete record.Keyframe.frame;
      changed = true;
    }

    if (changed) await cursor.update(record);
    cursor = await cursor.continue();
  }
}
