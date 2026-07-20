# `dapi node grep <pattern> [id]`

Searches entity records for a pattern and prints the matching entities, with the components that matched. The search corpus is the raw records [`node ls`](./ls.md) would emit (component values stringified), so anything `ls` can show, `grep` can find; the caveat carries over too: values are raw engine units (frames at 30 fps, packed colors, dB). `[id]` scopes the search to a subtree, like giving `grep -r` a path.

The structural counterpart of [`tree`](./tree.md) (find entities by content rather than by position) and the discovery front-end to `ls`, [`selection set`](../selection/set.md), and [`patch`](./patch.md): `grep` to find ids, then read, select, or edit them.

The common case (find nodes by name) is `dapi node grep -k Name Title`. Presence queries work with a match-anything pattern: `dapi node grep -k Trim .` lists every entity carrying a `Trim` component.

## Input

- `<pattern>`: JavaScript regex, unanchored (required). Case-sensitive unless `-i` is given.
- `[id]`: root entity id (optional; omitted = every top-level node's subtree)
- `-i, --ignore-case`: case-insensitive matching
- `-t, --type <types...>`: only match entities of these node types (e.g. `-t text image`; the `type` values of `node tree`)
- `-k, --component <names...>`: restrict matching to these components (e.g. `-k Name Chars`; the component keys of `node ls`)
- `-l, --refs-only`: output only the matching entity refs, no match detail
- `-c, --count`: output only the number of matching entities

## Output

JSON Lines, one per matching entity (no output if nothing matches; this is a successful run, exit `0`); the structured analog of grep's `file:line:content`:

```ts
NodeRef & { matches: Array<{ component: string; value: string }> }
// value is the stringified component value the pattern matched
```

With `--refs-only`, plain `NodeRef` lines; with `--count`, a single number.

## Errors

Exits non-zero if the pattern is not a valid regex, or if `[id]` doesn't resolve to a live entity.
