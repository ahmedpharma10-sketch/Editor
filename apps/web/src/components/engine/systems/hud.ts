/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hasComponent, Not, Or, query } from "bitecs";
import { invert2D, multiply2D, rectToQuad, rotate2D, scale2D, transformPoint, translate2D, type Mat2D } from "../math";
import * as callbacks from "../api/interactions";
import { entityQuad, entityWorldMat, getMarqueeQuad, getMountedNameInput, getSelectionMask } from "../utils/interaction";
import { ChildOf } from "../components";

import type { EngineWorld } from "../api/world";

export function hudSystem(world: EngineWorld) {
  const c = world.components;
  const ctx = world.ctx!;
  const res = world.resolution;

  // Draw snap guides
  if (!world.keys.has('mod') && world.snapLines.length > 0) {
    const res = world.resolution;
    const crossSize = Math.round(3 * res);

    ctx.resetTransform();
    ctx.beginPath();

    for (const snapLine of world.snapLines) {
      ctx.moveTo(snapLine.from.x, snapLine.from.y);
      ctx.lineTo(snapLine.to.x, snapLine.to.y);
    }

    ctx.closePath();

    ctx.strokeStyle = '#F43535';
    ctx.lineWidth = Math.round(res);
    ctx.stroke();

    const drawCross = (x: number, y: number) => {
      ctx.moveTo(x - crossSize, y - crossSize);
      ctx.lineTo(x + crossSize, y + crossSize);
      ctx.moveTo(x - crossSize, y + crossSize);
      ctx.lineTo(x + crossSize, y - crossSize);
    };

    ctx.beginPath();

    for (const snapLine of world.snapLines) {
      drawCross(snapLine.from.x, snapLine.from.y);
      drawCross(snapLine.to.x, snapLine.to.y);
    }

    ctx.strokeStyle = '#F43535';
    ctx.lineWidth = Math.round(res);
    ctx.stroke();
  }

  // Draw hover indicators
  {
    for (const eid of query(world, [c.Hovering, Or(c.Geometry, c.Group), Not(c.Sequential), Not(c.Culled), Not(c.Deleted)])) {
      const quad = entityQuad(world, eid);

      ctx.resetTransform();
      ctx.beginPath();
      ctx.moveTo(quad[0].x, quad[0].y);
      ctx.lineTo(quad[1].x, quad[1].y);
      ctx.lineTo(quad[2].x, quad[2].y);
      ctx.lineTo(quad[3].x, quad[3].y);
      ctx.closePath();

      ctx.strokeStyle = '#008CFF';
      ctx.lineWidth = Math.round(2 * res);
      ctx.stroke();
    }
  }

  // Draw headers
  for (const eid of query(world, [Or(c.Name, c.Generating), Not(c.Deleted), Not(c.Culled), Not(c.Hidden), Not(ChildOf('*'))])) {
    const isGenerating = hasComponent(world, eid, c.Generating);
    if (!isGenerating && !hasComponent(world, eid, c.Name)) continue;

    const name = isGenerating ? 'Generating...' : c.Name[eid];
    if (!name) continue;

    const header = getHeaderLayout(world, eid);
    const hasTimelineComp = hasComponent(world, eid, c.Playback);

    ctx.setTransform(header.mat.a, header.mat.b, header.mat.c, header.mat.d, header.mat.e, header.mat.f);

    let labelStartX = 0;

    const isActive = world.selection.scene === eid;
    const isSelected = hasComponent(world, eid, c.Selected);

    // Play/pause button (only for entities with Timeline)
    if (hasTimelineComp) {
      ctx.save();
      ctx.fillStyle = isSelected ? '#cce8ff' : 'rgba(242, 242, 242, 0.64)';
      if (c.Playback.playing[eid] !== 1) {
        ctx.translate(2, 3);
        ctx.fill(PLAY_PATH);
      } else {
        ctx.translate(4, 3);
        ctx.fill(PAUSE_PATH);
      }
      ctx.restore();
      labelStartX = 18;

      world.hitRegions.push({
        target: { kind: 'hud', id: `play:${eid}`, quad: rectToQuad(header.mat, 16, 22) },
        callback: callbacks.handlePlayInteraction,
      });
    }

    // Label
    const labelMat = multiply2D(header.mat, translate2D(labelStartX, 3));
    ctx.setTransform(labelMat.a, labelMat.b, labelMat.c, labelMat.d, labelMat.e, labelMat.f);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '350 11px Inter, sans-serif';

    const activeIndicatorWidth = isActive ? 60 : 0;
    const fittedText = fitTextToWidth(ctx, name, header.width - labelStartX - activeIndicatorWidth);

    if (fittedText) {
      ctx.fillStyle = isSelected ? '#cce8ff' : 'rgba(242, 242, 242, 0.64)';
      ctx.fillText(fittedText.value, 0, 0);

      const labelHitMat = multiply2D(header.mat, translate2D(labelStartX, 0));
      world.hitRegions.push({
        target: { kind: 'hud', id: `label:${eid}`, quad: rectToQuad(labelHitMat, fittedText.width + 4, 22) },
        callback: callbacks.handleLabelInteraction,
      });
    }

    const { input, eid: inputEid } = getMountedNameInput();

    // Position the label input overlay if editing this entity
    if (input && inputEid === eid) {
      const inputMat = multiply2D(header.mat, translate2D(labelStartX - 3, 0));
      const res = world.resolution;
      input.style.left = `${inputMat.e / res}px`;
      input.style.top = `${inputMat.f / res}px`;
      input.style.transform = `rotate(${header.rotation}deg)`;
      input.style.width = `${(fittedText?.width ?? 40) + 4}px`;
    }

    // Active indicator
    if (header.width > activeIndicatorWidth && isActive) {
      ctx.setTransform(header.mat.a, header.mat.b, header.mat.c, header.mat.d, header.mat.e, header.mat.f);
      ctx.translate((fittedText?.width ?? 0) + labelStartX + 4, 0);
      ctx.beginPath();
      ctx.roundRect(0, 0, 40, 16, 2);
      ctx.closePath();
      ctx.fillStyle = isSelected ? '#013e70' : '#292929';
      ctx.fill();

      ctx.translate(4, 3);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = '350 11px Inter, sans-serif';
      ctx.fillStyle = isSelected ? '#cce8ff' : 'rgba(242, 242, 242, 0.64)';
      ctx.fillText("Active", 0, 0);
    }

    // Duration (only for entities with Timeline)
    if (hasTimelineComp && ((fittedText?.width ?? 0) + activeIndicatorWidth + 60) < header.width) {
      ctx.setTransform(header.mat.a, header.mat.b, header.mat.c, header.mat.d, header.mat.e, header.mat.f);
      ctx.translate(header.width, 3);

      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.font = '400 11px JetBrains Mono';

      const duration = c.Computed.duration[eid];

      const durationSeconds = duration / world.frameRate;
      const m = Math.floor(durationSeconds / 60).toString().padStart(2, '0');
      const s = Math.floor(durationSeconds % 60).toString().padStart(2, '0');

      if (isSelected) {
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = '#cce8ff';
      } else {
        ctx.fillStyle = 'rgba(121, 121, 121, 1)';
      }
      ctx.fillText(`${m}:${s}`, 0, 0);
      ctx.globalAlpha = 1;
    }
  }

  const mask = getSelectionMask(world);

  // Draw selection mask
  if (mask && world.hudMode !== 'moving') {
    const { width, height, mat } = mask;
    const selection = query(world, [Or(c.Geometry, c.Group), c.Selected, Not(c.Sequential)]);

    ctx.resetTransform();
    ctx.beginPath();

    // Draw the quad of each node
    for (const eid of selection) {
      const quad = entityQuad(world, eid);

      ctx.moveTo(quad[0].x, quad[0].y);
      ctx.lineTo(quad[1].x, quad[1].y);
      ctx.lineTo(quad[2].x, quad[2].y);
      ctx.lineTo(quad[3].x, quad[3].y);
      ctx.lineTo(quad[0].x, quad[0].y);
    }

    // Draw the selection mask
    ctx.setTransform(mat.a, mat.b, mat.c, mat.d, mat.e, mat.f);
    ctx.rect(0, 0, width, height);

    ctx.closePath();

    ctx.strokeStyle = '#008CFF';
    ctx.lineWidth = Math.round(selection.length === 1 ? 2 : 1 * res);
    ctx.stroke();

    world.hitRegions.push({
      target: { kind: 'hud', id: 'selection', quad: rectToQuad(mat, width, height) },
      callback: callbacks.handleMaskInteraction,
    });

    // Set rotation regions

    const rr = Math.round(16 * res);

    const rotationRegions = {
      rtl: [-rr, -rr],
      rtr: [width, -rr],
      rbr: [width, height],
      rbl: [-rr, height],
    };

    for (const [id, [x, y]] of Object.entries(rotationRegions)) {
      const tr = multiply2D(mat, translate2D(x, y));
      world.hitRegions.push({
        target: { kind: 'hud', id, quad: rectToQuad(tr, rr, rr) },
        callback: callbacks.handleRotateInteraction,
      });
    }

    // Set scale regions

    const sr = Math.round(6 * res);
    const sr2 = Math.round(sr / 2);

    const scaleRegions = {
      l: [-sr2, 0, sr, height],
      t: [0, -sr2, width, sr],
      r: [width - sr2, 0, sr, height],
      b: [0, height - sr2, width, sr],
    };

    for (const [id, [x, y, width, height]] of Object.entries(scaleRegions)) {
      const tr = multiply2D(mat, translate2D(x, y));
      world.hitRegions.push({
        target: { kind: 'hud', id, quad: rectToQuad(tr, width, height) },
        callback: callbacks.handleResizeInteraction,
      });
    }

    // Draw the selection handles (handles move with the mask)

    ctx.beginPath();

    const hs = Math.round(8 * res);
    const hs2 = Math.round(hs / 2);

    const cornerHandles = {
      tl: [-hs2, -hs2],
      tr: [width - hs2, -hs2],
      br: [width - hs2, height - hs2],
      bl: [-hs2, height - hs2],
    };

    for (const [id, [x, y]] of Object.entries(cornerHandles)) {
      const tr = multiply2D(mat, translate2D(x, y));
      ctx.setTransform(tr.a, tr.b, tr.c, tr.d, tr.e, tr.f);
      ctx.rect(0, 0, hs, hs);
      world.hitRegions.push({
        target: { kind: 'hud', id, quad: rectToQuad(tr, hs, hs) },
        callback: callbacks.handleResizeInteraction,
      });
    }

    ctx.closePath();

    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = '#008CFF';
    ctx.lineWidth = Math.round(res);
    ctx.stroke();
  }

  // Render the dimensions
  if (mask && world.hudMode !== 'moving') {
    const selection = query(world, [c.Selected, Or(c.Geometry, c.Group), Not(c.Sequential)]);

    let rotation = 0;
    let center = 0;
    let x = 0;
    let y = 0;
    let width = 0;
    let height = 0;

    if (selection.length === 1) {
      const eid = selection[0];

      // get the lowest 2 points sorted by x
      const lowestPoints = [...entityQuad(world, eid)]
        .sort((a, b) => b.y - a.y)
        .slice(0, 2)
        .sort((a, b) => a.x - b.x);

      // get rotation between points in degrees
      rotation = Math.atan2(
        lowestPoints[1].y - lowestPoints[0].y,
        lowestPoints[1].x - lowestPoints[0].x
      ) * 180 / Math.PI;

      const a = lowestPoints[0].x - lowestPoints[1].x;
      const b = lowestPoints[0].y - lowestPoints[1].y;

      center = Math.sqrt(a * a + b * b) / 2;
      width = c.Computed.width[eid] * Math.abs(c.Computed.scaleX[eid]);
      height = c.Computed.height[eid] * Math.abs(c.Computed.scaleY[eid]);
      x = lowestPoints[0].x;
      y = lowestPoints[0].y;
    } else {
      // Get inverse transform and zero out translation to transform as vector, not point
      const worldTransform = entityWorldMat(world, null);
      const inverseTransform = invert2D(worldTransform);
      inverseTransform.e = 0;
      inverseTransform.f = 0;

      const transformed = transformPoint(inverseTransform, mask.width, mask.height);

      width = transformed.x;
      height = transformed.y;

      x = mask.mat.e;
      y = mask.mat.f + mask.height;
      center = mask.width / 2;
    }

    ctx.save();

    let mat = translate2D(x, y);
    mat = multiply2D(mat, rotate2D(rotation));
    mat = multiply2D(mat, scale2D(res, res));
    mat = multiply2D(mat, translate2D(center / res, 16));

    ctx.setTransform(mat.a, mat.b, mat.c, mat.d, mat.e, mat.f);

    const roundedWidth = Math.round(width * 100) / 100;
    const roundedHeight = Math.round(height * 100) / 100;
    const text = `${roundedWidth}x${roundedHeight}`;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '11px Inter, sans-serif';

    const tw = ctx.measureText(text).width + 8; // text width + padding
    const tw2 = tw / 2;                         // text width / 2
    const br = 3;                               // border radius
    const th = 16;                              // text height + padding
    const to = -(th + 2) / 2;                   // text offset

    ctx.beginPath();
    ctx.roundRect(-tw2, to, tw, th, br);
    ctx.closePath();
    ctx.fillStyle = '#008CFF';
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(text, 0, 0);

    ctx.restore();
  }


  // Draw marquee selection rectangle
  const marqueeQuad = getMarqueeQuad(world);
  if (marqueeQuad) {
    const x = marqueeQuad[0].x;
    const y = marqueeQuad[0].y;
    const w = marqueeQuad[1].x - marqueeQuad[0].x;
    const h = marqueeQuad[3].y - marqueeQuad[0].y;

    ctx.resetTransform();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.closePath();

		ctx.fillStyle = '#008CFF';
    ctx.globalAlpha = 0.15;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#008CFF';
    ctx.lineWidth = Math.round(res);
    ctx.stroke();
  }
}

