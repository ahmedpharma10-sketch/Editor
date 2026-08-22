/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Image generation as the runtime means it: the prompt box declares a
// `generate.image` source per variant and inserts an <Image> consuming it,
// the way any drawn element is inserted. The asset system resolves the
// declaration through the world's Ai (see `EditorGenAi`), and the element
// lands in the project file with the `generate.image({...})` call that
// reproduces it — same spec, same asset, this session and the next.
//
// Generations go on the canvas rather than into a scene: they are material to
// work with, not yet part of a composition, and a scene owns a timeline they
// have no place on until someone puts them there.

import { generate } from "@diffusionstudio/jsx";
import { Image } from "@diffusionstudio/reconciler";
import { Library, Root } from "@diffusionstudio/runtime";
import { useWorld } from "@diffusionstudio/koota-solid";
import { useEditor } from "@/engine/hooks";
import { findEmptyPlacement } from "@/engine/placement";
import { ASPECT_RATIO_DIMENSIONS } from "@/utils/genai";
import { toast } from "somoto";

import type { ImageGenerationConfig } from "@/components/engine/db";
import type { Entity } from "koota";

const IMAGE_GAP = 40;

/** A declaration is keyed by its spec, so a fresh seed makes a new take. */
const randomSeed = () => Math.floor(Math.random() * 1_000_000);

export function useGenerateImage() {
  const world = useWorld();
  const editor = useEditor();

  const run = async (config: ImageGenerationConfig) => {
    const library = world.get(Library);
    const root = world.get(Root);
    if (!root) return;

    // References travel by library path: durable in the file, and readable
    // there. Ids that no longer name a library asset are dropped.
    const refs = (config.imageRefIds ?? [])
      .map((id) => library?.get(id)?.path)
      .filter((path): path is string => path !== undefined);

    const dims = ASPECT_RATIO_DIMENSIONS[config.aspectRatio] ?? { width: 1920, height: 1080 };
    const totalWidth = config.count * dims.width + (config.count - 1) * IMAGE_GAP;
    const center = findEmptyPlacement(world, totalWidth, dims.height, IMAGE_GAP);
    const left = center.x - totalWidth / 2;
    const top = Math.round(center.y - dims.height / 2);

    const inserted: Entity[] = [];
    for (let index = 0; index < config.count; index++) {
      const src = generate.image({
        prompt: config.prompt,
        model: config.model,
        aspectRatio: config.aspectRatio,
        ...(refs.length ? { refs } : {}),
        seed: randomSeed(),
      });

      const x = Math.round(left + index * (dims.width + IMAGE_GAP));
      const [entity] = editor.insertElement(root, () => (
        <Image src={src} x={x} y={top} width={dims.width} height={dims.height} />
      ));
      if (entity) inserted.push(entity);
    }

    if (!inserted.length) {
      toast("Could not add the generation", {
        description: "Open a project to generate into.",
      });
      return;
    }
    editor.select(inserted);
  };

  return { generate: run } as const;
}
