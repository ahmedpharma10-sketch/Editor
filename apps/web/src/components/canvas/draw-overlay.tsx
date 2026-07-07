/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useEngine } from "@/context/engine";
import { Show } from "solid-js";
import { screenToWorld, worldToLocal, findSceneAt, ToolType, getNextName, GeometryType, PaintType, type Point, createEntity, switchActiveScene, addComponent, appendChild, setComponent, resizeEntity, clearComponent } from "@/components/engine";
import { useECS } from "@/context/ecs";


type ToolConfig = {
  geometry: GeometryType;
  isScene?: boolean;
  fillColor: number;
  previewColor: string;
  namePrefix: string;
  label: string;
  defaultWidth: number;
  defaultHeight: number;
};

const TOOL_CONFIG: Partial<Record<ToolType, ToolConfig>> = {
  [ToolType.RECT]: {
    geometry: GeometryType.RECT,
    fillColor: 0xE0E0E0,
    previewColor: '#E0E0E0',
    namePrefix: 'Rect',
    label: 'Create shape',
    defaultWidth: 300,
    defaultHeight: 300,
  },
  [ToolType.SCENE]: {
    geometry: GeometryType.RECT,
    isScene: true,
    fillColor: 0x000000,
    previewColor: '#000000',
    namePrefix: 'Scene',
    label: 'Create scene',
    defaultWidth: 1920,
    defaultHeight: 1080,
  },
  [ToolType.TEXT]: {
    geometry: GeometryType.TEXT,
    fillColor: 0xFFFFFF,
    previewColor: 'transparent',
    namePrefix: 'Text',
    label: 'Create text',
    // Width/height for click insertions are derived from the font size below.
    defaultWidth: 0,
    defaultHeight: 0,
  },
};

const CLICK_THRESHOLD = 10;

