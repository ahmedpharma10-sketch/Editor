/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hasComponent, query, Not } from "bitecs";
import { getAssetSpec, isAssetRef, parseTime } from "@diffusionstudio/jsx";
import * as solid from "solid-js";
import * as solidStore from "solid-js/store";
import * as diffusionJsx from "@diffusionstudio/jsx";
import {
  CaptionType,
  FontStyle,
  GeometryType,
  PaintType,
  ScaleMode,
  TextAlign,
  TextBaseline,
  TransitionType,
  addComponent,
  appendChild,
  computeAudioSyncOffsetCached,
  createEntity,
  deleteEntity,
  findAssetDuration,
  findGeometryAsset,
  getNextName,
  getParentEntity,
  getSceneAncestor,
  hasAudioSources,
  removeChild,
  removeComponent,
  resizeEntity,
  setComponent,
  setKeyframeTrack,
  transcribeScene,
} from "@/components/engine";
import { ChildOf } from "@/components/engine/components";
import { ASPECT_RATIO_DIMENSIONS, findEmptyPlacement } from "@/utils/genai";
import { resolveAsset, resolveGeneratedAsset } from "@/utils/jsx-generation";
import { assert, assertAllSettled, parseColor } from "@/utils";

import type { AssetRef, AssetSpecInput, ProjectDocument } from "@diffusionstudio/jsx";
import type { Engine, EngineWorld } from "@/components/engine";
import type { GenerationMemo } from "@/utils/jsx-generation";

type DocumentNode = {
  kind: "element";
  eid: number;
  start?: number;
  end?: number;
  sourceIn?: number;
  sourceOut?: number;
  objectFit?: keyof typeof SCALE_MODE_MAP;
  parent?: DocumentNode;
  children?: DocumentNode[];
} | {
  kind: "root";
  eid?: number;
  parent?: undefined;
  children?: DocumentNode[];
} | {
  kind: "text";
  text: string;
  parent?: DocumentNode;
  children?: DocumentNode[];
};

// Multiple new scenes are laid side by side in render order.
const PLACEMENT_GAP = 40;

const SCALE_MODE_MAP = {
  cover: ScaleMode.COVER,
  contain: ScaleMode.FIT,
  fill: ScaleMode.FILL,
} as const;

const FONT_STYLE_MAP = {
  normal: FontStyle.NORMAL,
  italic: FontStyle.ITALIC,
  oblique: FontStyle.OBLIQUE,
} as const;

const TEXT_ALIGN_MAP = {
  left: TextAlign.LEFT,
  center: TextAlign.CENTER,
  right: TextAlign.RIGHT,
} as const;

const TEXT_BASELINE_MAP = {
  top: TextBaseline.TOP,
  middle: TextBaseline.MIDDLE,
  bottom: TextBaseline.BOTTOM,
} as const;

// Named easing presets, expanded to the descriptors the interpolation
// inspector writes so JSX-authored keyframes match hand-edited ones.
const EASING_PRESET_MAP: Record<string, string> = {
  linear: "",
  easeIn: "cubicBezier(0.42,0,1,1)",
  easeOut: "cubicBezier(0,0,0.58,1)",
  easeInOut: "cubicBezier(0.42,0,0.58,1)",
  gentle: "spring(0.5,628)",
  snappy: "spring(0.15,300)",
  bouncy: "spring(0.4,500)",
  strong: "spring(0.65,400)",
};

function parseEasing(value: unknown): string {
  assert(typeof value === "string", "keyframe `easing` must be a string" + `, value: ${value}`);
  const preset = EASING_PRESET_MAP[value];
  if (preset !== undefined) return preset;

  const valid =
    /^cubicBezier\(-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+\)$/.test(value) ||
    /^spring\(-?[\d.]+,-?[\d.]+\)$/.test(value) ||
    /^steps\(\d+(,(true|false))?\)$/.test(value);
  assert(valid, `invalid keyframe easing: "${value}"`);
  return value;
}

/**
 * Parses a keyframe-list prop value: times to local frames (0 = the node's
 * in point), values through `convert` into the property's authored unit,
 * easings through the preset map. Returns the list sorted by time — callers
 * land `[0].value` as the authored value and hand the list to
 * `setKeyframeTrack`.
 */
function parseKeyframes(
  name: string,
  entries: unknown[],
  convert: (value: unknown) => number,
): { time: number; value: number; easing: string }[] {
  assert(entries.length > 0, `\`${name}\` keyframe list must not be empty`);

  const frames = new Set<number>();
  const keyframes = entries.map((entry) => {
    assert(
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
      `\`${name}\` keyframes must be { time, value, easing? } objects`,
    );
    const { time, value, easing } = entry as Record<string, unknown>;
    const frame = parseFrames(String(time), 30);
    assert(typeof frame === "number", `\`${name}\` keyframe \`time\` must be a time value` + `, value: ${time}`);
    assert(!frames.has(frame), `\`${name}\` has two keyframes at frame ${frame}`);
    frames.add(frame);
    return {
      time: frame,
      value: convert(value),
      easing: easing === undefined ? "" : parseEasing(easing),
    };
  });

  return keyframes.sort((a, b) => a.time - b.time);
}

