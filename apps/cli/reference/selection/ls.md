# `dapi selection ls`

The currently selected nodes. Alias: `get`.

Mutating selection commands ([`set`](./set.md), [`focus`](./focus.md)) return the resulting selection state in this same shape, so callers can chain or assert without a follow-up read.

## Input

None.

## Output

JSON Lines, one per selected node (no output if nothing is selected):

```ts
NodeRef   // { id: number; name: string; type: string }
```
