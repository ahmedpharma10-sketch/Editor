/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from 'zod';
import { useParams } from "@solidjs/router";
import { createMemo } from 'solid-js';

// A project id is the name of a project folder under the projects root
// (see @/projects), so anything goes except path segments.
const PROJECT_ID = z.string().min(1).regex(/^(?!\.{1,2}$)[^/\\]+$/);

/** Route for the editor with project `name` loaded (see `/projects/*name` in app.tsx). */
export const projectRoute = (name: string): string => `/projects/${encodeURIComponent(name)}`;

/**
 * The project folder name from the `/projects/*name` route, or null when the
 * route carries no valid name. Only meaningful under that route.
 */
export function useProjectId() {
  const params = useParams<{ name?: string }>();
  const projectId = createMemo(() => {
    const { success, data } = PROJECT_ID.safeParse(params.name);
    return success ? data : null;
  });
  return projectId;
}
