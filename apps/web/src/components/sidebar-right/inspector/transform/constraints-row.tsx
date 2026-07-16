/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectIconTrigger,
  SelectItem,
  SelectPortal,
} from "@/components/ui/select";
import { horizontalConstraints, verticalConstraints } from "./constants";
import { useEngine } from "@/context/engine";
import { ConstraintType, useEntityState, setComponent } from "@/components/engine";


type ConstraintsRowProps = {
  nodeEid: number;
};

export function ConstraintsRow(props: ConstraintsRowProps) {
  const { world } = useEngine();
  const c = world.components;

  const h = useEntityState(c.Constraint.horizontal, props.nodeEid, 0);
  const w = useEntityState(c.Constraint.vertical, props.nodeEid, 0);

  const assignHorizontalConstraint = (value: ConstraintType | null) => {
    if (value == null) return;
    setComponent(world, props.nodeEid, c.Constraint, { horizontal: value });
  };
  const assignVerticalConstraint = (value: ConstraintType | null) => {
    if (value == null) return;
    setComponent(world, props.nodeEid, c.Constraint, { vertical: value });
  };
  const assignCenterConstraints = () => {
    setComponent(world, props.nodeEid, c.Constraint, {
      horizontal: ConstraintType.CENTER,
      vertical: ConstraintType.CENTER,
    });
  };


  return (
    <ControlRow
      label=""
      labelClass="opacity-0"
      class="items-start"
      contentClass="grid grid-cols-2 gap-2"
    >
      <div class="flex flex-col gap-2 min-w-0">
        <Select<ConstraintType>
          value={h()}
          onChange={(value) => assignHorizontalConstraint(value)}
          options={horizontalConstraints.map((c) => c.key)}
          itemComponent={(itemProps) => (
            <SelectItem item={itemProps.item}>
              {horizontalConstraints.find((c) => c.key === itemProps.item.rawValue)?.label}
            </SelectItem>
          )}
        >
          <SelectIconTrigger<ConstraintType>
            icon={<Icon name="pin-left-right" />}
            valueClass="text-xs"
          >
            {(state) =>
              horizontalConstraints.find((c) => c.key === state.selectedOption())?.label
            }
          </SelectIconTrigger>
          <SelectPortal>
            <SelectContent />
          </SelectPortal>
        </Select>

        <Select<ConstraintType>
          value={w()}
          onChange={(value) => assignVerticalConstraint(value)}
          options={verticalConstraints.map((c) => c.key)}
          itemComponent={(itemProps) => (
            <SelectItem item={itemProps.item}>
              {verticalConstraints.find((c) => c.key === itemProps.item.rawValue)?.label}
            </SelectItem>
          )}
        >
          <SelectIconTrigger<ConstraintType>
            icon={<Icon name="pin-top-bottom" />}
            valueClass="text-xs"
          >
            {(state) =>
              verticalConstraints.find((c) => c.key === state.selectedOption())?.label
            }
          </SelectIconTrigger>
          <SelectPortal>
            <SelectContent />
          </SelectPortal>
        </Select>
      </div>

      <div class="h-16 bg-input rounded-md relative min-w-0">
        <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 size-7 bg-muted rounded-sm overflow-hidden flex items-center justify-center">
          <div class="size-6 overflow-hidden flex items-center justify-center text-muted-foreground">
            <Icon name="plus-add" />
          </div>
        </div>

        <div
          class="group absolute left-1/2 top-1/2 -translate-y-1/2 -translate-x-1/2 -ml-[23px] cursor-pointer py-1"
          onClick={() => assignHorizontalConstraint(ConstraintType.MIN)}
        >
          <div
            class="w-2.5 h-0.5 rounded-sm"
            classList={{
              "bg-primary": h() === ConstraintType.MIN || h() === ConstraintType.STRETCH,
              "bg-muted-foreground/40 group-hover:bg-muted-foreground/70": h() !== ConstraintType.MIN && h() !== ConstraintType.STRETCH
            }}
          />
        </div>

        <div
          class="group absolute left-1/2 top-1/2 -translate-y-1/2 -translate-x-1/2 ml-[23px] cursor-pointer py-1"
          onClick={() => assignHorizontalConstraint(ConstraintType.MAX)}
        >
          <div
            class="w-2.5 h-0.5 rounded-sm"
            classList={{
              "bg-primary": h() === ConstraintType.MAX || h() === ConstraintType.STRETCH,
              "bg-muted-foreground/40 group-hover:bg-muted-foreground/70": h() !== ConstraintType.MAX && h() !== ConstraintType.STRETCH
            }}
          />
        </div>

        <div
          class="group absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -mt-[23px] cursor-pointer px-1"
          onClick={() => assignVerticalConstraint(ConstraintType.MIN)}
        >
          <div
            class="w-0.5 h-2.5 rounded-sm"
            classList={{
              "bg-primary": w() === ConstraintType.MIN || w() === ConstraintType.STRETCH,
              "bg-muted-foreground/40 group-hover:bg-muted-foreground/70": w() !== ConstraintType.MIN && w() !== ConstraintType.STRETCH
            }}
          />
        </div>

        <div
          class="group absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 mt-[23px] cursor-pointer px-1"
          onClick={() => assignVerticalConstraint(ConstraintType.MAX)}
        >
          <div
            class="w-0.5 h-2.5 rounded-sm"
            classList={{
              "bg-primary": w() === ConstraintType.MAX || w() === ConstraintType.STRETCH,
              "bg-muted-foreground/40 group-hover:bg-muted-foreground/70": w() !== ConstraintType.MAX && w() !== ConstraintType.STRETCH
            }}
          />
        </div>

        <div
          class="group absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer p-1"
          onClick={assignCenterConstraints}
        >
          <div class="relative size-2.5">
            <div
              class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-0.5 rounded-sm"
              classList={{
                "bg-primary": h() === ConstraintType.CENTER,
                "bg-transparent group-hover:bg-muted-foreground/40": h() !== ConstraintType.CENTER
              }}
            />
            <div
              class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-2.5 rounded-sm"
              classList={{
                "bg-primary": w() === ConstraintType.CENTER,
                "bg-transparent group-hover:bg-muted-foreground/40": w() !== ConstraintType.CENTER
              }}
            />
          </div>
        </div>
      </div>
    </ControlRow>
  );
}
