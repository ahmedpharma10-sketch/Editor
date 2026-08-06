/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hasComponent, None, Not, Or, query } from "bitecs";
import { ChildOf, computeLocalMatrix, decompose2D, duplicateSelection, getParentEntity, identity2D, multiply2D, quadsIntersect, rectToQuad, rotate2D, scale2D, translate2D, type Mat2D, type Point, type Quad, transformPoint, invert2D, getSceneAncestor, isPointerInEntity, appendChild, removeChild, togglePlayback, switchActiveScene, transformSystem, clearComponent, computeGroupBounds } from "..";
import { addComponent, removeComponent, setComponent, clearSelectedAssets, findKeyframeTrackEntity } from "../api";
import { resizeEntity } from "./resize";
import { syncInteractiveState } from "./utils";
import { buildSnapCandidatesFromCorners, buildSnapCandidatesFromQuad, entityAnchor, entityOffset, entityQuad, entityWorldMat, findSnapTarget, getMarqueeQuad, getSelectionMaskSnapshot, getSelectionTransfromSnapshot, getSnapCandidatesSnapshot, mountNameInput, snapshotSelectionMask, snapshotSelectionTransforms, snapshotSnapCandidates, updateResizeCursor, updateRotationCursor } from "../utils/interaction";
import { assert } from "@/utils";
import z from "zod";

import type { DispatchedPointerEvent } from "../types";
import type { EngineWorld } from "./world";

const SNAP_DISTANCE = 6;

export function handleGeometryInteraction(world: EngineWorld, event: DispatchedPointerEvent) {
  const c = world.components;

  // Equivalent to pointerdown on an entity/ click
  if (event.type === 'dragstart' && event.target.kind === 'entity') {
    if (world.keys.has('shift')) {
      addComponent(world, event.target.id, c.Selected, false);
    } else {
      clearComponent(world, c.Selected, false);
      addComponent(world, event.target.id, c.Selected, false);
    }

    handleMaskInteraction(world, event);
  }

  if (event.type === 'drag') {
    handleMaskInteraction(world, event);
  }

  if (event.type === 'dragend') {
    handleMaskInteraction(world, event);
  }

  if (event.type === 'dblclick' && event.target.kind === 'entity') {
    const parentEid = event.target.id;
    const childEid = findChildHitTarget(world, parentEid, event.clientX, event.clientY);
    if (childEid !== null) {
      removeComponent(world, parentEid, c.Interactive, false);
      for (const cid of query(world, [Or(c.Geometry, c.Group), ChildOf(parentEid), Not(c.Deleted)])) {
        addComponent(world, cid, c.Interactive, false);
      }
      clearComponent(world, c.Selected, false);
      clearComponent(world, c.Hovering, false);
      addComponent(world, childEid, c.Selected, false);
      addComponent(world, childEid, c.Hovering, false);
    }
  }

  if (world.pointer.state === 'lifted') {
    world.cursor.update('default');
  }
}

function findChildHitTarget(world: EngineWorld, parentEid: number, x: number, y: number): number | null {
  const c = world.components;
  const children = query(world, [Or(c.Geometry, c.Group), ChildOf(parentEid), Not(c.IsMask), Not(c.Culled), Not(c.Deleted)]);
  for (let i = children.length - 1; i >= 0; i--) {
    if (isPointerInEntity(world, children[i], { x, y })) {
      return children[i];
    }
  }
  return null;
}

export function handleCanvasInteraction(world: EngineWorld, event: DispatchedPointerEvent) {
  const c = world.components;

  if (event.type === 'dragstart') {
    world.hudMode = 'marquee';
  }

  if (event.type === 'drag' && world.hudMode === 'marquee') {
    const marqueeQuad = getMarqueeQuad(world);
    if (marqueeQuad) {
      clearComponent(world, c.Selected, false);
      for (const eid of query(world, [c.Interactive, Or(c.Geometry, c.Group), Not(c.Deleted), Not(c.Culled)])) {
        if (quadsIntersect(marqueeQuad, entityQuad(world, eid))) {
          addComponent(world, eid, c.Selected, false);
        }
      }
    }

    world.cursor.update('default');
  }

  if (event.type === 'dragend') {
    world.hudMode = 'idle';
  }

  if (event.type === 'pointerup') {
    const x0 = world.pointer.dragStartX;
    const y0 = world.pointer.dragStartY;
    const x1 = event.clientX;
    const y1 = event.clientY;
    const distance = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
    if (distance < 4) {
      clearComponent(world, c.Selected, false);
      syncInteractiveState(world);
      clearComponent(world, c.Hovering, false);
      clearSelectedAssets(world);
    }
  }

  if (world.pointer.state === 'lifted') {
    world.cursor.update('default');
  }
}

