/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Dragging rows onto other rows. Where a drop lands is worked out from the
 * DOM — the rows are what the pointer is actually over — and the move itself
 * is a reparent through the editor, so the elements move in the file.
 *
 * Order comes out of the file too: a parent's children are drawn in the order
 * they are written, so moving an element in front of another is the whole of
 * reordering. Nothing here has to renumber anything.
 */

import {
  Expanded,
  Geometry,
  Group,
  Selected,
  buildTimelineLayers,
  getActiveEntity,
  getEntityChildren,
  getEntityTree,
  getParentEntity,
  isGroup,
} from '@diffusionstudio/runtime';
import { Or } from 'koota';

import { getDocumentEditor } from '@/engine/editor';
import { getRowEntity } from './node';

import type { Entity, World } from 'koota';
import type { TimelineNode } from '@diffusionstudio/runtime';
import type { DropPosition, LayerDragState } from './context';

/**
 * The row under the pointer and which part of it, or null over anything else.
 * A row already being dragged is not a target: dropping a thing next to
 * itself means nothing.
 */
export function findDropTarget(event: PointerEvent): LayerDragState | null {
  const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
  const row = element?.closest<HTMLElement>('[data-layer-row]');
  if (!row) return null;

  const target = getRowEntity(row);
  if (!target?.isAlive() || target.has(Selected)) return null;

  const rect = row.getBoundingClientRect();
  const offset = event.clientY - rect.top;

  // A group can be dropped into as well as beside, so it gives up its middle
  // to that. Everything else is one edge or the other.
  let position: DropPosition;
  if (isGroup(target)) {
    if (offset < rect.height * 0.25) position = 'above';
    else if (offset > rect.height * 0.75) position = 'below';
    else position = 'inside';
  } else {
    position = offset < rect.height * 0.5 ? 'above' : 'below';
  }

  // Below one row is above the next, and 'above' is the only one the drop
  // itself can express (it anchors on the row it goes in front of). The last
  // row has no next, so it keeps its 'below'.
  if (position === 'below') {
    const next = nextDroppableRow(row);
    if (next) return { target: next, position: 'above' };
  }

  return { target, position };
}

/** The first row after `row` that is not itself being dragged. */
function nextDroppableRow(row: HTMLElement): Entity | undefined {
  const rows = [...document.querySelectorAll<HTMLElement>('[data-layer-row]')];

  for (const candidate of rows.slice(rows.indexOf(row) + 1)) {
    const entity = getRowEntity(candidate);
    if (entity?.isAlive() && !entity.has(Selected)) return entity;
  }

  return undefined;
}

/**
 * Moves the selection to where the drag ended: inside the target, or in front
 * of it among its siblings. Only the tops of the selected subtrees move —
 * a selected node under another selected node travels with it.
 */
export function dropSelection(world: World, drop: LayerDragState | null): void {
  if (!drop) return;

  const editor = getDocumentEditor(world);
  const { target, position } = drop;

  const parent = position === 'inside' ? target : getParentEntity(target);
  if (!parent) return;

  const selection = new Set(world.query(Selected, Or(Geometry, Group)));
  // Top to bottom as the column shows them, so what they were relative to
  // each other survives the move. The query's own order means nothing.
  const moving = columnOrder(world).filter((entity) => {
    if (!selection.has(entity)) return false;
    for (let ancestor = getParentEntity(entity); ancestor; ancestor = getParentEntity(ancestor)) {
      if (selection.has(ancestor)) return false;
    }
    return true;
  });
  if (moving.length === 0) return;

  // Into its own subtree is not a move, it is a loop.
  for (const entity of moving) {
    if (getEntityTree(world, entity).includes(parent)) return;
  }

  // Dropped into a collapsed group, the rows would land out of sight.
  if (position === 'inside' && !parent.has(Expanded)) {
    editor.editProperty(parent, 'expanded', true);
  }

  // The column reads bottom-up: the last child of an element is drawn on top
  // of its siblings, so it is the topmost row. Dropping *above* a row
  // therefore means going *after* it in the file, which is in front of
  // whatever was written next — and the rows go in bottom one first, so each
  // lands in front of the one before it and their order comes out as it was.
  const anchor = position === 'inside' ? undefined : nextSibling(world, parent, target);

  for (const entity of [...moving].reverse()) {
    editor.reparent(entity, parent, anchor);
  }
}

/** Every clip row of the scene on show, top to bottom as the column has them. */
function columnOrder(world: World): Entity[] {
  const scene = getActiveEntity(world);
  if (scene === null) return [];

  const ordered: Entity[] = [];

  const walk = (nodes: TimelineNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'geometry') ordered.push(node.entity);
      walk(node.children);
    }
  };

  walk(buildTimelineLayers(world, scene));

  return ordered;
}

/** The element written after `entity` among `parent`'s children, if any. */
function nextSibling(world: World, parent: Entity, entity: Entity): Entity | undefined {
  const siblings = getEntityChildren(world, parent);
  return siblings[siblings.indexOf(entity) + 1];
}