const TRANSITION_TYPE_MAP = {
  dissolve: TransitionType.DISSOLVE,
  slideFromRight: TransitionType.SLIDE_FROM_RIGHT,
  slideFromLeft: TransitionType.SLIDE_FROM_LEFT,
  fadeToBlack: TransitionType.FADE_TO_BLACK,
  fadeToWhite: TransitionType.FADE_TO_WHITE,
} as const;

// 1 second at the canonical 30 fps — the transition inspector's default.
const TRANSITION_DEFAULT_DURATION = 30;

function parseTransitionType(value: unknown): number {
  assert(typeof value === "string", "transition `type` must be a string" + `, value: ${value}`);
  const type = TRANSITION_TYPE_MAP[value as keyof typeof TRANSITION_TYPE_MAP];
  assert(type !== undefined, `invalid transition type: "${value}"`);
  return type;
}

function parseTransitionDuration(value: unknown): number {
  const frames = parseFrames(String(value), 30);
  assert(typeof frames === "number", "transition `duration` must be a time value" + `, value: ${value}`);
  assert(frames > 0, "transition `duration` must be > 0");
  return frames;
}

const CAPTION_PRESET_MAP = {
  classic: CaptionType.CLASSIC,
  cascade: CaptionType.CASCADE,
  spotlight: CaptionType.SPOTLIGHT,
  whisper: CaptionType.WHISPER,
  paper: CaptionType.PAPER,
  guinea: CaptionType.GUINEA,
  stark: CaptionType.STARK,
} as const;

type GenaiQueueItem = {
  node: DocumentNode;
  ref?: AssetRef;
  targetKey?: string;
  type: "asset" | "caption" | "sync";
};

export class WorldDocument implements ProjectDocument<DocumentNode> {
  public promises: Promise<void>[] = [];
  public stage: DocumentNode;
  public rootEid: number | null = null;
  public engine: Engine;

  private queue: GenaiQueueItem[] = [];

  public constructor(engine: Engine, target?: { parentEid: number }) {
    this.stage = { kind: "root", eid: target?.parentEid };
    this.engine = engine;
  }

  /**
   * Waits for the rendering to complete and then handles the genai queue.
   */
  public async commit(): Promise<void> {
    const world = this.world;
    const c = world.components;

    // Wait for assets to settle
    {
      const results = await Promise.allSettled(this.promises);
      assertAllSettled(results);
    }

    // Handle generative queue
    {
      const memo: GenerationMemo = new Map();

      const results = await Promise.allSettled(this.queue.map(async ({ node, ref, type }) => {
        if (node.kind !== "element" || hasComponent(world, node.eid, c.Deleted) || type !== "asset" || !ref) return;
        try {
          const asset = await resolveGeneratedAsset(world, ref, memo);
          await this.mountSource(node, asset.id);
        } finally {
          world.history.untrack(() => removeComponent(world, node.eid, c.Generating));
        }
      }));

      assertAllSettled(results);
    }

    // Handle sync queue: after generated assets have landed (either side may
    // be generated), before captions read the scene's final placement.
    {
      for (const { node, targetKey, type } of this.queue) {
        if (node.kind !== "element" || type !== "sync" || !targetKey) continue;
        const targetEid = query(world, [c.Key, Not(c.Deleted)]).find(eid => c.Key[eid] === targetKey);

        assert(targetEid !== undefined, `syncTo: no other element carries key "${targetKey}"`);

        const source = findGeometryAsset(world, node.eid);
        assert(
          source !== null && (source.type === "AUDIO" || source.type === "VIDEO"),
          `syncTo: node ${node.eid} has no audio or video source to align`,
        );
        const targetSource = findGeometryAsset(world, targetEid);
        assert(
          targetSource !== null && (targetSource.type === "AUDIO" || targetSource.type === "VIDEO"),
          `syncTo: target "${targetKey}" has no audio or video source to align against`,
        );

        const { offsetSeconds } = await computeAudioSyncOffsetCached(source, targetSource);

        const offsetFrames = Math.round(offsetSeconds * world.frameRate);
        const parentEid = getParentEntity(world, node.eid);
        const parentDelay = parentEid !== null ? (c.Computed.delay[parentEid] ?? 0) : 0;
        const delay = (c.Computed.delay[targetEid] ?? 0) + offsetFrames - parentDelay;

        setComponent(world, node.eid, c.Delay, delay);

        const targetStart = (c.Computed.start[targetEid] ?? 0) - parentDelay;
        const targetEnd = (c.Computed.end[targetEid] ?? 0) - parentDelay;
        const duration = findAssetDuration(world, node.eid);

        // `sourceIn`/`sourceOut` are source-relative; default to the overlap
        // with the target window. `end` (timeline) converts through `delay`.
        const trimStart = node.sourceIn ?? Math.max(0, targetStart - delay);
        const trimEnd = node.sourceOut
          ?? (node.end !== undefined
            ? node.end - delay
            : (duration !== null ? Math.min(duration, targetEnd - delay) : targetEnd - delay));
        assert(trimEnd > trimStart, `syncTo: the aligned clip does not overlap the window of "${targetKey}"`);
        setComponent(world, node.eid, c.Trim, { start: trimStart, end: trimEnd });
        node.sourceIn = trimStart;
        node.sourceOut = trimEnd;
        node.start = delay + trimStart;
      }
    }

    // Handle captioning queue
    {
      for (const { node, type } of this.queue) {
        if (node.kind !== "element" || hasComponent(world, node.eid, c.Deleted) || type !== "caption" || c.AssetId[node.eid]) continue;
        const sceneEid = getSceneAncestor(world, node.eid);
        if (!sceneEid || !hasAudioSources(world, sceneEid)) continue;

        const { asset, trim } = await transcribeScene(this.engine, sceneEid);
        setComponent(world, node.eid, c.AssetId, asset.id);
        setComponent(world, node.eid, c.Trim, trim);
      }
    }
  }

