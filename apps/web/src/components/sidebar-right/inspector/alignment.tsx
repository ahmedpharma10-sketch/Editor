/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { For } from "solid-js";

import { Icon } from "@/components/ui/icon";
import { useEngine } from "@/context/engine";
import { isScene, setComponent } from "@/components/engine";
import { getParentEntity } from "@/components/engine/api";
import { invert2D, transformPoint } from "@/components/engine/math/aabb";
import { Or, query } from "bitecs";


const ALIGNMENT_ACTIONS = [
  /** Horizontal alignment */
  { 
    id: "align-left", 
    icon: "horizontal-align-left", 
    label: "Align left"
  },
  {
    id: "align-center-horizontal",
    icon: "horizontal-align-center",
    label: "Align center horizontally",
  },
  { 
    id: "align-right", 
    icon: "horizontal-align-right",
    label: "Align right"
  },
  /** Vertical alignment */
  { 
    id: "align-top", 
    icon: "vertical-align-top",
    label: "Align top"
  },
  {
    id: "align-center-vertical",
    icon: "vertical-align-center",
    label: "Align center vertically",
  },
  {
    id: "align-bottom",
    icon: "vertical-align-bottom",
    label: "Align bottom",
  },
  /** Distribute horizontally */
  {
    id: "distribute-horizontal",
    icon: "distribute-center-horizontal",
    label: "Distribute horizontally",
  },
  /** Distribute vertically */
  {
    id: "distribute-vertical",
    icon: "distribute-center-vertical",
    label: "Distribute vertically",
  },
] as const;

export type AlignmentAction = (typeof ALIGNMENT_ACTIONS)[number]["id"];

type Axis = "x" | "y";

type SelectionMask = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

