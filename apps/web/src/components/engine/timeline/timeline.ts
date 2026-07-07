/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createPointer } from "./pointer";
import { assert, clamp } from "@/utils";
import {
  renderBackground,
  renderMarquee,
  renderPlayhead,
  renderRuler,
  renderWorkarea,
  renderSnapPoints,
  renderLayers,
} from "./render";
import { pixelsToFrames, updateTimelineTransform } from "./utils";
import { DEFAULT_TIMELINE_RESOLUTION, TIMELINE_RESOLUTION_RANGE, TIMELINE_PADDING_LEFT } from "./config";
import { useEngine } from "@/context/engine";
import { useCursor } from "@/hooks/use-cursor";
import { createTimelineContext } from "./world";

export type { Marquee, TimelineContext } from "./world";

export function createTimeline() {
  const engine = useEngine();
  const world = engine.world;
  const c = world.components;

  const timeline = createTimelineContext();

  const pointer = createPointer({
    get marquee() { return timeline.marquee },
    get canvas() { return timeline.canvas },
    get ctx() { return timeline.ctx },
  });

  const cursor = useCursor();

  let layersEl: HTMLElement | null = null;
  let layersContainerEl: HTMLElement | null = null;
  let animationId: number | null = null;
  let layerScrollX = 0;

  const applyResize = () => {
    const canvas = timeline.canvas;
    const parent = canvas?.parentElement;
    if (!parent || !canvas) return;

    timeline.layout = parent.getBoundingClientRect();
    applyScroll();

    const dpr = window.devicePixelRatio;
    const nextWidth = Math.floor(timeline.layout.width * dpr);
    const nextHeight = Math.floor(timeline.layout.height * dpr);

    canvas.style.width = `${timeline.layout.width}px`;
    canvas.style.height = `${timeline.layout.height}px`;

    if (canvas.width === nextWidth && canvas.height === nextHeight) return;

    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  const resize = () => {
    applyResize();

    updateTimelineTransform(world);

    if (engine.running && timeline.canvas && timeline.ctx) {
      drawFrame();
    }
  }

  const observer = new ResizeObserver(resize);

  const layerObserver = new ResizeObserver(() => {
    applyScroll();
    updateTimelineTransform(world);
  });

  const drawFrame = () => {
    const canvas = timeline.canvas;
    const ctx = timeline.ctx;
    if (!canvas || !ctx || !timeline.pointer) return;

    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = timeline.colors.background.default;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

      timeline.cursor = 'default';

      renderBackground(world, timeline);
      renderLayers(world, timeline);
      renderMarquee(world, timeline);
      renderRuler(world, timeline);
      renderWorkarea(world, timeline);
      renderPlayhead(world, timeline);
      renderSnapPoints(world, timeline);

      cursor.set(canvas, timeline.cursor);
    } catch (e) {
      console.error(e);
    } finally {
      timeline.pointer.reset();
    }
  }

  const render = () => {
    if (engine.running) {
      drawFrame();
    }

    animationId = requestAnimationFrame(render);
  }

  const applyScroll = () => {
    if (!layersEl || !layersContainerEl) return;

    const sid = world.selection.scene;
    if (sid === null) return;

    const container = layersContainerEl;
    const layers = layersEl;

    const scrollY = c.Timeline.scrollY[sid] ?? 0;
    const newScrollY = Math.max(0, Math.min(scrollY, container.scrollHeight - container.clientHeight));

    c.Timeline.scrollY[sid] = newScrollY;
    layers.style.transform = `translateY(${-newScrollY}px)`;

    const windows = layers.querySelectorAll<HTMLElement>('[data-layer-label]');
    let maxScrollX = 0;
    windows.forEach((el) => { maxScrollX = Math.max(maxScrollX, el.scrollWidth - el.clientWidth); });
    layerScrollX = Math.max(0, Math.min(layerScrollX, maxScrollX));
    layers.style.setProperty('--layer-x', `${layerScrollX}px`);
  }

  const handleWheelEvent = (event: WheelEvent) => {
    event.preventDefault();

    const sid = world.selection.scene;
    if (sid === null) return;
    const scrollX = c.Timeline.scrollX[sid] ?? 0;
    const resolution = c.Timeline.resolution[sid] || DEFAULT_TIMELINE_RESOLUTION;
    const minScrollX = -TIMELINE_PADDING_LEFT / resolution;

    // Prioritize: Z (zoom) > X (horizontal) > Y (vertical)
    // Only one axis can be scrolled at a time
    if (event.ctrlKey || event.metaKey) {
      // Zoom (Z axis)
      const rect = timeline.canvas?.getBoundingClientRect();
      const timelineX = event.clientX - (rect?.left ?? 0);

      let newResolution = resolution;
      newResolution *= 1.01 ** -event.deltaY;
      newResolution = clamp(newResolution, 1 / TIMELINE_RESOLUTION_RANGE[1], 1 / TIMELINE_RESOLUTION_RANGE[0]);

      let newScrollX = scrollX + timelineX / resolution - timelineX / newResolution;
      newScrollX = Math.max(minScrollX, newScrollX);
      c.Timeline.scrollX[sid] = newScrollX;
      c.Timeline.resolution[sid] = newResolution;
    } else if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      // Horizontal scroll (X axis) - when horizontal movement is dominant
      const frameDelta = event.deltaX / resolution;

      let newScrollX = scrollX + frameDelta;
      newScrollX = Math.max(minScrollX, newScrollX);
      c.Timeline.scrollX[sid] = newScrollX;
    } else {
      // Vertical scroll (Y axis) - default when no other conditions match
      c.Timeline.scrollY[sid] = (c.Timeline.scrollY[sid] ?? 0) + event.deltaY;

      applyScroll();
    }

    updateTimelineTransform(world);
  }


  const unmount = () => {
    layerObserver.disconnect();

    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    document.body.removeEventListener('pointermove', pointer.move);
    document.body.removeEventListener('pointerup', pointer.up);
  }

  const scroll = (event: WheelEvent) => {
    event.preventDefault();

    const sid = world.selection.scene;
    if (sid === null) return;

    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      layerScrollX += event.deltaX;
    } else {
      c.Timeline.scrollY[sid] = (c.Timeline.scrollY[sid] ?? 0) + event.deltaY;
    }

    applyScroll();
    updateTimelineTransform(world);
  }

  const clientToFrame = (clientX: number) => {
    const sid = world.selection.scene;
    if (sid === null) return 0;
    const scrollX = c.Timeline.scrollX[sid] ?? 0;
    const resolution = c.Timeline.resolution[sid] || DEFAULT_TIMELINE_RESOLUTION;
    const rect = timeline.canvas?.getBoundingClientRect();
    const worldX = clientX - (rect?.left ?? 0) + scrollX * resolution;
    return pixelsToFrames(world, worldX);
  }

  const clientToTime = (clientX: number) => (clientToFrame(clientX) / world.frameRate);

  const attachCanvas = () => {
    const canvas = document.getElementById('timeline-canvas') as HTMLCanvasElement;
    assert(canvas, 'Timeline canvas must be defined');

    const parent = canvas.parentElement;
    assert(parent, 'Timeline canvas must have a parent element');

    timeline.canvas = canvas;
    timeline.layout = parent.getBoundingClientRect();
    timeline.ctx = canvas.getContext('2d')!;

    observer.observe(parent);

    canvas.addEventListener('wheel', handleWheelEvent);
    canvas.addEventListener('pointerdown', pointer.down, { passive: true });

    applyResize();
  }

  const detachCanvas = () => {
    observer.disconnect();

    const canvas = timeline.canvas;
    canvas?.removeEventListener('wheel', handleWheelEvent);
    canvas?.removeEventListener('pointerdown', pointer.down);

    // Drop the stale references so the render loop no-ops until the next
    // attachCanvas() rebinds a live element.
    timeline.canvas = null;
    timeline.ctx = null;
  }

  // The layer refs, pointer and render loop live as long as <Layers>, which
  // stays mounted across timeline visibility toggles.
  const mount = () => {
    const layers = document.querySelector<HTMLElement>('[data-timeline-layers]');
    assert(layers, 'Timeline layers element must be defined');

    const layersContainer = document.querySelector<HTMLElement>('[data-timeline-layers-container]');
    assert(layersContainer, 'Timeline layers container element must be defined');

    timeline.pointer = pointer;
    layersEl = layers;
    layersContainerEl = layersContainer;

    layerObserver.observe(layers);

    document.body.addEventListener('pointermove', pointer.move, { passive: true });
    document.body.addEventListener('pointerup', pointer.up, { passive: true });

    if (!animationId) {
      animationId = requestAnimationFrame(render);
    }
  }

  return {
    mount,
    unmount,
    attachCanvas,
    detachCanvas,
    scroll,
    clientToTime,
    clientToFrame,
  };
}
