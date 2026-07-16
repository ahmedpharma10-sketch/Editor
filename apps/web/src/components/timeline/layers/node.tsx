/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createSignal, Show } from 'solid-js';
import { hasComponent, Not, Or, query } from 'bitecs';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from '@/components/ui/tooltip';
import { DEFAULT_CLIP_HEIGHT, MAX_CLIP_HEIGHT, MIN_CLIP_HEIGHT } from '@/components/engine/timeline/config';
import { useEngine } from '@/context/engine';
import {
  useEntityState,
  useEntityTag,
  deleteEntity,
  addComponent,
  removeComponent,
  setComponent,
  reorderEntity,
  getParentEntity,
  getEntityTree,
  appendChild,
  removeChild,
  sortByItemIndex,
  ChildOf,
  type EngineWorld,
  isScene,
  isGroup,
  findGeometryAsset,
  clearComponent,
  isMask,
  isCaption,
  isText,
  isAdjustmentLayer,
  isSequence,
} from '@/components/engine';
import { NESTED_INDENT_PX } from './config';
import { useLayerContext, type DropPosition, type LayerDragState } from './context';

import type { TimelineNode } from '@/components/engine/api/timeline-index';

type NodeLayerProps = {
  layer: TimelineNode;
  depth?: number;
  expanded: boolean;
  ancestorSelected: boolean;
}

const DRAG_THRESHOLD_PX = 4;

