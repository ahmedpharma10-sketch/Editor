/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { RuntimeDocument } from './document';
import { evaluate } from './evaluate';
import { renderProject } from './renderer';

import type { World } from 'koota';

export interface Mount {
	/** Tears down the reactive graph and every entity the project rendered. */
	dispose(): void;
}

/**
 * Renders a compiled project bundle into `world`. Throws if the bundle does
 * not evaluate or its root is not a <stage>; nothing is left behind in the
 * world when it throws.
 */
export function mount(code: string, world: World): Mount {
	const component = evaluate(code);
	const document = new RuntimeDocument(world);

	let dispose: () => void;
	try {
		dispose = renderProject(component, document);
	} catch (error) {
		document.dispose();
		throw error;
	}

	return {
		dispose() {
			// Solid's universal render disposer only drops the reactive graph;
			// the document owns the entities.
			dispose();
			document.dispose();
		},
	};
}