  private get world(): EngineWorld {
    return this.engine.world;
  }

  public createElement(tag: string): DocumentNode {
    const world = this.world;
    const c = world.components;

    switch (tag) {
      case "scene": {
        const eid = createEntity(world);
        const node: DocumentNode = { kind: "element", eid };
        setComponent(world, eid, c.Geometry, GeometryType.RECT);
        addComponent(world, eid, c.Scene);
        addComponent(world, eid, c.ClipsContent);
        setComponent(world, eid, c.Name, getNextName(world, "Scene"));
        return node;
      } case "group": {
        const eid = createEntity(world);
        const node: DocumentNode = { kind: "element", eid };
        setComponent(world, eid, c.Geometry, GeometryType.RECT);
        addComponent(world, eid, c.Group);
        setComponent(world, eid, c.Name, getNextName(world, "Group"));
        return node;
      } case "rect": {
        const eid = createEntity(world);
        const node: DocumentNode = { kind: "element", eid };
        setComponent(world, eid, c.Geometry, GeometryType.RECT);
        setComponent(world, eid, c.Name, getNextName(world, "Rect"));
        return node;
      } case "sequence": {
        const eid = createEntity(world);
        const node: DocumentNode = { kind: "element", eid };
        addComponent(world, eid, c.Group);
        addComponent(world, eid, c.Sequential);
        setComponent(world, eid, c.Name, getNextName(world, "Sequence"));
        return node;
      } case "video": {
        const eid = createEntity(world);
        const node: DocumentNode = { kind: "element", eid };
        setComponent(world, eid, c.Geometry, GeometryType.RECT);
        setComponent(world, eid, c.Name, getNextName(world, "Video"));
        return node;
      } case "image": {
        const eid = createEntity(world);
        const node: DocumentNode = { kind: "element", eid };
        setComponent(world, eid, c.Geometry, GeometryType.RECT);
        setComponent(world, eid, c.Name, getNextName(world, "Image"));
        return node;
      } case "audio": {
        const eid = createEntity(world);
        const node: DocumentNode = { kind: "element", eid };
        addComponent(world, eid, c.Audio);
        setComponent(world, eid, c.Geometry, GeometryType.RECT);
        setComponent(world, eid, c.Name, getNextName(world, "Audio"));
        return node;
      } case "text": {
        const eid = createEntity(world);
        const node: DocumentNode = { kind: "element", eid };
        setComponent(world, eid, c.Geometry, GeometryType.TEXT);
        const fid = createEntity(world);
        setComponent(world, fid, c.Paint, PaintType.SOLID);
        setComponent(world, fid, c.Color, 0xffffff);
        appendChild(world, fid, eid);
        return node;
      } case "captions": {
        const eid = createEntity(world);
        const node: DocumentNode = { kind: "element", eid };
        setComponent(world, eid, c.Geometry, GeometryType.TEXT);
        setComponent(world, eid, c.Caption, {});
        setComponent(world, eid, c.Name, getNextName(world, "Captions"));
        this.queue.push({ node, type: "caption" });
        return node;
      } case "solidPaint": {
        const eid = createEntity(world);
        const node: DocumentNode = { kind: "element", eid };
        setComponent(world, eid, c.Paint, PaintType.SOLID);
        setComponent(world, eid, c.Color, 0xE0E0E0);
        return node;
      } case "linearGradientPaint": {
        const eid = createEntity(world);
        const node: DocumentNode = { kind: "element", eid };
        setComponent(world, eid, c.Paint, PaintType.LINEAR_GRADIENT);
        return node;
      } case "radialGradientPaint": {
        const eid = createEntity(world);
        const node: DocumentNode = { kind: "element", eid };
        setComponent(world, eid, c.Paint, PaintType.RADIAL_GRADIENT);
        return node;
      } case "colorStop": {
        const eid = createEntity(world);
        const node: DocumentNode = { kind: "element", eid };
        setComponent(world, eid, c.ColorStop, {});
        return node;
      } default: {
        assert(false, `unknown tag: "${tag}"`);
      }
    }
  }

