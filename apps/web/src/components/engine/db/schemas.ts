/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { transcriptionOutput } from "@diffusionstudio/api-contract";
import { ElectronFileHandle } from "@/lib/electron-file-handle";

export const aspectRatioSchema = z.enum(["1:1", "4:3", "3:4", "16:9", "9:16"]);
export type AspectRatio = z.infer<typeof aspectRatioSchema>;

export const imageGenerationConfigSchema = z.object({
  mode: z.literal("IMAGE"),
  model: z.string(),
  prompt: z.string(),
  aspectRatio: aspectRatioSchema,
  count: z.number().int().min(1).max(4),
  imageRefIds: z.array(z.string()).optional(),
});

export const videoGenerationConfigSchema = z.object({
  mode: z.literal("VIDEO"),
  model: z.string(),
  prompt: z.string(),
  aspectRatio: aspectRatioSchema,
  duration: z.number().int().min(1),
  generateAudio: z.boolean().optional(),
  startFrameImageId: z.string().optional(),
  endFrameImageId: z.string().optional(),
});

export const voiceGenerationConfigSchema = z.object({
  mode: z.literal("VOICE"),
  model: z.string(),
  prompt: z.string(),
  voice: z.string(),
});

export const audioGenerationConfigSchema = z.object({
  mode: z.literal("AUDIO"),
  model: z.string(),
  prompt: z.string(),
});

export const generationConfigSchema = z.discriminatedUnion("mode", [
  imageGenerationConfigSchema,
  videoGenerationConfigSchema,
  voiceGenerationConfigSchema,
  audioGenerationConfigSchema,
]);

export type ImageGenerationConfig = z.infer<typeof imageGenerationConfigSchema>;
export type VideoGenerationConfig = z.infer<typeof videoGenerationConfigSchema>;
export type VoiceGenerationConfig = z.infer<typeof voiceGenerationConfigSchema>;
export type AudioGenerationConfig = z.infer<typeof audioGenerationConfigSchema>;
export type GenerationConfig = z.infer<typeof generationConfigSchema>;

export const folderSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export type Folder = z.infer<typeof folderSchema>;

export const assetBaseSchema = z.object({
  id: z.string(),
  hash: z.string(),
  createdAt: z.iso.datetime(),
  lastModified: z.number().optional(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number().optional(),
  handle: z.union([
    z.instanceof(FileSystemFileHandle),
    z.instanceof(ElectronFileHandle),
  ]),
  generationId: z.string().nullable().optional(),
  generationKey: z.string().nullable().optional(),
  folderId: z.string().nullable().optional(),
});

export const imageAssetSchema = assetBaseSchema.extend({
  type: z.literal('IMAGE'),
  width: z.number(),
  height: z.number(),
});

export type ImageAsset = z.infer<typeof imageAssetSchema>;

export const audioAssetSchema = assetBaseSchema.extend({
  type: z.literal('AUDIO'),
  duration: z.number(),
  sampleRate: z.number(),
  channels: z.number(),
  transcript: transcriptionOutput.optional(),
});

export type AudioAsset = z.infer<typeof audioAssetSchema>;

export const videoAssetSchema = assetBaseSchema.extend({
  type: z.literal('VIDEO'),
  duration: z.number(),
  width: z.number(),
  height: z.number(),
  frameRate: z.number(),
  bitRate: z.number(),
  sampleRate: z.number().optional(),
  channels: z.number().optional(),
  transcript: transcriptionOutput.optional(),
});

export type VideoAsset = z.infer<typeof videoAssetSchema>;

export const transcriptAssetSchema = assetBaseSchema.extend({
  type: z.literal('TRANSCRIPT'),
});

export type TranscriptAsset = z.infer<typeof transcriptAssetSchema>;

// `handle` points to the first frame's file (so generic preview/thumbnail
export const sequenceAssetSchema = assetBaseSchema.extend({
  type: z.literal('SEQUENCE'),
  width: z.number(),
  height: z.number(),
  frameRate: z.number(),
  duration: z.number(),
  directoryHandle: z.instanceof(FileSystemDirectoryHandle),
});

export type SequenceAsset = z.infer<typeof sequenceAssetSchema>;

export const assetSchema = z.discriminatedUnion('type', [
  imageAssetSchema,
  audioAssetSchema,
  videoAssetSchema,
  transcriptAssetSchema,
  sequenceAssetSchema,
]);

export type Asset = z.infer<typeof assetSchema>;
