/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createMemo, Show } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { IncrementDecrementControl } from "@/components/ui/increment-decrement-control";
import { PanelSection } from "@/components/ui/panel-section";
import { ControlledTextField } from "@/components/ui/text-field";
import {
  Checkbox,
  CheckboxControl,
  CheckboxInput,
  CheckboxLabel,
} from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { createStoredSignal } from "@/lib/store";
import { store } from "@/init";
import { useTrait, useWorld } from "@diffusionstudio/koota-solid";
import {
  Computed,
  End,
  FrameRate,
  Geometry,
  PlaybackRate,
  SourceOut,
  findGeometryAsset,
  framesToSeconds,
  getSourceFrameAt,
  getTimelineOrigin,
  isGroupLike,
  isScene,
  secondsToFrames,
} from "@diffusionstudio/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { useLibrary } from "@/engine/library";
import { setSequenceFrameRate } from "@/engine/asset-actions";

import type { DocumentEditor } from "@/engine/editor";
import type { Entity, World } from "koota";

type TimeAddon = "inOut" | "playbackRate";
type TimeAddons = Partial<Record<TimeAddon, boolean>>;

function formatAsTimecode(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00:00";

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remaining = totalSeconds % 60;

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`;
}

function parseTimeInput(value: string) {
  const input = value.trim();
  if (!input) return null;

  if (!input.includes(":")) {
    const seconds = Number.parseFloat(input);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return seconds;
  }

  const parts = input.split(":").map((part) => part.trim());
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (parts.some((part) => part.length === 0)) return null;

  const numbers = parts.map((part) => Number.parseFloat(part));
  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) return null;

  if (parts.length === 2) {
    const [minutes, seconds] = numbers;
    return minutes * 60 + seconds;
  }

  const [hours, minutes, seconds] = numbers;
  return hours * 3600 + minutes * 60 + seconds;
}

type TimeProp = 'start' | 'end' | 'sourceIn' | 'sourceOut';

/**
 * Writes a time prop from a frame count of this project; the file spells
 * times in seconds. `null` unsets it: the document drops the trait, and the
 * writer spells it as the attribute's absence (`false` is the one PropValue
 * it removes for). A `start` or `sourceIn` of 0 is unset too, since absence
 * is what 0 reads as on those.
 */
function editTime(world: World, editor: DocumentEditor, entity: Entity, name: TimeProp, frames: number | null) {
  const unset = frames === null || (frames === 0 && (name === 'start' || name === 'sourceIn'));
  const fps = world.get(FrameRate)?.value ?? 30;
  editor.editProperty(entity, name, unset ? false : framesToSeconds(frames, fps));
}

/**
 * Moves the node's in point to scene frame `frame`, keeping the rest of the
 * clip where it is: the runtime's `trimEntityIn`, as edits. The out point is
 * only implied while the node authors no End, so it is pinned first, or the
 * tail would follow the head; then Start moves and SourceIn rolls forward by
 * as much as the head lost.
 */
function trimIn(world: World, editor: DocumentEditor, entity: Entity, frame: number) {
  if (!entity.has(End)) {
    editTime(world, editor, entity, 'end', (entity.get(Computed)?.end ?? 0) - getTimelineOrigin(entity));
  }
  // Both read the origin, which the Start write moves.
  const start = frame - getTimelineOrigin(entity);
  const source = getSourceFrameAt(entity, frame);
  editTime(world, editor, entity, 'start', start);
  editTime(world, editor, entity, 'sourceIn', source);
}

/**
 * Moves the node's out point to scene frame `frame` (the runtime's
 * `trimEntityOut`, as edits). The source window follows only when the node
 * authors one; otherwise End alone says where the clip runs out.
 */
function trimOut(world: World, editor: DocumentEditor, entity: Entity, frame: number) {
  if (entity.has(SourceOut)) {
    editTime(world, editor, entity, 'sourceOut', getSourceFrameAt(entity, frame));
  }
  editTime(world, editor, entity, 'end', frame - getTimelineOrigin(entity));
}

type TimeSettingsProps = {
  selection: Entity[];
};

/**
 * Where the node sits on the timeline and for how long. Edits are time props
 * (`start`/`end`/`sourceIn`/`sourceOut`/`playbackRate`) written through the
 * editor; the resolved bounds are read from Computed, which the systems
 * write, hence `useDerived`.
 */
export function TimeSettings(props: TimeSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const library = useLibrary();
  const entity = () => props.selection[0]!;

  const [addons, setAddons] = createStoredSignal(
    store.define<TimeAddons>("time.addons", {})
  );

  const frameRate = useTrait(world, FrameRate);
  const fps = () => frameRate()?.value ?? 30;

  const playbackRate = useTrait(entity, PlaybackRate);
  const authoredEnd = useTrait(entity, End);
  const start = useDerived(() => entity().get(Computed)?.start ?? 0);
  const end = useDerived(() => entity().get(Computed)?.end ?? 0);

  const isContainer = createMemo(() => isGroupLike(entity()));
  // A container authoring an End spans that rather than fitting its children.
  const hasTrim = () => authoredEnd() !== undefined;

  const playbackRatePercent = createMemo(() => Math.round((playbackRate()?.value ?? 1) * 100));

  const startSeconds = createMemo(() => start() / fps());
  const endSeconds = createMemo(() => end() / fps());
  const durationSeconds = createMemo(() => endSeconds() - startSeconds());

  const supportsPlaybackRate = createMemo(() => entity().has(Geometry) && !isScene(entity()));

  // The sequence the node shows, if any; its frame rate is the asset's, so
  // it is sampled too (`library.update` changes it in place).
  const sequenceAsset = useDerived(() => {
    const asset = findGeometryAsset(world, entity());
    return asset?.type === 'SEQUENCE' ? asset : null;
  });
  const sequenceFrameRate = useDerived(() => sequenceAsset()?.frameRate ?? null);

  const handleAddAddon = (addon: TimeAddon) => setAddons({ ...addons(), [addon]: true });
  const handleRemoveAddon = (addon: TimeAddon) => setAddons({ ...addons(), [addon]: false });

  // The rate scales the source window onto the timeline around the node's
  // start, so the start stays put on its own; 1 is the default, so it is unset.
  const assignPlaybackRate = (rate: number) => {
    editor.editProperty(entity(), 'playbackRate', rate === 1 ? false : rate);
  };

  const handleInChange = (event: Event & { currentTarget: HTMLInputElement }) => {
    const parsed = parseTimeInput(event.currentTarget.value);
    if (parsed === null) return;
    trimIn(world, editor, entity(), secondsToFrames(parsed, fps()));
  };

  const handleOutChange = (event: Event & { currentTarget: HTMLInputElement }) => {
    const parsed = parseTimeInput(event.currentTarget.value);
    if (parsed === null) return;
    trimOut(world, editor, entity(), secondsToFrames(parsed, fps()));
  };

  const handleLengthChange = (durationSec: number) => {
    trimOut(world, editor, entity(), start() + secondsToFrames(durationSec, fps()));
  };

  const toggleTrim = (checked: boolean) => {
    if (checked) {
      trimIn(world, editor, entity(), start());
    } else {
      editTime(world, editor, entity(), 'end', null);
    }
  };

  const handleFrameRateChange = (newRate: number) => {
    const asset = sequenceAsset();
    const lib = library();
    if (!asset || !lib) return;
    setSequenceFrameRate(world, lib, asset, newRate);
  };

  return (
    <PanelSection
      title="Time"
      actions={
        <Show when={!addons().inOut || !addons().playbackRate}>
          <DropdownMenu placement="bottom-end">
            <Tooltip>
              <TooltipTrigger<typeof DropdownMenuTrigger>
                as={(triggerProps: object) => (
                  <DropdownMenuTrigger<typeof Button>
                    {...triggerProps}
                    as={(buttonProps) => (
                      <Button size="icon" variant="ghost" class="text-muted-foreground" {...buttonProps}>
                        <Icon name="plus-add" />
                      </Button>
                    )}
                  />
                )}
              />
              <TooltipContent>Add option</TooltipContent>
            </Tooltip>
            <DropdownMenuContent>
              <Show when={!addons().inOut}>
                <DropdownMenuItem onSelect={() => handleAddAddon("inOut")}>
                  In &amp; Out
                </DropdownMenuItem>
              </Show>
              <Show when={!addons().playbackRate && supportsPlaybackRate()}>
                <DropdownMenuItem onSelect={() => handleAddAddon("playbackRate")}>
                  Playback rate
                </DropdownMenuItem>
              </Show>
            </DropdownMenuContent>
          </DropdownMenu>
        </Show>
      }
    >
      <ControlRow
        label="Length"
        contentClass="grid grid-cols-2 gap-2 min-w-0"
      >
        <ControlledTextField
          value={Math.round(durationSeconds() * 10) / 10}
          min={0}
          step={0.1}
          unit="s"
          autoSelect
          limitEvents
          onNumber={handleLengthChange}
        />
        <IncrementDecrementControl
          decrementLabel="Decrease length"
          incrementLabel="Increase length"
          onDecrement={() => handleLengthChange(Math.max(0.1, durationSeconds() - 0.1))}
          onIncrement={() => handleLengthChange(durationSeconds() + 0.1)}
        />
      </ControlRow>

      <Show when={supportsPlaybackRate() && addons().playbackRate}>
        <ContextMenu>
          <ContextMenuTrigger<typeof ControlRow>
            as={ControlRow}
            label="Speed"
            contentClass="grid grid-cols-2 gap-2 min-w-0"
          >
            <ControlledTextField
              value={playbackRatePercent()}
              min={1}
              step={5}
              unit="%"
              autoSelect
              limitEvents
              onNumber={(value) => assignPlaybackRate(value / 100)}
            />
            <IncrementDecrementControl
              decrementLabel="Decrease speed"
              incrementLabel="Increase speed"
              onDecrement={() => assignPlaybackRate(Math.max(1, Math.round(playbackRatePercent() - 10)) / 100)}
              onIncrement={() => assignPlaybackRate(Math.round(playbackRatePercent() + 10) / 100)}
            />
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => handleRemoveAddon("playbackRate")}>
              Remove row
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Show>

      <Show when={addons().inOut}>
        <ContextMenu>
          <ContextMenuTrigger<typeof ControlRow>
            as={ControlRow}
            label="In & Out"
            contentClass="grid grid-cols-2 gap-2 min-w-0"
          >
            <ControlledTextField
              value={formatAsTimecode(startSeconds())}
              autoSelect
              onChange={handleInChange}
            />
            <ControlledTextField
              value={formatAsTimecode(endSeconds())}
              autoSelect
              onChange={handleOutChange}
            />
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => handleRemoveAddon("inOut")}>
              Remove row
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Show>

      <Show when={sequenceFrameRate()}>
        {(rate) => (
          <ControlRow label="Frame Rate">
            <ControlledTextField
              value={Math.round(rate())}
              min={1}
              max={240}
              step={1}
              unit="FPS"
              autoSelect
              limitEvents
              onNumber={handleFrameRateChange}
            />
          </ControlRow>
        )}
      </Show>

      <Show when={isContainer()}>
        <Checkbox
          checked={hasTrim()}
          onChange={toggleTrim}
          class="flex items-center"
        >
          <CheckboxInput />
          <CheckboxControl />
          <CheckboxLabel>
            Trim content
          </CheckboxLabel>
        </Checkbox>
      </Show>
    </PanelSection>
  );
}
