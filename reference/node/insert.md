# `dapi node insert <parentId> <code> [--index <N>]`

Compiles an inline JSX fragment and inserts its rendered roots as children of an existing entity; the same pipeline as [`mount`](../mount.md), including declared asset generation, but instead of mounting into the document it inserts under an existing parent. Because the result is inserted rather than reconciled, root elements take no `key`: every run inserts fresh entities; there is no replace-or-create matching and nothing is deleted.

The payload is **bare JSX tags** — no `export default`, no file path. Unlike `mount`, an insert renders once and is then discarded: it is never persisted, restored, or kept live, so a component that relies on reactivity (signals, effects, `useTicker`) has nothing to drive it. Reach for [`mount`](../mount.md) when you want a live, reproducible program. The full JSX syntax lives in [jsx/](../jsx/README.md).

The rendered roots must be valid as children of the target parent, following the JSX containment rules: a node parent takes any element or paint root except a scene (an element carrying `scene`, which exists only at the document top level) and `<colorStop>`; a gradient paint parent takes only `<colorStop>` roots. That is how a stop is added to an existing gradient (`node insert <paintId> '<colorStop offset={0.5} color="#FF0055" />'`); other sub-entities take no children.

## Input

- `<parentId>`: entity id of the parent to insert into (required)
- `<code>`: inline JSX tags to insert, e.g. `'<rect width={100} height={100} />'` (required). Bare tags only — the source is rejected before contacting the app if it contains `export default` or doesn't look like JSX.
- `-i, --index <N>`: the inserted node's 0-based position among the parent's children, a non-negative integer (optional; default = append after the last child; values past the end are clamped). Node roots only: paints stack in insertion order and color stops render sorted by `offset`, so `--index` is rejected for them.

## Output

None.

## Errors

Exits non-zero if `<code>` is not a bare JSX fragment (contains `export default`, or has no tags), if `<parentId>` doesn't resolve to a live entity, if compilation or evaluation fails, if a rendered root is invalid as a child of the parent (e.g. a scene carrying `scene`, or a non-`<colorStop>` in a gradient paint), or if `--index` is given for a paint or color stop root. On any of these, **nothing is inserted**.
