/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Public authoring API (used by project modules).
export { PATCH_PROP_KEYS } from "./types";
export { parseTime, TIME_FPS } from "./time";
export type {
  Animatable,
  AudioProps,
  CaptionPreset,
  CaptionsProps,
  ColorStopProps,
  Easing,
  Fit,
  GradientPaintProps,
  GroupProps,
  ImageProps,
  Keyframe,
  PatchProps,
  RectProps,
  SceneProps,
  SequenceProps,
  SolidPaintProps,
  TextProps,
  Time,
  TransitionSpec,
  TransitionType,
  VideoProps,
} from "./types";

// Renderer runtime — compiled project modules import these (babel-preset-solid
// universal mode, moduleName "@diffusionstudio/solid").
export {
  render,
  effect,
  memo,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  insert,
  spread,
  setProp,
  mergeProps,
  use,
  renderProject,
} from "./renderer";

export type { ProjectDocument } from "./document";
