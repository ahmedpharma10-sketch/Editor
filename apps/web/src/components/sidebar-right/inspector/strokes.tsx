/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createSignal } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ControlRow } from "@/components/ui/control-group";
import { ColorOpacityPicker } from "@/components/ui/color-opacity-picker";
import { ColorOpacityRow } from "@/components/ui/color-opacity-row";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorTitle,
} from "@/components/ui/floating-inspector";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { ControlledTextField } from "@/components/ui/text-field";
import { SegmentedIconTabs } from "@/components/ui/segmented-icon-tabs";
import { Keyframe } from "@/components/ui/keyframe";
import { useHas, useTrait, useWorld } from "@diffusionstudio/koota-solid";
import { Stroke as StrokeElement } from "@diffusionstudio/reconciler";
import { Cache, Computed, Hidden, StrokeJoin, StrokeStyle, colorToHex } from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { syncKeyframe } from "@/engine/keyframes";

import type { StrokeJoin as StrokeJoinName } from "@diffusionstudio/jsx";
import type { Entity, World } from "koota";
import type { DocumentEditor } from "@/engine/editor";

const JOIN_SEGMENTS: { value: StrokeJoinName; icon: string; label: string }[] = [
  { value: "miter", icon: "line-join-miter", label: "Miter" },
  { value: "bevel", icon: "line-join-bevel", label: "Bevel" },
  { value: "round", icon: "line-join-round", label: "Round" },
];

const JOIN_NAMES: Record<StrokeJoin, StrokeJoinName> = {
  [StrokeJoin.MITER]: "miter",
  [StrokeJoin.BEVEL]: "bevel",
  [StrokeJoin.ROUND]: "round",
};

/** `<stroke>`'s defaults; a control left at one of these unsets its prop. */
const DEFAULT_COLOR = "#000000";
const DEFAULT_WIDTH = 1;
const DEFAULT_MITER_LIMIT = 10;

// Stable identity, so a node without strokes does not resample every tick.
const NO_STROKES: Entity[] = [];

type StrokesSettingsProps = {
  selection: Entity[];
};

/**
 * The `<stroke>` children of the selected node, in paint order (the list is
 * shown topmost first, so the last element in the file is the first row).
 * Each stroke is its own element with its own paint *and* its own line style
 * (`width`/`join`/`miterLimit`), which is why the style controls sit under
 * each row rather than once per node as they did while the style belonged to
 * the node. `cap` has no control yet: it only shows on open paths (text
 * glyphs) and there are no icons for it.
 */
export function StrokesSettings(props: StrokesSettingsProps) {
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  let anchorRef!: HTMLDivElement;

  const [picked, setPicked] = createSignal<Entity>();

  // Cache is derived state, written without change events.
  const strokes = useDerived(() => entity().get(Cache)?.strokes ?? NO_STROKES);

  const handleAppendStroke = () => {
    editor.insertElement(entity(), () => <StrokeElement color={DEFAULT_COLOR} />);
  };

  // Read back off the list, so the picker closes with the stroke it edits.
  const editing = createMemo(() => {
    const stroke = picked();
    return stroke !== undefined && strokes().includes(stroke) ? stroke : undefined;
  });

  /**
   * Swaps `stroke` with its neighbour, later in the file (`direction` 1, on
   * top) or earlier. Written as a swap because a move needs an anchor:
   * `reparent` appends without one, and refuses an append into the parent the
   * element already has.
   */
  const handleReorderStroke = (stroke: Entity, direction: number) => {
    const siblings = strokes();
    const index = siblings.indexOf(stroke);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= siblings.length) return;

    if (direction > 0) {
      editor.reparent(siblings[target]!, entity(), stroke);
    } else {
      editor.reparent(stroke, entity(), siblings[target]!);
    }
  };

  return (
    <>
      <PanelSection
        title="Stroke"
        ref={anchorRef}
        actions={
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={handleAppendStroke}
            >
              <Icon name="plus-add" />
            </TooltipTrigger>
            <TooltipContent>Add stroke</TooltipContent>
          </Tooltip>
        }
      >
        <For each={strokes().toReversed()}>
          {(stroke, index) => (
            <StrokeControls
              stroke={stroke}
              separated={index() > 0}
              onSelect={() => setPicked(stroke)}
              onRemove={() => editor.remove(stroke)}
              onMoveUp={() => handleReorderStroke(stroke, 1)}
              onMoveDown={() => handleReorderStroke(stroke, -1)}
            />
          )}
        </For>
      </PanelSection>

      <Show when={editing() !== undefined}>
        <StrokePicker
          stroke={editing()!}
          anchorRef={anchorRef}
          onClose={() => setPicked(undefined)}
        />
      </Show>
    </>
  );
}

/** Writes `color` and reports it; a stroke's color is required, never unset. */
function editColor(world: World, editor: DocumentEditor, stroke: Entity, value: number) {
  const color = colorToHex(value);
  editor.editProperty(stroke, "color", color);
  syncKeyframe(world, editor, stroke, "color", color);
}

