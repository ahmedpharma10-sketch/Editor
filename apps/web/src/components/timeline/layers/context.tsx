/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createContext, createSignal, useContext, type JSX, type Signal } from "solid-js";

import { assert } from "@/utils";

import type { Entity } from "koota";

export type DropPosition = 'above' | 'below' | 'inside';

export type LayerDragState = {
  target: Entity;
  position: DropPosition;
};

type LayerContextValue = {
  /** The row whose height is being dragged, if any. */
  resized: Signal<Entity | null>;
  /** Where the rows being dragged would land, if they were dropped now. */
  dragState: Signal<LayerDragState | null>;
}

const LayerContext = createContext<LayerContextValue>();

export function LayerContextProvider(props: { children: JSX.Element }) {
  const resized = createSignal<Entity | null>(null);
  const dragState = createSignal<LayerDragState | null>(null);

  return (
    <LayerContext.Provider value={{ resized, dragState }}>
      {props.children}
    </LayerContext.Provider>
  );
}

export function useLayerContext() {
  const context = useContext(LayerContext);
  assert(context, 'useLayerContext must be used within a LayerContextProvider');
  return context;
}
