/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from '@/components/ui/icon';
import { ItemRow } from "@/components/ui/item-row";
import { PanelSection } from '@/components/ui/panel-section';
import { For } from "solid-js";

import { useEntityState, getNextName, createEntity, deleteEntity, GeometryType, PaintType, type EngineWorld, addComponent, appendChild, setComponent, resizeEntity, clearComponent } from "@/components/engine";
import { useEngine } from "@/context/engine";

type MasksSettingsProps = {
	selection: Set<number>;
};

export function MasksSettings(props: MasksSettingsProps) {
	const { world } = useEngine();

	const eid = () => props.selection.values().next().value!;
	const maskEids = useEntityState(world.components.Cache.masks, eid, []);
	const handleAddMask = () => createMask(world, eid());
	const handleRemoveMask = (maskEid: number) => deleteEntity(world, maskEid);

	return (
		<PanelSection
			title="Masks"
			actions={
				<Tooltip>
					<TooltipTrigger
						as={Button}
						size="icon"
						variant="ghost"
						class="text-muted-foreground"
						onClick={handleAddMask}
					>
						<Icon name="plus-add" />
					</TooltipTrigger>
					<TooltipContent>Add mask</TooltipContent>
				</Tooltip>
			}
		>
			<For each={maskEids()}>
				{(maskEid: number) => {
					const name = useEntityState(world.components.Name, maskEid, '');
					return (
						<ItemRow
							label="Mask"
							value={name()}
							icon={<Icon name="mask-small" />}
							class="text-foreground"
						>
							<Tooltip>
								<TooltipTrigger
									as={Button}
									size="icon"
									variant="ghost"
									class="text-muted-foreground"
									onClick={() => handleRemoveMask(maskEid)}
								>
									<Icon name="close-remove-small" />
								</TooltipTrigger>
								<TooltipContent>Remove mask</TooltipContent>
							</Tooltip>
						</ItemRow>
					);
				}}
			</For>
		</PanelSection>
	);
}

function createMask(world: EngineWorld, targetEid: number) {
	const c = world.components;

	world.history.transaction('Add mask', () => {
		const width = c.Computed.width[targetEid] ?? 0;
		const height = c.Computed.height[targetEid] ?? 0;

		const parentDelay = c.Computed.delay[targetEid] ?? 0;
		const parentStart = c.Computed.start[targetEid] ?? parentDelay;
		const parentEnd = c.Computed.end[targetEid] ?? parentDelay;

		const maskEid = createEntity(world);
		setComponent(world, maskEid, c.Geometry, GeometryType.RECT);
		setComponent(world, maskEid, c.Name, `${getNextName(world, 'Mask')} [Mask Shape]`);
		setComponent(world, maskEid, c.Position, { x: 20, y: 20 });
		setComponent(world, maskEid, c.Trim, { start: parentStart - parentDelay, end: parentEnd - parentDelay });
		resizeEntity(world, maskEid, { width, height });

		const fillEid = createEntity(world);
		setComponent(world, fillEid, c.Paint, PaintType.SOLID);
		setComponent(world, fillEid, c.Color, 0xFFFFFF);
		appendChild(world, fillEid, maskEid);

		addComponent(world, maskEid, c.IsMask);
		appendChild(world, maskEid, targetEid);
		addComponent(world, targetEid, c.Expanded);

		clearComponent(world, c.Selected);
		addComponent(world, maskEid, c.Selected);
	});
}
