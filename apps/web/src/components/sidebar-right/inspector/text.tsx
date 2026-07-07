/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo, createResource, createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { ControlRow } from '@/components/ui/control-group';
import { Icon } from '@/components/ui/icon';
import { PanelSection } from '@/components/ui/panel-section';
import { SegmentedIconTabs } from '@/components/ui/segmented-icon-tabs';
import {
  Select,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectPortal,
} from '@/components/ui/select';
import { ControlledTextField } from '@/components/ui/text-field';
import { getLocalFonts, getWebFonts, loadWebFont, WebFonts, FONT_WEIGHTS } from '../../engine/font';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuGroupLabel, DropdownMenuPortal, DropdownMenuSeparator, DropdownMenuTrigger } from '../../ui/dropdown-menu';
import { cx } from '@/lib/cva';
import { Button } from '../../ui/button';
import { toast } from 'somoto';
import { usePermissionState } from '@/hooks/use-permission';
import { useEntityState, TextAlign, TextBaseline, useEntityTag, isText, isCaption, ToolType, addComponent, removeComponent, setComponent } from '@/components/engine';
import { useEngine } from '@/context/engine';
import { useECS } from '@/context/ecs';


type TextPanelProps = {
  selection: Set<number>;
};

const RESIZE_MODE_ITEMS = [
  {
    value: 'auto' as const,
    label: 'Auto width',
    icon: 'grow-auto-width',
  },
  {
    value: 'fixed' as const,
    label: 'Fixed size',
    icon: 'grow-fixed-size',
  },
] as const;

