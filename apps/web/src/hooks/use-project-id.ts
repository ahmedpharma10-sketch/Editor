/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from 'zod';
import { useSearchParams } from "@solidjs/router";
import { createMemo } from 'solid-js';
import { DEFAULT_PROJECT_ID } from '@/components/engine/db';

export function useProjectId() {
  const [params] = useSearchParams();

  const projectId = createMemo(() => {
    const { success, data } = z
      .string()
      .regex(/^[A-Za-z0-9_-]{21}$/)
      .safeParse(params.project);

    if (!success) {
      // when no project is set use a default project id
      return DEFAULT_PROJECT_ID;
    }

    return data;
  });

  return projectId;
}
