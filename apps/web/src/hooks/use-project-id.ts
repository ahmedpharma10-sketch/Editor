/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from 'zod';
import { useSearchParams } from "@solidjs/router";
import { createMemo } from 'solid-js';
import { DEFAULT_PROJECT_ID } from '@/components/engine/db';

// A project id is the name of a project folder under the projects root
// (see @/projects), so anything goes except path segments.
const PROJECT_ID = z.string().min(1).regex(/^(?!\.{1,2}$)[^/\\]+$/);

export function useProjectId() {
  const [params] = useSearchParams();
  const projectId = createMemo(() => {
    const { success, data } = PROJECT_ID.safeParse(params.project);
    if (!success) return DEFAULT_PROJECT_ID;   // when no project is set use a default project id
    return data;
  });
  return projectId;
}
