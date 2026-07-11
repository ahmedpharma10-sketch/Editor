# `dapi node capture [id] [-t, --time <time...>]`

Focuses the node on the canvas and captures it, writing one PNG to the system temp directory per timeline position. If `[id]` is omitted, captures the canvas (the active scene). To grab a video asset's own pixels at full resolution instead of the composited canvas, use [`media grab`](../media/grab.md).

## Input

- `[id]`: node id (optional; defaults to the canvas)
- `-t, --time <time...>`: one or more timeline positions at which to record the node, each a `Time` value (optional; defaults to the current playhead position)

## Output

One JSON object per line (JSON Lines), in the order the times were given: each has the requested time in seconds (`null` for the current playhead) and the absolute path to a freshly written PNG in the system temp directory with a uuid filename.

```ts
{ time: number | null, path: string }   // e.g. { "time": 1.5, "path": "/tmp/3f2c1a8e-....png" }
```