export function NodeLayer(props: NodeLayerProps) {
  const { world } = useEngine();

  const c = world.components;

  const depth = () => props.depth ?? 0;

  const eid = () => props.layer.eid;


  const height = useEntityState(c.ClipHeight, eid, DEFAULT_CLIP_HEIGHT);

  const muted = useEntityTag(c.Muted, eid);
  const soloed = useEntityTag(c.Soloed, eid);
  const hidden = useEntityTag(c.Hidden, eid);
  const hovering = useEntityTag(c.Hovering, eid);
  const selected = useEntityTag(c.Selected, eid);
  const controlsVisible = createMemo(() => hovering() || muted() || soloed() || hidden());

  const [resizedId, setResizedId] = useLayerContext().resizedId;
  const [dragState, setDragState] = useLayerContext().dragState;

  const [editing, setEditing] = createSignal(false);
  let originalName = '';

  const canExpand = () => props.layer.expandable;
  const nameState = useEntityState(c.Name, eid);
  const name = createMemo(() => nameState() ?? `Layer ${eid()}`);
  const icon = createMemo(() => getLayerIcon(world, props.layer));

  const dropPosition = createMemo(() => {
    if (dragState()?.targetEid === props.layer.eid) {
      return dragState()?.position ?? null;
    }
    return null;
  });

  const toggleTag = (tag: typeof c.Muted) => {
    const eid = props.layer.eid;
    if (hasComponent(world, eid, tag)) {
      removeComponent(world, eid, tag);
    } else {
      addComponent(world, eid, tag);
    }
  }

  const toggleMuted = (e?: Event) => {
    e?.stopPropagation();
    toggleTag(c.Muted);
  };
  const toggleHidden = (e?: Event) => {
    e?.stopPropagation();
    toggleTag(c.Hidden);
  };
  const toggleExpanded = (e?: Event) => {
    e?.stopPropagation();
    toggleTag(c.Expanded);
  };

  const toggleSoloed = (e?: Event) => {
    e?.stopPropagation();
    const eid = props.layer.eid;

    const wasSoloed = hasComponent(world, eid, c.Soloed);

    clearComponent(world, c.Soloed, false);
    if (!wasSoloed) {
      addComponent(world, eid, c.Soloed);
    }
  }

  const handleSelect = (e: { shiftKey: boolean }) => {
    if (e.shiftKey) {
      addComponent(world, props.layer.eid, c.Selected, false);
    } else {
      clearComponent(world, c.Selected, false);
      addComponent(world, props.layer.eid, c.Selected, false);
    }
  }

  const handleRowPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (resizedId() != null) return;
    if ((e.target as HTMLElement | null)?.closest('button')) return;

    handleSelect(e);

    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;

    const onMove = (ev: PointerEvent) => {
      const deltaX = Math.abs(ev.clientX - startX);
      const deltaY = Math.abs(ev.clientY - startY);

      if (!dragging && (deltaX > DRAG_THRESHOLD_PX || deltaY > DRAG_THRESHOLD_PX)) {
        dragging = true;
      }

      if (dragging) {
        setDragState(findClosestLayer(world, ev));
      }
    };

    const onUp = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);

      if (!dragging) return;

      dropSelection(world, findClosestLayer(world, ev));

      setDragState(null);
      clearComponent(world, c.Selected, false);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  let startY = 0;
  let startHeight = 0;

  const handleResizeStart = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startY = e.clientY;
    startHeight = height();
    setResizedId(props.layer.eid);

    document.addEventListener('pointermove', handleResizeMove);
    document.addEventListener('pointerup', handleResizeEnd);
  }

  const handleResizeMove = (e: PointerEvent) => {
    const deltaY = e.clientY - startY;
    const newHeight = Math.max(MIN_CLIP_HEIGHT, Math.min(MAX_CLIP_HEIGHT, startHeight + deltaY));
    setComponent(world, props.layer.eid, c.ClipHeight, newHeight);
  }

  const handleResizeEnd = () => {
    setResizedId(null);
    document.removeEventListener('pointermove', handleResizeMove);
    document.removeEventListener('pointerup', handleResizeEnd);
  }

  const handleRemove = () => deleteEntity(world, props.layer.eid);
  const handleReorder = (target: 'front' | 'back') => reorderEntity(world, props.layer.eid, target);

  const handlePointerEnter = () => {
    clearComponent(world, c.Hovering, false);
    addComponent(world, props.layer.eid, c.Hovering, false);
  }
  const handlePointerLeave = () => {
    clearComponent(world, c.Hovering, false);
    removeComponent(world, props.layer.eid, c.Hovering, false);
  }

  const startEditing = () => {
    originalName = c.Name[eid()] ?? '';
    world.history.startTransaction('Rename layer');
    setEditing(true);
  };

  const finishEditing = (input: HTMLInputElement) => {
    if (!editing()) return;
    if (!input.value.trim()) {
      setComponent(world, eid(), c.Name, originalName);
    }
    world.history.commitTransaction();
    setEditing(false);
  };

  const handleNameInput = (e: InputEvent) => {
    const input = e.currentTarget as HTMLInputElement;
    setComponent(world, eid(), c.Name, input.value ?? '');
  };

  const handleNameKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    const input = e.currentTarget as HTMLInputElement;
    if (e.key === 'Escape') {
      setComponent(world, eid(), c.Name, originalName);
      input.blur();
    } else if (e.key === 'Enter') {
      input.blur();
    }
  };

  const mountNameInput = (input: HTMLInputElement) => {
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        as="div"
        class="w-full text-muted-foreground group relative select-none"
        data-layer-eid={props.layer.eid}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handleRowPointerDown}
        classList={{
          'bg-accent': selected(),
          'bg-accent/70': !selected() && hovering() && resizedId() == null,
          'bg-accent/40': !selected() && !(hovering() && resizedId() == null) && props.ancestorSelected,
        }}
        style={{ height: height() + 'px' }}
      >
        <div class="w-full pl-0.5 pr-2 flex items-center justify-between h-full">
          <div
            data-layer-label
            class="flex-1 min-w-0 overflow-hidden"
            style={{
              'mask-image': controlsVisible() && !editing() ? 'linear-gradient(to right, #000 calc(100% - 1.25rem), transparent)' : undefined,
              '-webkit-mask-image': controlsVisible() && !editing() ? 'linear-gradient(to right, #000 calc(100% - 1.25rem), transparent)' : undefined,
            }}
          >
            <div
              class="flex items-center gap-0.5 w-max"
              style={{
                'padding-left': `${depth() * NESTED_INDENT_PX}px`,
                transform: editing() ? 'none' : 'translateX(calc(var(--layer-x, 0px) * -1))',
              }}
            >
              <button
                disabled={!canExpand()}
                onClick={toggleExpanded}
                class="size-4 shrink-0 flex items-center justify-center overflow-clip invisible group-hover/layers:visible focus-ring rounded-sm">
                <Show when={canExpand()}>
                  <Icon name={props.expanded ? "chevron-down" : "chevron-right"} class="size-6 hover:text-foreground" />
                </Show>
              </button>
              <div class="size-4 shrink-0 flex items-center justify-center overflow-clip mr-0.5">
                <Icon name={icon()} class="size-6" />
              </div>
              <Show
                when={editing()}
                fallback={
                  <span class="text-xs px-0.5 shrink-0 whitespace-nowrap text-foreground" onDblClick={startEditing}>
                    {name()}
                  </span>
                }
              >
                <input
                  ref={mountNameInput}
                  type="text"
                  class="text-xs bg-input border border-primary rounded-sm outline-none px-0.5 w-32 text-foreground"
                  value={name()}
                  onInput={handleNameInput}
                  onKeyDown={handleNameKeyDown}
                  onBlur={(e) => finishEditing(e.currentTarget)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onDblClick={(e) => e.stopPropagation()}
                />
              </Show>
            </div>
          </div>

          <div
            class="items-center flex gap-0.5 shrink-0 overflow-hidden group-hover:w-auto"
            classList={{
              'hidden': resizedId() != null,
              'w-0': !(muted() || soloed() || hidden()),
              'w-auto': muted() || soloed() || hidden(),
            }}
          >
            <Tooltip placement="bottom">
              <TooltipTrigger
                as={Button}
                variant={muted() ? "on" : "ghost"}
                size="icon"
                class="invisible group-hover:visible"
                style={{ visibility: muted() ? 'visible' : undefined }}
                onClick={toggleMuted}
              >
                <Icon name="mute" class="size-6" />
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent>{muted() ? "Unmute" : "Mute"}</TooltipContent>
              </TooltipPortal>
            </Tooltip>
            <Tooltip placement="bottom">
              <TooltipTrigger
                as={Button}
                variant={soloed() ? "on" : "ghost"}
                size="icon"
                class="invisible group-hover:visible"
                style={{ visibility: soloed() ? 'visible' : undefined }}
                onClick={toggleSoloed}
              >
                <Icon name="solo" class="size-6" />
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent>{soloed() ? "Unsolo" : "Solo"}</TooltipContent>
              </TooltipPortal>
            </Tooltip>
            <Tooltip placement="bottom">
              <TooltipTrigger
                as={Button}
                variant="ghost"
                size="icon"
                class="invisible group-hover:visible"
                onClick={toggleHidden}
                style={{ visibility: hidden() ? 'visible' : undefined }}
              >
                <Show when={!hidden()} fallback={<Icon name="eye-off" class="size-6" />}>
                  <Icon name="eye-on" class="size-6" />
                </Show>
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent>{hidden() ? "Show" : "Hide"}</TooltipContent>
              </TooltipPortal>
            </Tooltip>
          </div>
        </div>

        {/* Resize handle at the bottom */}
        <div
          class="absolute bottom-0 left-0 right-0 h-[3px] cursor-ns-resize translate-y-0.5 z-20 group/resize"
          classList={{ 'hidden': dragState() !== null }}
          onPointerDown={handleResizeStart}
        >
          <div
            class="absolute left-0 right-0 top-px h-px transition-colors group-hover/resize:bg-primary"
            classList={{ 'bg-primary': resizedId() === props.layer.eid }}
          />
        </div>

        {/* Drag-to-reparent drop indicators */}
        <Show when={dropPosition() === 'above'}>
          <div class="pointer-events-none absolute top-0 left-0 right-0 h-[2px] bg-primary z-30" />
        </Show>
        <Show when={dropPosition() === 'below'}>
          <div class="pointer-events-none absolute bottom-0 left-0 right-0 h-[2px] bg-primary z-30" />
        </Show>
        <Show when={dropPosition() === 'inside'}>
          <div class="pointer-events-none absolute inset-0 ring-2 ring-inset ring-primary z-30" />
        </Show>
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent class="w-[160px]">
          <ContextMenuItem onSelect={toggleMuted}>
            {muted() ? 'Unmute' : 'Mute'}
          </ContextMenuItem>
          <ContextMenuItem onSelect={toggleSoloed}>
            {soloed() ? 'Unsolo' : 'Solo'}
          </ContextMenuItem>
          <ContextMenuItem onSelect={toggleHidden}>
            {hidden() ? 'Unhide' : 'Hide'}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => handleReorder('front')}>
            Bring to front
            <ContextMenuShortcut>]</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => handleReorder('back')}>
            Send to back
            <ContextMenuShortcut>[</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleRemove}>
            Remove
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  )
}

