# `dapi asset visualize <id|path>`

Renders a visual preview of an asset to a PNG, written to a file in the system temp directory. The visualization is chosen by the asset's media type, so a single command covers the whole library. Renders locally; no credits. Alias: `viz`.

## By media type

- **audio**: an amplitude waveform with a time axis, drawn from decoded audio peaks.
- **video**: a composite: a **filmstrip** of frames sampled at even intervals across the window, with the **waveform** of the video's audio track drawn beneath it, sharing one time axis. Videos with no audio track render the filmstrip alone.
- **image**: a thumbnail of the image, auto-scaled.

Tick labels use `HH:MM:SS:FF` timecode (hours, minutes, seconds, frame within the second) at every zoom level, so labels stay comparable regardless of the window's span. Frames count against the video's frame rate; the audio ruler has no video track and counts against a nominal 30 fps.

## Input

- `<id|path>`: an image, audio, or video asset id, or a local file to add and visualize (required).
- `-s, --start <time>`: start of the window to visualize, a `Time` value in source/content time (optional; default `0`). Ignored for images.
- `-e, --end <time>`: end of the window to visualize, a `Time` value (optional; default the asset's duration). Ignored for images.
- `-x, --scale <factor>`: scale factor for the thumbnails (optional; default `1`, clamped to `0.25`-`4`). The overall canvas size stays fixed, so smaller thumbnails fit **more rows and columns** (a denser grid sampling more moments) and larger thumbnails fit fewer but show more detail each. For images, scales the output resolution instead (never above the source size).
- `-o, --output <path>`: write the PNG here instead of a temp file (optional).

## Output

One JSON object, the absolute path to the written PNG:

```ts
{ path: string }   // e.g. "/tmp/3f2c1a8e-....png", or the --output path
```

## Errors

Exits non-zero if the id is unknown, the media type isn't visualizable (e.g. a transcript asset, or an audio asset with no decodable audio), `--start`/`--end` fall outside the asset or cross (`--start` >= `--end`), `--scale` isn't a positive number, or `--output` can't be written.
