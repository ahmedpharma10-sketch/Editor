# `dapi folder mv <ids...> [--to <folderId>]`

Moves one or more folders under a new parent. A folder cannot be moved into itself or any of its descendants; such a move fails the command. Alias: `move`.

## Input

- `<ids...>`: folder ids (required)
- `--to <folderId>`: destination parent folder (optional; omitted = the library root)

## Output

JSON Lines on stdout, one per moved folder:

```ts
{ id: string; parentId: string | null }
```

## Errors

An unknown id, a cycle, or a `--to` that doesn't resolve to a folder fails the whole command before anything is moved.
