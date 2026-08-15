/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show } from 'solid-js';
import { Navigate } from '@solidjs/router';
import { EditorPage } from './editor';
import { LayoutProvider } from "@/context/layout";
import { PromptInputProvider } from "@/context/prompt-input";
import { EngineProvider } from '@/context/engine';
import { EditorApiProvider } from '@/context/dapi';
import { ExportProvider } from '@/context/export';
import { useProjectId } from '@/hooks/use-project-id';
import { ECSProvider } from '@/context/ecs';
import { TimelineProvider } from '@/context/timeline';
import { EngineProvider as KootaEngineProvider } from '@/engine';
import { ProjectLoader } from '@/projects';

/** `/projects/:name` — the editor, with the project folder `name` loaded. */
export function ProjectPage() {
  const projectId = useProjectId();

  return (
    /**
     * using show with keyed to ensure the engine provider is remounted when the project id changes
     */
    <Show when={projectId()} keyed fallback={<Navigate href="/" />}>
      {(id) => (
        <KootaEngineProvider projectId={id}>
          <ProjectLoader name={id} />
          <EngineProvider projectId={id}>
            <EditorApiProvider>
              <TimelineProvider>
                <ECSProvider>
                  <ExportProvider>
                    <PromptInputProvider>
                      <LayoutProvider>
                        <EditorPage />
                      </LayoutProvider>
                    </PromptInputProvider>
                  </ExportProvider>
                </ECSProvider>
              </TimelineProvider>
            </EditorApiProvider>
          </EngineProvider>
        </KootaEngineProvider>
      )}
    </Show>
  )
}
