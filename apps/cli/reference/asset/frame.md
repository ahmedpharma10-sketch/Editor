# `dapi asset frame <id|path>`

Decodes one or more frames of a video asset at the given times and writes each to a PNG file; like [`node screenshot`](../node/screenshot.md), but grabs the asset's own pixels at full resolution (unlike `node screenshot`, which captures the composited canvas). Renders locally; no credits.

## Input

- `<id|path>`: a video asset id, or a local video file to add and grab frames from (required).
- `-t, --time <time...>`: one or more timestamps to grab, `Time` values in source/content time (optional; default `0`). Order is preserved in the output regardless of the order given.
- `-o, --output <dir>`: directory to write the PNGs into (optional; default the system temp directory). Each frame is written as a uuid-named `.png`.

## Output

JSON Lines, one object per requested timestamp, in the requested order:

```ts
{ time: number; path: string }   // time = the requested timestamp in seconds; path = the written PNG
```

## Errors

Exits non-zero if the id is unknown, the asset is not a video, any `--time` is past the asset's duration, or a PNG can't be written.
