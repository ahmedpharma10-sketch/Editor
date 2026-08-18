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

/** How a stroke turns a corner: the canvas `lineJoin` values. */
export type StrokeJoin = "miter" | "round" | "bevel";

/** How a stroke ends an open path: the canvas `lineCap` values. */
export type StrokeCap = "butt" | "round" | "square";

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
 * Every property assignable through the renderer's property-write path. This
 * is the single property table: element props pick from it, and a patch-style
 * command takes any subset per patch entry with identical value requirements,
 * so JSX and any patch API can't drift.
 */
export type PatchProps = {
  /** Human-readable node name. */
  name?: string;
  /**
   * Whether the editor has this element selected. Editor state rather than
   * part of the composition (nothing rendered or exported depends on it), but
   * the source is the document, so it lives here for the same reason
   * `<stage>`'s `camera` does: a click on the canvas has nowhere else to be
   * written to, and the selection survives a recompile. Absent means not
   * selected; the editor writes the bare attribute and removes it again.
   */
  selected?: boolean;
  /**
   * Whether this element is the one the playhead, timeline, and capture
   * operate on. Editor state carried by the source like `selected`, with two
   * rules the runtime holds: at most one element is active, and only a root
   * (a direct child of `<stage>`) can be; a nested `active` is dropped. When
   * a file names more than one, the last one rendered wins.
   */
  active?: boolean;
  /** Position relative to the parent, px. Defaults to 0. Animatable. */
  x?: Animatable<number>;
  y?: Animatable<number>;
  /**
   * Render-time translation on top of `x`/`y`, px — moves the drawn content
   * without changing the layout box (the property slide animations drive).
   * Subpixel values are kept. Defaults to 0. Animatable.
   */
  offsetX?: Animatable<number>;
  offsetY?: Animatable<number>;
  /**
   * Box size, px. Defaults to the parent's size. Animatable. On a `<stroke>`
   * `width` is the line width instead, px (default 1).
   */
  width?: Animatable<number>;
  height?: Animatable<number>;
  /** Rotation in degrees. Animatable. */
  rotation?: Animatable<number>;
  /** Opacity, 0–1 (out-of-range values clamp, like CSS). Animatable. */
  opacity?: Animatable<number>;
  /** Uniform corner radius, px. Animatable. */
  cornerRadius?: Animatable<number>;
  /** Blur radius of a `<shadow>`, px. Default 0. Animatable. */
  blur?: Animatable<number>;
  /** How a `<stroke>` turns corners. Default "miter". */
  join?: StrokeJoin;
  /** How a `<stroke>` ends open paths (text glyphs). Default "butt". */
  cap?: StrokeCap;
  /** Miter length limit of a `<stroke>`, as a ratio of its width. Default 10. */
  miterLimit?: number;
  /** Parent-timeline time at which the node begins. Default 0. */
  start?: Time;
  /** Parent-timeline time at which the node ends. Alternative to `sourceOut`. */
  end?: Time;
  /** Source in point: where playback begins within the source, trimming the head. Default 0. */
  sourceIn?: Time;
  /** Source out point: where playback ends within the source. Defaults to the natural end. Alternative to `end`. */
  sourceOut?: Time;
  /**
   * `id` of another element carrying an audio track. Derives the timeline
   * placement (`start`) by cross-correlating the two audio signals so the
   * recordings coincide on the timeline. Mutually exclusive with `start`.
   */
  syncTo?: string;
  /**
   * Transition into the next clip, rendered centered on the cut, set on the
   * outgoing clip. Only on direct children of `<Sequence>`; a partial value
   * merges into the clip's existing transition, `null` removes it.
   */
  transition?: TransitionSpec | null;
  /**
   * Preset in/out animations, played over the clip's head and tail. The list
   * replaces the node's existing animations; `[]` removes them all.
   */
  animations?: AnimationSpec[];
  /** Any CSS color, the node's intrinsic solid fill (drawn beneath any paint children); alpha is ignored — use `opacity`. */
  fill?: string;
  /**
   * Path, URL, asset id, or a `generate.*` declaration. On `<Captions>` a
   * transcript source (.srt, .vtt, or transcript .json) mounted instead of
   * transcribing the scene; `generate.*` is not accepted there.
   */
  src?: string | AssetRef;
  /** How the source maps into the box. Default "cover" on `<Video>`, "contain" on `<Image>`. */
  objectFit?: Fit;
  /**
   * Fragment-stage WGSL of a `<ShaderPaint>`, applied to the video/image
   * paint directly below it in the paint stack, or run procedurally (over a
   * transparent source) when there is none. Entry point
   * `@fragment fn main(@location(0) uv: vec2f) -> @location(0) vec4f`;
   * sample the media with `sampleSource(uv)`.
   */
  wgsl?: string;
  /**
   * Values for the shader's `@group(1)` uniform declarations, matched by
   * name: numbers bind to `f32`, arrays of 2-4 to `vec2f`-`vec4f`, CSS
   * color strings to `vec3f`/`vec4f`.
   */
  uniforms?: Record<string, number | number[] | string>;
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
  /** Any CSS color: the glyph color on `<Text>`, the paint color on paints, strokes, shadows and color stops. Animatable. */
  color?: Animatable<string>;
  /** Horizontal alignment of glyphs within the box. Default "left". */
  textAlign?: "left" | "center" | "right";
  /** Vertical alignment within the box. Default "top". */
  textBaseline?: "top" | "middle" | "bottom";
  /** Position along the gradient, 0–1. Animatable. */
  offset?: Animatable<number>;
  /** Caption style preset — `<Captions>` only. Default "classic". */
  preset?: CaptionPreset;
  /** Fills the caption preset's color slots in order; any CSS color, alpha is ignored. */
  colors?: string[];
  /**
   * Vertical placement of the caption block — `<Captions>` only: anchored to
   * the top or bottom safe margin, or centered. The preset keeps owning the
   * horizontal placement. Defaults to the preset's own alignment.
   */
  verticalAlign?: "top" | "center" | "bottom";
  /**
   * Transcription seed — `<Captions>` only. Part of the transcript cache key,
   * so a new value bypasses the cached transcript and transcribes the scene
   * again; reusing a value replays that take from cache.
   */
  seed?: number;
};

