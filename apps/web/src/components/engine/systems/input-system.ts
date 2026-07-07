/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { assert, isInputTarget } from "@/utils";
import { addComponent, removeComponent } from "bitecs";
import { pointInQuad } from "../math";
import { isPointerInEntity } from "../utils";
import { ToolType } from "../components";
import { clearComponent } from "../api/events";

import type { EngineWorld } from "../api/world";
import type { CustomPointerEvent, CustomPointerEventType, HitRegion } from "../types/input";

export const isPanMode = (world: EngineWorld) =>
  world.selection.tool === ToolType.HAND || world.keys.has(' ');


const events: CustomPointerEvent[] = []
let initializedProject = null as string | null;

function addEventListeners(world: EngineWorld) {
  const canvas = world.canvas;
  const projectId = world.projectId;

  if (initializedProject === projectId || !canvas) return;
  assert(canvas instanceof HTMLCanvasElement, 'Canvas must be an HTMLCanvasElement');

  initializedProject = projectId;

  const pushEvent = (type: CustomPointerEventType, event: PointerEvent | MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio;

    events.push({
      type,
      clientX: (event.clientX - rect.left) * dpr,
      clientY: (event.clientY - rect.top) * dpr,
      button: event.button,
    });
  }

  // click/dblclick listeners
  canvas.addEventListener('click', (event) => pushEvent('click', event));
  canvas.addEventListener('dblclick', (event) => pushEvent('dblclick', event));

  // pointer down/up/cancel listeners
  canvas.addEventListener('pointerdown', (event) => pushEvent('pointerdown', event));
  canvas.addEventListener('pointermove', (event) => pushEvent('pointermove', event));

  // make globally
  window.addEventListener('pointerup', (event) => pushEvent('pointerup', event));
  window.addEventListener('pointercancel', (event) => pushEvent('pointerup', event));

  // keyboard listeners
  window.addEventListener('keydown', (event) => {
    if (isInputTarget(event)) return;

    world.keys.add(event.key.toLowerCase());

    if (event.key === 'Meta' || event.key === 'Control') {
      world.keys.add('mod');
    }
  });
  window.addEventListener('keyup', (event) => {
    world.keys.delete(event.key.toLowerCase());

    if (event.key === 'Meta' || event.key === 'Control') {
      world.keys.delete('mod');
    }
  });
}


let lastHoverRegion: HitRegion | null = null;
let lastDragRegion: HitRegion | null = null;

export function inputSystem(world: EngineWorld) {
  addEventListeners(world);
  const c = world.components;
  const panMode = isPanMode(world);

  for (const event of events) {
    world.pointer.clientX = event.clientX;
    world.pointer.clientY = event.clientY;
    world.pointer.button = event.button;

    if (event.type === 'pointerdown') {
      world.pointer.state = 'pressed';
      world.pointer.dragStartX = event.clientX;
      world.pointer.dragStartY = event.clientY;
    } else if (event.type === 'pointerup') {
      world.pointer.state = 'lifted';
    }

    if (panMode) continue;

    const region = hitTest(world, event);

    // handle pointer enter/leave callbacks
    if (event.type === 'pointermove') {
      const lastTarget = lastHoverRegion?.target.id ?? null;
      const currentTarget = region?.target.id ?? null;

      if (lastTarget !== currentTarget && lastTarget !== null) {
        if (lastHoverRegion?.target.kind === 'entity') {
          removeComponent(world, lastHoverRegion.target.id, c.Hovering);
        }
        lastHoverRegion?.callback(world, {
          ...event,
          target: lastHoverRegion.target,
          type: 'pointerleave' as const,
        })
      }

      if (currentTarget !== null && currentTarget !== lastTarget) {
        if (region?.target.kind === 'entity') {
          addComponent(world, region.target.id, c.Hovering);
        }
        region?.callback(world, {
          ...event,
          target: region.target,
          type: 'pointerenter' as const,
        })
      }

      lastHoverRegion = region;
    }

    // handle drag start/drag/end callbacks
    if (event.type === 'pointerdown') {
      if (region?.target.kind === 'entity') {
        addComponent(world, region.target.id, c.Dragging);
      }
      region?.callback(world, {
        ...event,
        target: region.target,
        type: 'dragstart' as const,
      });
      lastDragRegion = region;
    }

    if (event.type === 'pointermove') {
      lastDragRegion?.callback(world, {
        ...event,
        target: lastDragRegion.target,
        type: 'drag' as const,
      });
    }

    if (event.type === 'pointerup') {
      if (lastDragRegion?.target.kind === 'entity'){
        removeComponent(world, lastDragRegion.target.id, c.Dragging);
      }
      lastDragRegion?.callback(world, {
        ...event,
        target: lastDragRegion.target,
        type: 'dragend' as const,
      });
      lastDragRegion = null;
    }

    // all other callbacks
    region?.callback(world, { ...event, target: region.target });
  }

  if (panMode) {
    world.cursor.update(world.pointer.state === 'pressed' ? 'grabbing' : 'grab');
    clearComponent(world, c.Hovering, false);
    clearComponent(world, c.Dragging, false);
  }

  events.length = 0;
  world.hitRegions.length = 0;
}

function hitTest(world: EngineWorld, event: CustomPointerEvent): HitRegion | null {
  const x = event.clientX;
  const y = event.clientY;

  for (let i = world.hitRegions.length - 1; i >= 0; i--) {
    const hitRegion = world.hitRegions[i];

    if (hitRegion.target.kind === 'entity') {
      const eid = hitRegion.target.id;
      if (isPointerInEntity(world, eid, { x, y })) {
        return hitRegion;
      }
    } else if (pointInQuad(x, y, hitRegion.target.quad)) {
      return hitRegion;
    }
  }

  return null;
}
