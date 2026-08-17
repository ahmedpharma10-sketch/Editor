/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from 'koota';

import { ToolType } from '../constants';


export const Tool = trait({ value: ToolType.MOVE });

export const Selected = trait();

export const Interactive = trait();

export const Hovering = trait();

export const Dragging = trait();

// Timeline canvas view state (scroll/zoom).
export const Timeline = trait({
	scrollX: 0,
	scrollY: 0,
	resolution: 1,
	transform: () => new DOMMatrix(),
});

// Snapshot of a clip's timing at the moment a drag started.
export const ClipDragOrigin = trait({ delay: 0, start: 0, end: 0 });

export const KeyframeDragOrigin = trait({ time: 0 });

// Snapshot of the clip's start/end frames at the moment a trim interaction
// began. Tagged on the single clip being trimmed; removed on release.
export const TrimDragOrigin = trait({ start: 0, end: 0 });