function editOpacity(world: World, editor: DocumentEditor, stroke: Entity, value: number) {
  const opacity = Math.round(value * 100) / 100;
  editor.editProperty(stroke, "opacity", opacity === 1 ? false : opacity);
  syncKeyframe(world, editor, stroke, "opacity", opacity);
}

type StrokeControlsProps = {
  stroke: Entity;
  separated: boolean;
  onSelect(): void;
  onRemove(): void;
  onMoveUp(): void;
  onMoveDown(): void;
};

function StrokeControls(props: StrokeControlsProps) {
  const world = useWorld();
  const editor = useEditor();

  const color = useDerived(() => props.stroke.get(Computed)?.color ?? 0);
  const opacity = useDerived(() => props.stroke.get(Computed)?.opacity ?? 1);
  const width = useDerived(() => props.stroke.get(Computed)?.strokeWidth ?? DEFAULT_WIDTH);

  const style = useTrait(() => props.stroke, StrokeStyle);
  const hidden = useHas(() => props.stroke, Hidden);

  const join = createMemo(() => JOIN_NAMES[style()?.join ?? StrokeJoin.MITER]);
  const miterLimit = () => style()?.miterLimit ?? DEFAULT_MITER_LIMIT;

  const handleWidthChange = (value: number) => {
    // Unlike a node's width this is the line width, not `resizeEntity`, so
    // there is no track of its own to mint and the sync belongs after.
    editor.editProperty(props.stroke, "width", value === DEFAULT_WIDTH ? false : value);
    syncKeyframe(world, editor, props.stroke, "width", value);
  };

  const handleJoinChange = (value: StrokeJoinName) => {
    editor.editProperty(props.stroke, "join", value === "miter" ? false : value);
  };

  const handleMiterLimitChange = (value: number) => {
    editor.editProperty(props.stroke, "miterLimit", value === DEFAULT_MITER_LIMIT ? false : value);
  };

  const toggleHidden = () => {
    editor.editProperty(props.stroke, "hidden", !hidden());
  };

  return (
    <div
      class="flex flex-col gap-2"
      classList={{ "border-t border-border pt-3": props.separated }}
    >
      <ContextMenu>
        <ContextMenuTrigger<typeof ControlRow>
          as={ControlRow}
          label="Stroke"
          class={hidden() ? "opacity-50" : undefined}
        >
          <ColorOpacityRow
            color={color()}
            onChangeColor={(value) => editColor(world, editor, props.stroke, value)}
            opacity={opacity()}
            onChangeOpacity={(value) => editOpacity(world, editor, props.stroke, value)}
            onClick={props.onSelect}
            keyframe={<Keyframe target={props.stroke} property="opacity" />}
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={props.onMoveUp}>Move Up</ContextMenuItem>
          <ContextMenuItem onSelect={props.onMoveDown}>Move Down</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={toggleHidden}>
            {hidden() ? "Unhide" : "Hide"}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={props.onRemove}>Remove</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <ControlRow label="Weight">
        <ControlledTextField
          value={width()}
          onNumber={handleWidthChange}
          step={1}
          min={0}
          autoSelect
          limitEvents
          keyframe={<Keyframe target={props.stroke} property="width" />}
        />
      </ControlRow>

      <ControlRow label="Join">
        <SegmentedIconTabs
          value={join}
          onChange={handleJoinChange}
          items={JOIN_SEGMENTS}
          buttonClass="transition-colors"
          iconClass="size-3.5 text-muted-foreground"
        />
      </ControlRow>

      <ControlRow label="Miter">
        <ControlledTextField
          value={miterLimit()}
          onNumber={handleMiterLimitChange}
          step={1}
          min={1}
          autoSelect
          limitEvents
        />
      </ControlRow>
    </div>
  );
}

type StrokePickerProps = {
  stroke: Entity;
  anchorRef: HTMLElement;
  onClose(): void;
};

/**
 * A stroke's paint. Solid only: `<stroke>` takes a `color` and takes no paint
 * children, so there is no gradient or asset tab to offer.
 */
function StrokePicker(props: StrokePickerProps) {
  const world = useWorld();
  const editor = useEditor();

  const color = useDerived(() => props.stroke.get(Computed)?.color ?? 0);
  const opacity = useDerived(() => props.stroke.get(Computed)?.opacity ?? 1);

  return (
    <FloatingInspector open anchorRef={props.anchorRef}>
      <FloatingInspectorHeader>
        <FloatingInspectorTitle>Color</FloatingInspectorTitle>
        <div class="ml-auto">
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={props.onClose}
            >
              <Icon name="close-remove" class="size-6" />
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </div>
      </FloatingInspectorHeader>
      <FloatingInspectorContent class="p-0">
        <ColorOpacityPicker
          color={color()}
          opacity={opacity()}
          onColorChange={(value) => editColor(world, editor, props.stroke, value)}
          onOpacityChange={(value) => editOpacity(world, editor, props.stroke, value)}
          keyframeTarget={props.stroke}
        />
      </FloatingInspectorContent>
    </FloatingInspector>
  );
}
