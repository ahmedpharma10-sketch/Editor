/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hasComponent, query, Not } from "bitecs";
import { getAssetSpec, isAssetRef, parseTime } from "@diffusionstudio/jsx";
import * as solid from "solid-js";
import * as solidStore from "solid-js/store";
import * as diffusionJsx from "@diffusionstudio/jsx";
import {
  AnimationPhase,
  AnimationType,
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
  transcriptTrim,
} from "@/components/engine";
import { HtmlHost, isHtmlInCanvasSupported } from "@/components/engine/decoders/html";
import { CanvasHost } from "@/components/engine/decoders/canvas";
import { resolveTranscript } from "@/components/engine/decoders/caption/utils";
import { ChildOf } from "@/components/engine/components";
import { ASPECT_RATIO_DIMENSIONS, findEmptyPlacement } from "@/utils/genai";
import { resolveAsset, resolveGeneratedAsset } from "@/utils/jsx-generation";
import { assert, assertAllSettled, parseColor } from "@/utils";

import type { AssetRef, AssetSpecInput, ProjectDocument, ProjectTick } from "@diffusionstudio/jsx";
import type { Engine, EngineWorld } from "@/components/engine";
import type { GenerationMemo } from "@/utils/jsx-generation";

/**
 * Shadow node: the renderer's host tree, kept as plain objects. Lifecycle
 * calls update this representation first; entities and DOM nodes are only
 * created when a node is inserted into the live tree, at which point its
 * environment (ECS world vs DOM under an <htmlPaint>) is known and all
 * initial props have been recorded — Solid attaches a subtree's root last.
 */
type DocumentNode = {
  id: number;
  tag?: string;
  text?: string;
  props: Record<string, unknown>;
  children: DocumentNode[];
  parent?: DocumentNode;
  eid?: number;
  dom?: Element | Text;
  host?: HtmlHost;
  canvasHost?: CanvasHost;
  ref?(target: unknown): void;
};

let nextNodeId = 1;

function makeNode(init: Pick<DocumentNode, "tag" | "text" | "eid">): DocumentNode {
  return { id: nextNodeId++, ...init, props: {}, children: [] };
}

/**
 * Reads a timing prop as local frames. The record always holds raw `Time`
 * values (numbers are seconds), so every read parses; an unparsable value
 * reads as absent until its own apply rejects it.
 */