  public createTextNode(text: string): DocumentNode {
    // This is the text inside a tag, there is no engine equivalent
    return { kind: "text", text };
  }

  /**
   * Wraps an existing entity so props can be applied to it through the same
   * `setProperty` path a fresh render uses (e.g. `dapi node patch`). Timing
   * state is hydrated from the entity's components so a partial patch (say,
   * only `sourceIn`) composes with its existing delay/trim like a full render.
   */
  public element(eid: number): DocumentNode {
    const world = this.world;
    const c = world.components;
    const node: DocumentNode = { kind: "element", eid };
    const delay = hasComponent(world, eid, c.Delay) ? c.Delay[eid] : 0;
    if (hasComponent(world, eid, c.Trim)) {
      const start = c.Trim.start[eid];
      const end = c.Trim.end[eid];
      if (start !== undefined) {
        node.sourceIn = start;
      }
      if (end !== undefined) {
        node.sourceOut = end;
      }
    }
    // start = timeline placement of source-0 (Delay) shifted by the source in point.
    if (hasComponent(world, eid, c.Delay) || node.sourceIn !== undefined) {
      node.start = delay + (node.sourceIn ?? 0);
    }
    return node;
  }

  private reconcileTiming(node: DocumentNode) {
    if (node.kind !== "element") return;
    const world = this.world;
    const c = world.components;
    const eid = node.eid;
    const sourceIn = node.sourceIn ?? 0;
    const start = node.start ?? 0;
    const delay = start - sourceIn;
    setComponent(world, eid, c.Delay, delay);

    if (node.sourceIn !== undefined) {
      setComponent(world, eid, c.Trim, { start: node.sourceIn });
    }
    if (node.sourceOut !== undefined) {
      setComponent(world, eid, c.Trim, { end: node.sourceOut });
    } else if (node.end !== undefined) {
      const trimEnd = node.end - delay;
      assert(trimEnd > sourceIn, `\`end\` must be after \`start\`, got start=${start}, end=${node.end}`);
      setComponent(world, eid, c.Trim, { end: trimEnd });
    }
  }

  public replaceText(node: DocumentNode, text: string) {
    assert(node.kind === "text", "replaceText target is not a text node");
    node.text = text;
  }

  public isTextNode(node: DocumentNode): boolean {
    return node.kind === "text";
  }