const PLAY_PATH = new Path2D("M0.24182 0.0683919C0.3919 -0.017789 0.5784 -0.022846 0.73338 0.0550586L9.7334 4.57886C9.8974 4.66129 10 4.82339 10 4.99999C10 5.17659 9.8974 5.3387 9.7334 5.42113L0.73338 9.94494C0.5784 10.0228 0.3919 10.0178 0.24182 9.93161C0.0917501 9.84541 0 9.69065 0 9.5238V0.476191C0 0.309296 0.0917501 0.154573 0.24182 0.0683919ZM1 1.26595V8.73399L8.4288 4.99999L1 1.26595Z");
const PAUSE_PATH = new Path2D("M1.08197 0.518868C1.08197 0.232311 0.839803 0 0.540984 0C0.242203 0 0 0.232311 0 0.518868V9.48113C0 9.76764 0.242203 10 0.540984 10C0.839803 10 1.08197 9.76764 1.08197 9.48113V0.518868ZM6 0.518868C6 0.232311 5.75784 0 5.45902 0C5.1602 0 4.91803 0.232311 4.91803 0.518868V9.48113C4.91803 9.76764 5.1602 10 5.45902 10C5.75784 10 6 9.76764 6 9.48113V0.518868Z");

function getHeaderLayout(world: EngineWorld, eid: number) {
  const quad = entityQuad(world, eid);

  // Find two highest points, sorted by x
  const highestPoints = [...quad]
    .sort((a, b) => a.y - b.y)
    .slice(0, 2)
    .sort((a, b) => a.x - b.x);

  const rotation = Math.atan2(
    highestPoints[1].y - highestPoints[0].y,
    highestPoints[1].x - highestPoints[0].x
  ) * 180 / Math.PI;

  const x = highestPoints[0].x;
  const y = highestPoints[0].y;

  const dx = highestPoints[0].x - highestPoints[1].x;
  const dy = highestPoints[0].y - highestPoints[1].y;
  const width = Math.sqrt(dx * dx + dy * dy) / world.resolution;

  const rad = rotation * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const res = world.resolution;
  const mat: Mat2D = {
    a: cos * res,
    b: sin * res,
    c: -sin * res,
    d: cos * res,
    e: x + (-22) * (-sin * res),
    f: y + (-22) * (cos * res),
  };

  return { x, y, rotation, width, mat };
};

const TEXT_WIDTH_CACHE: Map<string, number> = new Map();
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function fitTextToWidth(ctx: Ctx2D, text: string, maxWidth: number) {
  const getTextWidth = (text: string) => {
    if (TEXT_WIDTH_CACHE.has(text)) {
      return TEXT_WIDTH_CACHE.get(text)!;
    }
    const width = ctx.measureText(text).width;
    TEXT_WIDTH_CACHE.set(text, width);
    return width;
  };

  const textWidth = getTextWidth(text);

  if (textWidth > maxWidth) {
    const availableWidth = maxWidth - getTextWidth('...');

    if (availableWidth > 0) {
      let start = 0;
      let end = text.length;
      let bestLength = 0;

      while (start <= end) {
        const mid = Math.floor((start + end) / 2);
        const testText = text.slice(0, mid);
        const testWidth = getTextWidth(testText);

        if (testWidth <= availableWidth) {
          bestLength = mid;
          start = mid + 1;
        } else {
          end = mid - 1;
        }
      }

      if (bestLength > 0) {
        const value = text.slice(0, bestLength) + '...';
        return {
          value,
          width: getTextWidth(value),
        };
      }

      return null;
    } else {
      return null;
    }
  }

  return { value: text, width: textWidth };
}
