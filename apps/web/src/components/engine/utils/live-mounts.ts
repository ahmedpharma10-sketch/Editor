/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * JSX mounts keep their Solid reactive graph running after
 * the mount lands, so signals, effects, and timers keep driving the mounted
 * entities. A run stays alive until the world is
 * disposed or a later mount claims one of its root keys: the keyed root
 * replacement already deletes its entities, so the superseded graph is
 * disposed with them. Root keys are read live rather than snapshotted, so
 * roots a running graph adds or removes later still reconcile.
 */
export type LiveMount = {
	/** Identity shared by every entity of this mount; unique per running graph. */
	mountId: string;
	rootKeys: () => string[];
	advance: () => void;
	dispose: () => void;
};

export type LiveMounts = ReturnType<typeof createLiveMounts>;

export function createLiveMounts() {
	const mounts = new Set<LiveMount>();
	return {
		advance(): void {
			for (const mount of mounts) {
				mount.advance();
			}
		},
		hasMount(mountId: string): boolean {
			for (const mount of mounts) {
				if (mount.mountId === mountId) return true;
			}
			return false;
		},
		supersede(keys: string[]): void {
			for (const mount of mounts) {
				if (keys.some((key) => mount.rootKeys().includes(key))) {
					mount.dispose();
					mounts.delete(mount);
				}
			}
		},
		register(mount: LiveMount): void {
			mounts.add(mount);
		},
		disposeAll(): void {
			for (const mount of mounts) mount.dispose();
			mounts.clear();
		},
	};
}
