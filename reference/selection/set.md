# `dapi selection set [ids...]`

Replaces the current selection with exactly the given node ids. No ids = clear the selection.

## Input

- `[ids...]`: zero or more node ids

## Output

JSON Lines, one per selected node (no output when clearing):

```ts
NodeRef   // { id: number; name: string; type: string }
```
