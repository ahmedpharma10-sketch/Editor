/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { JSX as SolidJSX } from "solid-js";
import type { AssetRef } from "./generate";

/**
 * Composition-relative time: seconds (number), frames ("30f"), or a
 * "MM:SS" / "HH:MM:SS" clock string. The canonical internal unit is frames
 * at 30 fps; all formats are converted on import. Values may be negative.
 */
export type Time = number | `${number}f` | `${string}:${string}`;

export type Fit = "cover" | "contain" | "fill";

/**
 * Easing for the segment from a keyframe to the next one: a named preset or
 * an explicit descriptor. `cubicBezier(x1,y1,x2,y2)` takes CSS-style control
 * points, `spring(bounce,duration)` a 0–1 bounce and a duration in ms,
 * `steps(n)` holds n discrete values.
 */
export type Easing =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "gentle"
  | "snappy"
  | "bouncy"
  | "strong"
  | `cubicBezier(${string})`
  | `spring(${string})`
  | `steps(${string})`;

export type Keyframe<T> = {
  /** Node-local time: 0 is where the clip begins (its `start`). Any `Time` format. */
  time: Time;
  value: T;
  /** Shapes the segment to the next keyframe; ignored on the last. Default "linear". */
  easing?: Easing;
};

/**
 * A static value, or keyframes animating it over the node's local time.
 * Setting a static value removes any existing keyframe track on the property.
 */
export type Animatable<T> = T | Keyframe<T>[];

/** Transition styles — the editor's transition inspector options. */
export type TransitionType =
  | "dissolve"
  | "slideFromRight"
  | "slideFromLeft"
  | "fadeToBlack"
  | "fadeToWhite";

/** The `transition` prop's value — see `PatchProps["transition"]`. */
export type TransitionSpec = {
  /** Transition style. Default "dissolve". */
  type?: TransitionType;
  /** Length of the transition, centered on the cut. Any `Time` format. Default 1 second. */
  duration?: Time;
};

/**
 * Preset animation styles — the editor's animations inspector options.
 * "appearWord" / "appearChar" / "scramble" apply only to text elements;
 * "gain" ramps audio and has no visual effect.
 */
export type AnimationType =
  | "fade"
  | "gain"
  | "grow"
  | "shrink"
  | "blur"
  | "slideLeft"
  | "slideRight"
  | "slideUp"
  | "slideDown"
  | "spin"
  | "twist"
  | "appearWord"
  | "appearChar"
  | "scramble";

/** One entry of the `animations` prop's list — see `PatchProps["animations"]`. */
export type AnimationSpec = {
  /** Animation style. */
  type: AnimationType;
  /** "in" plays from the clip's head, "out" into its tail. Default "in". */
  phase?: "in" | "out";
  /** Length of the animation. Any `Time` format. Default 1 second. */
  duration?: Time;
  /**
   * Gap between the clip edge and the animation: after the head for "in",
   * before the tail for "out". Any `Time` format. Default 0.
   */
  delay?: Time;
};

/** Caption style presets — the editor's caption inspector presets. */
export type CaptionPreset =
  | "classic"
  | "cascade"
  | "spotlight"
  | "whisper"
  | "paper"
  | "guinea"
  | "stark";

/**
 * Every property assignable through the renderer — exactly the set
 * `WorldDocument.setProperty` accepts. This is the single property table:
 * element props pick from it, and `dapi node patch` takes any subset per
 * patch entry with identical value requirements, so JSX and CLI can't drift.
 */
