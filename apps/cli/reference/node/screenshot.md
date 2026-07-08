# `dapi node screenshot [id] [-t, --time <time>]`

Focuses the node on the canvas and captures a screenshot, written to a PNG file in the system temp directory. If `[id]` is omitted, captures the canvas (the active scene). To grab a video asset's own pixels at full resolution instead of the composited canvas, use [`asset frame`](../asset/frame.md).

## Input

- `[id]`: node id (optional; defaults to the canvas)
- `-t, --time <time>`: timeline position at which to record the node, a `Time` value (optional; defaults to the current playhead position)

## Output

One JSON object: the absolute path to a freshly written PNG in the system temp directory with a uuid filename.

```ts
{ path: string }   // e.g. "/tmp/3f2c1a8e-....png"
```
