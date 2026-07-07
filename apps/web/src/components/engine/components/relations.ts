/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createRelation, withAutoRemoveSubject } from 'bitecs';

/**
 * Universal parent-child relation. Replaces all array-based ownership:
 * Hierarchy.parent/children, Fills, Shadows, Strokes, Effects,
 * TextRanges, Timeline.tracks, Track.clips, Track.animations.
 *
 * Uses withAutoRemoveSubject so removing a parent auto-removes its children.
 * Children are distinguished by their type tags (Fill, Node, Track, etc.).
 * Ordering is encoded via the Index component on each child.
 */
export const ChildOf = createRelation(withAutoRemoveSubject);
