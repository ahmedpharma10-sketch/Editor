/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Container format for export. Lives in the runtime (not the encoder
// package) because the ExportSettings trait persists it; the encoder
// imports it from here.

export type ContainerFormat = 'mp4' | 'webm' | 'ogg' | 'mov';
