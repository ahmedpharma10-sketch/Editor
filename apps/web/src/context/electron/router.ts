/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { t, q, m, q0, m0 } from "@/lib/cli-rpc";
import { assert } from "@/utils/common";
import { handleContextGet } from "./context";
import { handleAssetsAdd, handleAssetsList, handleAssetTree, handleAssetsDelete, handleAssetsMove, handleAssetsExport, handleAssetProbe, handleAssetFrame, handleAssetTranscribe, handleAssetVisualize, handleAssetAnalyze } from "./assets";
import { handleFoldersList, handleFolderCreate, handleFolderRename, handleFoldersMove, handleFoldersDelete } from "./folders";
import { handleSelectionFocus, handleSelectionList, handleSelectionSet } from "./selection";
import { handleNodeList, handleNodeTree, handleNodeGrep, handleNodeScreenshot, handleNodeDelete, handleNodePatch, handleNodeDuplicate, handleNodeRender } from "./node";
import { handleMount, handleNodeInsert } from "./mount";
import { handleProjectActive, handleProjectList, handleProjectCreate, handleProjectDelete, handleProjectOpen } from "./project";
import { handleModels } from "./models";
import { handleVoices } from "./voices";

import type { Accessor } from "solid-js";
import type { Engine } from "@/components/engine";
import type { useSearchParams } from "@solidjs/router";

type AppRouterDeps = {
  engine: Accessor<Engine>;
  setParams: ReturnType<typeof useSearchParams>[1];
  isAuthenticated: () => boolean;
  getUser: () => { id: string; email: string; provider: string } | null;
};

// The complete CLI surface. Registered by ElectronProvider, which mounts
// whenever a project is open (sign-in not required); requests arriving
// earlier are held by the CLI bridge until then. `ping` answers
// `waitForCliSocket` probes.
export function createAppRouter({ engine, setParams, isAuthenticated, getUser }: AppRouterDeps) {
  const requireAuth = <I, O>(fn: (data: I) => Promise<O>) => (data: I) => {
    assert(isAuthenticated(), "Sign in required: AI generation needs a Diffusion Studio account.");
    return fn(data);
  };

  return t.router({
    ping: t.procedure.query(() => {}),
    whoami: t.procedure.query(() => getUser()),
    context: q0(handleContextGet(engine)),
    mount: m(handleMount(engine)),
    models: q(handleModels()),
    voices: q0(handleVoices()),
    asset: t.router({
      add: m(handleAssetsAdd(engine)),
      list: q(handleAssetsList(engine)),
      tree: q(handleAssetTree(engine)),
      delete: m(handleAssetsDelete(engine)),
      move: m(handleAssetsMove(engine)),
      export: m(handleAssetsExport(engine)),
      probe: q(handleAssetProbe(engine)),
      frame: q(handleAssetFrame(engine)),
      transcribe: q(handleAssetTranscribe(engine)),
      visualize: q(handleAssetVisualize(engine)),
      analyze: q(requireAuth(handleAssetAnalyze(engine))),
    }),
    folder: t.router({
      list: q(handleFoldersList(engine)),
      create: m(handleFolderCreate(engine)),
      rename: m(handleFolderRename(engine)),
      move: m(handleFoldersMove(engine)),
      delete: m(handleFoldersDelete(engine)),
    }),
    selection: t.router({
      list: q0(handleSelectionList(engine)),
      set: m(handleSelectionSet(engine)),
      focus: m0(handleSelectionFocus(engine)),
    }),
    node: t.router({
      list: q(handleNodeList(engine)),
      tree: q(handleNodeTree(engine)),
      grep: q(handleNodeGrep(engine)),
      screenshot: q(handleNodeScreenshot(engine)),
      insert: m(handleNodeInsert(engine)),
      delete: m(handleNodeDelete(engine)),
      patch: m(handleNodePatch(engine)),
      duplicate: m(handleNodeDuplicate(engine)),
      render: m(handleNodeRender(engine)),
    }),
    project: t.router({
      active: q0(handleProjectActive(engine)),
      list: q0(handleProjectList()),
      create: m(handleProjectCreate(engine, setParams)),
      delete: m(handleProjectDelete(engine, setParams)),
      open: m(handleProjectOpen(engine, setParams)),
    }),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