export function findClosestLayer(world: EngineWorld, ev: PointerEvent): LayerDragState | null {
  const c = world.components;

  const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
  const match = el?.closest('[data-layer-eid]') as HTMLElement | null;
  if (!match) return null;

  const targetEid = Number(match.dataset.layerEid);
  if (!Number.isFinite(targetEid)) return null;

  // Never drop relative to a row that is itself part of the dragged selection.
  if (hasComponent(world, targetEid, c.Selected)) return null;

  const rect = match.getBoundingClientRect();
  const relY = ev.clientY - rect.top;

  // Groups are containers, so their middle band is an `inside` (reparent-as-
  // child) zone — regardless of whether they're currently expanded. Everything
  // else only gets `above`/`below` sibling zones.
  let position: DropPosition;
  if (isGroup(world, targetEid)) {
    if (relY < rect.height * 0.25) position = 'above';
    else if (relY > rect.height * 0.75) position = 'below';
    else position = 'inside';
  } else {
    position = relY < rect.height * 0.5 ? 'above' : 'below';
  }

  if (position === 'below') {
    const next = nextDroppableRow(world, match);
    if (next !== null) {
      return { position: 'above', targetEid: next };
    }
  }

  return { position, targetEid };
}

/**
 * The eid of the first non-selected geometry/group row that follows `row` in
 * visual order, or null if `row` is the last droppable row. Sub-item and
 * keyframe rows don't carry `data-layer-eid` and are skipped.
 */
