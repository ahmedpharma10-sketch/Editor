# `dapi node tree [id] [--depth N]`

An entity's subtree as a nested JSON object: structure only, every entity and sub-entity included, and the way to discover their ids. Key characteristics are folded into a compact `description` built from whatever the entity carries; use [`node ls`](./ls.md) for exact property values. The root is level 0, so `--depth 1` yields the root plus its immediate children.

## Input

- `[id]`: root entity id (optional; omitted = one tree per top-level node, mirroring `ls`)
- `--depth <N>`: max depth, non-negative integer (optional; default `3`, `0` = full subtree)

## Output

JSON Lines, one nested object per root; category arrays are omitted when empty:

```ts
NodeTree = NodeRef & {
  description:     string;      // e.g. "hidden; size: 200x300; text: Hello World"
  children?:       NodeTree[];  // child nodes (masks listed separately)
  masks?:          NodeTree[];
  paints?:         NodeTree[];  // fills
  strokes?:        NodeTree[];
  shadows?:        NodeTree[];
  effects?:        NodeTree[];
  colorStops?:     NodeTree[];  // on gradient paints
  textRanges?:     NodeTree[];  // on text nodes
  keyframeTracks?: NodeTree[];  // keyframes nest beneath their track
  keyframes?:      NodeTree[];
  animations?:     NodeTree[];
}
```
