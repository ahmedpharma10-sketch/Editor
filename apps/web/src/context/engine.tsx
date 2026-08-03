/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEngine, invalidateAssets } from '@/components/engine';
import { clearAudioPeaksCache, clearAudioTrackCache, clearKeyframeIndexCache, clearVideoTrackCache } from '@/components/engine/decoders';
import { clearImageThumbnailCache } from '@/components/engine/timeline/render/image';
import { markProjectOpened, setProjectThumbnail } from '@/components/engine/db';
import { captureCanvasThumbnail } from '@/components/engine/thumbnail';
import { assert } from '@/utils';
import { createContext, onCleanup, onMount, useContext, createSignal, Show } from 'solid-js';
import { verifyHandlePermissions } from "@/utils/browser";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { disposeDecoders } from '@/components/engine/api/utils';
import { getAllEntities } from 'bitecs';

import type { JSX } from 'solid-js';
import type { ElectronFileHandle } from '@/lib/electron-file-handle';

type EngineContextValue = ReturnType<typeof createEngine>;

const EngineContext = createContext<EngineContextValue>();

type EngineProviderProps = {
  children: JSX.Element;
  projectId: string;
};

type GrantableHandle = FileSystemDirectoryHandle | FileSystemFileHandle | ElectronFileHandle;;

// Project-swap readiness barrier.
const readyWaiters = new Map<string, Set<() => void>>();
let readyProjectId: string | null = null;

function markProjectReady(id: string): void {
  readyProjectId = id;
  const waiters = readyWaiters.get(id);
  if (!waiters) return;
  readyWaiters.delete(id);
  for (const resolve of waiters) resolve();
}

export function whenProjectReady(id: string, timeoutMs = 30_000): Promise<void> {
  if (readyProjectId === id) return Promise.resolve();

  const { promise, resolve } = Promise.withResolvers<void>();
  const waiters = readyWaiters.get(id) ?? new Set<() => void>();
  waiters.add(resolve);
  readyWaiters.set(id, waiters);

  // Best-effort: a project whose engine never initializes (init threw) must
  // not hang the caller forever.
  const timer = setTimeout(() => {
    readyWaiters.get(id)?.delete(resolve);
    console.warn(`[engine] timed out waiting for project ${id} to become ready`);
    resolve();
  }, timeoutMs);

  return promise.then(() => clearTimeout(timer));
}

export function EngineProvider(props: EngineProviderProps) {
  const engine = createEngine(props.projectId);
  const resizeObserver = new ResizeObserver(() => engine.resize());

  const [open, setOpen] = createSignal(false);
  const [handles, setHandles] = createSignal<GrantableHandle[]>([]);
  const [granting, setGranting] = createSignal(false);
  let resolveCurrent: (() => void) | null = null;

  const showGrantPermissionDialog = (pending: GrantableHandle[]) => {
    if (pending.length === 0) return Promise.resolve();
    // Resolve any prior pending call so callers don't deadlock if show()
    // is invoked again before the previous dialog closes.
    resolveCurrent?.();
    const { promise, resolve } = Promise.withResolvers<void>();
    resolveCurrent = resolve;
    setHandles(pending);
    setOpen(true);
    return promise;
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      resolveCurrent?.();
      resolveCurrent = null;
    }
  };

  const handleGrant = async () => {
    if (granting()) return;
    setGranting(true);
    try {
      await verifyHandlePermissions(handles(), "read");
    } finally {
      setGranting(false);
      handleOpenChange(false);
    }
  };

  onMount(async () => {
    // Track project in global DB
    markProjectOpened(props.projectId);

    const canvas = document.getElementById('engine-canvas') as HTMLCanvasElement;
    resizeObserver.observe(canvas.parentElement!);

    await engine.init(canvas);

    markProjectReady(props.projectId);

    // Detect filesystem handles whose permission was lost across reloads, then
    // open a dialog so the user can re-grant in a real click handler — the
    // requestPermission API requires a transient user activation.
    const pending: GrantableHandle[] = [];
    for (const asset of engine.world.assets.values()) {
      if (asset.handle) {
        const state = await asset.handle.queryPermission({ mode: 'read' });
        if (state !== 'granted') pending.push(asset.handle);
      }
      if (asset.type === 'SEQUENCE') {
        const state = await asset.directoryHandle.queryPermission({ mode: 'read' });
        if (state !== 'granted') pending.push(asset.directoryHandle);
      }
    }

    if (pending.length > 0) {
      await showGrantPermissionDialog(pending);

      // Permission re-granted (or dialog dismissed): drop cached decoders/tracks
      // so they refetch with the new permission, and bump the assets version to
      // retrigger resource consumers (thumbnails, sidebar previews, etc).
      clearAudioPeaksCache();
      clearAudioTrackCache();
      clearVideoTrackCache();
      clearKeyframeIndexCache();
      clearImageThumbnailCache();

      for (const eid of getAllEntities(engine.world)) {
        disposeDecoders(engine.world, eid);
      }

      invalidateAssets(engine.world);
    }
  });

  onCleanup(() => {
    if (readyProjectId === props.projectId) readyProjectId = null;

    // Capture thumbnail before disposing the engine
    const canvas = engine.world.canvas;
    captureCanvasThumbnail(canvas).then((blob) => {
      if (blob) {
        setProjectThumbnail(props.projectId, blob);
      }
    });

    resizeObserver.disconnect();
    engine.dispose();
  });

  return (
    <EngineContext.Provider value={engine}>
      {props.children}
      <Dialog open={open()} onOpenChange={handleOpenChange}>
        <DialogPortal>
          <DialogContent class="sm:max-w-sm p-0 overflow-hidden" showCloseButton={false}>
            <img src="permission-dialog-header.png" alt="Restore access to your media" class="w-full h-auto" />
            <div class="px-4 pb-4">
              <DialogHeader>
                <DialogTitle class="text-[12px] font-450">Restore access to your files</DialogTitle>
                <DialogDescription class="text-xs text-muted-foreground leading-relaxed">
                  This project references {handles().length} files from your filesystem. Grant access to load them. Enable <span class="font-450 text-foreground">Allow on every visit</span> in your browser settings to avoid this dialog in the future.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button class="w-full mt-3" variant="secondary" disabled={granting()} onClick={handleGrant}>
                  Grant access
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>
      <Show when={!engine.initialized() && !open()}>
        <div class="fixed inset-0 z-50 bg-overlay animate-out fade-out-0 duration-200" />
      </Show>
    </EngineContext.Provider>
  );
}

export function useEngine() {
  const ctx = useContext(EngineContext);
  assert(ctx, 'useEngine must be used within EngineProvider');
  return ctx;
}
