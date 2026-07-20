# `dapi asset mv <ids...> [--to <folderId>]`

Moves one or more assets into a folder. Alias: `move`.

## Input

- `<ids...>`: asset ids (required)
- `--to <folderId>`: destination folder (optional; omitted = the library root)

## Output

JSON Lines on stdout, one per moved asset:

```ts
{ id: string; folderId: string | null }
```

## Errors

An unknown asset id, or a `--to` that doesn't resolve to a folder, fails the whole command before anything is moved.
