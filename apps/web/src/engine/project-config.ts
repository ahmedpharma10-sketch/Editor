/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The project's config in the app: what is about the project rather than the
// composition (how it is exported, for a start), kept in the `diffusion`
// field of its package.json — the project record — rather than in the JSX,
// which says what the composition is. Attached to the world for the project
// on disk, like the library: the world holds the handle, the handle holds
// the values as signals for the panels to read, and writes go to the file.
// Nothing here is the runtime's business (a headless world is not exported
// by its own settings; the encoder is handed its config), so no trait.
//
// Project-wide today. Per-scene settings would come as a further key here
// (e.g. `scenes: { [name]: { export } }`) and a per-scene accessor, falling
// back to the project's.

import { createSignal } from 'solid-js';
import { useTrait, useWorld } from '@diffusionstudio/koota-solid';

import { readProjectConfig, writeProjectConfig } from '@/projects/host';
import { ProjectConfig as ProjectConfigTrait } from './traits';

import type { VideoCodec, AudioCodec } from 'mediabunny';
import type { World } from 'koota';
import type { Accessor } from 'solid-js';

/** The file the config lives in, relative to the project. */
export const PROJECT_CONFIG_FILE = 'package.json';

export type ContainerFormat = 'mp4' | 'webm' | 'ogg' | 'mov';

export type ExportVideoSettings = {
	enabled?: boolean;
	codec?: VideoCodec;
	bitrate?: number;
	fps?: number;
	resolution?: number;
};

export type ExportAudioSettings = {
	enabled?: boolean;
	codec?: AudioCodec;
	sampleRate?: number;
	bitrate?: number;
};

/**
 * How the project is exported, in the shape the encoder takes its config
 * (format + video + audio), so the value goes to it as it is. `template`
 * names the editor preset the values came from — only a label, the fields
 * are what the export reads.
 */
export type ExportConfig = {
	template?: string;
	format?: ContainerFormat;
	video?: ExportVideoSettings;
	audio?: ExportAudioSettings;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const string = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const boolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

/** An object without its `undefined` entries, so the file does not spell them. */
function compact<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/**
 * The export field as read from the file: the same shape, with anything of
 * the wrong type left out rather than trusted. Undefined when it is not an
 * object, i.e. no export is set up.
 */
export function parseExportConfig(value: unknown): ExportConfig | undefined {
	if (!isRecord(value)) return undefined;

	let video: ExportVideoSettings | undefined;
	if (isRecord(value.video)) {
		video = compact({
			enabled: boolean(value.video.enabled),
			codec: string(value.video.codec) as ExportVideoSettings['codec'],
			bitrate: number(value.video.bitrate),
			fps: number(value.video.fps),
			resolution: number(value.video.resolution),
		});
	}

	let audio: ExportAudioSettings | undefined;
	if (isRecord(value.audio)) {
		audio = compact({
			enabled: boolean(value.audio.enabled),
			codec: string(value.audio.codec) as ExportAudioSettings['codec'],
			sampleRate: number(value.audio.sampleRate),
			bitrate: number(value.audio.bitrate),
		});
	}

	return compact({
		template: string(value.template),
		format: string(value.format) as ContainerFormat | undefined,
		video,
		audio,
	});
}

/**
 * The config of the project at `dir`. `load` reads the file; the setters
 * update the signal first and write the file after, so a panel sees its
 * change at once. Fields the app does not know are carried through a write
 * untouched.
 */
export class ProjectConfig {
	private readonly world: World;
	private readonly dir: string;
	private raw: Record<string, unknown> = {};
	private disposed = false;
	private readonly exportSignal = createSignal<ExportConfig | null>(null);

	public constructor(world: World, dir: string) {
		this.world = world;
		this.dir = dir;
	}

	/** How the project is exported, or null until it is set up. Reactive. */
	public get export(): Accessor<ExportConfig | null> {
		return this.exportSignal[0];
	}

	/** Reads the config from the project. */
	public async load(): Promise<void> {
		let value: unknown = null;
		try {
			value = await readProjectConfig(this.dir);
		} catch (error) {
			console.warn('Failed to read the project config', error);
		}
		if (this.disposed) return;

		this.raw = isRecord(value) ? value : {};
		this.exportSignal[1](parseExportConfig(this.raw.export) ?? null);
	}

	/** Sets how the project is exported (null for none): here now, in the file after. */
	public async setExport(settings: ExportConfig | null): Promise<void> {
		const next = { ...this.raw };
		if (settings) next.export = exportToJson(settings);
		else delete next.export;
		this.raw = next;
		this.exportSignal[1](settings && exportToJson(settings));

		try {
			await writeProjectConfig(this.dir, Object.keys(next).length ? next : null);
		} catch (error) {
			console.warn('Failed to write the project config', error);
		}
	}

	/** Detaches the config from the world. */
	public dispose(): void {
		this.disposed = true;
		if (this.world.get(ProjectConfigTrait) === this) {
			this.world.set(ProjectConfigTrait, null);
		}
	}
}

/** The export settings as they are spelled in the file: no `undefined`s, no empty sections. */
function exportToJson(settings: ExportConfig): ExportConfig {
	const video = settings.video && compact({ ...settings.video });
	const audio = settings.audio && compact({ ...settings.audio });
	return compact({
		template: settings.template,
		format: settings.format,
		video: video && Object.keys(video).length ? video : undefined,
		audio: audio && Object.keys(audio).length ? audio : undefined,
	});
}

/**
 * Creates the config of the project at `dir`, attaches it to the world and
 * starts loading it. Returns it; `dispose` detaches it.
 */
export function attachProjectConfig(world: World, dir: string): ProjectConfig {
	const config = new ProjectConfig(world, dir);
	world.set(ProjectConfigTrait, config);
	void config.load();
	return config;
}

/** Whether a changed project file holds the config. */
export function isProjectConfigFile(path: string): boolean {
	return path === PROJECT_CONFIG_FILE;
}

/** The world's project config, or undefined until a project attaches one. */
export function useProjectConfig(): Accessor<ProjectConfig | undefined> {
	const world = useWorld();
	const attached = useTrait(world, ProjectConfigTrait);
	return () => attached() ?? undefined;
}