export function handlePlayInteraction(world: EngineWorld, event: DispatchedPointerEvent) {
  if (event.target.kind !== 'hud') return;
  const eid = parseHudEntityId(event.target.id, 'play');
  if (eid === null) return;

  if (event.type === 'click') {
    togglePlayback(world, eid);
  }
}

export function handleLabelInteraction(world: EngineWorld, event: DispatchedPointerEvent) {
  if (event.target.kind !== 'hud') return;
  const eid = parseHudEntityId(event.target.id, 'label');
  if (eid === null) return;
  const c = world.components;

  if (event.type === 'pointerenter') {
    clearComponent(world, c.Hovering, false);
    addComponent(world, eid, c.Hovering, false);
  }

  if (event.type === 'pointerleave') {
    clearComponent(world, c.Hovering, false);
  }

  if (event.type === 'dragstart') {
    if (world.keys.has('shift')) {
      addComponent(world, eid, c.Selected, false);
    } else {
      clearComponent(world, c.Selected, false);
      addComponent(world, eid, c.Selected, false);
    }
  }

  if (event.type === 'dblclick') {
    mountNameInput(world, eid);
  }

  if (event.type === 'click' && hasComponent(world, eid, c.Scene)) {
    switchActiveScene(world, eid);
  }

  handleMaskInteraction(world, event);
}

function parseHudEntityId(id: string, prefix: string): number | null {
  if (!id.startsWith(`${prefix}:`)) return null;
  const eid = Number(id.slice(prefix.length + 1));
  return Number.isFinite(eid) ? eid : null;
}

