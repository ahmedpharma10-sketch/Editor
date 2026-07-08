# `dapi node cp <ids...>`

Deep-clones one or more nodes, including all descendants. Alias: `duplicate`.

## Input

- `<ids...>`: one or more node ids (required)

## Output

JSON Lines, one per input id:

```ts
| { status: "fulfilled"; sourceId: number; newId: number }
| { status: "rejected"; sourceId: number; error: string }
```