  public setProperty(node: DocumentNode, name: string, value: unknown) {
    if (name === "children" || name === "ref" || value === undefined || node.kind !== "element") return;

    const world = this.world;
    const c = world.components;
    const eid = node.eid;

    switch (name) {
      case "name": {
        assert(typeof value === "string", "`name` must be a string" + `, value: ${value}`);
        setComponent(world, eid, c.Name, value);
        break;
      } case "x": {
        if (Array.isArray(value)) {
          const keyframes = parseKeyframes(name, value, (v) => {
            assert(typeof v === "number", "`x` must be a number" + `, value: ${v}`);
            return Math.round(v);
          });
          setComponent(world, eid, c.Position, { x: keyframes[0].value });
          setKeyframeTrack(world, eid, "position.x", keyframes);
          break;
        }
        setKeyframeTrack(world, eid, "position.x", []);
        assert(typeof value === "number", "`x` must be a number" + `, value: ${value}`);
        setComponent(world, eid, c.Position, { x: Math.round(value) });
        break;
      } case "y": {
        if (Array.isArray(value)) {
          const keyframes = parseKeyframes(name, value, (v) => {
            assert(typeof v === "number", "`y` must be a number" + `, value: ${v}`);
            return Math.round(v);
          });
          setComponent(world, eid, c.Position, { y: keyframes[0].value });
          setKeyframeTrack(world, eid, "position.y", keyframes);
          break;
        }
        setKeyframeTrack(world, eid, "position.y", []);
        assert(typeof value === "number", "`y` must be a number" + `, value: ${value}`);
        setComponent(world, eid, c.Position, { y: Math.round(value) });
        break;
      } case "width": {
        if (Array.isArray(value)) {
          const keyframes = parseKeyframes(name, value, (v) => {
            assert(typeof v === "number", "`width` must be a number" + `, value: ${v}`);
            assert(v >= 0, "`width` must be >= 0");
            return Math.round(v);
          });
          resizeEntity(world, eid, { width: keyframes[0].value });
          setKeyframeTrack(world, eid, "width", keyframes);
          break;
        }
        setKeyframeTrack(world, eid, "width", []);
        assert(typeof value === "number", "`width` must be a number" + `, value: ${value}`);
        assert(value >= 0, "`width` must be >= 0");
        resizeEntity(world, eid, { width: Math.round(value) });
        break;
      } case "height": {
        if (Array.isArray(value)) {
          const keyframes = parseKeyframes(name, value, (v) => {
            assert(typeof v === "number", "`height` must be a number" + `, value: ${v}`);
            assert(v >= 0, "`height` must be >= 0");
            return Math.round(v);
          });
          resizeEntity(world, eid, { height: keyframes[0].value });
          setKeyframeTrack(world, eid, "height", keyframes);
          break;
        }
        setKeyframeTrack(world, eid, "height", []);
        assert(typeof value === "number", "`height` must be a number" + `, value: ${value}`);
        assert(value >= 0, "`height` must be >= 0");
        resizeEntity(world, eid, { height: Math.round(value) });
        break;
      } case "rotation": {
        if (Array.isArray(value)) {
          const keyframes = parseKeyframes(name, value, (v) => {
            assert(typeof v === "number", "`rotation` must be a number" + `, value: ${v}`);
            return v;
          });
          setComponent(world, eid, c.Rotation, keyframes[0].value);
          setKeyframeTrack(world, eid, "rotation", keyframes);
          break;
        }
        setKeyframeTrack(world, eid, "rotation", []);
        assert(typeof value === "number", "`rotation` must be a number" + `, value: ${value}`);
        setComponent(world, eid, c.Rotation, value);
        break;
      } case "opacity": {
        const isStop = hasComponent(world, eid, c.ColorStop);
        if (Array.isArray(value)) {
          const keyframes = parseKeyframes(name, value, (v) => {
            assert(typeof v === "number", "`opacity` must be a number" + `, value: ${v}`);
            assert(v >= 0 && v <= 1, "`opacity` must be between 0 and 1");
            return v;
          });
          if (isStop) setComponent(world, eid, c.ColorStop, { opacity: keyframes[0].value });
          else setComponent(world, eid, c.Appearance, { opacity: keyframes[0].value });
          setKeyframeTrack(world, eid, isStop ? "stop.opacity" : "opacity", keyframes);
          break;
        }
        setKeyframeTrack(world, eid, isStop ? "stop.opacity" : "opacity", []);
        assert(typeof value === "number", "`opacity` must be a number" + `, value: ${value}`);
        assert(value >= 0 && value <= 1, "`opacity` must be between 0 and 1");
        if (isStop) {
          setComponent(world, eid, c.ColorStop, { opacity: value });
        } else {
          setComponent(world, eid, c.Appearance, { opacity: value });
        }
        break;
      } case "cornerRadius": {
        if (Array.isArray(value)) {
          const keyframes = parseKeyframes(name, value, (v) => {
            assert(typeof v === "number", "`cornerRadius` must be a number" + `, value: ${v}`);
            assert(v >= 0, "`cornerRadius` must be >= 0");
            return Math.round(v);
          });
          setComponent(world, eid, c.CornerRadius, keyframes[0].value);
          setKeyframeTrack(world, eid, "vertexRadius", keyframes);
          break;
        }
        setKeyframeTrack(world, eid, "vertexRadius", []);
        assert(typeof value === "number", "`cornerRadius` must be a number" + `, value: ${value}`);
        assert(value >= 0, "`cornerRadius` must be >= 0");
        setComponent(world, eid, c.CornerRadius, Math.round(value));
        break;
      } case "start": {
        const parsed = parseFrames(String(value), 30);
        assert(typeof parsed === "number", "`start` must be a string or number" + `, value: ${value}`);
        node.start = parsed;
        this.reconcileTiming(node);
        break;
      } case "end": {
        const parsed = parseFrames(String(value), 30);
        assert(typeof parsed === "number", "`end` must be a string or number" + `, value: ${value}`);
        node.end = parsed;
        // `end` and `sourceOut` are two spellings of the clip's out edge.
        node.sourceOut = undefined;
        this.reconcileTiming(node);
        break;
      } case "sourceIn": {
        const parsed = parseFrames(String(value), 30);
        assert(typeof parsed === "number", "`sourceIn` must be a string or number" + `, value: ${value}`);
        node.sourceIn = parsed;
        this.reconcileTiming(node);
        break;
      } case "sourceOut": {
        const parsed = parseFrames(String(value), 30);
        assert(typeof parsed === "number", "`sourceOut` must be a string or number" + `, value: ${value}`);
        node.sourceOut = parsed;
        node.end = undefined;
        this.reconcileTiming(node);
        break;
      }
      case "fill": {
        assert(typeof value === "string", "`fill` must be a string" + `, value: ${value}`);
        const color = parseColor(value);
        assert(color !== null, `fill is not a valid CSS color: "${value}"`);
        const fills = [...query(world, [c.Paint, ChildOf(eid), Not(c.Deleted)])]
          .filter((fid) => c.Paint[fid] === PaintType.SOLID);

        if (fills.length === 0) {
          const fid = createEntity(world);
          setComponent(world, fid, c.Paint, PaintType.SOLID);
          appendChild(world, fid, eid);
          fills.push(fid);
        }


        for (const fid of fills) {
          setComponent(world, fid, c.Color, color);
        }
        break;
      }
      case "volume": {
        if (Array.isArray(value)) {
          const keyframes = parseKeyframes(name, value, (v) => {
            assert(typeof v === "number", "`volume` must be a number" + `, value: ${v}`);
            assert(v >= 0, "`volume` must be >= 0");
            // Keyframed silence floors at -60 dB so segments toward it
            // interpolate over finite values.
            return Math.max(v <= 0 ? -Infinity : 20 * Math.log10(v), -60);
          });
          setComponent(world, eid, c.Volume, keyframes[0].value);
          setKeyframeTrack(world, eid, "volume", keyframes);
          break;
        }
        setKeyframeTrack(world, eid, "volume", []);
        assert(typeof value === "number", "`volume` must be a number" + `, value: ${value}`);
        assert(value >= 0, "`volume` must be >= 0");
        // Convert linear volume to decibels
        const db = value <= 0 ? -Infinity : 20 * Math.log10(value);
        setComponent(world, eid, c.Volume, db);
        break;
      } case "muted": {
        assert(typeof value === "boolean", "`muted` must be a boolean" + `, value: ${value}`);
        if (value) addComponent(world, eid, c.Muted);
        else removeComponent(world, eid, c.Muted);
        break;
      } case "syncTo": {
        assert(typeof value === "string", "`syncTo` must be a string" + `, value: ${value}`);
        assert(value.trim().length > 0, "`syncTo` must be a non-empty string");
        this.queue.push({ node, targetKey: value.trim(), type: "sync" });
        break;
      } case "transition": {
        if (value === null) {
          removeComponent(world, eid, c.Transition);
          break;
        }
        assert(
          typeof value === "object" && !Array.isArray(value),
          "`transition` must be a { type?, duration? } object or null" + `, value: ${value}`,
        );
        const { type, duration } = value as Record<string, unknown>;
        const spec: { type?: number; duration?: number } = {};
        if (type !== undefined) spec.type = parseTransitionType(type);
        if (duration !== undefined) spec.duration = parseTransitionDuration(duration);

        if (!hasComponent(world, eid, c.Transition)) {
          spec.type ??= TransitionType.DISSOLVE;
          spec.duration ??= TRANSITION_DEFAULT_DURATION;
        }
        setComponent(world, eid, c.Transition, spec);
        break;
      } case "src": {
        if (isAssetRef(value)) {
          world.history.untrack(() => addComponent(world, eid, c.Generating));
          if (!hasComponent(world, eid, c.Size)) {
            resizeEntity(world, eid, placeholderSize(getAssetSpec(value)));
          }
          this.queue.push({ node, ref: value, type: "asset" });
          break;
        }
        assert(typeof value === "string", "`src` must be a string" + `, value: ${value}`);
        assert(value.trim().length > 0, "`src` must be a non-empty string");

        this.promises.push(this.mountSource(node, value));
        break;
      } case "objectFit":
        assert(typeof value === "string", "`objectFit` must be a string" + `, value: ${value}`);
        assert(value in SCALE_MODE_MAP, `invalid objectFit value: "${value}"`);

        // The media paint is attached asynchronously
        node.objectFit = value as keyof typeof SCALE_MODE_MAP;

        for (const pid of query(world, [c.Paint, ChildOf(eid), Not(c.Deleted)])) {
          if (c.Paint[pid] === PaintType.IMAGE || c.Paint[pid] === PaintType.VIDEO) {
            setComponent(world, pid, c.ScaleMode, SCALE_MODE_MAP[node.objectFit]);
          }
        }
        break;
      case "key": {
        assert(typeof value === "string", "`key` must be a string" + `, value: ${value}`);
        assert(value.trim().length > 0, "`key` must be a non-empty string");
        setComponent(world, eid, c.Key, value.trim());
        break;
      }
      case "fontFamily":
        assert(typeof value === "string", "`fontFamily` must be a string" + `, value: ${value}`);
        assert(value.trim().length > 0, "`fontFamily` must be a non-empty string");
        setComponent(world, eid, c.TextStyle, { fontFamily: value.trim() });
        break;
      case "fontSize":
        assert(typeof value === "number", "`fontSize` must be a number" + `, value: ${value}`);
        assert(value > 0, "`fontSize` must be > 0");
        setComponent(world, eid, c.TextStyle, { fontSize: Math.round(value) });
        break;
      case "fontWeight":
        if (value === "normal") value = "400";
        else if (value === "bold") value = "700";
        assert(typeof value === "string", "`fontWeight` must be a string" + `, value: ${value}`);
        assert(Number.isFinite(Number(value)), "`fontWeight` must be a number");
        setComponent(world, eid, c.TextStyle, { fontWeight: value });
        break;
      case "fontStyle":
        assert(typeof value === "string", "`fontStyle` must be a string" + `, value: ${value}`);
        assert(value in FONT_STYLE_MAP, `invalid fontStyle value: "${value}"`);
        setComponent(world, eid, c.TextStyle, { fontStyle: FONT_STYLE_MAP[value as keyof typeof FONT_STYLE_MAP] });
        break;
      case "textAlign":
        assert(typeof value === "string", "`textAlign` must be a string" + `, value: ${value}`);
        assert(value in TEXT_ALIGN_MAP, `invalid textAlign value: "${value}"`);
        setComponent(world, eid, c.TextStyle, { textAlign: TEXT_ALIGN_MAP[value as keyof typeof TEXT_ALIGN_MAP] });
        break;
      case "textBaseline":
        assert(typeof value === "string", "`textBaseline` must be a string" + `, value: ${value}`);
        assert(value in TEXT_BASELINE_MAP, `invalid textBaseline value: "${value}"`);
        setComponent(world, eid, c.TextStyle, { textBaseline: TEXT_BASELINE_MAP[value as keyof typeof TEXT_BASELINE_MAP] });
        break;
      case "color": {
        const isStop = hasComponent(world, eid, c.ColorStop);
        assert(isStop || hasComponent(world, eid, c.Paint), "`color` only applies to paints or color stops");
        if (Array.isArray(value)) {
          const keyframes = parseKeyframes(name, value, (v) => {
            assert(typeof v === "string", "`color` must be a string" + `, value: ${v}`);
            const color = parseColor(v);
            assert(color !== null, `color is not a valid CSS color: "${v}"`);
            return color;
          });
          if (isStop) setComponent(world, eid, c.ColorStop, { color: keyframes[0].value });
          else setComponent(world, eid, c.Color, keyframes[0].value);
          setKeyframeTrack(world, eid, isStop ? "stop.color" : "color", keyframes);
          break;
        }
        setKeyframeTrack(world, eid, isStop ? "stop.color" : "color", []);
        assert(typeof value === "string", "`color` must be a string" + `, value: ${value}`);
        const color = parseColor(value);
        assert(color !== null, `color is not a valid CSS color: "${value}"`);
        if (isStop) {
          setComponent(world, eid, c.ColorStop, { color });
        } else {
          setComponent(world, eid, c.Color, color);
        }
        break;
      } case "offset": {
        assert(hasComponent(world, eid, c.ColorStop), "`offset` only applies to <colorStop>");
        if (Array.isArray(value)) {
          const keyframes = parseKeyframes(name, value, (v) => {
            assert(typeof v === "number", "`offset` must be a number" + `, value: ${v}`);
            assert(v >= 0 && v <= 1, "`offset` must be between 0 and 1");
            return v;
          });
          setComponent(world, eid, c.ColorStop, { offset: keyframes[0].value });
          setKeyframeTrack(world, eid, "stop.offset", keyframes);
          break;
        }
        setKeyframeTrack(world, eid, "stop.offset", []);
        assert(typeof value === "number", "`offset` must be a number" + `, value: ${value}`);
        assert(value >= 0 && value <= 1, "`offset` must be between 0 and 1");
        setComponent(world, eid, c.ColorStop, { offset: value });
        break;
      } case "preset": {
        assert(hasComponent(world, eid, c.Caption), "`preset` only applies to <captions>");
        assert(typeof value === "string", "`preset` must be a string" + `, value: ${value}`);
        assert(value in CAPTION_PRESET_MAP, `invalid preset value: "${value}"`);
        setComponent(world, eid, c.Caption, { type: CAPTION_PRESET_MAP[value as keyof typeof CAPTION_PRESET_MAP] });
        break;
      } case "colors": {
        assert(hasComponent(world, eid, c.Caption), "`colors` only applies to <captions>");
        assert(Array.isArray(value), "`colors` must be an array of CSS colors" + `, value: ${value}`);
        const colors = value.map((entry) => {
          assert(typeof entry === "string", "`colors` entries must be strings" + `, value: ${entry}`);
          const color = parseColor(entry);
          assert(color !== null, `colors entry is not a valid CSS color: "${entry}"`);
          return color;
        });
        setComponent(world, eid, c.Caption, { colors });
        break;
      }
    }
  }

