/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createMemo, createSignal } from "solid-js";
import { Canvas } from "@/components/canvas";
import { Timeline, Layers } from "@/components/timeline";
import { Soundboard, Inspector } from "@/components/sidebar-right";
import { FloatingProjectHeader, SidebarLeft } from "@/components/sidebar-left";
import { useLayout, MIN_TIMELINE_HEIGHT } from "@/context/layout";
import { useElectron } from "@/context/electron";

const MIN_CANVAS_HEIGHT = 200;

export function EditorPage() {
  const { sidebarsVisible, timelineVisible, timelineHeight, setTimelineHeight } = useLayout();
  const { isDesktop, isFullscreen } = useElectron();
  const [resizing, setResizing] = createSignal(false);

  const timelineStyles = createMemo(() => {
    if (!timelineVisible()) return;

    return {
      'grid-template-rows': `1fr 1px ${timelineHeight()}px`,
    };
  });

  const handleResizeStart = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startHeight = timelineHeight();
    setResizing(true);

    const handleMove = (ev: PointerEvent) => {
      const deltaY = startY - ev.clientY;
      const maxHeight = Math.max(
        MIN_TIMELINE_HEIGHT,
        window.innerHeight - MIN_CANVAS_HEIGHT - 1,
      );
      const next = Math.max(MIN_TIMELINE_HEIGHT, Math.min(maxHeight, startHeight + deltaY));
      setTimelineHeight(next);
    };

    const handleEnd = () => {
      setResizing(false);
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleEnd);
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleEnd);
  };

  return (
    <div
      class="bg-background h-screen w-full overflow-hidden grid"
      classList={{
        'grid-cols-[264px_1px_1fr_1px_264px]': sidebarsVisible(),
        'grid-cols-[1fr]': !sidebarsVisible(),
        'grid-rows-[1fr]': !timelineVisible(),
      }}
      style={timelineStyles()}
    >
      <Show when={isDesktop && !isFullscreen()}>
        <div class="fixed top-0 left-0 right-0 h-10 z-20" style="-webkit-app-region: drag;" />
      </Show>
      <Show when={sidebarsVisible()}>
        <SidebarLeft />
        <div class="bg-border" />
      </Show>
      <Canvas />
      <Show when={sidebarsVisible()}>
        <div class="bg-border" />
        <Inspector />
      </Show>
      <Show when={timelineVisible()}>
        <div class="col-span-full bg-border relative">
          <div
            class="absolute left-0 right-0 -top-px h-[3px] z-10 cursor-ns-resize group"
            onPointerDown={handleResizeStart}
          >
            <div
              class="absolute left-0 right-0 top-px h-px transition-colors group-hover:bg-primary"
              classList={{ 'bg-primary': resizing() }}
            />
          </div>
        </div>
      </Show>
      <Show when={timelineVisible()}>
        <Layers />
        <div class="bg-border" />
      </Show>
      <Show when={timelineVisible()}>
        <Timeline />
      </Show>
      <Show when={timelineVisible()}>
        <div class="bg-border" />
        <Soundboard />
      </Show>
      <Show when={!sidebarsVisible()}>
        <FloatingProjectHeader />
      </Show>
    </div>
  );
}
