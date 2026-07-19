/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The composition elements, as PascalCase components. A capitalized JSX tag
 * compiles to a component reference, so hosts receive PascalCase tags for
 * composition elements and lowercase tags only for DOM content under
 * `<HtmlPaint>` — `createElement` can tell them apart by case alone. The
 * compile step lists these names as babel `builtIns`, so project files use
 * them without imports.
 */

import { splitProps } from "solid-js";
import { createElement, spread, use } from "./renderer";

import type { JSX as SolidJSX } from "solid-js";
import type {
  AudioProps,
  CaptionsProps,
  ColorStopProps,
  GradientPaintProps,
  GroupProps,
  HtmlPaintProps,
  HtmlProps,
  ImageProps,
  RectProps,
  SceneProps,
  SequenceProps,
  SolidPaintProps,
  SurfacePaintProps,
  SurfaceProps,
  TextProps,
  VideoProps,
} from "./types";

/**
 * A component wrapping one host element: creates the node, routes `ref`
 * through the renderer's `use` (so hosts with `applyRef` hand the callback
 * the backing object, e.g. a surface's canvas), and spreads the remaining
 * props and children reactively.
 */
function hostElement<P extends object>(tag: string): (props: P) => SolidJSX.Element {
  return (props) => {
    const el = createElement(tag);
    const [local, rest] = splitProps(props as P & { ref?: unknown }, ["ref"]);
    if (typeof local.ref === "function") use(local.ref as (target: unknown) => void, el);
    spread(el, rest, false);
    return el as SolidJSX.Element;
  };
}

export const Scene = hostElement<SceneProps>("Scene");
export const Group = hostElement<GroupProps>("Group");
export const Rect = hostElement<RectProps>("Rect");
export const Video = hostElement<VideoProps>("Video");
export const Image = hostElement<ImageProps>("Image");
export const Audio = hostElement<AudioProps>("Audio");
export const Text = hostElement<TextProps>("Text");
export const Sequence = hostElement<SequenceProps>("Sequence");
export const Captions = hostElement<CaptionsProps>("Captions");
export const SolidPaint = hostElement<SolidPaintProps>("SolidPaint");
export const LinearGradientPaint = hostElement<GradientPaintProps>("LinearGradientPaint");
export const RadialGradientPaint = hostElement<GradientPaintProps>("RadialGradientPaint");
export const ColorStop = hostElement<ColorStopProps>("ColorStop");
export const HtmlPaint = hostElement<HtmlPaintProps>("HtmlPaint");
export const Html = hostElement<HtmlProps>("Html");
export const SurfacePaint = hostElement<SurfacePaintProps>("SurfacePaint");
export const Surface = hostElement<SurfaceProps>("Surface");
