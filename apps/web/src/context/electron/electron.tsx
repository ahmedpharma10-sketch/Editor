/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createContext, useContext, onCleanup, createResource } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import { useEngine } from '@/context/engine';
import { useAuth } from '@/context/auth';

import { cliBridge, mainBridge } from '@/lib/ipc';
import { CLI_CHANNELS } from '@diffusionstudio/cli/channels';
import { MAIN_CHANNELS } from '@desktop/main-channels';
import { assert } from "@/utils/common";
import { handleContextGet } from "./context";
import { handleAssetsAdd, handleAssetsList, handleAssetsDelete, handleAssetsMove, handleAssetsExport, handleAssetProbe, handleAssetFrame, handleAssetTranscribe, handleAssetVisualize, handleAssetAnalyze } from "./assets";
import { handleFoldersList, handleFolderCreate, handleFolderRename, handleFoldersMove, handleFoldersDelete } from "./folders";
import { handleSelectionFocus, handleSelectionList, handleSelectionSet } from "./selection";
import { handleNodeList, handleNodeTree, handleNodeGrep, handleNodeScreenshot, handleNodeDelete, handleNodePatch, handleNodeDuplicate, handleNodeRender } from "./node";
import { handleMount, handleNodeInsert } from "./mount";
import { handleProjectActive, handleProjectList, handleProjectCreate, handleProjectDelete, handleProjectOpen } from "./project";
import { handleModels } from "./models";
import { handleVoices } from "./voices";
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

  const requireAuth = <Args extends unknown[], R>(fn: (...args: Args) => Promise<R>) => {
    return (...args: Args) => {
      assert(auth.isAuthenticated(), "Sign in required: AI generation needs a Diffusion Studio account.");

      return fn(...args);
    };
  };

  createEffect(() => {
    if (!window.desktop) return;

    const engineRef = () => engine;
    const unsubContext = cliBridge.handle(CLI_CHANNELS.CONTEXT, handleContextGet(engineRef));
    const unsubAssetsAdd = cliBridge.handle(CLI_CHANNELS.ASSETS_ADD, handleAssetsAdd(engineRef));
    const unsubAssetsList = cliBridge.handle(CLI_CHANNELS.ASSETS_LIST, handleAssetsList(engineRef));
    const unsubAssetsDelete = cliBridge.handle(CLI_CHANNELS.ASSETS_DELETE, handleAssetsDelete(engineRef));
    const unsubAssetsMove = cliBridge.handle(CLI_CHANNELS.ASSETS_MOVE, handleAssetsMove(engineRef));
    const unsubAssetsExport = cliBridge.handle(CLI_CHANNELS.ASSETS_EXPORT, handleAssetsExport(engineRef));
    const unsubFoldersList = cliBridge.handle(CLI_CHANNELS.FOLDERS_LIST, handleFoldersList(engineRef));
    const unsubFolderCreate = cliBridge.handle(CLI_CHANNELS.FOLDER_CREATE, handleFolderCreate(engineRef));
    const unsubFolderRename = cliBridge.handle(CLI_CHANNELS.FOLDER_RENAME, handleFolderRename(engineRef));
    const unsubFoldersMove = cliBridge.handle(CLI_CHANNELS.FOLDERS_MOVE, handleFoldersMove(engineRef));
    const unsubFoldersDelete = cliBridge.handle(CLI_CHANNELS.FOLDERS_DELETE, handleFoldersDelete(engineRef));
    const unsubAssetProbe = cliBridge.handle(CLI_CHANNELS.ASSET_PROBE, handleAssetProbe(engineRef));
    const unsubAssetFrame = cliBridge.handle(CLI_CHANNELS.ASSET_FRAME, handleAssetFrame(engineRef));
    const unsubAssetTranscribe = cliBridge.handle(CLI_CHANNELS.ASSET_TRANSCRIBE, handleAssetTranscribe(engineRef));
    const unsubAssetVisualize = cliBridge.handle(CLI_CHANNELS.ASSET_VISUALIZE, handleAssetVisualize(engineRef));
    const unsubAssetAnalyze = cliBridge.handle(CLI_CHANNELS.ASSET_ANALYZE, requireAuth(handleAssetAnalyze(engineRef)));
    const unsubSelectionList = cliBridge.handle(CLI_CHANNELS.SELECTION_LIST, handleSelectionList(engineRef));
    const unsubSelectionSet = cliBridge.handle(CLI_CHANNELS.SELECTION_SET, handleSelectionSet(engineRef));
    const unsubSelectionFocus = cliBridge.handle(CLI_CHANNELS.SELECTION_FOCUS, handleSelectionFocus(engineRef));
    const unsubNodeList = cliBridge.handle(CLI_CHANNELS.NODE_LIST, handleNodeList(engineRef));
    const unsubNodeTree = cliBridge.handle(CLI_CHANNELS.NODE_TREE, handleNodeTree(engineRef));
    const unsubNodeGrep = cliBridge.handle(CLI_CHANNELS.NODE_GREP, handleNodeGrep(engineRef));
    const unsubNodeScreenshot = cliBridge.handle(CLI_CHANNELS.NODE_SCREENSHOT, handleNodeScreenshot(engineRef));
    const unsubMount = cliBridge.handle(CLI_CHANNELS.MOUNT, handleMount(engineRef));
    const unsubNodeInsert = cliBridge.handle(CLI_CHANNELS.NODE_INSERT, handleNodeInsert(engineRef));
    const unsubNodeDelete = cliBridge.handle(CLI_CHANNELS.NODE_DELETE, handleNodeDelete(engineRef));
    const unsubNodePatch = cliBridge.handle(CLI_CHANNELS.NODE_PATCH, handleNodePatch(engineRef));
    const unsubNodeDuplicate = cliBridge.handle(CLI_CHANNELS.NODE_DUPLICATE, handleNodeDuplicate(engineRef));
    const unsubNodeRender = cliBridge.handle(CLI_CHANNELS.NODE_RENDER, handleNodeRender(engineRef));
    const unsubProjectActive = cliBridge.handle(CLI_CHANNELS.PROJECT_ACTIVE, handleProjectActive(engineRef));
    const unsubProjectList = cliBridge.handle(CLI_CHANNELS.PROJECT_LIST, handleProjectList());
    const unsubProjectCreate = cliBridge.handle(CLI_CHANNELS.PROJECT_CREATE, handleProjectCreate(engineRef, setParams));
    const unsubProjectDelete = cliBridge.handle(CLI_CHANNELS.PROJECT_DELETE, handleProjectDelete(engineRef, setParams));
    const unsubProjectOpen = cliBridge.handle(CLI_CHANNELS.PROJECT_OPEN, handleProjectOpen(engineRef, setParams));
    const unsubModels = cliBridge.handle(CLI_CHANNELS.MODELS, handleModels());
    const unsubVoices = cliBridge.handle(CLI_CHANNELS.VOICES, handleVoices());
    const unsubScreenChange = mainBridge.handle(MAIN_CHANNELS.WINDOW_FULLSCREEN_CHANGE, handleWindowFullscreenChange(mutate));

    onCleanup(() => {
      unsubContext();
      unsubAssetsAdd();
      unsubAssetsList();
      unsubAssetsDelete();
      unsubAssetsMove();
      unsubAssetsExport();
      unsubFoldersList();
      unsubFolderCreate();
      unsubFolderRename();
      unsubFoldersMove();
      unsubFoldersDelete();
      unsubAssetProbe();
      unsubAssetFrame();
      unsubAssetTranscribe();
      unsubAssetVisualize();
      unsubAssetAnalyze();
      unsubSelectionList();
      unsubSelectionSet();
      unsubSelectionFocus();
      unsubNodeList();
      unsubNodeTree();
      unsubNodeGrep();
      unsubNodeScreenshot();
      unsubMount();
      unsubNodeInsert();
      unsubNodeDelete();
      unsubNodePatch();
      unsubNodeDuplicate();
      unsubNodeRender();
      unsubProjectActive();
      unsubProjectList();
      unsubProjectCreate();
      unsubProjectDelete();
      unsubProjectOpen();
      unsubModels();
      unsubVoices();
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