function timingProp(node: DocumentNode, name: "start" | "end" | "sourceIn" | "sourceOut"): number | undefined {
  const value = node.props[name];
  return value === undefined ? undefined : parseFrames(String(value), 30);
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Children of an SVG element stay in the SVG namespace, except under
// <foreignObject>, which switches back to HTML.
function isSvgContext(el: Element): boolean {
  return el.namespaceURI === SVG_NS && el.localName !== "foreignObject";
}

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

// JSX animation names, mapped to the presets the animations inspector writes.
// Exported for `node tree`'s entity descriptions.
export const ANIMATION_TYPE_MAP = {
  fade: AnimationType.FADE,
  gain: AnimationType.GAIN,
  grow: AnimationType.GROW,
  shrink: AnimationType.SHRINK,
  blur: AnimationType.BLUR,
  slideLeft: AnimationType.SLIDE_LEFT,
  slideRight: AnimationType.SLIDE_RIGHT,
  slideUp: AnimationType.SLIDE_UP,
  slideDown: AnimationType.SLIDE_DOWN,
  spin: AnimationType.SPIN,
  twist: AnimationType.TWIST,
  appearWord: AnimationType.APPEAR_WORD,
  appearChar: AnimationType.APPEAR_CHAR,
  scramble: AnimationType.SCRAMBLE,
} as const;

const TEXT_ANIMATION_TYPES: ReadonlySet<AnimationType> = new Set([
  AnimationType.APPEAR_WORD,
  AnimationType.APPEAR_CHAR,
  AnimationType.SCRAMBLE,
]);

// 1 second at the canonical 30 fps — the animations inspector's default.
const ANIMATION_DEFAULT_DURATION = 30;

function parseAnimationSpec(
  entry: unknown,
  isTextNode: boolean,
): { type: AnimationType; phase: AnimationPhase; duration: number; delay: number } {
  assert(
    typeof entry === "object" && entry !== null && !Array.isArray(entry),
    "`animations` entries must be { type, phase?, duration?, delay? } objects" + `, value: ${entry}`,
  );
  const { type, phase, duration, delay } = entry as Record<string, unknown>;

  assert(typeof type === "string", "animation `type` must be a string" + `, value: ${type}`);
  const parsedType = ANIMATION_TYPE_MAP[type as keyof typeof ANIMATION_TYPE_MAP];
  assert(parsedType !== undefined, `invalid animation type: "${type}"`);
  assert(
    isTextNode || !TEXT_ANIMATION_TYPES.has(parsedType),
    `animation type "${type}" only applies to text elements`,
  );

  let parsedPhase = AnimationPhase.IN;
  if (phase !== undefined) {
    assert(phase === "in" || phase === "out", 'animation `phase` must be "in" or "out"' + `, value: ${phase}`);
    if (phase === "out") parsedPhase = AnimationPhase.OUT;
  }

  let parsedDuration = ANIMATION_DEFAULT_DURATION;
  if (duration !== undefined) {
    const frames = parseFrames(String(duration), 30);
    assert(typeof frames === "number", "animation `duration` must be a time value" + `, value: ${duration}`);
    assert(frames > 0, "animation `duration` must be > 0");
    parsedDuration = frames;
  }

  let parsedDelay = 0;
  if (delay !== undefined) {
    const frames = parseFrames(String(delay), 30);
    assert(typeof frames === "number", "animation `delay` must be a time value" + `, value: ${delay}`);
    assert(frames >= 0, "animation `delay` must be >= 0");
    parsedDelay = frames;
  }

  return { type: parsedType, phase: parsedPhase, duration: parsedDuration, delay: parsedDelay };
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

  // Set once `commit()` finishes. A live mount (`dapi mount --live`) keeps
  // its reactive graph running past commit, so later writes flow through the
  // same paths, untracked; otherwise the undo stack would fill with one
  // entry per reactive update.
  private committed = false;

  private track<T>(fn: () => T): T {
    if (!this.committed) return fn();
    let result!: T;
    this.world.history.untrack(() => {
      result = fn();
    });
    return result;
  }

  public constructor(engine: Engine, target?: { parentEid: number }) {
    this.stage = makeNode({ tag: "#root", eid: target?.parentEid });
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

      const results = await Promise.allSettled(this.queue.map(({ node, ref, type }) => {
        if (type !== "asset" || !ref) return;
        return this.generateInto(node, ref, memo);
      }));

      assertAllSettled(results);
    }

    // Handle sync queue: after generated assets have landed (either side may
    // be generated), before captions read the scene's final placement.
    {
      for (const { node, targetKey, type } of this.queue) {
        if (node.eid === undefined || type !== "sync" || !targetKey) continue;
        const nodeEid = node.eid;
        const targetEid = query(world, [c.Key, Not(c.Deleted)]).find(eid => c.Key[eid] === targetKey);

        assert(targetEid !== undefined, `syncTo: no other element carries key "${targetKey}"`);

        const source = findGeometryAsset(world, nodeEid);
        assert(
          source !== null && (source.type === "AUDIO" || source.type === "VIDEO"),
          `syncTo: node ${nodeEid} has no audio or video source to align`,
        );
        const targetSource = findGeometryAsset(world, targetEid);
        assert(
          targetSource !== null && (targetSource.type === "AUDIO" || targetSource.type === "VIDEO"),
          `syncTo: target "${targetKey}" has no audio or video source to align against`,
        );

        const { offsetSeconds } = await computeAudioSyncOffsetCached(source, targetSource);

        const offsetFrames = Math.round(offsetSeconds * world.frameRate);
        const parentEid = getParentEntity(world, nodeEid);
        const parentDelay = parentEid !== null ? (c.Computed.delay[parentEid] ?? 0) : 0;
        const delay = (c.Computed.delay[targetEid] ?? 0) + offsetFrames - parentDelay;

        setComponent(world, nodeEid, c.Delay, delay);

        const targetStart = (c.Computed.start[targetEid] ?? 0) - parentDelay;
        const targetEnd = (c.Computed.end[targetEid] ?? 0) - parentDelay;
        const duration = findAssetDuration(world, nodeEid);

        // `sourceIn`/`sourceOut` are source-relative; default to the overlap
        // with the target window. `end` (timeline) converts through `delay`.
        const end = timingProp(node, "end");
        const trimStart = timingProp(node, "sourceIn") ?? Math.max(0, targetStart - delay);
        const trimEnd = timingProp(node, "sourceOut")
          ?? (end !== undefined
            ? end - delay
            : (duration !== null ? Math.min(duration, targetEnd - delay) : targetEnd - delay));
        assert(trimEnd > trimStart, `syncTo: the aligned clip does not overlap the window of "${targetKey}"`);
        setComponent(world, nodeEid, c.Trim, { start: trimStart, end: trimEnd });
        node.props.sourceIn = `${trimStart}f`;
        node.props.sourceOut = `${trimEnd}f`;
        delete node.props.end;
        node.props.start = `${delay + trimStart}f`;
      }
    }

    // Handle captioning queue
    {
      for (const { node, type } of this.queue) {
        if (node.eid === undefined || hasComponent(world, node.eid, c.Deleted) || type !== "caption" || c.AssetId[node.eid]) continue;
        const nodeEid = node.eid;
        const sceneEid = getSceneAncestor(world, nodeEid);
        if (!sceneEid || !hasAudioSources(world, sceneEid)) continue;

        const { asset, trim } = await transcribeScene(this.engine, sceneEid);
        setComponent(world, nodeEid, c.AssetId, asset.id);
        setComponent(world, nodeEid, c.Trim, trim);
      }
    }

    this.queue.length = 0;
    this.committed = true;
  }

  private get world(): EngineWorld {
    return this.engine.world;
  }

  private ticker = solid.createSignal<ProjectTick>(
    { time: 0, frame: 0, delta: 0, playing: false },
    { equals: (a, b) => a.time === b.time && a.frame === b.frame && a.delta === b.delta && a.playing === b.playing },
  );
  private lastTickTime: number | null = null;

  public tick(): ProjectTick {
    return this.ticker[0]();
  }

  /**
   * Reads the playhead of the nearest Playback-carrying ancestor of the
   * mount's root (the root itself for a mounted scene) into the ticker
   * signal. Called by the playback system once per tick.
   */
  public advanceTicker(): void {
    const c = this.world.components;
    const sid = this.playbackRoot();
    const time = sid !== null ? (c.Computed.localTimeInSeconds[sid] ?? 0) : 0;
    const delta = this.lastTickTime === null ? 0 : time - this.lastTickTime;
    this.lastTickTime = time;
    this.ticker[1]({
      time,
      frame: sid !== null ? (c.Computed.localTime[sid] ?? 0) : 0,
      delta,
      playing: sid !== null && c.Playback.playing[sid] === 1,
    });
  }

  private playbackRoot(): number | null {
    // Resolved per tick rather than cached: the root lands after component
    // bodies run (so it is null during the first render), and reparenting or
    // keyed replacement can change the answer later.

    const world = this.world;
    const c = world.components;
    let current = this.rootEid ?? this.stage.eid ?? null;
    while (current !== null && !hasComponent(world, current, c.Deleted)) {
      if (hasComponent(world, current, c.Playback)) return current;
      current = getParentEntity(world, current);
    }
    return null;
  }

  /**
   * Resolves a generated asset and attaches it: during commit via the genai
   * queue, or immediately when a live mount sets an asset ref after commit.
   */
  private async generateInto(node: DocumentNode, ref: AssetRef, memo: GenerationMemo): Promise<void> {
    const world = this.world;
    const c = world.components;
    if (node.eid === undefined || hasComponent(world, node.eid, c.Deleted)) return;
    const eid = node.eid;
    try {
      const asset = await resolveGeneratedAsset(world, ref, memo);
      await this.mountSource(node, asset.id);
    } finally {
      world.history.untrack(() => removeComponent(world, eid, c.Generating));
    }
  }

  public createElement(tag: string): DocumentNode {
    return makeNode({ tag });
  }

  public createTextNode(text: string): DocumentNode {
    return makeNode({ text });
  }

  /** Tag-specific entity setup for a node materializing into the ECS world. */
  private createEntityForTag(node: DocumentNode): number {
    const world = this.world;
    const c = world.components;
    const eid = createEntity(world);

    switch (node.tag) {
      case "scene": {
        setComponent(world, eid, c.Geometry, GeometryType.RECT);
        addComponent(world, eid, c.Scene);
        addComponent(world, eid, c.ClipsContent);
        setComponent(world, eid, c.Playback, {});
        setComponent(world, eid, c.Name, getNextName(world, "Scene"));
        break;
      } case "group": {
        setComponent(world, eid, c.Geometry, GeometryType.RECT);
        addComponent(world, eid, c.Group);
        setComponent(world, eid, c.Name, getNextName(world, "Group"));
        break;
      } case "rect": {
        setComponent(world, eid, c.Geometry, GeometryType.RECT);
        setComponent(world, eid, c.Name, getNextName(world, "Rect"));
        break;
      } case "sequence": {
        addComponent(world, eid, c.Group);
        addComponent(world, eid, c.Sequential);
        setComponent(world, eid, c.Name, getNextName(world, "Sequence"));
        break;
      } case "video": {
        setComponent(world, eid, c.Geometry, GeometryType.RECT);
        setComponent(world, eid, c.Name, getNextName(world, "Video"));
        break;
      } case "image": {
        setComponent(world, eid, c.Geometry, GeometryType.RECT);
        setComponent(world, eid, c.Name, getNextName(world, "Image"));
        break;
      } case "audio": {
        addComponent(world, eid, c.Audio);
        setComponent(world, eid, c.Geometry, GeometryType.RECT);
        setComponent(world, eid, c.Name, getNextName(world, "Audio"));
        break;
      } case "text": {
        setComponent(world, eid, c.Geometry, GeometryType.TEXT);
        const fid = createEntity(world);
        setComponent(world, fid, c.Paint, PaintType.SOLID);
        setComponent(world, fid, c.Color, 0xffffff);
        appendChild(world, fid, eid);
        break;
      } case "captions": {
        assert(!this.committed, "<captions> cannot be created after commit; re-mount instead");
        setComponent(world, eid, c.Geometry, GeometryType.TEXT);
        setComponent(world, eid, c.Caption, {});
        setComponent(world, eid, c.Name, getNextName(world, "Captions"));
        this.queue.push({ node, type: "caption" });
        break;
      } case "solidPaint": case "solid": {
        setComponent(world, eid, c.Paint, PaintType.SOLID);
        setComponent(world, eid, c.Color, 0xE0E0E0);
        break;
      } case "linearGradientPaint": case "linearGradient": {
        setComponent(world, eid, c.Paint, PaintType.LINEAR_GRADIENT);
        break;
      } case "radialGradientPaint": case "radialGradient": {
        setComponent(world, eid, c.Paint, PaintType.RADIAL_GRADIENT);
        break;
      } case "colorStop": case "stop": {
        setComponent(world, eid, c.ColorStop, {});
        break;
      } case "htmlPaint": {
        assert(
          isHtmlInCanvasSupported(),
          "<htmlPaint> requires the html-in-canvas API; enable chrome://flags/#canvas-draw-element",
        );
        setComponent(world, eid, c.Paint, PaintType.HTML);
        const host = new HtmlHost();
        addComponent(world, eid, c.HtmlHost, false);
        c.HtmlHost[eid] = host;
        node.host = host;
        break;
      } case "html": {
        // A rect carrying an html paint; the node's children are the paint's
        // DOM content, so `node.host` points at the paint's host.
        assert(
          isHtmlInCanvasSupported(),
          "<html> requires the html-in-canvas API; enable chrome://flags/#canvas-draw-element",
        );
        setComponent(world, eid, c.Geometry, GeometryType.RECT);
        setComponent(world, eid, c.Name, getNextName(world, "HTML"));
        const fid = createEntity(world);
        setComponent(world, fid, c.Paint, PaintType.HTML);
        const host = new HtmlHost();
        addComponent(world, fid, c.HtmlHost, false);
        c.HtmlHost[fid] = host;
        appendChild(world, fid, eid);
        node.host = host;
        break;
      } case "canvasPaint": {
        setComponent(world, eid, c.Paint, PaintType.CANVAS);
        const host = new CanvasHost();
        addComponent(world, eid, c.CanvasHost, false);
        c.CanvasHost[eid] = host;
        node.canvasHost = host;
        break;
      } case "canvas": {
        // A rect carrying a canvas paint; the node's ref receives the
        // paint's backing canvas, so `node.canvasHost` points at it.
        setComponent(world, eid, c.Geometry, GeometryType.RECT);
        setComponent(world, eid, c.Name, getNextName(world, "Canvas"));
        const fid = createEntity(world);
        setComponent(world, fid, c.Paint, PaintType.CANVAS);
        const host = new CanvasHost();
        addComponent(world, fid, c.CanvasHost, false);
        c.CanvasHost[fid] = host;
        appendChild(world, fid, eid);
        node.canvasHost = host;
        break;
      } default: {
        assert(false, `<${node.tag}> is only valid inside <html> content`);
      }
    }

    return eid;
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
    const node = makeNode({ tag: "#entity", eid });
    const delay = hasComponent(world, eid, c.Delay) ? c.Delay[eid] : 0;
    if (hasComponent(world, eid, c.Trim)) {
      const start = c.Trim.start[eid];
      const end = c.Trim.end[eid];
      if (start !== undefined) {
        node.props.sourceIn = `${start}f`;
      }
      if (end !== undefined) {
        node.props.sourceOut = `${end}f`;
      }
    }
    // start = timeline placement of source-0 (Delay) shifted by the source in point.
    if (hasComponent(world, eid, c.Delay) || node.props.sourceIn !== undefined) {
      node.props.start = `${delay + (timingProp(node, "sourceIn") ?? 0)}f`;
    }
    return node;
  }

  private reconcileTiming(node: DocumentNode) {
    if (node.eid === undefined) return;
    const world = this.world;
    const c = world.components;
    const eid = node.eid;
    const sourceIn = timingProp(node, "sourceIn") ?? 0;
    const start = timingProp(node, "start") ?? 0;
    const end = timingProp(node, "end");
    const sourceOut = timingProp(node, "sourceOut");
    const delay = start - sourceIn;
    setComponent(world, eid, c.Delay, delay);

    if (timingProp(node, "sourceIn") !== undefined) {
      setComponent(world, eid, c.Trim, { start: sourceIn });
    }
    if (sourceOut !== undefined) {
      setComponent(world, eid, c.Trim, { end: sourceOut });
    } else if (end !== undefined) {
      const trimEnd = end - delay;
      assert(trimEnd > sourceIn, `\`end\` must be after \`start\`, got start=${start}, end=${end}`);
      setComponent(world, eid, c.Trim, { end: trimEnd });
    }
  }

  public replaceText(node: DocumentNode, text: string) {
    assert(node.text !== undefined, "replaceText target is not a text node");
    node.text = text;
    // Text inside HTML content is backed by a live DOM node.
    if (node.dom !== undefined) {
      (node.dom as Text).data = text;
      return;
    }
    // Already-materialized text inside a <text> element (a live mount
    // updating a signal) must land in the world too.
    const parent = node.parent;
    if (parent !== undefined && this.isTextEntity(parent)) {
      this.track(() => this.assignChars(parent));
    }
  }

  public isTextNode(node: DocumentNode): boolean {
    return node.text !== undefined;
  }

  private isTextEntity(node: DocumentNode): boolean {
    const c = this.world.components;
    return c.Geometry[node.eid ?? -1] === GeometryType.TEXT;
  }

  /**
   * Chars mirrors the concatenation of a text element's text children — a
   * reactive segment compiles to its own text node (`frame {frame()}` is two).
   */
  private assignChars(parent: DocumentNode): void {
    const c = this.world.components;
    const texts = parent.children.filter((child) => child.text !== undefined);
    assert(parent.eid !== undefined, "syncChars parent is not a text entity");

    if (texts.length === 0) {
      removeComponent(this.world, parent.eid, c.Chars);
    } else {
      setComponent(this.world, parent.eid, c.Chars, texts.map((child) => child.text).join(""));
    }
  }

  public setProperty(node: DocumentNode, name: string, value: unknown) {
    if (name === "children" || name === "ref" || value === undefined || node.text !== undefined) return;
    // update shadow node props
    node.props[name] = value;

    // dom path
    if (node.dom !== undefined) {
      setDomProperty(node.dom as Element, name, value);
    } else if (node.eid !== undefined) {
      // ecs path
      this.track(() => this.applyEcsProperty(node, name, value));
    }
  }

  private applyEcsProperty(node: DocumentNode, name: string, value: unknown) {
    const world = this.world;
    const c = world.components;
    const eid = node.eid!;

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
        node.props.start = value;
        this.reconcileTiming(node);
        break;
      } case "end": {
        const parsed = parseFrames(String(value), 30);
        assert(typeof parsed === "number", "`end` must be a string or number" + `, value: ${value}`);
        node.props.end = value;
        delete node.props.sourceOut;
        this.reconcileTiming(node);
        break;
      } case "sourceIn": {
        const parsed = parseFrames(String(value), 30);
        assert(typeof parsed === "number", "`sourceIn` must be a string or number" + `, value: ${value}`);
        node.props.sourceIn = value;
        this.reconcileTiming(node);
        break;
      } case "sourceOut": {
        const parsed = parseFrames(String(value), 30);
        assert(typeof parsed === "number", "`sourceOut` must be a string or number" + `, value: ${value}`);
        node.props.sourceOut = value;
        delete node.props.end;
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
            assert(typeof v === "number", "`volume` must be a number (dB)" + `, value: ${v}`);
            // Keyframed silence floors at -60 dB so segments toward it
            // interpolate over finite values.
            return Math.max(v, -60);
          });
          setComponent(world, eid, c.Volume, keyframes[0].value);
          setKeyframeTrack(world, eid, "volume", keyframes);
          break;
        }
        setKeyframeTrack(world, eid, "volume", []);
        assert(typeof value === "number", "`volume` must be a number (dB)" + `, value: ${value}`);
        setComponent(world, eid, c.Volume, value);
        break;
      } case "muted": {
        assert(typeof value === "boolean", "`muted` must be a boolean" + `, value: ${value}`);
        if (value) addComponent(world, eid, c.Muted);
        else removeComponent(world, eid, c.Muted);
        break;
      } case "syncTo": {
        assert(typeof value === "string", "`syncTo` must be a string" + `, value: ${value}`);
        assert(value.trim().length > 0, "`syncTo` must be a non-empty string");
        assert(!this.committed, "`syncTo` cannot change after commit; re-mount instead");
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
      } case "animations": {
        assert(
          Array.isArray(value),
          "`animations` must be an array of { type, phase?, duration?, delay? } objects" + `, value: ${value}`,
        );
        const isTextNode = c.Geometry[eid] === GeometryType.TEXT;
        const specs = value.map((entry) => parseAnimationSpec(entry, isTextNode));

        // The list replaces the node's existing animations; [] clears them.
        // Materialized before deleting — removal mutates the live query.
        for (const aid of [...query(world, [c.Animation, ChildOf(eid), Not(c.Deleted)])]) {
          deleteEntity(world, aid);
        }
        for (const spec of specs) {
          const aid = createEntity(world);
          setComponent(world, aid, c.Animation, spec);
          appendChild(world, aid, eid);
        }
        break;
      } case "src": {
        if (isAssetRef(value)) {
          world.history.untrack(() => addComponent(world, eid, c.Generating));
          if (!hasComponent(world, eid, c.Size)) {
            resizeEntity(world, eid, placeholderSize(getAssetSpec(value)));
          }
          // Post-commit (live mount) nothing drains the queue; resolve now.
          if (this.committed) this.generateInto(node, value, new Map()).catch(console.error);
          else this.queue.push({ node, ref: value, type: "asset" });
          break;
        }
        assert(typeof value === "string", "`src` must be a string" + `, value: ${value}`);
        assert(value.trim().length > 0, "`src` must be a non-empty string");

        if (this.committed) this.mountSource(node, value).catch(console.error);
        else this.promises.push(this.mountSource(node, value));
        break;
      } case "objectFit": {
        assert(typeof value === "string", "`objectFit` must be a string" + `, value: ${value}`);
        assert(value in SCALE_MODE_MAP, `invalid objectFit value: "${value}"`);
        const mode = SCALE_MODE_MAP[value as keyof typeof SCALE_MODE_MAP];

        for (const pid of query(world, [c.Paint, ChildOf(eid), Not(c.Deleted)])) {
          if (c.Paint[pid] === PaintType.IMAGE || c.Paint[pid] === PaintType.VIDEO) {
            setComponent(world, pid, c.ScaleMode, mode);
          }
        }
        break;
      }
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
        else if (typeof value === "number") value = String(value);
        assert(typeof value === "string", "`fontWeight` must be a number, \"normal\", or \"bold\"" + `, value: ${value}`);
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

  public insertNode(parent: DocumentNode, node: DocumentNode, anchor?: DocumentNode) {
    // Shadow first — re-inserting an attached node moves it (how the
    // renderer reorders), so detach it from its previous position.
    if (node.parent) {
      node.parent.children = node.parent.children.filter((child) => child !== node);
    }
    const index = anchor !== undefined ? parent.children.indexOf(anchor) : -1;
    if (index === -1) parent.children.push(node);
    else parent.children.splice(index, 0, node);
    node.parent = parent;

    if (parent === this.stage || parent.eid !== undefined || parent.dom !== undefined) {
      this.track(() => this.attach(parent, node, anchor));
    }
  }

  /**
   * Inserts `node` under a live parent, materializing it first if needed.
   * The environment is the parent's: children of an <htmlPaint> (or of any
   * DOM node) become real DOM, everything else lands in the ECS world.
   */
  private attach(parent: DocumentNode, node: DocumentNode, anchor?: DocumentNode): void {
    const world = this.world;
    const c = world.components;

    const domParent = parent.host?.element ?? parent.dom;
    if (domParent !== undefined) {
      assert(domParent instanceof Element, "text nodes cannot contain children");
      if (node.dom === undefined) this.materializeDom(node, isSvgContext(domParent));
      domParent.insertBefore(node.dom!, anchor?.dom ?? null);
      return;
    }

    // Text in the ECS world is the content of a text element; anywhere else
    // only the empty placeholders Solid's control flow leaves behind pass.
    if (node.text !== undefined) {
      if (parent === this.stage) return;
      if (this.isTextEntity(parent)) this.assignChars(parent);
      else assert(node.text === "", `<${parent.tag}> cannot contain text`);
      return;
    }

    if (node.eid === undefined) this.materializeEcs(node);
    const eid = node.eid!;

    if (parent !== this.stage) {
      this.attachEntity(eid, parent.eid!);
      return;
    }

    if (this.stage.eid !== undefined) {
      this.attachEntity(eid, this.stage.eid);
    } else {
      assert(hasComponent(world, eid, c.Geometry), "this element cannot be a document root");
      const key = c.Key[eid];
      assert(key !== undefined, "`key` is required for `root` nodes");

      // Find and replace node with the same key
      const existing = query(world, [c.Key, Not(c.Deleted)])
        .find((other) => other !== eid && c.Key[other] === key);

      if (existing === undefined) {
        const width = c.Computed.width[eid] ?? 0;
        const height = c.Computed.height[eid] ?? 0;
        setComponent(world, eid, c.Position, this.findPlacement(width, height));
      } else {
        setComponent(world, eid, c.Position, {
          x: c.Position.x[existing] ?? 0,
          y: c.Position.y[existing] ?? 0,
        });
        deleteEntity(world, existing);
      }
    }

    this.rootEid = eid;
  }

  // Fresh entities append; an entity that already has a parent is a Solid
  // reorder or reparent (e.g. a <For> moving rows in a live mount).
  private attachEntity(eid: number, parentEid: number): void {
    const currentParent = getParentEntity(this.world, eid);
    if (currentParent === null) {
      appendChild(this.world, eid, parentEid);
      return;
    }
    if (currentParent !== parentEid) {
      removeChild(this.world, eid, currentParent);
      appendChild(this.world, eid, parentEid);
    }
  }

  /**
   * Records a `ref` callback (the renderer's `use`). Refs run at
   * materialization, when the backing object exists — for canvas elements
   * the paint's canvas, for DOM nodes under an <htmlPaint> the element.
   */
  public applyRef(node: DocumentNode, ref: (target: unknown) => void): void {
    node.ref = ref;
  }

  /** Invokes and consumes a node's recorded ref, outside the current tracking scope. */
  private invokeRef(node: DocumentNode, target: unknown): void {
    const ref = node.ref;
    if (ref === undefined) return;
    node.ref = undefined;
    solid.untrack(() => ref(target));
  }

  /**
   * The box a canvas paint's bitmap is initially allocated at: the nearest
   * explicit size up the shadow tree (every element's box defaults to its
   * parent's), falling back to a live ancestor's computed size for mounts
   * into existing entities (`dapi node insert`).
   */
  private resolveBoxSize(node: DocumentNode): { width: number; height: number } {
    const c = this.world.components;
    let width: number | undefined;
    let height: number | undefined;

    // Recorded props first — entities in the materializing subtree are fresh,
    // so their Computed sizes are defaults, not layout. Live ancestors'
    // Computed only backstops mounts into existing entities (node insert).
    for (let cursor: DocumentNode | undefined = node; cursor !== undefined; cursor = cursor.parent) {
      width ??= sizeProp(cursor.props.width);
      height ??= sizeProp(cursor.props.height);
      if (width !== undefined && height !== undefined) return { width, height };
    }
    for (let cursor: DocumentNode | undefined = node; cursor !== undefined; cursor = cursor.parent) {
      // Freshly created entities have an eid but no Size yet; only already
      // live ones (e.g. the target of a `node insert`) carry a real box.
      if (cursor.eid === undefined || !hasComponent(this.world, cursor.eid, c.Size)) continue;
      width ??= c.Computed.width[cursor.eid] || undefined;
      height ??= c.Computed.height[cursor.eid] || undefined;
      if (width !== undefined && height !== undefined) break;
    }

    return { width: width ?? 300, height: height ?? 150 };
  }

  /**
   * Creates the entity for an element and replays its shadow state: tag
   * components, children (attached while the subtree is still detached from
   * the stage), then recorded props in authored order.
   */
  private materializeEcs(node: DocumentNode): void {
    node.eid = this.createEntityForTag(node);
    for (const child of node.children) this.attach(node, child);
    for (const [name, value] of Object.entries(node.props)) this.applyEcsProperty(node, name, value);

    if (node.canvasHost !== undefined) {
      const box = this.resolveBoxSize(node.tag === "canvasPaint" ? node.parent ?? node : node);
      node.canvasHost.setSize(box.width, box.height);
      this.invokeRef(node, node.canvasHost.canvas);
    }
    assert(node.ref === undefined, `\`ref\` is not supported on <${node.tag}>`);
  }

  /** Builds the DOM subtree for a node under an <htmlPaint>, props applied. */
  private materializeDom(node: DocumentNode, svg: boolean): void {
    if (node.text !== undefined) {
      node.dom = document.createTextNode(node.text);
      return;
    }
    const tag = node.tag!;
    const inSvg = svg || tag === "svg";
    const el = inSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    node.dom = el;
    for (const child of node.children) {
      this.materializeDom(child, inSvg && tag !== "foreignObject");
      el.appendChild(child.dom!);
    }
    for (const [name, value] of Object.entries(node.props)) setDomProperty(el, name, value);
    this.invokeRef(node, el);
  }

  public removeNode(parent: DocumentNode, node: DocumentNode) {
    parent.children = parent.children.filter((child) => child !== node);
    node.parent = undefined;

    this.track(() => {
      if (node.dom !== undefined) {
        node.dom.remove();
      } else if (node.text !== undefined) {
        if (this.isTextEntity(parent)) this.assignChars(parent);
      } else if (node.eid !== undefined && parent !== this.stage && parent.eid !== undefined) {
        removeChild(this.world, node.eid, parent.eid);
        deleteEntity(this.world, node.eid);
      }
    });
  }

  public getParentNode(node: DocumentNode): DocumentNode | undefined {
    return node.parent;
  }

  public getFirstChild(node: DocumentNode): DocumentNode | undefined {
    return node.children[0];
  }

  public getNextSibling(node: DocumentNode): DocumentNode | undefined {
    const siblings = node.parent?.children;
    if (siblings === undefined) return undefined;
    const index = siblings.indexOf(node);
    return index === -1 ? undefined : siblings[index + 1];
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
    if (node.eid === undefined) return;
    const eid = node.eid;

    const asset = await resolveAsset(this.world, src);
    const transcript = asset.type === 'TRANSCRIPT' ? await resolveTranscript(asset) : null;

    this.track(() => {
      const world = this.world;
      const c = world.components;

      if (asset.type === 'TRANSCRIPT') {
        // AssetId set here makes commit's caption phase skip transcription.
        setComponent(world, eid, c.AssetId, asset.id);
        setComponent(world, eid, c.Trim, transcriptTrim(transcript!));
      } else if (asset.type === 'AUDIO') {
        setComponent(world, eid, c.AssetId, asset.id);
        resizeEntity(world, eid, { width: 500, height: 150 });
      } else if (asset.type === 'IMAGE' || asset.type === 'VIDEO') {
        const fid = createEntity(world);
        setComponent(world, fid, c.Paint, asset.type === 'IMAGE' ? PaintType.IMAGE : PaintType.VIDEO);
        const objectFit = node.props.objectFit as keyof typeof SCALE_MODE_MAP | undefined;
        setComponent(world, fid, c.ScaleMode, objectFit ? SCALE_MODE_MAP[objectFit] : ScaleMode.COVER);
        setComponent(world, fid, c.AssetId, asset.id);
        appendChild(world, fid, eid);

        if (!hasComponent(world, eid, c.Size)) {
          resizeEntity(world, eid, { width: asset.width, height: asset.height });
        }
      }

      setComponent(world, eid, c.Name, asset.name);
    });
  }

}