  public insertNode(parent: DocumentNode, node: DocumentNode) {
    const c = this.world.components;
    if (parent.kind === "root" && node.kind === "element") {
      if (parent.eid === undefined) {
        assert(hasComponent(this.world, node.eid, c.Geometry), "this element cannot be a document root");
        const key = c.Key[node.eid];
        assert(key !== undefined, "`key` is required for `root` nodes");

        // Find and replace node with the same key
        const existing = query(this.world, [c.Key, Not(c.Deleted)])
          .find((eid) => eid !== node.eid && c.Key[eid] === key);

        if (existing === undefined) {
          const width = c.Computed.width[node.eid] ?? 0;
          const height = c.Computed.height[node.eid] ?? 0;
          const position = this.findPlacement(width, height);
          setComponent(this.world, node.eid, c.Position, position);
        } else {
          setComponent(this.world, node.eid, c.Position, {
            x: c.Position.x[existing] ?? 0,
            y: c.Position.y[existing] ?? 0,
          });
          deleteEntity(this.world, existing);
        }
      } else {
        appendChild(this.world, node.eid, parent.eid);
      }

      this.rootEid = node.eid;
    } else if (parent.kind === "element" && node.kind === "text") {
      assert(hasComponent(this.world, parent.eid, c.Geometry), `<${parent.kind}> cannot contain text`);
      assert(c.Geometry[parent.eid] === GeometryType.TEXT, `<${parent.kind}> is not a text element`);
      setComponent(this.world, parent.eid, c.Chars, node.text);
    } else if (parent.kind === "element" && node.kind === "element") {
      appendChild(this.world, node.eid, parent.eid);
    }

    parent.children ??= [];
    parent.children.push(node);
    node.parent = parent;
  }

