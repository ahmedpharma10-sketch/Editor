/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import * as ComponentRegistry from "../components/components";

export type { MountData } from "../components/components";

export function createComponents(): Components {
  return Object.fromEntries(
    Object.entries(ComponentRegistry)
      .map(([name, definition]) => [name, structuredClone(definition)]),
  ) as Components;
}

export type Components = {
  [K in keyof typeof ComponentRegistry]: typeof ComponentRegistry[K];
}
export type ComponentName = keyof Components;
