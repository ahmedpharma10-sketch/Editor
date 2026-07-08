# `dapi selection focus`

Pans and zooms the canvas to fit the currently selected nodes in view, framing them with padding; the same focus [`node screenshot`](../node/screenshot.md) uses before it captures. No-op if nothing is selected (the canvas is left unchanged).

## Input

None.

## Output

JSON Lines, one per selected node (no output if nothing is selected):

```ts
NodeRef   // { id: number; name: string; type: string }
```
