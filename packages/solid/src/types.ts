/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { JSX as SolidJSX } from "solid-js";
import type { AssetRef } from "@diffusionstudio/ai";

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
  /** Node-local time: 0 is the node's in point. Any `Time` format. */
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
  /** Composition time at which the node becomes visible/audible. */
  inPoint?: Time;
  /** Composition time at which the node stops. */
  outPoint?: Time;
  /** Composition time at which the node's source time 0 is placed. Defaults to the in point. */
  startTime?: Time;
  /**
   * Key of another element carrying an audio track. Derives `startTime` by
   * cross-correlating the two audio signals so the recordings coincide on the
   * timeline. Mutually exclusive with `startTime`.
   */
  syncTo?: string;
  /** Any CSS color, applied to the node's solid fill (created if absent); alpha is ignored — use `opacity`. */
  fill?: string;
  /** Path, URL, asset id, or a `generate.*` declaration. */
  src?: string | AssetRef;
  /** How the source maps into the box. Default "cover" on `<video>`, "contain" on `<image>`. */
  objectFit?: Fit;
  /** 0–1; 1 = unity gain. Animatable. */
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
  inPoint: true,
  outPoint: true,
  startTime: true,
  syncTo: true,
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

type TimingProps = Pick<PatchProps, "inPoint" | "outPoint" | "startTime">;

type CommonProps = TimingProps &
  Pick<
    PatchProps,
    "key" | "name" | "x" | "y" | "width" | "height" | "rotation" | "opacity" | "cornerRadius"
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

export type AudioProps = TimingProps &
  Required<Pick<PatchProps, "src">> &
  Pick<PatchProps, "name" | "volume" | "muted" | "syncTo">;

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

export type CaptionsProps = Pick<PatchProps, "preset" | "colors">;
