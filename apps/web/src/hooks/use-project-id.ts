/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useParams } from "@solidjs/router";
import { createMemo } from 'solid-js';

/** Route for the editor with project `name` loaded (see `/projects/*name` in app.tsx). */
export const projectRoute = (name: string): string => `/projects/${encodeURIComponent(name)}`;

/**
 * The project id: the project folder name from the `/projects/*name` route.
 * Whether it names a usable folder is decided by `projectDir` in @/projects.
 */
export function useProjectId() {
  const params = useParams<{ name?: string }>();
  return createMemo(() => params.name ?? '');
}