export function DrawOverlay() {
  const { world } = useEngine();
  const { selectedTool } = useECS();

  const c = world.components;

  let overlayRef!: HTMLDivElement;
  let previewRef!: HTMLDivElement;
  let dimensionsRef!: HTMLDivElement;

  let isDrawing = false;
  let startPoint: Point | null = null;
  let currentPoint: Point | null = null;
  let targetSceneEid: number | null = null;

  const config = () => TOOL_CONFIG[selectedTool()];
  const isActiveTool = () => !!config();

  const getRect = () => {
    if (!startPoint || !currentPoint) return null;
    return {
      x: Math.min(startPoint.x, currentPoint.x),
      y: Math.min(startPoint.y, currentPoint.y),
      width: Math.abs(currentPoint.x - startPoint.x),
      height: Math.abs(currentPoint.y - startPoint.y),
    };
  };

  const updatePreview = () => {
    const cfg = config();
    const rect = getRect();
    if (!previewRef || !rect || !cfg) {
      if (previewRef) previewRef.style.display = 'none';
      if (dimensionsRef) dimensionsRef.style.display = 'none';
      return;
    }

    previewRef.style.display = 'block';
    previewRef.style.left = `${rect.x}px`;
    previewRef.style.top = `${rect.y}px`;
    previewRef.style.width = `${rect.width}px`;
    previewRef.style.height = `${rect.height}px`;
    previewRef.style.backgroundColor = cfg.previewColor;
    previewRef.style.outline = '2px solid #008CFF';
    previewRef.style.outlineOffset = '0px';

    const worldTopLeft = screenToWorld(world, rect.x, rect.y);
    const worldBottomRight = screenToWorld(world, rect.x + rect.width, rect.y + rect.height);
    const worldWidth = Math.round(worldBottomRight.x - worldTopLeft.x);
    const worldHeight = Math.round(worldBottomRight.y - worldTopLeft.y);

    dimensionsRef.style.display = 'block';
    dimensionsRef.style.left = `${rect.x + rect.width / 2}px`;
    dimensionsRef.style.top = `${rect.y + rect.height + 8}px`;
    dimensionsRef.textContent = `${worldWidth}x${worldHeight}`;
  };

  const getLocalPoint = (e: PointerEvent): Point => {
    const rect = overlayRef.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e: PointerEvent) => {
    if (!isActiveTool()) return;

    const point = getLocalPoint(e);
    const worldPt = screenToWorld(world, point.x, point.y);
    targetSceneEid = findSceneAt(world, worldPt.x, worldPt.y);

    overlayRef.setPointerCapture(e.pointerId);
    isDrawing = true;
    startPoint = point;
    currentPoint = point;
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDrawing) return;
    currentPoint = getLocalPoint(e);
    updatePreview();
  };

  const reset = () => {
    isDrawing = false;
    startPoint = null;
    currentPoint = null;
    targetSceneEid = null;
    updatePreview();
  };

  const handlePointerUp = () => {
    if (!isDrawing) return;

    const cfg = config();
    const rect = getRect();
    if (!cfg || !rect) {
      reset();
      return;
    }

    const tool = selectedTool();
    const isClick = rect.width < CLICK_THRESHOLD || rect.height < CLICK_THRESHOLD;

    const worldTopLeft = screenToWorld(world, rect.x, rect.y);
    const worldBottomRight = screenToWorld(world, rect.x + rect.width, rect.y + rect.height);

    // Approximate text size from the parent scene's height.
    let fontSize = 16;
    if (tool === ToolType.TEXT && targetSceneEid !== null) {
      const sceneHeight = c.Computed.height[targetSceneEid];
      fontSize = Math.max(8, Math.round(sceneHeight / 22.5));
    }

    let width: number;
    let height: number;
    if (!isClick) {
      width = Math.round(worldBottomRight.x - worldTopLeft.x);
      height = Math.round(worldBottomRight.y - worldTopLeft.y);
    } else if (tool === ToolType.TEXT) {
      // Rough text bounds based on "Text" (4 chars) at the chosen font size.
      width = Math.round(fontSize * 0.6 * 4);
      height = Math.round(fontSize * 1.2);
    } else {
      width = cfg.defaultWidth;
      height = cfg.defaultHeight;
    }

    let posX = isClick ? worldTopLeft.x - width / 2 : worldTopLeft.x;
    let posY = isClick ? worldTopLeft.y - height / 2 : worldTopLeft.y;

    // Scenes always live at the root; rect/text may parent into a hovered scene.
    const parentScene = tool === ToolType.SCENE ? null : targetSceneEid;
    if (parentScene !== null) {
      const local = worldToLocal(world, parentScene, posX, posY);
      posX = local.x;
      posY = local.y;
    }

    const eid = world.history.transaction(cfg.isScene ? 'Add scene' : 'Draw shape', () => {
      const newEid = createEntity(world);
      setComponent(world, newEid, c.Geometry, cfg.geometry);
      if (cfg.isScene) {
        addComponent(world, newEid, c.Scene);
        addComponent(world, newEid, c.ClipsContent);
        setComponent(world, newEid, c.Playback, {});
      }
      setComponent(world, newEid, c.Name, getNextName(world, cfg.namePrefix));
      setComponent(world, newEid, c.Position, { x: Math.round(posX), y: Math.round(posY) });

      if (tool === ToolType.TEXT) {
        setComponent(world, newEid, c.Chars, 'Text');
        setComponent(world, newEid, c.TextStyle, { fontSize: fontSize });
      }

      if (tool !== ToolType.TEXT || !isClick) {
        resizeEntity(world, newEid, { width, height });
      }

      const fillEid = createEntity(world);
      setComponent(world, fillEid, c.Paint, PaintType.SOLID);
      setComponent(world, fillEid, c.Color, cfg.fillColor);
      appendChild(world, fillEid, newEid);

      if (parentScene !== null) {
        appendChild(world, newEid, parentScene);
      }
      return newEid;
    });

    if (tool === ToolType.SCENE) {
      switchActiveScene(world, eid);
    }

    clearComponent(world, c.Selected, false);
    addComponent(world, eid, c.Selected, false);

    world.selection.tool = tool === ToolType.TEXT ? ToolType.TEXT_EDIT : ToolType.MOVE;
    reset();
  };

  return (
    <Show when={isActiveTool()}>
      <div
        ref={overlayRef}
        class="absolute inset-0 z-5 cursor-crosshair"
        on:pointerdown={handlePointerDown}
        on:pointermove={handlePointerMove}
        on:pointerup={handlePointerUp}
      >
        <div
          ref={previewRef}
          class="absolute pointer-events-none"
          style={{ display: 'none' }}
        />
        <div
          ref={dimensionsRef}
          class="absolute pointer-events-none"
          style={{
            display: 'none',
            transform: 'translateX(-50%)',
            'background-color': '#008CFF',
            color: '#FFFFFF',
            'font-family': 'Inter, sans-serif',
            'font-size': '11px',
            'line-height': '1',
            padding: '3px 4px',
            'border-radius': '3px',
            'white-space': 'nowrap',
          }}
        />
      </div>
    </Show>
  );
}
