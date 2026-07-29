# `dapi node capture <id> [-t, --time <time...>]`

Renders a node in isolation and writes one PNG per timeline position, each named after the `HH-MM-SS-FF` timecode of the frame actually rendered (e.g. `00-00-01-12.png`). The node is drawn offscreen at 720p height, tightly framed to its own bounds on a transparent background; siblings and overlapping scene content are not included, so capture a scene id to check composition. To grab a video asset's own pixels at full resolution instead of the composited node, use [`media grab`](../media/grab.md).


## Input

- `<id>`: node id to capture (required)
- `-t, --time <time...>`: one or more positions to capture, relative to the node's start (`0` = its first visible frame), each a `Time` value (optional; default `0`)
- `-o, --output <dir>`: directory to write the PNGs into (optional; default a fresh `dapi-capture-*` directory in the system temp directory, so runs never overwrite each other). Writing into the same directory twice overwrites captures whose timecode matches; requested times that land on the same frame share one file.

## Output

One JSON object per line (JSON Lines), in the order the times were given: the requested time in seconds and the absolute path to the written PNG.

```ts
{ time: number, path: string }   // e.g. { "time": 1.5, "path": "/tmp/dapi-capture-3f2c1a8e/00-00-01-15.png" }
```