export function handleResizeInteraction(world: EngineWorld, event: DispatchedPointerEvent) {
  const c = world.components;

  const orientation = anchorSchema.parse(event.target.id);
  const snapshot = getSelectionMaskSnapshot();

  if (event.type === 'dragstart') {
    snapshotSelectionMask(world);
    snapshotSelectionTransforms(world);
    snapshotSnapCandidates(world);
    world.snapLines = [];
    world.history.startTransaction('Resize');
  }

  if (event.type === 'drag' && snapshot) {
    const oldTr = snapshot.mat;
    const selection = query(world, [c.Selected, Or(c.Geometry, c.Group)]);
    world.snapLines.length = 0;

    const currentLocalPoint = getPointerCurrentPoint(world, oldTr);
    const initialLocalPoint = getPointerInitialPoint(world, oldTr);

    // Calculate delta in mask local space
    const deltaX = currentLocalPoint.x - initialLocalPoint.x;
    const deltaY = currentLocalPoint.y - initialLocalPoint.y;

    // How the drag distance relates to the mask size
    const factor = HANDLE_RESIZE_FACTOR[orientation];

    // Delta size
    let deltaWidth = deltaX * factor.x;
    let deltaHeight = deltaY * factor.y;

    // Lock aspect ratio when shift is held OR every selected entity has KeepAspectRatio.
    // Both paths run through the same math here so the pivot/position stays consistent;
    // when KAR's stored ratio matches the mask ratio (the observer keeps them in sync),
    // the Size observer's enforceAspectRatio becomes a no-op.
    const lockAR = world.keys.has('shift') || (
      selection.length > 0 && selection.every(eid => hasComponent(world, eid, c.KeepAspectRatio))
    );

    if (lockAR) {
      const w0 = snapshot.width;
      const h0 = snapshot.height;

      if (w0 > 0 && h0 > 0) {
        if (['tl', 'tr', 'bl', 'br'].includes(orientation)) {
          // Project the pointer delta onto the pivot→corner diagonal: the dragged
          // corner gets placed at the closest point on the AR-locked ray, so the
          // cursor stays as close as possible to the corner without ever leaping
          // past it on either axis.
          const denom = w0 * w0 + h0 * h0;
          const t = (deltaX * factor.x * w0 + deltaY * factor.y * h0) / denom;
          deltaWidth = w0 * t;
          deltaHeight = h0 * t;
        } else if (['l', 'r'].includes(orientation)) {
          const scale = (w0 + deltaWidth) / w0;
          deltaHeight = h0 * (scale - 1);
        } else if (['t', 'b'].includes(orientation)) {
          const scale = (h0 + deltaHeight) / h0;
          deltaWidth = w0 * (scale - 1);
        }
      }
    }

    // Pivot point: opposite to the handle being dragged
    // factor -1 → 1 (full), factor 0 → 0.5 (center), factor 1 → 0
    let pivotX = snapshot.width * (1 - factor.x) / 2;
    let pivotY = snapshot.height * (1 - factor.y) / 2;

    // When Alt is pressed, we want to scale the selection from the center
    if (world.keys.has('alt')) {
      pivotX = snapshot.width * 0.5;
      pivotY = snapshot.height * 0.5;
      deltaWidth = deltaWidth * 2;
      deltaHeight = deltaHeight * 2;
    }

    let newWidth = snapshot.width + deltaWidth;
    let newHeight = snapshot.height + deltaHeight;

    // Snap the resize vertices to nearby candidates.
    {
      const proposedScaleX = newWidth / snapshot.width;
      const proposedScaleY = newHeight / snapshot.height;

      let proposedLocalScaleTr = translate2D(pivotX, pivotY);
      proposedLocalScaleTr = multiply2D(proposedLocalScaleTr, scale2D(proposedScaleX, proposedScaleY));
      proposedLocalScaleTr = multiply2D(proposedLocalScaleTr, translate2D(-pivotX, -pivotY));

      const proposedWorldTr = multiply2D(oldTr, proposedLocalScaleTr);
      const proposedQuad = rectToQuad(
        proposedWorldTr,
        snapshot.width,
        snapshot.height,
      );

      // Only snap the vertices of the edge/corner being dragged
      // rectToQuad returns [TL, TR, BR, BL]
      const snapCandidates = getSnapCandidatesSnapshot();
      const draggedVertices = getResizeHandleVertices(orientation, proposedQuad);
      const cornerCandidates = buildSnapCandidatesFromCorners(draggedVertices);
      const snapThreshold = SNAP_DISTANCE * world.resolution;

      if (lockAR) {
        // The dragged corner moves linearly from `base` (s=0, the pivot in
        // world space) through `sourcePoint` (s=proposedScale). Each snap
        // line crosses that ray at exactly one scale, so the ratio of new-to-
        // old scale that puts the corner on it is just (span + offset) / span
        // on the snapped axis. Pick the snap whose ratio is closest to 1 and
        // apply it uniformly to both axes.
        const xSnap = findSnapTarget(cornerCandidates.x, snapCandidates.x, snapThreshold, 'x');
        const ySnap = findSnapTarget(cornerCandidates.y, snapCandidates.y, snapThreshold, 'y');
        const base = transformPoint(oldTr, pivotX, pivotY);

        const ratioOf = (snap: { sourcePoint: Point; offset: number } | null, axis: 'x' | 'y') => {
          if (!snap) return null;
          const span = snap.sourcePoint[axis] - base[axis];
          return Math.abs(span) < 1e-9 ? null : (span + snap.offset) / span;
        };

        const rX = ratioOf(xSnap, 'x');
        const rY = ratioOf(ySnap, 'y');
        const pickX = rX !== null && (rY === null || Math.abs(rX - 1) <= Math.abs(rY - 1));
        const pickY = rY !== null && !pickX;
        const ratio = pickX ? rX! : pickY ? rY! : null;
        const snap = pickX ? xSnap! : pickY ? ySnap! : null;

        if (snap && ratio !== null) {
          newWidth *= ratio;
          newHeight *= ratio;
          world.snapLines.push({
            from: {
              x: base.x + (snap.sourcePoint.x - base.x) * ratio,
              y: base.y + (snap.sourcePoint.y - base.y) * ratio,
            },
            to: snap.targetPoint,
          });
        }
      } else {
        const xSnap = factor.x !== 0 ? findSnapTarget(cornerCandidates.x, snapCandidates.x, snapThreshold, 'x') : null;
        const ySnap = factor.y !== 0 ? findSnapTarget(cornerCandidates.y, snapCandidates.y, snapThreshold, 'y') : null;

        if (xSnap) world.snapLines.push({
          from: {
            x: xSnap.sourcePoint.x + xSnap.offset,
            y: xSnap.sourcePoint.y + (ySnap?.offset ?? 0),
          },
          to: xSnap.targetPoint
        });

        if (ySnap) world.snapLines.push({
          from: {
            x: ySnap.sourcePoint.x + (xSnap?.offset ?? 0),
            y: ySnap.sourcePoint.y + ySnap.offset,
          },
          to: ySnap.targetPoint
        });


        if (xSnap || ySnap) {
          // Convert the world-space snap offset back into a local-space size correction
          const inverseTr = invert2D(oldTr);
          inverseTr.e = 0;
          inverseTr.f = 0;
          const localCorrection = transformPoint(inverseTr, xSnap?.offset ?? 0, ySnap?.offset ?? 0);

          // The correction needs to be scaled by the factor and alt multiplier
          const altMultiplier = world.keys.has('alt') ? 2 : 1;
          if (factor.x !== 0) {
            deltaWidth += localCorrection.x * factor.x * altMultiplier;
          }
          if (factor.y !== 0) {
            deltaHeight += localCorrection.y * factor.y * altMultiplier;
          }

          newWidth = snapshot.width + deltaWidth;
          newHeight = snapshot.height + deltaHeight;
        }
      }
    }

    // Scale factors
    const scaleX = newWidth / snapshot.width;
    const scaleY = newHeight / snapshot.height;

    // Scale transformation in local space around the pivot
    let localScaleTr = translate2D(pivotX, pivotY);
    localScaleTr = multiply2D(localScaleTr, scale2D(scaleX, scaleY));
    localScaleTr = multiply2D(localScaleTr, translate2D(-pivotX, -pivotY));

    // Groups have no Size of their own — resize them by transforming their
    // direct children instead. Each child's snapshot was captured at dragstart.
    // The group's own transform is left untouched; transformSystem rebuilds
    // its Computed AABB from the moved/resized children.
    const hasGroupSelected = selection.some(eid => hasComponent(world, eid, c.Group));
    // The single-node wobble guard doesn't apply to group children: they're
    // scaled in the group's space, not their own, so rotation/skew can change.
    const writeRotationSkew = selection.length > 1 || hasGroupSelected;

    for (const selectedEid of selection) {
      const targets = hasComponent(world, selectedEid, c.Group)
        ? [...query(world, [ChildOf(selectedEid), Or(c.Geometry, c.Group), Not(c.Deleted)])]
        : [selectedEid];

      for (const eid of targets) {
        const initialState = getSelectionTransfromSnapshot(eid);
        if (!initialState) continue;

        const parentTransform = initialState.parentTransform;
        const anchor = entityAnchor(world, eid);

        // Don't include the pivot point in the old local transform
        const oldLocal = multiply2D(
          initialState.localTransform,
          translate2D(
            initialState.width * anchor.x,
            initialState.height * anchor.y,
          )
        );

        // Convert scaleMatrix from mask local space to world space
        let deltaWorld = multiply2D(oldTr, localScaleTr);
        deltaWorld = multiply2D(deltaWorld, invert2D(oldTr));

        // Calculate new local transform: [new local] = [parent inverted] * [delta] * [parent] * [old local]
        let newLocal = multiply2D(invert2D(parentTransform), deltaWorld);
        newLocal = multiply2D(newLocal, parentTransform);
        newLocal = multiply2D(newLocal, oldLocal);

        // Decompose the new local transform
        const decomposed = decompose2D(newLocal);

        // Calculate the new width and height from the decomposed transform
        // Using the decomposed scale accounts for entity rotation relative to the mask
        // NOTE: Claude added these two lines and I have no idea why they are needed (but it works)
        const newWidth = initialState.width * (decomposed.scaleX / initialState.scaleX);
        const newHeight = initialState.height * (decomposed.scaleY / initialState.scaleY);

        // Calculate the new pivot point
        const newPivotX = (newWidth * anchor.x);
        const newPivotY = (newHeight * anchor.y);

        const newPosX = decomposed.x - newPivotX;
        const newPosY = decomposed.y - newPivotY;

        const offset = entityOffset(world, eid);

        resizeEntity(world, eid, { width: newWidth, height: newHeight });
        {
          const roundedX = Math.round(newPosX - offset.x);
          const roundedY = Math.round(newPosY - offset.y);
          setComponent(world, eid, c.Position, { x: roundedX, y: roundedY });
        }

        if (writeRotationSkew) {
          const roundedRot = Math.round(decomposed.rotation * 100) / 100;
          const roundedSkewX = Math.round(decomposed.skewX * 100) / 100;
          const roundedSkewY = Math.round(decomposed.skewY * 100) / 100;
          setComponent(world, eid, c.Rotation, roundedRot);
          setComponent(world, eid, c.Skew, { x: roundedSkewX, y: roundedSkewY });
        }

        // transformSystem walks parent-first, so a group's computeGroupBounds
        // reads its children's LocalTransform from the previous walk — one frame
        // stale. Refresh this child's LocalTransform synchronously so the AABB
        // computed for any selected ancestor in this same tick is current. The
        // lag is invisible for non-rotated groups but shows up as drift in a
        // rotated direction once the group has a rotation.
        if (hasGroupSelected) {
          computeLocalMatrix(world, eid);
        }
      }

      // A group's own LocalTransform pivots around anchor * Computed.width/height
      // (see computeLocalMatrix). Resizing its children changes the group's AABB,
      // moving that pivot — and with a nonzero group rotation the (I - R)·pivot
      // term shifts the group's world translation, dragging the whole group
      // (children + selection mask) off the pointer-anchored position. The child
      // math above snapshots the group's world transform at dragstart and assumes
      // it stays fixed, so compensate the group's Position to keep its
      // LocalTransform equal to that snapshot. A no-op when the group isn't
      // rotated/skewed, which is why drift only shows up once it's rotated.
      if (hasComponent(world, selectedEid, c.Group)) {
        const groupSnapshot = getSelectionTransfromSnapshot(selectedEid);
        if (groupSnapshot) {
          // Recompute the group's AABB from the freshly-updated children so the
          // new pivot (anchor * new size) reflects the resize.
          computeGroupBounds(world, selectedEid);

          const anchor = entityAnchor(world, selectedEid);
          const newPivotX = anchor.x * c.Computed.width[selectedEid];
          const newPivotY = anchor.y * c.Computed.height[selectedEid];

          // Desired local = the dragstart snapshot; its linear part (rotation,
          // skew, scale) is untouched by the resize.
          const desiredLocal = groupSnapshot.localTransform;
          const linear: Mat2D = {
            a: desiredLocal.a, b: desiredLocal.b,
            c: desiredLocal.c, d: desiredLocal.d,
            e: 0, f: 0,
          };

          // computeLocalMatrix builds L = T(pos) · K with K = T(pivot)·linear·T(-pivot).
          // Solve T(pos) = L · K⁻¹ for the new pivot so the rebuilt matrix matches.
          let k = multiply2D(translate2D(newPivotX, newPivotY), linear);
          k = multiply2D(k, translate2D(-newPivotX, -newPivotY));
          const posMat = multiply2D(desiredLocal, invert2D(k));

          const offset = entityOffset(world, selectedEid);
          setComponent(world, selectedEid, c.Position, {
            x: Math.round(posMat.e - offset.x),
            y: Math.round(posMat.f - offset.y),
          });
          computeLocalMatrix(world, selectedEid);
        }
      }
    }
    updateResizeCursor(world, orientation);
  }

  if (event.type === 'dragend') {
    // Clear state when resize ends
    world.snapLines.length = 0;
    world.history.commitTransaction();
  }

  if (world.pointer.state === 'lifted') {
    updateResizeCursor(world, orientation);
  }
}