export function TextPanel(props: TextPanelProps) {
  const { world } = useEngine();
  const { selectedTool } = useECS();
  const c = world.components;
  const eid = () => props.selection.values().next().value!;

  const [fontWeight, setFontWeight] = createSignal(c.TextStyle.fontWeight[eid()] ?? '400');
  const [fontFamily, setFontFamily] = createSignal(c.TextStyle.fontFamily[eid()] ?? 'Inter');
  const [availableWeights, setAvailableWeights] = createSignal<string[]>([]);

  const textContent = useEntityState(c.Chars, eid, 'Text');
  const fontSize = useEntityState(c.TextStyle.fontSize, eid, 16);
  const leading = useEntityState(c.TextStyle.leading, eid, 1);
  const textAlign = useEntityState(c.TextStyle.textAlign, eid, TextAlign.LEFT);
  const textBaseline = useEntityState(c.TextStyle.textBaseline, eid, TextBaseline.TOP);
  const letterSpacing = useEntityState(c.TextStyle.letterSpacing, eid, 0);
  const sizeTag = useEntityTag(c.Size, eid);

  const resizeMode = createMemo(() => sizeTag() ? 'fixed' : 'auto');
  const textSelected = createMemo(() => isText(world, eid()) && !isCaption(world, eid()));

  const handleFontFamilyChange = (family: string) => {
    setComponent(world, eid(), c.TextStyle, { fontFamily: family });
    setFontFamily(c.TextStyle.fontFamily[eid()] ?? 'Inter');

    if (family in WebFonts) {
      loadWebFont(world, family as keyof typeof WebFonts);
    }
  };

  const handleFontWeightChange = (weight: string) => {
    setComponent(world, eid(), c.TextStyle, { fontWeight: weight });
    setFontWeight(c.TextStyle.fontWeight[eid()] ?? '400');
  };

  const weightOptions = createMemo(() => {
    const weights = availableWeights();
    if (!weights.length) return ALL_FONT_WEIGHTS;
    return ALL_FONT_WEIGHTS.filter(w => weights.includes(w.value));
  });

  const handleResizeModeChange = (mode: 'auto' | 'fixed') => {
    if (mode === 'fixed') addComponent(world, eid(), c.Size);
    else removeComponent(world, eid(), c.Size);
  };

  return (
    <PanelSection title="Typography">
      <Show when={textSelected()}>
        <ControlRow label="Content" contentClass="flex flex-col">
          <GrowingTextArea
            value={textContent()}
            maxRows={8}
            onInput={(v) => setComponent(world, eid(), c.Chars, v)}
            focused={selectedTool() === ToolType.TEXT_EDIT}
            onFocus={() => (world.selection.tool = ToolType.TEXT_EDIT)}
            onBlur={() => (world.selection.tool = ToolType.MOVE)}
          />
        </ControlRow>
      </Show>

      <ControlRow label="Font">
        <FontDropdown
          eid={eid()}
          family={fontFamily()}
          onFamilyChange={handleFontFamilyChange}
          onWeightsChange={setAvailableWeights}
        />
      </ControlRow>

      <ControlRow label="Sizing" contentClass="flex gap-2 items-center">
        <Select
          class="flex-1 min-w-0"
          value={fontWeight()}
          onChange={v => handleFontWeightChange(v ?? '400')}
          options={weightOptions().map(w => w.value)}
          itemComponent={itemProps => (
            <SelectItem
              item={itemProps.item}
              onPointerEnter={() => (c.TextStyle.fontWeight[eid()] = itemProps.item.rawValue)}
            >
              {weightOptions().find(w => w.value === itemProps.item.rawValue)?.label}
            </SelectItem>
          )}
        >
          <SelectTrigger>
            <SelectValue>
              {weightOptions().find(w => w.value === fontWeight())?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectContent onCloseAutoFocus={() => (c.TextStyle.fontWeight[eid()] = fontWeight())} />
          </SelectPortal>
        </Select>

        <ControlledTextField
          class="flex-1"
          value={fontSize()}
          onNumber={(v) => setComponent(world, eid(), c.TextStyle, { fontSize: v })}
          step={1}
          min={1}
          autoSelect
          limitEvents
        />
      </ControlRow>

      <ControlRow
        label="Flow"
        labelClass="opacity-0"
        contentClass="grid grid-cols-2 gap-2"
      >
        <ControlledTextField
          icon={<Icon name="text.line-height" />}
          value={Math.round(leading() * 100)}
          onNumber={(v) => setComponent(world, eid(), c.TextStyle, { leading: v / 100 })}
          unit="%"
          step={1}
          min={0}
          max={1200}
          autoSelect
          sliderEnabled
          limitEvents
        />
        <ControlledTextField
          icon={<Icon name="text.letter-spacing" />}
          value={Math.round(letterSpacing() * 100)}
          onNumber={(v) => setComponent(world, eid(), c.TextStyle, { letterSpacing: v / 100 })}
          unit="%"
          step={1}
          min={-1200}
          max={1200}
          autoSelect
          sliderEnabled
          limitEvents
        />
      </ControlRow>

      <ControlRow label="Grow">
        <SegmentedIconTabs
          value={resizeMode}
          onChange={handleResizeModeChange}
          items={RESIZE_MODE_ITEMS}
        />
      </ControlRow>

      <ControlRow label="Align" contentClass="flex gap-2">
        <SegmentedIconTabs
          class="flex-1"
          value={() => HORIZONTAL_ALIGN_TABS[textAlign() ?? TextAlign.LEFT]?.value ?? 'left'}
          onChange={(v) => setComponent(world, eid(), c.TextStyle, { textAlign: HORIZONTAL_ALIGN_MAP[v as any] })}
          items={HORIZONTAL_ALIGN_TABS}
        />
        <SegmentedIconTabs
          class="flex-1"
          value={() => VERTICAL_ALIGN_TABS[textBaseline() ?? TextBaseline.TOP]?.value ?? 'top'}
          onChange={(v) => setComponent(world, eid(), c.TextStyle, { textBaseline: VERTICAL_ALIGN_MAP[v as any] })}
          items={VERTICAL_ALIGN_TABS}
        />
      </ControlRow>
    </PanelSection>
  );
}

type FontDropdownProps = {
  eid: number;
  family: string;
  onFamilyChange(family: string): void;
  onWeightsChange(weights: string[]): void;
};

function FontDropdown(props: FontDropdownProps) {
  const { world } = useEngine();
  const c = world.components;

  const [webfonts] = createSignal(getWebFonts());
  const [fontQuery, setFontQuery] = createSignal('');
  const fontsPermission = usePermissionState('local-fonts');

  // Preload web fonts for preview
  onMount(() => {
    if (document.visibilityState !== 'visible') return;
    for (const family of Object.keys(WebFonts)) {
      const config = WebFonts[family as keyof typeof WebFonts];
      const face = new FontFace(family, `url(${config.url})`, { weight: '400' });
      face.load().then((f) => document.fonts.add(f)).catch(() => { });
    }
  });

  const [localFonts, { refetch }] = createResource(fontsPermission, async (state) => {
    if (state !== 'granted') return [];
    try {
      return await getLocalFonts();
    } catch {
      toast.error('Failed to access local fonts, please configure the browser to allow access');
      return [];
    }
  });

  // Report available weights whenever the family changes
  const allFonts = createMemo(() => [...webfonts(), ...(localFonts.latest ?? [])]);

  createEffect(() => {
    const match = allFonts().find(f => f.family === props.family);
    const weights = match?.variants.map(v => v.weight).filter((w): w is string => !!w) ?? [];
    props.onWeightsChange([...new Set(weights)]);
  });

  const filteredWebFonts = createMemo(() => {
    const q = fontQuery().trim().toLowerCase();
    if (!q) return webfonts();
    return webfonts().filter((f) => f.family.toLowerCase().includes(q));
  });

  const filteredLocalFonts = createMemo(() => {
    const q = fontQuery().trim().toLowerCase();
    const fonts = localFonts.latest;
    if (!fonts?.length) return [];
    if (!q) return fonts;
    return fonts.filter((f) => f.family.toLowerCase().includes(q));
  });

  const handlePointerEnter = (family: string) => {
    setComponent(world, props.eid, c.TextStyle, { fontFamily: family });
  };

  const handleSelect = (family: string) => {
    props.onFamilyChange(family);
  };

  const handleOpenChange = () => {
    setFontQuery('');

    setComponent(world, props.eid, c.TextStyle, { fontFamily: props.family });
  };

  const handleGrantAccess = async () => {
    if (typeof window.queryLocalFonts !== 'function') {
      toast.error('Local fonts are not supported in this browser');
      return;
    }
    try {
      await window.queryLocalFonts();
      refetch();
    } catch {
      toast.error('Failed to access local fonts, please configure the browser to allow access');
    }
  };

  return (
    <DropdownMenu onOpenChange={handleOpenChange} placement="left" sameWidth gutter={8}>
      <DropdownMenuTrigger
        class={cx(
          "bg-input h-7 hover:bg-input/80 text-foreground data-placeholder:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground flex w-full items-center gap-0 rounded-md pl-2 pr-0 text-xs whitespace-nowrap transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50",
          "relative overflow-hidden after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:opacity-0 after:ring-1 after:ring-inset after:ring-ring after:z-20 focus-visible:after:opacity-100 justify-between",
          "*:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:flex-1 *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        )}
      >
        {props.family}
        <Icon name="chevron-down" class="size-6 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="max-h-[700px] w-58 flex flex-col">
          <div class="relative flex h-7 items-center shrink-0">
            <Icon name="search" class="size-6 text-muted-foreground" />
            <input
              type="text"
              value={fontQuery()}
              onInput={(e) => setFontQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') return;
                e.stopPropagation();
              }}
              placeholder="Search"
              aria-label="Search fonts"
              autocomplete="off"
              class="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
            />
          </div>
          <DropdownMenuSeparator />
          <div class="overflow-y-auto flex-1 flex flex-col gap-2">
            <DropdownMenuGroup>
              <DropdownMenuGroupLabel>Web Fonts</DropdownMenuGroupLabel>
              <For each={filteredWebFonts()}>
                {(font) => (
                  <LazyFontItem
                    family={font.family}
                    checked={props.family === font.family}
                    onPointerEnter={handlePointerEnter}
                    onSelect={handleSelect}
                  >
                    {font.family}
                  </LazyFontItem>
                )}
              </For>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuGroupLabel>System Fonts</DropdownMenuGroupLabel>
              <Show when={!localFonts.latest?.length}>
                <Button
                  variant="secondary"
                  class="text-foreground gap-0"
                  onClick={handleGrantAccess}
                >
                  <Icon name="lock-closed-small" class="size-6" />
                  <span class="mr-3">Grant Access</span>
                </Button>
              </Show>
              <Show when={filteredLocalFonts().length}>
                <For each={filteredLocalFonts()}>
                  {(font) => (
                    <LazyFontItem
                      family={font.family}
                      checked={props.family === font.family}
                      onPointerEnter={handlePointerEnter}
                      onSelect={handleSelect}
                    >
                      {font.family}
                    </LazyFontItem>
                  )}
                </For>
              </Show>
            </DropdownMenuGroup>
          </div>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}

type GrowingTextAreaProps = {
  value: string;
  onInput(value: string): void;
  maxRows?: number;
  focused?: boolean;
  onBlur?(): void;
  onFocus?(): void;
};

function GrowingTextArea(props: GrowingTextAreaProps) {
  let ref!: HTMLTextAreaElement;
  const lineHeight = 18; // matches text-xs leading
  const maxRows = () => props.maxRows ?? 8;

  const resize = () => {
    if (!ref) return;
    ref.style.height = 'auto';
    const max = lineHeight * maxRows() + 8; // 8px for py-1
    ref.style.height = `${Math.min(ref.scrollHeight, max)}px`;
  };

  // Resize when value changes externally (e.g. undo/redo, selection change)
  createEffect(() => {
    props.value;
    resize();
  });

  createEffect(() => {
    if (props.focused) {
      ref.focus();
      ref.select();
    }
  });

  const handleInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    props.onInput(e.currentTarget.value);
    resize();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ref.blur();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      ref.blur();
    }
  };

  return (
    <textarea
      ref={ref!}
      value={props.value}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
      rows={1}
      class="bg-input h-7 rounded-md px-2 py-1 text-xxs text-foreground placeholder:text-muted-foreground outline-none resize-none w-full focus-ring overflow-y-auto"
      style={{ 'line-height': `${lineHeight}px` }}
    />
  );
}

type LazyFontItemProps = {
  family: string;
  checked: boolean;
  onPointerEnter: (family: string) => void;
  onSelect: (family: string) => void;
  children: string;
};

function LazyFontItem(props: LazyFontItemProps) {
  let ref!: HTMLDivElement;
  const [visible, setVisible] = createSignal(false);

  onMount(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0 },
    );
    observer.observe(ref);
    onCleanup(() => observer.disconnect());
  });

  return (
    <DropdownMenuCheckboxItem
      ref={ref}
      checked={props.checked}
      closeOnSelect
      onSelect={() => props.onSelect(props.family)}
      onPointerEnter={() => props.onPointerEnter(props.family)}
      style={visible() ? { 'font-family': `'${props.family}', Inter` } : undefined}
    >
      <span class="truncate leading-none">{props.children}</span>
    </DropdownMenuCheckboxItem>
  );
}

const ALL_FONT_WEIGHTS = Object.entries(FONT_WEIGHTS).map(([value, label]) => ({ value, label }));

const HORIZONTAL_ALIGN_TABS = [
  { value: 'left', label: 'Align left', icon: 'text.align-left' },
  { value: 'center', label: 'Align center', icon: 'text.align-center' },
  { value: 'right', label: 'Align right', icon: 'text.align-right' },
] as const;

const HORIZONTAL_ALIGN_MAP: Record<string, TextAlign> = {
  left: TextAlign.LEFT,
  center: TextAlign.CENTER,
  right: TextAlign.RIGHT,
};

const VERTICAL_ALIGN_TABS = [
  { value: 'top', label: 'Align top', icon: 'text.align-top' },
  { value: 'middle', label: 'Align middle', icon: 'text.align-middle' },
  { value: 'bottom', label: 'Align bottom', icon: 'text.align-bottom' },
] as const;

const VERTICAL_ALIGN_MAP: Record<string, TextBaseline> = {
  top: TextBaseline.TOP,
  middle: TextBaseline.MIDDLE,
  bottom: TextBaseline.BOTTOM,
};
