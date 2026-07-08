# `dapi node rm <ids...>`

Deletes one or more entities and all their descendants. Alias: `remove`.

## Input

- `<ids...>`: one or more entity ids (required)

## Output

JSON Lines, one per input id:

```ts
| { status: "fulfilled"; id: number }
| { status: "rejected"; id: number; error: string }
```
