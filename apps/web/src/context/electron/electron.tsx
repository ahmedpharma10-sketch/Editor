/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createContext, useContext, onCleanup, createResource } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import { useEngine } from '@/context/engine';
import { useAuth } from '@/context/auth';

import { cliBridge, mainBridge } from '@/lib/ipc';
import { createRouterCaller } from '@/lib/cli-rpc';
import { MAIN_CHANNELS } from '@desktop/main-channels';
import { assert } from "@/utils/common";
import { createAppRouter } from "./router";
import { handleGetFullscreenState, handleWindowFullscreenChange } from "./window";

import type { JSX, Accessor } from 'solid-js';


type ElectronProviderProps = {
  children: JSX.Element;
};

type ElectronContextValue = {
  isFullscreen: Accessor<boolean>;
  isDesktop: boolean;
};

const ElectronContext = createContext<ElectronContextValue>();

export function ElectronProvider(props: ElectronProviderProps) {
  const engine = useEngine();
  const auth = useAuth();
  const [, setParams] = useSearchParams();
  const [isFullscreen, { mutate }] = createResource(handleGetFullscreenState, { initialValue: false });

  createEffect(() => {
    if (!window.desktop) return;

    const router = createAppRouter({
      engine: () => engine,
      setParams,
      isAuthenticated: () => auth.isAuthenticated(),
      getUser: () => {
        const user = auth.user();
        if (!user) return null;
        return {
          id: user.id,
          email: user.email ?? "",
          provider: user.app_metadata?.provider ?? "unknown",
        };
      },
    });
    const unsubRouter = cliBridge.register(createRouterCaller(router));
    const unsubScreenChange = mainBridge.handle(MAIN_CHANNELS.WINDOW_FULLSCREEN_CHANGE, handleWindowFullscreenChange(mutate));

    onCleanup(() => {
      unsubRouter();
      unsubScreenChange();
    });
  });

  return (
    <ElectronContext.Provider
      value={{
        isFullscreen,
        isDesktop: !!window.desktop,
      }}
    >
      {props.children}
    </ElectronContext.Provider>
  );
}


export function useElectron() {
  const ctx = useContext(ElectronContext);
  assert(ctx, "useElectron must be used within ElectronProvider");
  return ctx;
}
