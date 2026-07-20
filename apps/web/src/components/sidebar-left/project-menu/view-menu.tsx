/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { useEngine } from "@/context/engine";
import { useLayout } from "@/context/layout";
import { useECS } from "@/context/ecs";

export function ViewMenu() {
  const engine = useEngine();
  const layout = useLayout();
  const { selectedNodes } = useECS();

  const hasSelection = () => selectedNodes().size > 0;

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={() => engine.camera.zoomBy(1.25)}>
          Zoom in
          <DropdownMenuShortcut>⌘+</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => engine.camera.zoomBy(0.8)}>
          Zoom out
          <DropdownMenuShortcut>⌘-</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => engine.camera.resetZoom()}>
          Zoom to 100%
          <DropdownMenuShortcut>⌘0</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => engine.camera.fitToActiveScene()}>
          Zoom to fit
          <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => engine.camera.fitToSelection()}
        >
          Zoom to selection
          <DropdownMenuShortcut>⌘2</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={layout.toggleUI}>
          Toggle UI
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={layout.toggleTimelineMinimized}>
          Toggle timeline
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}
