/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AdjustmentLayer, Geometry, Group, Scene } from "@diffusionstudio/runtime";
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

// Scenes are nodes too, so capture accepts them alongside geometry, groups,
// and adjustment layers.
function isNode(entity: Entity): boolean {
  return entity.has(Geometry)
    || entity.has(Group)
    || entity.has(AdjustmentLayer)
    || entity.has(Scene);
}

/**
 * The entity `id` names. Entities travel to the CLI as their koota values
 * (`dapi context` hands them out), so an id is one straight back — it only
 * has to still be alive and still be something worth drawing.
 */
function resolveNode(world: World, id: number): Entity {
  const entity = id as Entity;
  if (!Number.isInteger(id) || id < 0 || !world.has(entity) || !isNode(entity)) {
    throw new Error(`No such node: ${id}`);
  }
  return entity;
}

// Ceiling on the height a sheet cell renders a node at.
const SHEET_CAPTURE_HEIGHT = 1080;

export function handleCapture(world: World) {
  return async ({ id, frames, combine = true, perSheet }: CaptureRequest): Promise<CaptureResult> => {
    const node = resolveNode(world, id);

    // `undefined` means the node's first visible frame (the encoder's frame 0).
    let shots = frames;
    if (shots === undefined || shots.length === 0) {
      shots = [0];
    }

    // The project re-rendered into a world of its own, reduced to this node:
    // the same arrangement an export runs against, and the encoder's to draw.
    const capture = await createCapture(world, node);

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
