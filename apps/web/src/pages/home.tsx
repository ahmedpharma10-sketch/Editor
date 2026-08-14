/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show } from 'solid-js';
import { EditorPage } from './editor';
import { LayoutProvider } from "@/context/layout";
import { Dashboard } from '@/components/dashboard';
import { PromptInputProvider } from "@/context/prompt-input";
import { EngineProvider } from '@/context/engine';
import { EditorApiProvider } from '@/context/editor-api';
import { ExportProvider } from '@/context/export';
import { useProjectId } from '@/hooks/use-project-id';
import { useSearchParams } from '@solidjs/router';
import { ECSProvider } from '@/context/ecs';
import { TimelineProvider } from '@/context/timeline';
import { EngineProvider as KootaEngineProvider } from '@/engine';

export function HomePage() {
  const projectId = useProjectId();
  const [params] = useSearchParams();

  return (
    /**
     * using show with keyed to ensure the engine provider is remounted when the project id changes
     */
    <Show when={projectId()} keyed>
      {(id) => (
        <KootaEngineProvider projectId={id}>
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
                    <Show when={!params.project || !!params.dashboard}>
                      <Dashboard />
                    </Show>
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
