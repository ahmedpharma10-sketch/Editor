/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, onCleanup } from 'solid-js';
import { toast } from 'somoto';
import { useWorld } from '@diffusionstudio/koota-solid';
import { mount } from '@diffusionstudio/reconciler';

import { compileProject, projectDir, watchProject } from './host';

import type { Mount } from '@diffusionstudio/reconciler';

export interface ProjectLoaderProps {
	/** Project folder name under the projects root. */
	name: string;
}

/**
 * Compiles the project folder, renders its JSX into the runtime world, and
 * re-renders on every change on disk. Renders nothing itself; mount it under
 * the koota EngineProvider.
 */
export function ProjectLoader(props: ProjectLoaderProps): null {
	const world = useWorld();

	createEffect(() => {
		const dir = projectDir(props.name);
		if (!dir) return;

		let mounted: Mount | undefined;
		let disposed = false;
		let generation = 0;

		const unmount = (): void => {
			mounted?.dispose();
			mounted = undefined;
		};

		const load = async (): Promise<void> => {
			const current = ++generation;
			const result = await compileProject(dir);
			if (disposed || current !== generation) return;

			// A broken edit keeps the last good render on the canvas.
			if (!result.ok) {
				toast.error('Project failed to compile', { description: result.error });
				return;
			}

			// The old render goes first: there is only one stage per world.
			unmount();
			try {
				mounted = mount(result.code, world);
			} catch (error) {
				toast.error('Project failed to render', { description: (error as Error).message });
			}
		};

		void load();
		const unwatch = watchProject(dir, () => void load());

		onCleanup(() => {
			disposed = true;
			unwatch();
			unmount();
		});
	});

	return null;
}
