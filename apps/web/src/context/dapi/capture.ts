/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AdjustmentLayer, Geometry, Group, Scene, Source } from "@diffusionstudio/runtime";
import { parseSource } from "@diffusionstudio/jsx";
import {
  composeSheet,
  createImageEncoder,
  decodePngBase64,
  planSheet,
  planSheetSizes,
  sheetTimecode,
} from "@diffusionstudio/encoder";

import { createCapture } from "@/engine/capture";

import type { CaptureRequest, CaptureResult, TimecodedImage } from "@diffusionstudio/cli/channels";
import type { Entity, World } from "koota";
import type { ProjectContextValue } from "@/context/project";

// Scenes are nodes too, so capture accepts them alongside geometry, groups,
// and adjustment layers.
function isNode(entity: Entity): boolean {
  return entity.has(Geometry)
    || entity.has(Group)
    || entity.has(AdjustmentLayer)
    || entity.has(Scene);
}

/**
 * The entity `id` names. An id is a source id — the durable name an element
 * carries in the project's JSX — not a koota entity number, which is minted
 * anew on every recompile and so names nothing across calls. The bare id is
 * enough while it names one element; `file:id` settles a tie between files,
 * and a positional stamp (`index.tsx:12`) addresses elements that have no id.
 */
function resolveNode(world: World, id: string): Entity {
  const matches = world.query(Source).filter((entity) => {
    const stamp = entity.get(Source)!.value;
    if (stamp === id) return true;
    const parsed = parseSource(stamp);
    return parsed !== undefined && String(parsed.locator) === id;
  });
  if (!matches.length) {
    throw new Error(`No such node: "${id}" — node ids are the id attributes in the project's JSX`);
  }

  const nodes = matches.filter(isNode);
  if (!nodes.length) {
    throw new Error(`"${id}" is not a renderable node; capture a scene, group, clip, or adjustment layer`);
  }
  if (nodes.length > 1) {
    const stamps = [...new Set(nodes.map((node) => node.get(Source)!.value))];
    if (stamps.length === 1) {
      // One element, many entities: a loop renders its body once per item.
      throw new Error(`"${id}" renders ${nodes.length} times (it sits in a loop) — capture its scene instead`);
    }
    throw new Error(`"${id}" is ambiguous between ${stamps.map((stamp) => `"${stamp}"`).join(", ")} — use the file:id form`);
  }
  return nodes[0]!;
}

// Ceiling on the height a sheet cell renders a node at.
const SHEET_CAPTURE_HEIGHT = 1080;

export function handleCapture(world: World, project: ProjectContextValue) {
  return async ({ id, frames, combine = true, perSheet }: CaptureRequest): Promise<CaptureResult> => {
    const node = resolveNode(world, id);

    // `undefined` means the node's first visible frame (the encoder's frame 0).
    let shots = frames;
    if (shots === undefined || shots.length === 0) {
      shots = [0];
    }

    // The project re-rendered into a world of its own, reduced to this node:
    // the same arrangement an export runs against, and the encoder's to draw.
    const capture = await createCapture(world, node, { dir: project.dir() });

    try {
      const encoder = await createImageEncoder(capture.world, {
        frames: shots,
        resolution: 720,
      });

      // Sheets render at their cell size instead of the flat 720p: with a few
      // frames that is sharper than a standalone capture, never coarser. A node
      // is drawn, not decoded, so a small one is worth rendering past its own
      // bounds; beyond SHEET_CAPTURE_HEIGHT that only costs tokens.
      const aspect = encoder.bounds.width / encoder.bounds.height;
      const height = Math.max(encoder.bounds.height, SHEET_CAPTURE_HEIGHT);
      const sizes = combine ? planSheetSizes(shots.length, perSheet) : [];
      const plans = sizes.map((n) => planSheet(n, { width: height * aspect, height }));
      if (combine) {
        encoder.resize(Math.max(...plans.map((plan) => plan.cellHeight)));
      }

      const result = await encoder.render();

      if (result.type === "canceled") throw new Error("Capture canceled");
      if (result.type === "error") throw result.error;

      if (!combine) return result.data;

      const sheets: TimecodedImage[] = [];
      let offset = 0;
      for (const [sheet, size] of sizes.entries()) {
        const group = result.data.slice(offset, offset + size);
        const cells = group.map(({ timecode }, k) => ({ at: shots[offset + k], timecode }));
        offset += size;
        const images = await Promise.all(group.map((image) => decodePngBase64(image.base64)));
        sheets.push({
          timecode: sheetTimecode(cells),
          base64: await composeSheet(
            images.map((image, k) => ({ image, label: group[k].timecode })),
            plans[sheet],
          ),
        });
        for (const image of images) image.close();
      }
      return sheets;
    } finally {
      capture.dispose();
    }
  };
}
