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
  CaptionsProps,
  ColorStopProps,
  GradientPaintProps,
  GroupProps,
  ImageProps,
  RectProps,
  SceneProps,
  SequenceProps,
  SolidPaintProps,
  TextProps,
  VideoProps,
} from "./types";

export declare namespace JSX {
  // Solid's Element type keeps Solid's control flow (<For>, <Show>, …) and
  // user components interoperable with this JSX namespace.
  export type Element = SolidJSX.Element;

  export interface ElementChildrenAttribute {
    children: unknown;
  }

  export interface IntrinsicElements {
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
    linearGradientPaint: GradientPaintProps;
    radialGradientPaint: GradientPaintProps;
    colorStop: ColorStopProps;
  }
}
