/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The authoring hooks, as signatures. Both read the host a project is mounted
 * into, which only exists inside the editor: when a project is mounted, the
 * renderer substitutes its own "@diffusionstudio/jsx" module (see
 * @diffusionstudio/reconciler) and these implementations are replaced by ones
 * bound to the live host. This package carries the declarations so project
 * sources type-check and get IntelliSense; calling them outside a mount
 * throws rather than silently returning a dead value.
 */

import type { Accessor, ResourceReturn } from "solid-js";
import type { AssetInput } from "./generate";

export type Ticker = {
  time: Accessor<number>;
  frame: Accessor<number>;
  delta: Accessor<number>;
  playing: Accessor<boolean>;
};

function hostOnly(name: string): never {
  throw new Error(
    `${name} is implemented by the editor's renderer and only works inside a mounted project.`,
  );
}

/**
 * Subscribes to the project's timeline: the playhead of the scene the mount's
 * root lives in (or is), pushed by the host once per playback tick. Each
 * accessor only propagates when its value changes, so a paused scene re-runs
 * nothing and `frame()` consumers update at most once per frame. Values move
 * while the reactive graph is alive: a mount stays live, and export, capture,
 * and reload each re-execute the module and drive the ticker themselves.
 */
export function useTicker(): Ticker {
  return hostOnly("useTicker");
}

/**
 * Resolves a source (path, asset id, URL, or a `generate.*` ref) to its `File`,
 * for reading raw bytes inside effects. Returns Solid's `createResource` tuple
 * unchanged: the resource accessor reads `undefined` until it resolves, then
 * the `File` (with `.loading` / `.error`), plus `mutate` / `refetch`.
 * Resolution is async (fetch a URL, read a path or library asset, await a
 * `generate.*` ref) and, like `src`, needs the host — a sandboxed module can't
 * fetch a path or asset id itself.
 *
 * ```tsx
 * const [canvas, setCanvas] = createSignal<HTMLCanvasElement>();
 * const [file] = useFile("/assets/logo.png");
 * createEffect(async () => {
 *   const el = canvas();
 *   const f = file();
 *   if (!el || !f) return;
 *   el.getContext("2d")!.drawImage(await createImageBitmap(f), 0, 0);
 * });
 * // <surface ref={setCanvas} width={640} height={360} />
 * ```
 */
export function useFile(_src: AssetInput): ResourceReturn<File> {
  return hostOnly("useFile");
}