/**
 * Prop assignment for DOM nodes inside <htmlPaint>: enough of Solid's DOM
 * conventions (style objects, class, classList, innerHTML) for drawn markup.
 * Event handlers are dropped — the content is painted, not interactive.
 */
function setDomProperty(el: Element, name: string, value: unknown): void {
  if (typeof value === "function") return;

  if (name === "style") {
    const style = (el as HTMLElement).style;
    if (typeof value === "string") style.cssText = value;
    else if (typeof value === "object" && value !== null) Object.assign(style, value);
  } else if (name === "class" || name === "className") {
    el.setAttribute("class", String(value));
  } else if (name === "classList") {
    if (typeof value === "object" && value !== null) {
      for (const [key, on] of Object.entries(value)) {
        el.classList.toggle(key, !!on);
      }
    }
  } else if (name === "innerHTML") {
    el.innerHTML = String(value);
  } else if (name === "textContent") {
    el.textContent = String(value);
  } else if (value === false || value === null) {
    el.removeAttribute(name);
  } else {
    el.setAttribute(name, value === true ? "" : String(value));
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
 * Reads a recorded width/height prop as a number; keyframed sizes read as their first keyframe.
 */
function sizeProp(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (Array.isArray(value) && typeof (value[0] as { value?: unknown })?.value === "number") {
    return (value[0] as { value: number }).value;
  }
  return undefined;
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
