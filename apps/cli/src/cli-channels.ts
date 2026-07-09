/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { PatchProps } from "@diffusionstudio/jsx";

// Wire-level channels for the CLI-forwarding path. Main only knows these two —
// it does not inspect logical channel names. The renderer mirrors requests
// back onto FORWARD_REPLY, correlated by envelope id.
export const CLI_WIRE = {
  FORWARD_REQ: "cli:fwd:req",
  FORWARD_REPLY: "cli:fwd:reply",
} as const;

// Logical channels — known only to the CLI and renderer. `cli:ping` is a
// built-in: the renderer's bridge auto-registers it so `waitForCliSocket`
// can probe end-to-end without depending on an app-level handler.
export const CLI_CHANNELS = {
  PING: "cli:ping",
  CONTEXT: "cli:context",
  ASSETS_ADD: "cli:assets:add",
  ASSETS_LIST: "cli:assets:list",
  ASSET_TREE: "cli:asset:tree",
  ASSETS_DELETE: "cli:assets:delete",
  ASSETS_MOVE: "cli:assets:move",
  ASSETS_EXPORT: "cli:assets:export",
  FOLDERS_LIST: "cli:folders:list",
  FOLDER_CREATE: "cli:folder:create",
  FOLDER_RENAME: "cli:folder:rename",
  FOLDERS_MOVE: "cli:folders:move",
  FOLDERS_DELETE: "cli:folders:delete",
  ASSET_PROBE: "cli:asset:probe",
  ASSET_FRAME: "cli:asset:frame",
  ASSET_TRANSCRIBE: "cli:asset:transcribe",
  ASSET_VISUALIZE: "cli:asset:visualize",
  ASSET_ANALYZE: "cli:asset:analyze",
  SELECTION_LIST: "cli:selection:list",
  SELECTION_SET: "cli:selection:set",
  SELECTION_FOCUS: "cli:selection:focus",
  NODE_LIST: "cli:node:list",
  NODE_TREE: "cli:node:tree",
  NODE_GREP: "cli:node:grep",
  NODE_SCREENSHOT: "cli:node:screenshot",
  MOUNT: "cli:mount",
  NODE_INSERT: "cli:node:insert",
  NODE_DELETE: "cli:node:delete",
  NODE_PATCH: "cli:node:patch",
  NODE_DUPLICATE: "cli:node:duplicate",
  NODE_RENDER: "cli:node:render",
  PROJECT_ACTIVE: "cli:project:active",
  PROJECT_LIST: "cli:project:list",
  PROJECT_CREATE: "cli:project:create",
  PROJECT_DELETE: "cli:project:delete",
  PROJECT_OPEN: "cli:project:open",
  MODELS: "cli:models",
  VOICES: "cli:voices",
  WHOAMI: "cli:whoami",
} as const;

export type CliChannel = (typeof CLI_CHANNELS)[keyof typeof CLI_CHANNELS];

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

export type AssetProbeRequest = { id: string };

export type AssetFrameRequest = { id: string; times?: number[] };
export type AssetFrameResult = Array<{ time: number; base64: string }>;

export type AssetTranscribeRequest = { id: string; start?: number; end?: number };
export type TranscriptWord = { text: string; start: number; end: number };
export type TranscriptSegment = { text: string; words: TranscriptWord[] };
export type AssetTranscribeResult = { id: string; segments: TranscriptSegment[] };

export type AssetVisualizeRequest = { id: string; start?: number; end?: number; scale?: number };
export type AssetVisualizeResult = {
  base64: string;
} & Record<string, unknown>;

export type AssetAnalyzeRequest = { id: string; prompt?: string; start?: number; end?: number };
export type AssetAnalyzeResult = { id: string; analysis?: string; start?: number; end?: number };

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

