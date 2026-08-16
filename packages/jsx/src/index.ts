/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The authoring surface: the types project sources are written against, the
 * pure helpers they may call, and the hooks the editor implements. The
 * renderer that turns this vocabulary into a composition is not here — the
 * editor supplies it when a project is mounted (see
 * @diffusionstudio/reconciler), so nothing in this package touches a host.
 */

export { generate, AssetRef, isAssetRef, getAssetSpec } from "./generate";
export type {
  AspectRatio,
  AssetInput,
  AssetSpecInput,
  GenerateAudioOptions,
  GenerateImageOptions,
  GenerateVideoOptions,
  GenerateVoiceOptions,
} from "./generate";
export { parseTime, TIME_FPS } from "./time";
export { useTicker, useFile } from "./hooks";
export type { Ticker } from "./hooks";
export type {
  Animatable,
  AnimationSpec,
  AnimationType,
  AudioProps,
  CaptionPreset,
  CaptionsProps,
  ColorStopProps,
  Easing,
  Fit,
  GradientPaintProps,
  GroupProps,
  HtmlPaintProps,
  HtmlProps,
  ImageProps,
  Keyframe,
  PatchProps,
  RectProps,
  SequenceProps,
  ShaderPaintProps,
  SolidPaintProps,
  StageProps,
  SurfacePaintProps,
  SurfaceProps,
  TextProps,
  Time,
  TransitionSpec,
  TransitionType,
  VideoProps,
} from "./types";
