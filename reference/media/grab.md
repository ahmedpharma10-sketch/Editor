# `dapi media grab <id|path>`

Decodes one or more frames of a video asset at the given times and writes each to a PNG file; like [`node capture`](../node/capture.md), but grabs the asset's own pixels at full resolution (unlike `node capture`, which captures the composited canvas). Renders locally; no credits.

## Input

- `<id|path>`: a video asset id, or a local video file to grab frames from in place without adding it to the library (required).
- `-t, --time <time...>`: one or more timestamps to grab, `Time` values in source/content time (optional; default `0`). A negative value is an offset back from the end of the clip, so `-1` is one second before the end and `-1f` one frame before it. Order is preserved in the output regardless of the order given. Mutually exclusive with `--count`.
- `-c, --count <n>`: instead of `--time`, grab `n` frames evenly spaced across the clip at a fixed interval of `window / n`, starting at the window start (optional; positive integer).
- `-s, --start <time>`: with `--count`, the start of the window to sample (optional; `Time` value; default `0`).
- `-e, --end <time>`: with `--count`, the end of the window to sample (optional; `Time` value; default the asset duration).
- `-q, --quality <preset>`: per-frame resolution preset (optional; default `small`). One of `small` (384x384), `medium` (768x768), `large` (1536x1536), or `fullres` (native). Each caps the total pixel count while preserving aspect ratio.
- `--no-timestamp`: don't stamp each frame with its `HH:MM:SS:FF` timestamp label (optional; the label is drawn by default).
- `--uncapped`: lift the 100-frame safety cap (optional). Without it, requesting more than 100 frames (via `--count` or `--time`) is rejected.
- `-o, --output <dir>`: directory to write the PNGs into (optional; default the system temp directory). Each frame is written as a uuid-named `.png`.

## Output

JSON Lines, one object per requested timestamp, in the requested order:

```ts
{ time: number; path: string }   // time = the requested timestamp in seconds; path = the written PNG
```

## Errors

Exits non-zero if the id is unknown, the asset is not a video, any `--time` is past the asset's duration, the `--count` window is empty, `--time` and `--count` are combined, `--start`/`--end` are given without `--count`, more than 100 frames are requested without `--uncapped`, or a PNG can't be written.
