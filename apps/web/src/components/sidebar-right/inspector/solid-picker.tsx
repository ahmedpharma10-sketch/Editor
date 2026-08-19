/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ColorOpacityPicker } from "@/components/ui/color-opacity-picker";
import { useEntityState, setComponent } from "@/components/engine";
import { useEngine } from "@/context/engine";


export type SolidColorPickerProps = {
  nodeEid: number;
  fillEid: number;
};

export function SolidFillPicker(props: SolidColorPickerProps) {
  const { world } = useEngine();
  const c = world.components;

  const color = useEntityState(c.Computed.color, props.fillEid, 0xE0E0E0);
  const opacity = useEntityState(c.Computed.opacity, props.fillEid, 1);

  const updateColor = (color: number) => {
    setComponent(world, props.fillEid, c.Color, color);
  };

  const updateOpacity = (opacity: number) => {
    setComponent(world, props.fillEid, c.Appearance, { opacity });
  };

  return (
    <ColorOpacityPicker
      color={color()}
      opacity={opacity()}
      onColorChange={updateColor}
      onOpacityChange={updateOpacity}
      onBeginChange={(label) => world.history.startTransaction(label)}
      onEndChange={() => world.history.commitTransaction()}
    />
  );
}