type TimingProps = Pick<PatchProps, "start" | "end" | "sourceIn" | "sourceOut">;

type CommonProps = TimingProps &
  Pick<
    PatchProps,
    | "name" | "selected" | "x" | "y" | "offsetX" | "offsetY" | "width" | "height" | "rotation"
    | "opacity" | "cornerRadius" | "transition" | "animations"
  >;

/**
 * What every composition element accepts on top of its own props. Read by the
 * compile step and never seen by a host, so it is not part of `PatchProps`:
 * nothing patches an id, because an id is not a property of the composition.
 */
export type SourceProps = {
  id?: string;
};

/**
 * A 2D affine transform as its six values, in the order CSS `matrix()` and
 * canvas `setTransform` take them: `[a, b, c, d, e, f]`, where `a`/`d` scale,
 * `b`/`c` skew, and `e`/`f` translate. See `StageProps["camera"]`.
 */
export type CameraMatrix = [a: number, b: number, c: number, d: number, e: number, f: number];

/**
 * The infinite canvas every project renders into; only allowed as the root
 * element, and holding `<scene>` children.
 */
export type StageProps = {
  /** Canvas color, any CSS color. */
  background?: string;
  /**
   * The editor's viewport when the project is opened: `[1, 0, 0, 1, 0, 0]` is
   * the origin at 100%. Not part of the composition — nothing rendered or
   * exported depends on it — so a project that never says where to look opens
   * at the origin.
   */
  camera?: CameraMatrix;
  children?: SolidJSX.Element;
};

/**
 * A scene: the clipped, playable frame a composition is made in, and the only
 * element allowed directly under `<stage>`. It clips its children to
 * `width`×`height` and owns the timeline they are placed on, so it takes no
 * timing of its own — nothing outside a scene has a clock to place it against.
 *
 * `x`/`y` are where the frame sits on the infinite canvas, `selected` whether
 * the editor has it selected, and `active` whether the timeline is pointed at
 * it (scenes only, for now). Those are editor concerns rather than
 * part of the composition, but they live here for the same reason `<stage>`'s
 * `camera` does: the source is the document, so a scene dragged or clicked on
 * the canvas has nowhere else to be written back to.
 */
export type SceneProps = Required<Pick<PatchProps, "width" | "height">> &
  Pick<PatchProps, "name" | "selected" | "active" | "x" | "y" | "fill"> & {
    children?: SolidJSX.Element;
  };

export type GroupProps = CommonProps & Pick<PatchProps, "fill"> & {
  children?: SolidJSX.Element;
};

export type RectProps = CommonProps & Pick<PatchProps, "fill"> & {
  /**
   * Paint children (`<SolidPaint>`, `<LinearGradientPaint>`,
   * `<RadialGradientPaint>`), plus `<Stroke>` and `<Shadow>` children.
   */
  children?: SolidJSX.Element;
};

