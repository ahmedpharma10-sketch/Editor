# `dapi folder mv <ids...> [--to <folderId>]`

Moves one or more folders under a new parent. A folder cannot be moved into itself or any of its descendants; such a move rejects that id and leaves it where it was. Alias: `move`.

## Input

- `<ids...>`: folder ids (required)
- `--to <folderId>`: destination parent folder (optional; omitted = the library root)

## Output

JSON Lines, one per input id:

```ts
| { status: "fulfilled"; id: string; parentId: string | null }
| { status: "rejected"; id: string; error: string }   // unknown id, or a cycle
```

## Errors

Exits non-zero before moving anything if `--to` doesn't resolve to a folder.
