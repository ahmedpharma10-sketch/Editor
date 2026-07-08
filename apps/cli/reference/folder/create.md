# `dapi folder create <name> [-p, --parent <id>]`

Creates a folder.

## Input

- `<name>`: folder name (required)
- `-p, --parent <id>`: parent folder (optional; omitted = the library root)

## Output

One JSON object:

```ts
Folder   // { id: string; name: string; type: 'folder' }
```

## Errors

Exits non-zero if `--parent` doesn't resolve to a folder.
