# `dapi node patch ([path] | --json <str>)`

Assigns JSX props on one or more existing entities in a single call. Every patch entry takes the same properties, with the same value requirements, as a JSX element in [`mount`](../mount.md); the single property table lives in [jsx/elements.md](../jsx/elements.md) and is not repeated here (the payload type is `PatchProps` from `@diffusionstudio/jsx`). Patches are applied through the same setters as a render, so the two surfaces cannot diverge. Changes are tracked for undo like a UI edit.

Any live entity is addressable, not just nodes: paints and color stops can be patched too (`color`, `offset`, `opacity`, gradient `rotation`). There is no separate rename command: renaming a node is patching its `name`.

## Input

Exactly one of:

- `[path]`: path to a `.json` file containing the patch array
- `--json <str>`: the array inline

Payload shape:

```ts
Array<{ id: number } & PatchProps>
```

All props are optional; a patch may set any subset. An unsupported property or an out-of-range value rejects that entity; a rejected patch applies none of its props (no half-applied patches). Notes beyond the JSX table:

- `fill` recolors the entity's existing solid fill(s), or creates one if the entity has none.
- `src` takes a path, URL, or asset id (`generate.*` declarations are JSX-only). The source resolves asynchronously after the other props land; if resolution fails, the entity is reported rejected even though its other props were applied. Patch `src` on its own to avoid ambiguity.
- `syncTo` re-runs audio alignment against the document node carrying the given key and writes the entity's `start` from the measured offset (see [jsx/audio-sync.md](../jsx/audio-sync.md)). The command blocks until alignment settles; a failed alignment rejects the entity.
- `transition` sets, merges into, or (with `null`) removes the clip's transition into the next clip (see [jsx/transitions.md](../jsx/transitions.md)).
- Keyframe lists are accepted wherever the property is animatable, with the same semantics as mount (see [jsx/keyframes.md](../jsx/keyframes.md)); a static value replaces any existing keyframes.
- Element applicability is not checked: props are applied wherever `mount` would apply them (e.g. `fontSize` only makes sense on a text node).

## Output

JSON Lines, one per input id:

```ts
| { status: "fulfilled"; id: number }
| { status: "rejected"; id: number; error: string }
```
