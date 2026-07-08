# `dapi asset mv <ids...> [--to <folderId>]`

Moves one or more assets into a folder. Alias: `move`.

## Input

- `<ids...>`: asset ids (required)
- `--to <folderId>`: destination folder (optional; omitted = the library root)

## Output

JSON Lines, one per input id:

```ts
| { status: "fulfilled"; id: string; folderId: string | null }
| { status: "rejected"; id: string; error: string }
```

## Errors

Exits non-zero before moving anything if `--to` doesn't resolve to a folder; an unknown asset id rejects that id only.