function nextDroppableRow(world: EngineWorld, row: HTMLElement): number | null {
  const c = world.components;
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-layer-eid]'));
  const idx = rows.indexOf(row);
  if (idx === -1) return null;

  for (let i = idx + 1; i < rows.length; i++) {
    const eid = Number(rows[i].dataset.layerEid);
    if (!Number.isFinite(eid)) continue;
    // Skip rows being dragged — they aren't valid drop anchors.
    if (hasComponent(world, eid, c.Selected)) continue;
    return eid;
  }

  return null;
}

/**
 * Reparent the entire geometry selection relative to a drop target.
 * - `inside` — selection becomes the last children of the target.
 * - `above` / `below` — selection becomes siblings of the target, in order.
 *
 * The selection's DFS order from the timeline index is preserved; descendants
 * of already-selected items are dropped (they move with the ancestor). The
 * operation is a no-op if the target sits inside the dragged subtree.
 */
function dropSelection(world: EngineWorld, target: LayerDragState | null) {
  if (!target || target.targetEid === null || target.position === null) return;

  const c = world.components;
  const targetEid = target.targetEid;
  const position = target.position;

  const newParent = position === 'inside'
    ? targetEid
    : getParentEntity(world, targetEid);
  if (newParent === null) return;

  // Collect the selection in DFS order, skipping descendants of items whose
  // ancestor is already selected — those move with their ancestor.
  const selection = new Set(query(world, [c.Selected, Or(c.Geometry, c.Group, c.AdjustmentLayer), Not(c.Deleted)]));
  if (selection.size === 0) return;

  const ordered: number[] = [];
  const walk = (nodes: TimelineNode[]) => {
    for (const node of nodes) {
      if (selection.has(node.eid)) {
        ordered.push(node.eid);
        continue;
      }
      walk(node.children);
    }
  };
  walk(world.timelineIndex().layers);
  if (ordered.length === 0) return;

  // Block cycles: target cannot lie inside any dragged entity's subtree.
  for (const eid of ordered) {
    if (getEntityTree(world, eid).includes(targetEid)) return;
  }

  world.history.transaction('Reparent layers', () => {
    // Dropping into a collapsed group would hide the moved items — expand it so
    // the result is visible.
    if (position === 'inside' && !hasComponent(world, newParent, c.Expanded)) {
      addComponent(world, newParent, c.Expanded);
    }

    // Reparent items whose current parent differs from the new parent.
    let reparented = false;
    for (const eid of ordered) {
      const currentParent = getParentEntity(world, eid);
      if (currentParent === newParent) continue;
      if (currentParent !== null) removeChild(world, eid, currentParent);
      appendChild(world, eid, newParent);
      reparented = true;
    }

    // Rebuild ItemIndex on the new parent's geometry siblings, inserting the
    // moved set at the position resolved from the drop target.
    //
    // The layers panel renders siblings top-to-bottom in *descending* ItemIndex
    // (the index builder sorts ascending then reverses), so all reasoning here
    // is done in that same top-to-bottom display order — `ordered` is already
    // collected top-to-bottom — and the indices are written back descending so
    // they survive the round-trip through the index builder.
    const siblings = [...query(world, [ChildOf(newParent), Not(c.Deleted), Or(c.Geometry, c.Group, c.AdjustmentLayer)])];
    siblings.sort(sortByItemIndex(world)).reverse();

    const movedSet = new Set(ordered);
    const rest = siblings.filter(eid => !movedSet.has(eid));

    let insertIndex: number;
    if (position === 'inside') {
      // Drop at the top of the target's children, directly beneath its row.
      insertIndex = 0;
    } else {
      const anchorPos = rest.indexOf(targetEid);
      if (anchorPos === -1) return;
      insertIndex = position === 'above' ? anchorPos : anchorPos + 1;
    }

    const newOrder = [...rest.slice(0, insertIndex), ...ordered, ...rest.slice(insertIndex)];

    // A reparent already pushed history and left the moved items carrying a
    // stale ItemIndex from their old parent, so their position in `siblings`
    // (sorted by that stale value) is meaningless — always rewrite indices in
    // that case. The order-equality check is only a valid no-op guard for a
    // pure same-parent reorder.
    let changed = reparented || newOrder.length !== siblings.length;
    for (let i = 0; !changed && i < newOrder.length; i++) {
      if (newOrder[i] !== siblings[i]) changed = true;
    }
    if (!changed) return;

    // Top of the display list gets the highest ItemIndex.
    const top = newOrder.length - 1;
    for (const [idx, sib] of newOrder.entries()) {
      setComponent(world, sib, c.ItemIndex, top - idx);
    }
  });
}

function getLayerIcon(world: EngineWorld, layer: TimelineNode) {
  if (isMask(world, layer.eid)) {
    return "mask-small"
  }

  if (isAdjustmentLayer(world, layer.eid)) {
    return "adjustment-layer"
  }

  if (isScene(world, layer.eid)) {
    return "scene-frame-small"
  }

  if (isSequence(world, layer.eid)) {
    return "timeline-sequence-small"
  }

  if (isGroup(world, layer.eid)) {
    return "group"
  }

  if (isCaption(world, layer.eid)) {
    return "captions-small"
  }

  if (isText(world, layer.eid)) {
    return "text-small"
  }

  const asset = findGeometryAsset(world, layer.eid);

  if (asset?.type === 'IMAGE') {
    return "image-small"
  }

  if (asset?.type === 'VIDEO') {
    return "video-small"
  }

  if (asset?.type === 'AUDIO') {
    return "audio-small"
  }

  return "rectangle-small"
}