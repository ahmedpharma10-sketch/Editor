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
import { copySelection, pasteClipboard, duplicateSelection, selectStageEntities, selectParentEntities, selectChildEntities, addComponent, removeComponent, clearComponent } from "@/components/engine";
import { useECS } from "@/context/ecs";
import { hasComponent, Or, query } from 'bitecs';

export function EditMenu() {
  const { world } = useEngine();
  const { selectedNodes } = useECS();
  const hasSelection = () => selectedNodes().size > 0;
  const c = world.components;

  const handleToggleHidden = () => {
    const eids = [...query(world, [c.Selected, Or(c.Geometry, c.Group)])];
    const anyVisible = Array.from(eids).some((eid) => !hasComponent(world, eid, c.Hidden));

    if (anyVisible) {
      eids.forEach(eid => addComponent(world, eid, c.Hidden));
    } else {
      eids.forEach(eid => removeComponent(world, eid, c.Hidden));
    }
  };

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem
          disabled={!world.history.canUndo}
          onSelect={() => world.history.undo()}
        >
          Undo
          <DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!world.history.canRedo}
          onSelect={() => world.history.redo()}
        >
          Redo
          <DropdownMenuShortcut>⇧⌘Z</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => copySelection(world)}
        >
          Copy
          <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => pasteClipboard(world)}>
          Paste
          <DropdownMenuShortcut>⌘V</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => duplicateSelection(world)}
        >
          Duplicate
          <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          Delete
          <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={handleToggleHidden}
        >
          Hide
          <DropdownMenuShortcut>⇧⌘H</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={() => selectStageEntities(world)}>
          Select all
          <DropdownMenuShortcut>⌘A</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => selectParentEntities(world)}
        >
          Select parent
          <DropdownMenuShortcut>{"\\"}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => selectChildEntities(world)}
        >
          Select children
          <DropdownMenuShortcut>↩︎</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => clearComponent(world, c.Selected, false)}
        >
          Deselect
          <DropdownMenuShortcut>Esc</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}
