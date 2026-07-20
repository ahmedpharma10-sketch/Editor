# `dapi node cp <ids...>`

Deep-clones one or more nodes, including all descendants. Alias: `duplicate`.

## Input

- `<ids...>`: one or more node ids (required)

## Output

JSON Lines on stdout, one per cloned node:

```ts
{ sourceId: number; newId: number }
```

## Errors

An unknown id fails the whole command before anything is cloned.
