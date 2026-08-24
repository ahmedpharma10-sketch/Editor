/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createContext, useContext, onCleanup } from "solid-js";
import { useWorld } from '@diffusionstudio/koota-solid';
import { Project } from '@diffusionstudio/runtime';
import { useProject } from '@/context/project';
import { useAuth } from '@/context/auth';
import { t, q, q0 } from "@/lib/cli-rpc";
import type { ShellRouter } from "./shell";
import { handleContextGet } from "./context";
import { handleMediaProbe, handleMediaFrame, handleMediaTranscribe, handleMediaFilmstrip, handleMediaWaveform, handleMediaListen } from "./media";
import { handleCapture } from "./capture";
import { handleLogs } from "./logs";
import { handleModels } from "./models";
import { handleVoices } from "./voices";
import { cliBridge } from '@/lib/ipc';
import { createRouterCaller } from '@/lib/cli-rpc';
import { assert } from "@/utils/common";
import { handleWindowScreenshot } from "./window";
import { useFullscreenState } from "@/hooks/use-fullscreen-state";

import type { JSX, Accessor } from 'solid-js';
import type { User } from '@supabase/supabase-js';
import type { World } from 'koota';
import type { ProjectContextValue } from '@/context/project';

type EditorApiProviderProps = {
  children: JSX.Element;
};

type EditorApiContextValue = {
  isFullscreen: Accessor<boolean>;
  isDesktop: boolean;
};

const EditorApiContext = createContext<EditorApiContextValue>();

export function EditorApiProvider(props: EditorApiProviderProps) {
  const project = useProject();
  const auth = useAuth();
  const isFullscreen = useFullscreenState();

  const requireAuth = <I, O>(fn: (data: I) => Promise<O>) => (data: I) => {
    assert(auth.isAuthenticated(), "Sign in required: AI generation needs a Diffusion Studio account.");
    return fn(data);
  };

  const getUser = () => {
    const user = auth.user();
    assert(user, "User not found");
    return user;
  };

  const world = useWorld();

  createEffect(() => {
    if (!window.desktop || project.id() !== world.get(Project)?.id) return;

    const router = createAppRouter({ world, project, getUser, requireAuth });
    onCleanup(cliBridge.register(createRouterCaller(router)));
  });

  return (
    <EditorApiContext.Provider
      value={{
        isFullscreen,
        isDesktop: !!window.desktop,
      }}
    >
      {props.children}
    </EditorApiContext.Provider>
  );
}


type AppRouterDeps = {
  world: World;
  project: ProjectContextValue;
  getUser: () => User;
  requireAuth: <I, O>(fn: (data: I) => Promise<O>) => (data: I) => Promise<O>;
};

function createAppRouter({ world, project, getUser, requireAuth }: AppRouterDeps) {
  return t.router({
    whoami: t.procedure.query(() => getUser()),
    context: q0(handleContextGet(world, project)),
    capture: q(handleCapture(world, project)),
    models: q(handleModels()),
    logs: q(handleLogs()),
    screenshot: q0(handleWindowScreenshot()),
    voices: q0(handleVoices()),
    media: t.router({
      probe: q(handleMediaProbe(world)),
      frame: q(handleMediaFrame(world)),
      transcribe: q(handleMediaTranscribe(world)),
      filmstrip: q(handleMediaFilmstrip(world)),
      waveform: q(handleMediaWaveform(world)),
      listen: q(requireAuth(handleMediaListen(world))),
    }),
  });
}

export type AppRouter = ShellRouter & ReturnType<typeof createAppRouter>;

export function useEditorApi() {
  const ctx = useContext(EditorApiContext);
  assert(ctx, "useEditorApi must be used within EditorApiProvider");
  return ctx;
}