export type CliRequestMap = {
  [CLI_CHANNELS.PING]: { request: void; response: void };
  [CLI_CHANNELS.CONTEXT]: { request: void; response: any };
  [CLI_CHANNELS.ASSETS_ADD]: {
    request: { paths: string[]; folderId?: string };
    response: any;
  };
  [CLI_CHANNELS.ASSETS_LIST]: {
    request: { ids?: string[] };
    response: AssetListResult[];
  };
  [CLI_CHANNELS.ASSET_TREE]: {
    request: { folderId?: string; depth?: number };
    response: AssetTreeEntry[];
  };
  [CLI_CHANNELS.ASSETS_DELETE]: { request: { ids: string[] }; response: any };
  [CLI_CHANNELS.ASSETS_MOVE]: {
    request: { ids: string[]; to?: string };
    response: AssetMoveResult[];
  };
  [CLI_CHANNELS.ASSETS_EXPORT]: {
    request: AssetsExportRequest;
    response: AssetExportResult[];
  };
  [CLI_CHANNELS.FOLDERS_LIST]: {
    request: { parentId?: string };
    response: FolderInfo[];
  };
  [CLI_CHANNELS.FOLDER_CREATE]: {
    request: { name: string; parentId?: string };
    response: FolderInfo;
  };
  [CLI_CHANNELS.FOLDER_RENAME]: {
    request: { id: string; name: string };
    response: FolderInfo;
  };
  [CLI_CHANNELS.FOLDERS_MOVE]: {
    request: { ids: string[]; to?: string };
    response: FolderMoveResult[];
  };
  [CLI_CHANNELS.FOLDERS_DELETE]: {
    request: { ids: string[] };
    response: FolderDeleteResult[];
  };
  [CLI_CHANNELS.ASSET_PROBE]: {
    request: AssetProbeRequest;
    response: unknown;
  };
  [CLI_CHANNELS.ASSET_FRAME]: {
    request: AssetFrameRequest;
    response: AssetFrameResult;
  };
  [CLI_CHANNELS.ASSET_TRANSCRIBE]: {
    request: AssetTranscribeRequest;
    response: AssetTranscribeResult;
  };
  [CLI_CHANNELS.ASSET_VISUALIZE]: {
    request: AssetVisualizeRequest;
    response: AssetVisualizeResult;
  };
  [CLI_CHANNELS.ASSET_ANALYZE]: {
    request: AssetAnalyzeRequest;
    response: AssetAnalyzeResult;
  };
  [CLI_CHANNELS.SELECTION_LIST]: { request: void; response: NodeRef[] };
  [CLI_CHANNELS.SELECTION_SET]: {
    request: { ids: number[] };
    response: NodeRef[];
  };
  [CLI_CHANNELS.SELECTION_FOCUS]: { request: void; response: NodeRef[] };
  [CLI_CHANNELS.NODE_LIST]: {
    request: { ids?: number[] };
    response: NodeListResult[];
  };
  [CLI_CHANNELS.NODE_TREE]: {
    request: { id?: number; depth?: number };
    response: NodeTree[];
  };
  [CLI_CHANNELS.NODE_GREP]: {
    request: NodeGrepRequest;
    response: NodeGrepResult[];
  };
  [CLI_CHANNELS.NODE_SCREENSHOT]: {
    request: { id?: number; frame?: number };
    response: { base64: string };
  };
  [CLI_CHANNELS.MOUNT]: {
    request: MountRequest;
    response: MountResult;
  };
  [CLI_CHANNELS.NODE_INSERT]: {
    request: NodeInsertRequest;
    response: MountResult;
  };
  [CLI_CHANNELS.NODE_DELETE]: {
    request: { ids: number[] };
    response: NodeDeleteResult[];
  };
  [CLI_CHANNELS.NODE_PATCH]: {
    request: { patches: NodePatch[] };
    response: NodePatchResult[];
  };
  [CLI_CHANNELS.NODE_DUPLICATE]: {
    request: { ids: number[] };
    response: NodeDuplicateResult[];
  };
  [CLI_CHANNELS.NODE_RENDER]: {
    request: NodeRenderRequest;
    response: NodeRenderResult;
  };
  [CLI_CHANNELS.PROJECT_ACTIVE]: {
    request: void;
    response: { id: string; name: string } | null;
  };
  [CLI_CHANNELS.PROJECT_LIST]: {
    request: void;
    response: ProjectSummary[];
  };
  [CLI_CHANNELS.PROJECT_CREATE]: {
    request: { name?: string };
    response: { id: string; name: string };
  };
  [CLI_CHANNELS.PROJECT_DELETE]: {
    request: { id: string };
    response: { id: string; name: string };
  };
  [CLI_CHANNELS.PROJECT_OPEN]: {
    request: { id: string };
    response: { id: string; name: string } | null;
  };
  [CLI_CHANNELS.MODELS]: {
    request: ModelsRequest;
    response: ModelInfo[];
  };
  [CLI_CHANNELS.VOICES]: {
    request: void;
    response: VoiceInfo[];
  };
  [CLI_CHANNELS.WHOAMI]: {
    request: void;
    response: { id: string; email: string; provider: string } | null;
  };
};

export type CliRequestChannel = keyof CliRequestMap;

export type CliRequest = {
  id: string;
  channel: CliRequestChannel;
  data: unknown;
};

export type CliReply =
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; error: string };
