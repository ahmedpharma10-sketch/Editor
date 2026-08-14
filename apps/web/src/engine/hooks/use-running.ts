/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, onCleanup, type Accessor } from 'solid-js';

import { useEngineContext } from '../context';

/** Reactive read of whether the engine's tick loop is running. */
export function useRunning(): Accessor<boolean> {
	const engine = useEngineContext();
	const [running, setRunning] = createSignal(engine.running);

	onCleanup(engine.onRunningChange(setRunning));

	return running;
}
