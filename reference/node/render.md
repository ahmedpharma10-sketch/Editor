# `dapi node render [id] ([config] | --json <str>)`

Renders a scene to a video file. Composes the scene frame-by-frame and muxes the result, writing it to disk. Operates on one scene; scenes are nodes, so this is the node-level render. If `[id]` is omitted, renders the active scene.

Encode settings are passed as a single JSON config: the same object the in-app render method takes (`EncoderConfig`), minus the runtime-only fields the CLI fills in for you (`scene`, `target`, `onProgress`). The whole config is **optional**; omit it to render with the defaults below. The encode window follows the scene's timeline workarea (its `Trim`): the render starts at the workarea start and runs to the scene's end, unless capped earlier with `trim.end`. Renders locally; **no credits** and no authenticated account required.

Like the generators, this is **long-running**: the CLI blocks until the render finishes (or fails) before printing. While waiting, a progress spinner with elapsed time is shown on **stderr** (a single static line when stderr isn't a TTY), so stdout stays clean JSON for piping.

## Input

- `[id]`: scene node id (optional; defaults to the active scene).
- `-o, --output <path>`: write the video here (optional; default a uuid-named file in the system temp directory). The container extension is derived from the config's `format`.
- Encode config (optional), at most one of:
  - `[config]`: path to a `.json` file containing the config object. Node ids are integers, so a lone non-numeric positional is read as the config path (`dapi node render encode.json` works without an id).
  - `--json <str>`: the object inline

Config shape (every field optional; all defaults shown):

```ts
{
  format?: "mp4" | "webm" | "ogg" | "mov";    // default "mp4"; sets the output extension
  video?: {
    codec?:      "avc" | "hevc" | "vp9" | "av1" | "vp8";  // default "avc" (H.264); valid codecs depend on format
    enabled?:    boolean;   // default true
    bitrate?:    number;    // bits/sec, default 10_000_000 (10 Mbps)
    fps?:        number;    // default the scene's frame rate
    resolution?: number;    // target height in px (e.g. 720, 1080, 1440, 2160); default 1080. Width follows the scene's aspect ratio
  };
  audio?: {
    enabled?:          boolean;          // default true; set false to render video only
    codec?:            "aac" | "opus";   // default "aac"; valid codecs depend on format
    bitrate?:          number;           // bits/sec, default 128_000 (128 kbps)
    sampleRate?:       number;           // Hz, e.g. 44100, 48000, 96000; default 48000
    numberOfChannels?: number;           // default 2
  };
  trim?: {
    end?: number;   // seconds; cap the encode here. Default the scene's full duration. Caps the workarea end; cannot extend past the scene
  };
}
```

## Output

One JSON object: the absolute path to the written video file.

```ts
{ path: string }   // e.g. "/tmp/3f2c1a8e-....mp4", or the --output path
```

## Errors

Exits non-zero if the id is unknown or the node is not a scene (`Not a scene`), if no scene is active and `[id]` is omitted, if the config is malformed or holds a value out of range or incompatible with the chosen `format` (e.g. an unsupported codec), if `--output` can't be written, or if the render fails or is canceled.