export function Alignment() {
  const { world } = useEngine();
  const c = world.components;

  /**
   * Return selected entities that live directly inside a scene, plus top-level
   * entities (scenes themselves) which are parented to nothing / the root.
   */
  const getSelectedEids = () =>
    [...query(world, [c.Selected, Or(c.Geometry, c.Group)])].filter(
      (eid) => {
        const parentEid = getParentEntity(world, eid);
        return parentEid === null || isScene(world, parentEid);
      }
    );

  const getSelectionMask = (): SelectionMask | null => {
    const eids = getSelectedEids();
    if (eids.length === 0) return null;

    const minX = Math.min(...eids.map((eid) => c.WorldBounds.minX[eid]));
    const minY = Math.min(...eids.map((eid) => c.WorldBounds.minY[eid]));
    const maxX = Math.max(...eids.map((eid) => c.WorldBounds.maxX[eid]));
    const maxY = Math.max(...eids.map((eid) => c.WorldBounds.maxY[eid]));

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
    };
  };

  /** Convert a world-space delta into the parent's local space for the given entity. */
  const worldDeltaToParentLocal = (eid: number, dx: number, dy: number) => {
    const parentEid = getParentEntity(world, eid);

    const parentMat =
      parentEid !== null
        ? {
            a: c.WorldTransform.a[parentEid],
            b: c.WorldTransform.b[parentEid],
            c: c.WorldTransform.c[parentEid],
            d: c.WorldTransform.d[parentEid],
            e: c.WorldTransform.e[parentEid],
            f: c.WorldTransform.f[parentEid],
          }
        : {
            a: world.camera.a * world.resolution,
            b: world.camera.b * world.resolution,
            c: world.camera.c * world.resolution,
            d: world.camera.d * world.resolution,
            e: world.camera.e * world.resolution,
            f: world.camera.f * world.resolution,
          };

    const inv = invert2D(parentMat);
    const localOrigin = transformPoint(inv, 0, 0);
    const localDelta = transformPoint(inv, dx, dy);

    return {
      x: localDelta.x - localOrigin.x,
      y: localDelta.y - localOrigin.y,
    };
  };

  const moveNodeByWorldDelta = (eid: number, dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;

    const localDelta = worldDeltaToParentLocal(eid, dx, dy);
    if (!localDelta) return;

    setComponent(world, eid, c.Position, {
      x: c.Position.x[eid] + localDelta.x,
      y: c.Position.y[eid] + localDelta.y,
    });
  };

  /**
   * Align every selected item relative to the selection's bounding box.
   * A single selected item is a no-op (the selection bounds equal the item).
   */
  const alignSelection = (action: AlignmentAction) => {
    const eids = getSelectedEids();
    if (eids.length < 2) return;

    const mask = getSelectionMask();
    if (!mask) return;

    world.history.transaction("Align selection", () => {
      for (const eid of eids) {
        const boundsWidth = c.WorldBounds.maxX[eid] - c.WorldBounds.minX[eid];
        const boundsHeight = c.WorldBounds.maxY[eid] - c.WorldBounds.minY[eid];

        let targetMinX = c.WorldBounds.minX[eid];
        let targetMinY = c.WorldBounds.minY[eid];

        if (action === "align-left") {
          targetMinX = mask.minX;
        }
        if (action === "align-center-horizontal") {
          targetMinX = mask.centerX - boundsWidth / 2;
        }
        if (action === "align-right") {
          targetMinX = mask.maxX - boundsWidth;
        }
        if (action === "align-top") {
          targetMinY = mask.minY;
        }
        if (action === "align-center-vertical") {
          targetMinY = mask.centerY - boundsHeight / 2;
        }
        if (action === "align-bottom") {
          targetMinY = mask.maxY - boundsHeight;
        }

        moveNodeByWorldDelta(eid, targetMinX - c.WorldBounds.minX[eid], targetMinY - c.WorldBounds.minY[eid]);
      }
    });
  };

  const distributeSelection = (axis: Axis) => {
    const eids = getSelectedEids();
    if (eids.length < 3) return;

    const mask = getSelectionMask();
    if (!mask) return;

    const isHorizontal = axis === "x";
    const sorted = [...eids].sort((a, b) =>
      isHorizontal
        ? c.WorldBounds.minX[a] - c.WorldBounds.minX[b]
        : c.WorldBounds.minY[a] - c.WorldBounds.minY[b]
    );

    const totalSize = sorted.reduce(
      (sum, eid) =>
        sum +
        (isHorizontal
          ? c.WorldBounds.maxX[eid] - c.WorldBounds.minX[eid]
          : c.WorldBounds.maxY[eid] - c.WorldBounds.minY[eid]),
      0
    );
    const maskSize = isHorizontal ? mask.width : mask.height;
    const gap = (maskSize - totalSize) / (sorted.length - 1);

    let cursor = isHorizontal ? mask.minX : mask.minY;

    world.history.transaction("Distribute entities", () => {
      for (const eid of sorted) {
        const currentMin = isHorizontal ? c.WorldBounds.minX[eid] : c.WorldBounds.minY[eid];
        const size = isHorizontal
          ? c.WorldBounds.maxX[eid] - c.WorldBounds.minX[eid]
          : c.WorldBounds.maxY[eid] - c.WorldBounds.minY[eid];
        const delta = cursor - currentMin;

        if (isHorizontal) {
          moveNodeByWorldDelta(eid, delta, 0);
        } else {
          moveNodeByWorldDelta(eid, 0, delta);
        }

        cursor += size + gap;
      }
    }
    );
  };

  const handleAction = (action: AlignmentAction) => {
    if (action === "distribute-horizontal") {
      distributeSelection("x");
      return;
    }

    if (action === "distribute-vertical") {
      distributeSelection("y");
      return;
    }

    alignSelection(action);
  };

  return (
    <div
      role="toolbar"
      aria-label="Alignment"
      class="flex h-12 items-center gap-2 border-t border-border px-4"
    >
      <For each={ALIGNMENT_ACTIONS}>
        {(item) => (
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground w-5.5 h-7"
              onClick={() => handleAction(item.id)}
            >
              <Icon name={item.icon} />
            </TooltipTrigger>
            <TooltipContent>{item.label}</TooltipContent>
          </Tooltip>
        )}
      </For>
    </div>
  );
}