export type PatchProps = {
  /**
   * Stable identity across mounts — required when the element is a document
   * root: re-mounting replaces the node carrying the same key, or creates it
   * if absent.
   */
  key?: string;
  /** Human-readable node name. */
  name?: string;
  /** Position relative to the parent, px. Defaults to 0. Animatable. */
  x?: Animatable<number>;
  y?: Animatable<number>;
  /** Box size, px. Defaults to the parent's size. Animatable. */
  width?: Animatable<number>;
  height?: Animatable<number>;
  /** Rotation in degrees. Animatable. */
  rotation?: Animatable<number>;
  /** Opacity, 0–1. Animatable. */
  opacity?: Animatable<number>;
  /** Uniform corner radius, px. Animatable. */
  cornerRadius?: Animatable<number>;
  /** Parent-timeline time at which the node begins. Default 0. */
  start?: Time;
  /** Parent-timeline time at which the node ends. Alternative to `sourceOut`. */
  end?: Time;
  /** Source in point: where playback begins within the source, trimming the head. Default 0. */
  sourceIn?: Time;
  /** Source out point: where playback ends within the source. Defaults to the natural end. Alternative to `end`. */
  sourceOut?: Time;
  /**
   * Key of another element carrying an audio track. Derives the timeline
   * placement (`start`) by cross-correlating the two audio signals so the
   * recordings coincide on the timeline. Mutually exclusive with `start`.
   */
  syncTo?: string;
  /**
   * Transition into the next clip, rendered centered on the cut, set on the
   * outgoing clip. Only on direct children of `<sequence>`; a partial value
   * merges into the clip's existing transition, `null` removes it.
   */
  transition?: TransitionSpec | null;
  /**
   * Preset in/out animations, played over the clip's head and tail. The list
   * replaces the node's existing animations; `[]` removes them all.
   */
  animations?: AnimationSpec[];
  /** Any CSS color, applied to the node's solid fill (created if absent); alpha is ignored — use `opacity`. */
  fill?: string;
  /**
   * Path, URL, asset id, or a `generate.*` declaration. On `<captions>` a
   * transcript source (.srt, .vtt, or transcript .json) mounted instead of
   * transcribing the scene; `generate.*` is not accepted there.
   */
  src?: string | AssetRef;
  /** How the source maps into the box. Default "cover" on `<video>`, "contain" on `<image>`. */
  objectFit?: Fit;
  /** Decibels: 0 = unity gain, negative attenuates (-6 ≈ half as loud), -Infinity = silence. Use `muted` to silence. Animatable. */
  volume?: Animatable<number>;
  /** Excludes the node's audio from the mix; independent of `volume`. */
  muted?: boolean;
  /** A family available on the machine (`dapi fonts`). */
  fontFamily?: string;
  /** Font size, px. */
  fontSize?: number;
  /** CSS weights 100–900, or "normal" / "bold". */
  fontWeight?: number | "normal" | "bold";
  fontStyle?: "normal" | "italic";
  /** Any CSS color: the glyph color on `<text>`, the paint color on paints and color stops. Animatable. */
  color?: Animatable<string>;
  /** Horizontal alignment of glyphs within the box. Default "left". */
  textAlign?: "left" | "center" | "right";
  /** Vertical alignment within the box. Default "top". */
  textBaseline?: "top" | "middle" | "bottom";
  /** Position along the gradient, 0–1. Animatable. */
  offset?: Animatable<number>;
  /** Caption style preset — `<captions>` only. Default "classic". */
  preset?: CaptionPreset;
  /** Fills the caption preset's color slots in order; any CSS color, alpha is ignored. */
  colors?: string[];
};

/** Every PatchProps key, at runtime — the `dapi node patch` allowlist. */
export const PATCH_PROP_KEYS = Object.keys({
  key: true,
  name: true,
  x: true,
  y: true,
  width: true,
  height: true,
  rotation: true,
  opacity: true,
  cornerRadius: true,
  start: true,
  end: true,
  sourceIn: true,
  sourceOut: true,
  syncTo: true,
  transition: true,
  animations: true,
  fill: true,
  src: true,
  objectFit: true,
  volume: true,
  muted: true,
  fontFamily: true,
  fontSize: true,
  fontWeight: true,
  fontStyle: true,
  color: true,
  textAlign: true,
  textBaseline: true,
  offset: true,
  preset: true,
  colors: true,
} satisfies Record<keyof PatchProps, true>) as ReadonlyArray<keyof PatchProps>;

type TimingProps = Pick<PatchProps, "start" | "end" | "sourceIn" | "sourceOut">;

