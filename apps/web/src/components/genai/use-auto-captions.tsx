/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from "solid-js";
import { Captions, authoredElement } from "@diffusionstudio/reconciler";
import {
  Caption,
  Computed,
  FrameRate,
  framesToSeconds,
  getEntityTree,
  isScene,
} from "@diffusionstudio/runtime";
import { useWorld } from "@diffusionstudio/koota-solid";
import { useEditor, useSelection } from "@/engine/hooks";
import { toast } from "somoto";

import type { Entity } from "koota";

export function useAutoCaptions() {
  const world = useWorld();
  const editor = useEditor();
  const { nodes } = useSelection();

  const scenes = createMemo(() => nodes().filter(isScene));
  const hasScene = () => scenes().length > 0;

  /**
   * The scene's own length in seconds, for the caption element's `end`. A
   * fresh <Captions> has no source to take a length from, so without one it
   * runs for the 16s default and stretches the very scene it captions.
   */
  const sceneSpan = (scene: Entity) => {
    const computed = scene.get(Computed);
    const frames = computed?.duration ?? 0;
    if (frames <= 0) return undefined;
    return framesToSeconds(frames, world.get(FrameRate)?.value ?? 30);
  };

  const insertFresh = (scene: Entity) => {
    const [entity] = editor.insertElement(scene, () => (
      <Captions end={sceneSpan(scene)} seed={Date.now()} />
    ));
    if (!entity) {
      toast.error("Could not add captions", {
        description: "The scene has no source to write the element into.",
      });
      return;
    }
  };

  const generate = () => {
    for (const scene of scenes()) {
      const existing = getEntityTree(world, scene).find(
        (entity) => entity !== scene && entity.has(Caption),
      );

      if (!existing) {
        insertFresh(scene);
        return;
      }

      const authored = authoredElement(existing);

      // Captions bound to a subtitle file say what they show; auto-captions
      // means transcribing, so the element is replaced by one that does.
      if (authored?.props.src !== undefined) {
        editor.remove(existing);
        insertFresh(scene);
        return;
      }

      // A new take: a fresh seed re-transcribes the scene.
      editor.editProperty(existing, "seed", Date.now());
      editor.select(existing);
    }
  };

  return { hasScene, generate };
}