export function handleRotateInteraction(world: EngineWorld, event: DispatchedPointerEvent) {
  const c = world.components;

  const snapshot = getSelectionMaskSnapshot();

  if (event.type === 'dragstart') {
    snapshotSelectionTransforms(world);
    snapshotSelectionMask(world);
    world.history.startTransaction('Rotate');
  }

  if (event.type === 'drag' && snapshot) {
    const oldTr = snapshot.mat;

    // Calculate the pivot point in mask local space
    // For 2+ nodes: use the center of the selection
    // For 1 node: use the anchor point of the node
    let pivotX: number;
    let pivotY: number;

    const selection = query(world, [c.Selected, Or(c.Geometry, c.Group)]);

    if (selection.length === 1) {
      const eid = selection[0];

      const anchor = entityAnchor(world, eid);
      // Use the anchor point (which is at the origin in local space after accounting for anchor offset)
      pivotX = snapshot.width * anchor.x;
      pivotY = snapshot.height * anchor.y;
    } else {
      // Use the center of the selection bounding box
      pivotX = snapshot.width / 2;
      pivotY = snapshot.height / 2;
    }

    // Get pointer positions in mask local space
    const currentLocalPoint = getPointerCurrentPoint(world, oldTr);
    const initialLocalPoint = getPointerInitialPoint(world, oldTr);

    // Calculate angles from pivot to pointer positions
    const initialAngle = Math.atan2(
      initialLocalPoint.y - pivotY,
      initialLocalPoint.x - pivotX
    );
    const currentAngle = Math.atan2(
      currentLocalPoint.y - pivotY,
      currentLocalPoint.x - pivotX
    );

    // Calculate rotation delta in radians
    const deltaAngleRad = currentAngle - initialAngle;
    const deltaAngleDeg = deltaAngleRad * 180 / Math.PI;

    // Rotation transformation in local space around the pivot
    let localRotateTr = translate2D(pivotX, pivotY);
    localRotateTr = multiply2D(localRotateTr, rotate2D(deltaAngleDeg));
    localRotateTr = multiply2D(localRotateTr, translate2D(-pivotX, -pivotY));

    for (const eid of selection) {
      const initialState = getSelectionTransfromSnapshot(eid);
      if (!initialState) continue;

      const parentTransform = initialState.parentTransform;
      const anchor = entityAnchor(world, eid);

      // Include the anchor offset in the old local transform
      const oldLocal = multiply2D(
        initialState.localTransform,
        translate2D(
          initialState.width * anchor.x,
          initialState.height * anchor.y,
        )
      );

      // Convert rotation from mask local space to world space
      let deltaWorld = multiply2D(oldTr, localRotateTr);
      deltaWorld = multiply2D(deltaWorld, invert2D(oldTr));

      // Calculate new local transform: [new local] = [parent inverted] * [delta] * [parent] * [old local]
      let newLocal = multiply2D(invert2D(parentTransform), deltaWorld)
      newLocal = multiply2D(newLocal, parentTransform);
      newLocal = multiply2D(newLocal, oldLocal);

      // Decompose the new local transform
      let decomposed = decompose2D(newLocal);

      // Snap rotation to global 15 degree multiples when Shift is pressed.
      // The snap must rotate about the same pivot the interactive rotation
      // used (the mask pivot, in world space) and the position must be
      // re-derived from the snapped transform. Reusing the unsnapped position
      // works for a single node — computeLocalMatrix pivots about the same
      // anchor, so its world position is rotation-invariant — but a group's
      // local matrix pivots about its box center (width/2, height/2) while the
      // interaction pivots about the mask/AABB center (offset by the group's
      // AABB origin). Overriding rotation while keeping the unsnapped position
      // then rotates about the wrong point and the mask jumps.
      if (world.keys.has('shift')) {
        const snapIncrement = 15;
        const snapped = Math.round(decomposed.rotation / snapIncrement) * snapIncrement;
        const snapDelta = snapped - decomposed.rotation;

        if (snapDelta !== 0) {
          const pivotWorld = transformPoint(oldTr, pivotX, pivotY);
          let snapWorld = translate2D(pivotWorld.x, pivotWorld.y);
          snapWorld = multiply2D(snapWorld, rotate2D(snapDelta));
          snapWorld = multiply2D(snapWorld, translate2D(-pivotWorld.x, -pivotWorld.y));

          let snappedLocal = multiply2D(invert2D(parentTransform), snapWorld);
          snappedLocal = multiply2D(snappedLocal, parentTransform);
          snappedLocal = multiply2D(snappedLocal, newLocal);
          newLocal = snappedLocal;
          decomposed = decompose2D(newLocal);
        }
      }

      // Calculate the anchor offset
      const anchorOffsetX = initialState.width * anchor.x;
      const anchorOffsetY = initialState.height * anchor.y;

      const offset = entityOffset(world, eid);
      const newPosX = decomposed.x - anchorOffsetX - offset.x;
      const newPosY = decomposed.y - anchorOffsetY - offset.y;

      const roundedPosX = Math.round(newPosX);
      const roundedPosY = Math.round(newPosY);
      const roundedRot = Math.round(decomposed.rotation * 100) / 100;
      setComponent(world, eid, c.Position, { x: roundedPosX, y: roundedPosY });
      setComponent(world, eid, c.Rotation, roundedRot);
    }
    updateRotationCursor(world);
  }

  if (event.type === 'dragend') {
    // Clear state when rotation ends
    world.history.commitTransaction();
  }

  if (world.pointer.state === 'lifted') {
    updateRotationCursor(world);
  }
}

