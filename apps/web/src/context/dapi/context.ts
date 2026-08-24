/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Computed, Fonts, FrameRate, getActiveEntity } from "@diffusionstudio/runtime";

import type { World } from "koota";

/**
 * The open project's identity, as the editor knows it. Structural on purpose:
 * this is the project context's shape, without the handler having to depend on
 * the Solid context it comes from.
 */
type OpenProject = {
  id: () => string;
  dir: () => string;
  name: () => string;
};

/**
 * What `dapi context` reports: what the project's source cannot say. The JSX is
 * the composition — its scenes, what is selected, which scene is active, the
 * work area are all in the file, and a caller that wants them reads it. What is
 * left over is which project the app has open, where its playhead sits, and
 * which font families are actually registered in the world drawing it.
 */
export function handleContextGet(world: World, project: OpenProject) {
  return async () => {
    const frameRate = world.get(FrameRate)?.value || 30;
    const active = getActiveEntity(world);

    return {
      project: {
        id: project.id(),
        name: project.name(),
        dir: project.dir(),
      },
      // Seconds, the unit the source places clips in; null when no scene is
      // active, which is when there is no playhead to report.
      currentTime: active ? (active.get(Computed)?.localTime ?? 0) / frameRate : null,
      // What text can be drawn with right now: registered in the world, not
      // merely named in the source. The editor default is always among them.
      fontFamilies: [...new Set(["Inter", ...(world.get(Fonts)?.list ?? []).map((f) => f.family)])],
    };
  }
}