type CommonProps = TimingProps &
  Pick<
    PatchProps,
    | "key" | "name" | "x" | "y" | "width" | "height" | "rotation" | "opacity" | "cornerRadius"
    | "transition" | "animations"
  >;

export type SceneProps = {
  /**
   * Stable identity across mounts — required: re-mounting replaces the scene
   * carrying the same key, or creates it if absent.
   */
  key: string;
  /** Human-readable scene name — recommended, e.g. `name="Intro"`. */
  name?: string;
  /** Composition width in pixels. Required. */
  width: number;
  /** Composition height in pixels. Required. */
  height: number;
  /** Background fill, any CSS color (alpha is ignored). */
  fill?: string;
  children?: SolidJSX.Element;
};

export type GroupProps = CommonProps & Pick<PatchProps, "fill"> & {
  children?: SolidJSX.Element;
};

export type RectProps = CommonProps & Pick<PatchProps, "fill"> & {
  /** Paint children (`<solidPaint>`, `<linearGradientPaint>`, `<radialGradientPaint>`). */
  children?: SolidJSX.Element;
};

export type SolidPaintProps = Required<Pick<PatchProps, "color">> & Pick<PatchProps, "opacity">;

export type GradientPaintProps = Pick<PatchProps, "opacity"> & {
  /** Gradient rotation in degrees. Defaults to 0 (left to right). */
  rotation?: number;
  /** `<colorStop>` children — the gradient's color stops. */
  children?: SolidJSX.Element;
};

export type ColorStopProps = Required<Pick<PatchProps, "offset" | "color">> &
  Pick<PatchProps, "opacity">;

export type VideoProps = CommonProps &
  Required<Pick<PatchProps, "src">> &
  Pick<PatchProps, "objectFit" | "volume" | "muted" | "syncTo">;

export type ImageProps = CommonProps &
  Required<Pick<PatchProps, "src">> &
  Pick<PatchProps, "objectFit">;

export type HtmlPaintProps = Pick<PatchProps, "opacity"> & {
  /**
   * HTML children — real DOM elements laid out by the browser at the parent
   * geometry's box size and drawn into it (html-in-canvas). Fully reactive:
   * signals in attributes and text update the drawn content.
   */
  children?: SolidJSX.Element;
};

/** `<html>` — a rectangle carrying an `<htmlPaint>` with the given children. */
export type HtmlProps = CommonProps & Pick<HtmlPaintProps, "children">;

// HTMLCanvasElement without requiring the DOM lib (this package also
// type-checks in node contexts): the real type when present, a structural
// stub otherwise.
type HostCanvas = typeof globalThis extends { HTMLCanvasElement: new () => infer T } ? T
  : { width: number; height: number; getContext(contextId: string, options?: unknown): unknown };

export type CanvasPaintProps = Pick<PatchProps, "opacity"> & {
  /**
   * Receives the paint's backing canvas once the paint materializes. Draw to
   * any context type (2d, webgl, webgpu); the engine samples the bitmap every
   * frame and stretches it into the parent geometry's box. Callback form
   * only — the renderer has no element to assign to a variable ref.
   */
  ref: (canvas: HostCanvas) => void;
};

/** `<canvas>` — a rectangle carrying a `<canvasPaint>` with the given ref. */
export type CanvasProps = CommonProps & Pick<CanvasPaintProps, "ref">;

export type AudioProps = TimingProps &
  Required<Pick<PatchProps, "src">> &
  Pick<PatchProps, "name" | "volume" | "muted" | "syncTo" | "animations">;

export type TextProps = CommonProps &
  Pick<
    PatchProps,
    "fontFamily" | "fontSize" | "fontWeight" | "fontStyle" | "color" | "textAlign" | "textBaseline"
  > & {
    /** The text content. Required. */
    children: SolidJSX.Element;
  };

export type SequenceProps = Pick<PatchProps, "name"> & {
  children?: SolidJSX.Element;
};

export type CaptionsProps = Pick<PatchProps, "preset" | "colors" | "src" | "start" | "animations">;