const transformCorrectionFactors: Map<number, Mat2D> = new Map();

export function handleMaskInteraction(world: EngineWorld, event: DispatchedPointerEvent) {
  const c = world.components;
  const snapshot = getSelectionMaskSnapshot();

  if (event.type === 'dblclick') {
    const selection = query(world, [c.Selected, Or(c.Geometry, c.Group)]);
    if (selection.length === 1) {
      const parentEid = selection[0];
      const childEid = findChildHitTarget(world, parentEid, event.clientX, event.clientY);
      if (childEid !== null) {
        removeComponent(world, parentEid, c.Interactive, false);
        for (const cid of query(world, [Or(c.Geometry, c.Group), ChildOf(parentEid), Not(c.Deleted)])) {
          addComponent(world, cid, c.Interactive, false);
        }
        clearComponent(world, c.Selected, false);
        clearComponent(world, c.Hovering, false);
        addComponent(world, childEid, c.Selected, false);
        addComponent(world, childEid, c.Hovering, false);
      }
    }
    return;
  }

  if (event.type == 'dragstart') {
    // One gesture = one undo step. For an option-drag the clone + the move
    // share this transaction (duplicateSelection's own transaction nests into
    // it); a plain drag just records the move.
    world.history.startTransaction(world.keys.has('alt') ? 'Duplicate' : 'Transform');

    if (world.keys.has('alt')) {
      duplicateSelection(world, { offset: false });
      transformSystem(world);
    }

    // Get the base matrix that was used to render the backdrop
    snapshotSelectionMask(world);
    snapshotSelectionTransforms(world);
    snapshotSnapCandidates(world);
    world.snapLines = [];

    // Initialize correction factors to identity for each selected node
    transformCorrectionFactors.clear();
    for (const eid of query(world, [c.Selected, Or(c.Geometry, c.Group)])) {
      transformCorrectionFactors.set(eid, identity2D());
    }

    world.hudMode = 'moving';
  }

  if (event.type == 'drag' && snapshot) {
    const oldTr = snapshot.mat;
    world.snapLines.length = 0;

    const currentLocalPoint = getPointerCurrentPoint(world, oldTr);
    const initialLocalPoint = getPointerInitialPoint(world, oldTr);

    // Calculate delta in mask local space
    let deltaX = currentLocalPoint.x - initialLocalPoint.x;
    let deltaY = currentLocalPoint.y - initialLocalPoint.y;

    // Determine if the drag is snapping to a guide
    if (!world.keys.has('mod')) {
      const proposedMaskQuad = rectToQuad(
        multiply2D(oldTr, translate2D(deltaX, deltaY)),
        snapshot.width,
        snapshot.height,
      );
      const snapCandidates = getSnapCandidatesSnapshot();
      const proposedMaskCandidates = buildSnapCandidatesFromQuad(proposedMaskQuad);
      const snapThreshold = SNAP_DISTANCE * world.resolution;
      const xSnap = findSnapTarget(proposedMaskCandidates.x, snapCandidates.x, snapThreshold, 'x');
      const ySnap = findSnapTarget(proposedMaskCandidates.y, snapCandidates.y, snapThreshold, 'y');

      if (xSnap) world.snapLines.push({
        from: {
          x: xSnap.sourcePoint.x + xSnap.offset,
          y: xSnap.sourcePoint.y + (ySnap?.offset ?? 0),
        },
        to: xSnap.targetPoint
      });

      if (ySnap) world.snapLines.push({
        from: {
          x: ySnap.sourcePoint.x + (xSnap?.offset ?? 0),
          y: ySnap.sourcePoint.y + ySnap.offset,
        },
        to: ySnap.targetPoint
      });

      if (xSnap || ySnap) {
        const inverseTr = invert2D(oldTr);
        assert(inverseTr, 'Matrix must be invertible');
        inverseTr.e = 0;
        inverseTr.f = 0;

        const localCorrection = transformPoint(inverseTr, xSnap?.offset ?? 0, ySnap?.offset ?? 0);
        deltaX += localCorrection.x;
        deltaY += localCorrection.y;
      }
    }

    // Update mask offset by adding delta to the initial offset
    const localOffsetTr = translate2D(deltaX, deltaY);

    // Apply the offset to each node
    for (const eid of query(world, [c.Selected, Or(c.Geometry, c.Group)])) {
      const initialState = getSelectionTransfromSnapshot(eid);
      if (!initialState) continue;

      const parentEid = getParentEntity(world, eid);
      const oldParentTransform = entityWorldMat(world, parentEid);

      let reparented = false;

      const inScene = getSceneAncestor(world, eid) !== null;
      const sceneHitTarget = findSceneHitTarget(world, event.clientX, event.clientY);

      if (sceneHitTarget && sceneHitTarget !== eid && parentEid === null) {
        try {
          appendChild(world, eid, sceneHitTarget);
          reparented = true;
        } catch {/* ignore */ }
        try {
          switchActiveScene(world, sceneHitTarget);
        } catch { /* ignore */ }
      }

      if (!sceneHitTarget && inScene && parentEid !== null && !hasPositionKeyframes(world, eid)) {
        try {
          removeChild(world, eid, parentEid);
          reparented = true;
        } catch { /* ignore */ }
      }

      if (reparented) {
        // Calculate correction factor: newParent^-1 * oldParent
        // This compensates for the change in parent transform
        const newParentEid = getParentEntity(world, eid);
        const newParentTransform = entityWorldMat(world, newParentEid);
        const correction = multiply2D(invert2D(newParentTransform), oldParentTransform);
        const existingCorrection = transformCorrectionFactors.get(eid) ?? identity2D();
        transformCorrectionFactors.set(eid, multiply2D(existingCorrection, correction));
      }

      const anchor = entityAnchor(world, eid);
      const offsetX = initialState.width * anchor.x;
      const offsetY = initialState.height * anchor.y;

      const parentTransform = initialState.parentTransform;
      const oldLocal = multiply2D(initialState.localTransform, translate2D(offsetX, offsetY));

      // Convert scaleMatrix from mask local space to world space
      let deltaWorld = multiply2D(oldTr, localOffsetTr);
      deltaWorld = multiply2D(deltaWorld, invert2D(oldTr));

      // Get correction factor (identity if no reparenting occurred)
      const correctionFactor = transformCorrectionFactors.get(eid) ?? identity2D();

      // Calculate new local transform: [new local] = [correction] * [parent inverted] * [delta] * [parent] * [old local]
      // The correction factor compensates for any parent changes during the drag
      let newLocal = multiply2D(correctionFactor, invert2D(parentTransform));
      newLocal = multiply2D(newLocal, deltaWorld);
      newLocal = multiply2D(newLocal, parentTransform);
      newLocal = multiply2D(newLocal, oldLocal);

      const offset = entityOffset(world, eid);
      const decomposed = decompose2D(newLocal);
      const newPosX = Math.round(decomposed.x - offsetX - offset.x);
      const newPosY = Math.round(decomposed.y - offsetY - offset.y);

      setComponent(world, eid, c.Position, { x: newPosX, y: newPosY });
    }
  }

  if (event.type == 'dragend') {
    // Clear state when drag ends
    world.snapLines.length = 0;
    world.hudMode = 'idle';
    world.history.commitTransaction();
  }

  if (world.pointer.state === 'lifted') {
    world.cursor.update('default');
  }
}