/**
 * `<stroke>` — an outline of the parent's box (or glyphs), a sub-entity like a
 * paint: `color`/`opacity` are its paint, `width`/`join`/`cap`/`miterLimit`
 * its line style. Several stack in document order, later ones on top.
 */
export type StrokeProps = Required<Pick<PatchProps, "color">> &
  Pick<PatchProps, "opacity" | "width" | "join" | "cap" | "miterLimit">;

/**
 * `<shadow>` — a drop shadow beneath the parent's box (or glyphs): a blurred,
 * offset copy of its silhouette in `color`. Several stack in document order.
 */
export type ShadowProps = Required<Pick<PatchProps, "color">> &
  Pick<PatchProps, "opacity" | "blur" | "offsetX" | "offsetY">;

export type SolidPaintProps = Required<Pick<PatchProps, "color">> & Pick<PatchProps, "opacity">;

export type GradientPaintProps = Pick<PatchProps, "opacity"> & {
  /** Gradient rotation in degrees. Defaults to 0 (left to right). */
  rotation?: number;
  /** `<ColorStop>` children — the gradient's color stops. */
  children?: SolidJSX.Element;
};

export type ColorStopProps = Required<Pick<PatchProps, "offset" | "color">> &
  Pick<PatchProps, "opacity">;

export type VideoProps = CommonProps &
  Required<Pick<PatchProps, "src">> &
  Pick<PatchProps, "objectFit" | "volume" | "muted" | "syncTo"> & {
    /** Paint children, stacked over the media paint created by `src`; `<Stroke>` and `<Shadow>` children. */
    children?: SolidJSX.Element;
  };

export type ImageProps = CommonProps &
  Required<Pick<PatchProps, "src">> &
  Pick<PatchProps, "objectFit"> & {
    /** Paint children, stacked over the media paint created by `src`; `<Stroke>` and `<Shadow>` children. */
    children?: SolidJSX.Element;
  };

export type HtmlPaintProps = Pick<PatchProps, "opacity"> & {
  /**
   * HTML children — real DOM elements laid out by the browser at the parent
   * geometry's box size and drawn into it (html-in-canvas). Fully reactive:
   * signals in attributes and text update the drawn content.
   */
  children?: SolidJSX.Element;
};

/** `<Html>` — a rectangle carrying an `<HtmlPaint>` with the given children. */
export type HtmlProps = CommonProps & Pick<HtmlPaintProps, "children">;

// HTMLCanvasElement without requiring the DOM lib (this package also
// type-checks in node contexts): the real type when present, a structural
// stub otherwise.
type HostCanvas = typeof globalThis extends { HTMLCanvasElement: new () => infer T } ? T
  : { width: number; height: number; getContext(contextId: string, options?: unknown): unknown };

/** `<ShaderPaint>` — transforms the media paint directly below it. Takes no children. */
export type ShaderPaintProps = Required<Pick<PatchProps, "wgsl">> &
  Pick<PatchProps, "uniforms" | "opacity">;

export type SurfacePaintProps = Pick<PatchProps, "opacity"> & {
  /**
   * Receives the surface's backing canvas once the paint materializes. Draw to
   * any context type (2d, webgl, webgpu); the engine samples the bitmap every
   * frame and stretches it into the parent geometry's box. Callback form
   * only — the renderer has no element to assign to a variable ref.
   */
  ref: (canvas: HostCanvas) => void;
};

/** `<Surface>` — a rectangle carrying a `<SurfacePaint>` with the given ref. */
export type SurfaceProps = CommonProps & Pick<SurfacePaintProps, "ref">;

export type AudioProps = TimingProps &
  Required<Pick<PatchProps, "src">> &
  Pick<PatchProps, "name" | "volume" | "muted" | "syncTo" | "animations">;

export type TextProps = CommonProps &
  Pick<
    PatchProps,
    "fontFamily" | "fontSize" | "fontWeight" | "fontStyle" | "color" | "textAlign" | "textBaseline"
  > & {
    /**
     * The text content, required; alongside it, paint, `<Stroke>` and
     * `<Shadow>` children styling the glyphs.
     */
    children: SolidJSX.Element;
  };

export type SequenceProps = Pick<PatchProps, "name"> & {
  children?: SolidJSX.Element;
};

export type CaptionsProps = Pick<
  PatchProps,
  | "preset" | "colors" | "verticalAlign" | "offsetX" | "offsetY" | "src"
  | "start" | "end" | "sourceIn" | "sourceOut" | "animations" | "seed"
>;
