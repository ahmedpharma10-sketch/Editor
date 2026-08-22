/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Root } from "@diffusionstudio/runtime";
import { findEmptyPlacement } from "@/engine/placement";
import { toast } from "somoto";

import type { DocumentEditor } from "@/engine/editor";
import type { Entity, World } from "koota";

/** Between the variants of one batch, and between the batch and its neighbour. */
const GAP = 40;

/** A declaration is keyed by its spec, so a fresh seed makes a new take. */
export const randomSeed = () => Math.floor(Math.random() * 1_000_000);

/** The box an inserted element is given, in canvas space. */
export interface GenerationBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Inserts `count` elements of `size` at the root of the canvas, side by side
 * as one block, and selects them. `element` is called once per variant with
 * the box it goes in; each call declares its own source, so the variants of a
 * batch are separate takes rather than one asset shown four times.
 *
 * Returns the entities, or nothing (having said so) when there is no project
 * to insert into.
 */
export function insertGenerated(
  world: World,
  editor: DocumentEditor,
  size: { width: number; height: number },
  element: (box: GenerationBox, index: number) => unknown,
  count = 1,
): Entity[] {
  const root = world.get(Root);
  const inserted: Entity[] = [];

  if (root) {
    const totalWidth = count * size.width + (count - 1) * GAP;
    const center = findEmptyPlacement(world, totalWidth, size.height, GAP);
    const left = center.x - totalWidth / 2;
    const y = Math.round(center.y - size.height / 2);

    for (let index = 0; index < count; index++) {
      const x = Math.round(left + index * (size.width + GAP));
      const [entity] = editor.insertElement(root, () => element({ x, y, ...size }, index));
      if (entity) inserted.push(entity);
    }
  }

  if (!inserted.length) {
    toast("Could not add the generation", {
      description: "Open a project to generate into.",
    });
    return inserted;
  }

  editor.select(inserted);
  return inserted;
}
