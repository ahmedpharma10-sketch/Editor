# `dapi asset rm <ids...>`

Deletes one or more assets from the open project by id. Alias: `remove`.

## Input

- `<ids...>`: asset ids (required)

## Output

JSON Lines, one per input id:

```ts
| { status: "fulfilled"; id: string; name: string }
| { status: "rejected"; id: string; error: string }
```