  public removeNode(parent: DocumentNode, node: DocumentNode) {
    const c = this.world.components;

    if (parent.kind === "element" && node.kind === "text") {
      removeComponent(this.world, parent.eid, c.Chars);
    } else if (parent.kind === "element" && node.kind === "element") {
      removeChild(this.world, node.eid, parent.eid);
      deleteEntity(this.world, node.eid);
    }

    parent.children = parent.children?.filter((child) => child !== node);
    node.parent = undefined;
  }

  public getParentNode(node: DocumentNode): DocumentNode | undefined {
    return node.parent;
  }

  public getFirstChild(node: DocumentNode): DocumentNode | undefined {
    return node.children?.[0];
  }

  public getNextSibling(node: DocumentNode): DocumentNode | undefined {
    const index = node.parent?.children?.indexOf(node);
    if (index === undefined || index == -1) {
      return undefined;
    }

    return node.parent?.children?.[index + 1];
  }

  private findPlacement(width: number, height: number): { x: number; y: number } {
    const center = findEmptyPlacement(this.world, width, height, PLACEMENT_GAP);
    return {
      x: Math.round(center.x - width / 2),
      y: Math.round(center.y - height / 2),
    };
  }

  /**
   * Attaches a resolved asset to a media node — shared by plain `src` values
   * (resolved during mount) and generated assets (landing after commit).
   */
  private async mountSource(node: DocumentNode, src: string) {
    if (node.kind !== "element") return;

    const asset = await resolveAsset(this.world, src);
    const world = this.world;
    const c = world.components;
    const eid = node.eid;

    if (asset.type === 'AUDIO') {
      setComponent(world, eid, c.AssetId, asset.id);
      resizeEntity(world, eid, { width: 500, height: 150 });
    } else if (asset.type === 'IMAGE' || asset.type === 'VIDEO') {
      const fid = createEntity(world);
      setComponent(world, fid, c.Paint, asset.type === 'IMAGE' ? PaintType.IMAGE : PaintType.VIDEO);
      setComponent(world, fid, c.ScaleMode, node.objectFit ? SCALE_MODE_MAP[node.objectFit] : ScaleMode.COVER);
      setComponent(world, fid, c.AssetId, asset.id);
      appendChild(world, fid, eid);

      if (!hasComponent(world, eid, c.Size)) {
        resizeEntity(world, eid, { width: asset.width, height: asset.height });
      }
    }

    setComponent(world, eid, c.Name, asset.name);
  }

}

