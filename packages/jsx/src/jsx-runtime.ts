/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Type-only JSX runtime for `jsxImportSource: "@diffusionstudio/jsx"`. JSX is
 * compiled by babel-preset-solid (universal mode) against the renderer in
 * "./renderer", so this module carries no runtime — only the JSX namespace
 * TypeScript resolves element and prop types from.
 *
 * Composition elements are the PascalCase components in "./elements";
 * intrinsic (lowercase) tags are exclusively DOM vocabulary for `<HtmlPaint>`
 * content, so the case of a tag decides its environment.
 */

import type { JSX as SolidJSX } from "solid-js";

// "canvas" is dropped: a DOM canvas's content doesn't survive
// drawElementImage, so it is useless inside a paint host (draw with
// <Surface> instead).
type HtmlElementTags = Omit<SolidJSX.HTMLElementTags, "canvas">;

export declare namespace JSX {
  // Solid's Element type keeps Solid's control flow (<For>, <Show>, …) and
  // user components interoperable with this JSX namespace.
  export type Element = SolidJSX.Element;

  export interface ElementChildrenAttribute {
    children: unknown;
  }

  export interface IntrinsicElements extends HtmlElementTags, SolidJSX.SVGElementTags {}
}
