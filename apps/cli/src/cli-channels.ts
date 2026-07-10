/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { PatchProps } from "@diffusionstudio/jsx";

// Wire-level channel for the CLI handshake. Each CLI command hosts a
// short-lived WebSocket server; main's only job is to relay the connect
// info to the renderer, which then dials the CLI directly. Main never sees
// request payloads.
export const CLI_WIRE = {
  CONNECT: "cli:connect",
} as const;

// Sent by the CLI to main over the unix socket, relayed verbatim to the
// renderer. The token guards the loopback WebSocket server against other
// local processes racing to connect first.
export type CliHandshake = { port: number; token: string };

export type CliHandshakeReply = { ok: true } | { ok: false; error: string };

// One tRPC request/reply pair per WebSocket connection. `path` is the
// dot-joined procedure path in the renderer's router (e.g. "media.frame");
// procedure inputs and outputs are typed end-to-end via the AppRouter type,
// so the wire envelope stays untyped.
export type CliRequest = {
  path: string;
  input: unknown;
};

export type CliReply =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export type NodeRef = { id: number; name: string; type: string };

export type EntityRecord = { id: string; eid: number } & Record<string, unknown>;

export type NodeListResult =
  | { status: "fulfilled"; node: EntityRecord }
  | { status: "rejected"; id: number; error: string };

export type NodeTree = NodeRef & {
  description: string;
  children?: NodeTree[];       // child nodes (masks listed separately)
  masks?: NodeTree[];
  paints?: NodeTree[];         // fills
  strokes?: NodeTree[];
  shadows?: NodeTree[];
  effects?: NodeTree[];
  colorStops?: NodeTree[];     // on gradient paints
  textRanges?: NodeTree[];     // on text nodes
  keyframeTracks?: NodeTree[]; // keyframes nest beneath their track
  keyframes?: NodeTree[];
  animations?: NodeTree[];
};

export type NodeGrepRequest = {
  pattern: string;
  ignoreCase?: boolean;
  id?: number;          // scope to this entity's subtree; omitted = the whole document
  types?: string[];     // only match entities of these node types
  components?: string[]; // restrict matching to these components
};

export type NodeGrepMatch = { component: string; value: string };

export type NodeGrepResult = NodeRef & { matches: NodeGrepMatch[] };

export type NodeDeleteResult =
  | { status: "fulfilled"; id: number }
  | { status: "rejected"; id: number; error: string };

export type MountRequest = {
  code: string;
};

export type MountResult =
  | { status: "fulfilled" }
  | { status: "rejected"; error: string };

export type NodeInsertRequest = {
  code: string;
  parentId: number;
  index?: number;
};

export type NodePatch = { id: number } & PatchProps;

export type NodePatchResult =
  | { status: "fulfilled"; id: number }
  | { status: "rejected"; id: number; error: string };

export type NodeDuplicateResult =
  | { status: "fulfilled"; sourceId: number; newId: number }
  | { status: "rejected"; sourceId: number; error: string };

export type EncoderConfigInput = {
  format?: "mp4" | "webm" | "ogg" | "mov";
  video?: {
    codec?: "avc" | "hevc" | "vp9" | "av1" | "vp8";
    enabled?: boolean;
    bitrate?: number;
    fps?: number;
    resolution?: number;
  };
  audio?: {
    enabled?: boolean;
    codec?: "aac" | "opus";
    bitrate?: number;
    sampleRate?: number;
    numberOfChannels?: number;
  };
  trim?: { end?: number };  // seconds; caps the encode end
};

export type NodeRenderRequest = { id?: number; output: string; config?: EncoderConfigInput };
export type NodeRenderResult = { path: string };

export type AssetRef = { id: string } | { path: string };

export type MediaProbeRequest = AssetRef;

export type MediaFrameRequest = AssetRef & { times?: number[]; resolution?: number };
export type MediaFrameResult = Array<{ time: number; base64: string }>;

export type MediaTranscribeRequest = AssetRef & { start?: number; end?: number };
export type TranscriptWord = { text: string; start: number; end: number };
export type TranscriptSegment = { text: string; words: TranscriptWord[] };
export type MediaTranscribeResult = { segments: TranscriptSegment[] };

export type MediaVisualizeRequest = AssetRef & { start?: number; end?: number; scale?: number };
export type MediaVisualizeResult = {
  base64: string;
} & Record<string, unknown>;

export type MediaListenRequest = AssetRef & { prompt?: string; start?: number; end?: number; stripVideo?: boolean };
export type MediaListenResult = { analysis?: string; start?: number; end?: number };

export type GeneratedAsset = { id: string; name: string; type: string };

export type FolderInfo = { id: string; name: string; type: "folder" };

export type AssetTreeEntry = { id: string; name: string; type: string; children?: AssetTreeEntry[] };

export type AssetRecord = { id: string } & Record<string, unknown>;

export type AssetListResult =
  | { status: "fulfilled"; asset: AssetRecord }
  | { status: "rejected"; id: string; error: string };

export type AssetMoveResult =
  | { status: "fulfilled"; id: string; folderId: string | null }
  | { status: "rejected"; id: string; error: string };

export type AssetsExportRequest = { ids: string[]; output: string; isDir: boolean };

export type AssetExportResult =
  | { status: "fulfilled"; id: string; path: string }
  | { status: "rejected"; id: string; error: string };

export type FolderMoveResult =
  | { status: "fulfilled"; id: string; parentId: string | null }
  | { status: "rejected"; id: string; error: string };

export type FolderDeleteResult =
  | { status: "fulfilled"; id: string; deletedFolders: number; deletedAssets: number }
  | { status: "rejected"; id: string; error: string };

export type ModelsRequest = { type?: "image" | "video" | "audio" };

export type ModelInfo = {
  type: "image" | "video" | "audio";
  id: string;
  name: string;
  durations?: string[];
  aspectRatios?: string[];
  features?: Array<"start-frame" | "end-frame" | "audio">;
};

export type VoiceInfo = { id: string; label: string; description: string };

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: string;
  lastAccessedAt: string;
};

