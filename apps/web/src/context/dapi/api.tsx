/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createContext, useContext, onCleanup, onMount, createResource } from "solid-js";
import { useEngine } from '@/context/engine';
import { useProjectId } from '@/hooks/use-project-id';
import { useAuth } from '@/context/auth';
import { t, q, q0 } from "@/lib/cli-rpc";
import { handleContextGet } from "./context";
import { handleMediaProbe, handleMediaFrame, handleMediaTranscribe, handleMediaFilmstrip, handleMediaWaveform, handleMediaListen } from "./media";
import { handleCapture } from "./capture";
import { handleLogs } from "./logs";
import { handleModels } from "./models";
import { handleVoices } from "./voices";
import { cliBridge, mainBridge } from '@/lib/ipc';
import { createRouterCaller } from '@/lib/cli-rpc';
import { MAIN_CHANNELS } from '@desktop/main-channels';
import { assert } from "@/utils/common";
import { handleGetFullscreenState, handleWindowFullscreenChange, handleWindowScreenshot } from "./window";

import type { JSX, Accessor } from 'solid-js';
import type { User } from '@supabase/supabase-js';
import type { Engine } from '@/components/engine';

type EditorApiProviderProps = {
  children: JSX.Element;
};

type EditorApiContextValue = {
  isFullscreen: Accessor<boolean>;
  isDesktop: boolean;
};

const EditorApiContext = createContext<EditorApiContextValue>();

export function EditorApiProvider(props: EditorApiProviderProps) {
  const projectId = useProjectId();
  const engine = useEngine();
  const auth = useAuth();
  const [isFullscreen, { mutate }] = createResource(handleGetFullscreenState, { initialValue: false });

  const requireAuth = <I, O>(fn: (data: I) => Promise<O>) => (data: I) => {
    assert(auth.isAuthenticated(), "Sign in required: AI generation needs a Diffusion Studio account.");
    return fn(data);
  };

  const getUser = () => {
    const user = auth.user();
    assert(user, "User not found");
    return user;
  };

  const getEngine = () => engine;

  createEffect(() => {
    document.documentElement.dataset.fullscreen = String(isFullscreen());
  });

  onMount(() => {
    if (!window.desktop) return;
    onCleanup(mainBridge.handle(MAIN_CHANNELS.WINDOW_FULLSCREEN_CHANGE, handleWindowFullscreenChange(mutate)));
  });

  createEffect(() => {
    if (!window.desktop || !engine.initialized() || projectId() !== engine.world.projectId) return;


    const router = createAppRouter({ getEngine, getUser, requireAuth });
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
  getEngine: () => Engine;
  getUser: () => User;
  requireAuth: <I, O>(fn: (data: I) => Promise<O>) => (data: I) => Promise<O>;
};

function createAppRouter({ getEngine, getUser, requireAuth }: AppRouterDeps) {
  return t.router({
    ping: t.procedure.query(() => {}),
    whoami: t.procedure.query(() => getUser()),
    context: q0(handleContextGet(getEngine)),
    capture: q(handleCapture(getEngine)),
    models: q(handleModels()),
    logs: q(handleLogs()),
    screenshot: q0(handleWindowScreenshot()),
    voices: q0(handleVoices()),
    media: t.router({
      probe: q(handleMediaProbe(getEngine)),
      frame: q(handleMediaFrame(getEngine)),
      transcribe: q(handleMediaTranscribe(getEngine)),
      filmstrip: q(handleMediaFilmstrip(getEngine)),
      waveform: q(handleMediaWaveform(getEngine)),
      listen: q(requireAuth(handleMediaListen(getEngine))),
    }),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

export function useEditorApi() {
  const ctx = useContext(EditorApiContext);
  assert(ctx, "useEditorApi must be used within EditorApiProvider");
  return ctx;
}
