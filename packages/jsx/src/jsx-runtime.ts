/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Type-only JSX runtime for `jsxImportSource: "@diffusionstudio/jsx"`. JSX is
 * compiled by babel-preset-solid (universal mode) against the renderer in
 * "./renderer", so this module carries no runtime — only the JSX namespace
 * TypeScript resolves element and prop types from.
 */

import type { JSX as SolidJSX } from "solid-js";
import type {
  AudioProps,
  CanvasPaintProps,
  CanvasProps,
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
  TextProps,
  VideoProps,
} from "./types";

// "html" and "canvas" are dropped alongside the media tags: in composition
// context they are node elements, and as DOM tags they are useless inside a
// paint host (a DOM canvas's content doesn't survive drawElementImage).
type HtmlElementTags = Omit<SolidJSX.HTMLElementTags, "audio" | "video" | "html" | "canvas">;

// SVG vocabulary for <htmlPaint> content. Tags the editor also declares keep
// their composition types below; the runtime resolves the actual meaning by
// environment, the type system approximates with the composition side.
type SvgElementTags = Omit<
  SolidJSX.SVGElementTags,
  "image" | "linearGradient" | "radialGradient" | "rect" | "stop" | "text"
>;

export declare namespace JSX {
  // Solid's Element type keeps Solid's control flow (<For>, <Show>, …) and
  // user components interoperable with this JSX namespace.
  export type Element = SolidJSX.Element;

  export interface ElementChildrenAttribute {
    children: unknown;
  }

  export interface IntrinsicElements extends HtmlElementTags, SvgElementTags {
    scene: SceneProps;
    group: GroupProps;
    rect: RectProps;
    video: VideoProps;
    image: ImageProps;
    audio: AudioProps;
    text: TextProps;
    sequence: SequenceProps;
    captions: CaptionsProps;
    solidPaint: SolidPaintProps;
    solid: SolidPaintProps;
    linearGradientPaint: GradientPaintProps;
    linearGradient: GradientPaintProps;
    radialGradientPaint: GradientPaintProps;
    radialGradient: GradientPaintProps;
    colorStop: ColorStopProps;
    stop: ColorStopProps;
    htmlPaint: HtmlPaintProps;
    html: HtmlProps;
    canvasPaint: CanvasPaintProps;
    canvas: CanvasProps;
  }
}
