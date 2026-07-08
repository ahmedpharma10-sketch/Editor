# `dapi node ls [ids...]`

The raw entity records, exactly as persisted: every component the entity carries, keyed by component name. The property-level counterpart to [`node tree`](./tree.md)'s structure. With no ids, returns the root (top-level nodes). Alias: `get`.

## Input

- `[ids...]`: zero or more entity ids (optional)

## Output

JSON Lines, one per entity:

```ts
EntityRecord = { id: string; eid: number } & { [component: string]: unknown }
// e.g. Name, Size, Position, Rotation, Paint, Color, Trim, ChildOf (parent eid), …
```

Records are raw engine data: times are frames at 30 fps, colors are packed `0xRRGGBB` integers, volume is dB.

## Errors

If any input id fails to resolve, writes a per-id message to stderr and exits non-zero after emitting all successful records to stdout.
