/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, onCleanup } from 'solid-js';
import { toast } from 'somoto';
import { useWorld } from '@diffusionstudio/koota-solid';
import { mount } from '@diffusionstudio/reconciler';
import { ActiveScene, Camera, Position, RenderSurface, Size } from '@diffusionstudio/runtime';

import { compileProject, projectDir, watchProject } from './host';

import type { Mount } from '@diffusionstudio/reconciler';
import type { World } from 'koota';

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
		// Only the first mount of a project frames the camera; reloads keep the view.
		let fitted = false;

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

			// The old render goes first: there is only one active stage per world.
			unmount();
			try {
				mounted = mount(result.code, world);
			} catch (error) {
				toast.error('Project failed to render', { description: (error as Error).message });
				return;
			}

			if (!fitted) fitted = await fitCameraToStage(world);
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

const FIT_PADDING = 48;
const FIT_RETRIES = 30;

/**
 * Centers the active stage in the canvas. The canvas is sized by a resize
 * observer, so right after mount it may still be 0x0: retry a few frames.
 * Resolves true once the camera was set (or there is nothing to fit).
 */
function fitCameraToStage(world: World): Promise<boolean> {
	return new Promise((resolve) => {
		let attempts = 0;
		const attempt = (): void => {
			const stage = world.get(ActiveScene)?.entity;
			if (!stage) return resolve(true);

			const surface = world.get(RenderSurface);
			const canvas = surface?.canvas;
			const resolution = surface?.resolution || 1;
			const width = canvas ? canvas.width / resolution : 0;
			const height = canvas ? canvas.height / resolution : 0;

			if (!width || !height) {
				if (++attempts >= FIT_RETRIES) return resolve(false);
				requestAnimationFrame(attempt);
				return;
			}

			const size = stage.get(Size) ?? { width: 1, height: 1 };
			const position = stage.get(Position) ?? { x: 0, y: 0 };
			const scale = Math.min(
				(width - FIT_PADDING * 2) / Math.max(1, size.width),
				(height - FIT_PADDING * 2) / Math.max(1, size.height),
			);
			world.set(Camera, {
				a: scale,
				b: 0,
				c: 0,
				d: scale,
				e: (width - size.width * scale) / 2 - position.x * scale,
				f: (height - size.height * scale) / 2 - position.y * scale,
			});
			resolve(true);
		};
		attempt();
	});
}