function getPointerCurrentPoint(world: EngineWorld, mat: Mat2D) {
  const currentX = world.pointer.clientX;
  const currentY = world.pointer.clientY;

  const inverse = invert2D(mat);
  assert(inverse, 'Matrix must be invertible');

  return transformPoint(inverse, currentX, currentY);
}

function getPointerInitialPoint(world: EngineWorld, mat: Mat2D) {
  const initialX = world.pointer.dragStartX ?? 0;
  const initialY = world.pointer.dragStartY ?? 0;

  const inverse = invert2D(mat);
  assert(inverse, 'Matrix must be invertible');

  return transformPoint(inverse, initialX, initialY);
}

function hasPositionKeyframes(world: EngineWorld, eid: number) {
  return findKeyframeTrackEntity(world, eid, 'position.x') !== null
    || findKeyframeTrackEntity(world, eid, 'position.y') !== null;
}

function findSceneHitTarget(world: EngineWorld, x: number, y: number) {
  const c = world.components;

  for (const eid of query(world, [c.Scene, None(ChildOf('*'), c.Selected, c.Dragging, c.Culled, c.Deleted)])) {
    if (isPointerInEntity(world, eid, { x, y })) {
      return eid;
    }
  }

  return null;
}

const anchorSchema = z.enum(['tl', 'tr', 'bl', 'br', 't', 'r', 'b', 'l']);
type AnchorType = z.infer<typeof anchorSchema>;

const HANDLE_RESIZE_FACTOR: Record<AnchorType, Point> = {
  tl: { x: -1, y: -1 }, tr: { x: 1, y: -1 },
  bl: { x: -1, y: 1 }, br: { x: 1, y: 1 },
  t: { x: 0, y: -1 }, r: { x: 1, y: 0 },
  b: { x: 0, y: 1 }, l: { x: -1, y: 0 },
};

function getResizeHandleVertices(orientation: AnchorType, q: Quad): Point[] {
  switch (orientation) {
    case 'tl': return [q[0]];
    case 'tr': return [q[1]];
    case 'br': return [q[2]];
    case 'bl': return [q[3]];
    case 't': return [q[0], q[1]];
    case 'r': return [q[1], q[2]];
    case 'b': return [q[2], q[3]];
    case 'l': return [q[3], q[0]];
  }
}
