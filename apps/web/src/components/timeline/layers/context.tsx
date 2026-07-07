/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createContext, createSignal, useContext, type JSX, type Signal } from "solid-js";

export type DropPosition = 'above' | 'below' | 'inside';

export type LayerDragState = {
  targetEid: number | null;
  position: DropPosition | null;
};

type LayerContextValue = {
  resizedId: Signal<number | null>;
  dragState: Signal<LayerDragState | null>;
}

const LayerContext = createContext<LayerContextValue>();

export function LayerContextProvider(props: { children: JSX.Element }) {
  const resizedId = createSignal<number | null>(null);
  const dragState = createSignal<LayerDragState | null>(null);

  return (
    <LayerContext.Provider value={{ resizedId, dragState }}>
      {props.children}
    </LayerContext.Provider>
  );
}

export function useLayerContext() {
  const context = useContext(LayerContext);
  if (!context) {
    throw new Error('useLayerContext must be used within a LayerContextProvider');
  }
  return context;
}
