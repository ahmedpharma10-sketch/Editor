/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Or } from "koota";
import {
  Active, AdjustmentLayer, Computed, Fonts, FrameRate, Geometry, Group,
  Project, Scene, Selected, Workarea,
} from "@diffusionstudio/runtime";

import type { World } from "koota";

/**
 * What `dapi context` reports: enough of the open project for a caller with
 * no window onto it to say what to look at next. Entities travel as their
 * koota values, which is what `capture` takes back.
 */
export function handleContextGet(world: World) {
  return async () => {
    const scenes = [...world.query(Scene)];
    const active = world.queryFirst(Active) ?? null;

    const fps = world.get(FrameRate)?.value ?? 30;
    const workarea = active?.get(Workarea);

    return {
      projectId: world.get(Project)?.id ?? '',
      entityCount: world.entities.length,
      scenes,
      activeSceneId: active,
      currentFrame: active?.get(Computed)?.localTime ?? 0,
      workarea: workarea ? { start: workarea.start / fps, end: workarea.end / fps } : null,
      fontFamilies: [...new Set(["Inter", ...(world.get(Fonts)?.list ?? []).map((f) => f.family)])],
      selection: [...world.query(Selected, Or(Geometry, Group, AdjustmentLayer))],
    };
  }
}
