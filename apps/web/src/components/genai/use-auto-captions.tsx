/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from "solid-js";
import { Captions, authoredElement } from "@diffusionstudio/reconciler";
import { Caption, getEntityTree, isScene } from "@diffusionstudio/runtime";
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

  const insertFresh = (scene: Entity) => {
    const [entity] = editor.insertElement(scene, () => <Captions />);
    if (!entity) {
      toast.error("Could not add captions", {
        description: "The scene has no source to write the element into.",
      });
      return;
    }
    editor.select(entity);
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

      // A new take: bumping the seed re-transcribes the scene.
      const seed = authored?.props.seed;
      const next = (typeof seed === "number" && Number.isFinite(seed) ? Math.trunc(seed) : 0) + 1;
      editor.editProperty(existing, "seed", next);
      editor.select(existing);
    }
  };

  return { hasScene, generate };
}