function placeholderSize(spec: AssetSpecInput): { width: number; height: number } {
  if (spec.type === "image" || spec.type === "video") {
    return ASPECT_RATIO_DIMENSIONS[spec.aspectRatio ?? "16:9"] ?? { width: 1920, height: 1080 };
  }
  return { width: 500, height: 150 };
}

function parseFrames(value: string | null | undefined, fps: number): number | undefined {
  const seconds = parseTime(value);
  return seconds === undefined ? undefined : Math.round(seconds * fps);
}

/**
 * Evaluates a compiled project module. The CLI ships a
 * single-file ESM bundle whose host modules are left external under the
 * "dapi-host:" prefix
 */

// Must match HOST_MODULE_PREFIX in @diffusionstudio/cli's compile step.
const HOST_MODULE_PREFIX = "dapi-host:";

const HOST_MODULES: Record<string, object> = {
  "solid-js": solid,
  "solid-js/store": solidStore,
  "@diffusionstudio/jsx": diffusionJsx,
};

declare global {
  var __dapiHostModules__: Record<string, object> | undefined;
}

const shimUrls = new Map<string, string>();

// A blob module cannot import bare specifiers, so the shim reaches its target
// namespace through a global and re-exports every name statically.
function getShimUrl(name: string): string {
  const cached = shimUrls.get(name);
  if (cached) return cached;

  const ns = HOST_MODULES[name]!;
  globalThis.__dapiHostModules__ ??= {};
  globalThis.__dapiHostModules__[name] = ns;

  const lines = [`const m = globalThis.__dapiHostModules__[${JSON.stringify(name)}];`];
  for (const key of Object.keys(ns)) {
    if (key === "default") continue;
    lines.push(`export const ${key} = m[${JSON.stringify(key)}];`);
  }
  if ("default" in ns) lines.push("export default m.default;");

  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/javascript" }));
  shimUrls.set(name, url);
  return url;
}

export async function importProjectModule(code: string): Promise<Record<string, unknown>> {
  let rewritten = code;
  for (const name of Object.keys(HOST_MODULES)) {
    rewritten = rewritten.replaceAll(
      JSON.stringify(`${HOST_MODULE_PREFIX}${name}`),
      JSON.stringify(getShimUrl(name)),
    );
  }

  const url = URL.createObjectURL(new Blob([rewritten], { type: "text/javascript" }));
  try {
    // Top-level code (including top-level await) runs to completion here.
    return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
  } finally {
    URL.revokeObjectURL(url);
  }
}
