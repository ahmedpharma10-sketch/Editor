# `dapi asset add <paths...>`

Adds one or more local files as assets in the open project. The counterpart of [`asset export`](./export.md).

## Input

- `<paths...>`: absolute or relative file paths (resolved against CWD)
- `--folder <id>`: folder to place the new assets in (optional; default the library root)

## Output

JSON Lines, one per input path:

```ts
| ({ status: "fulfilled"; path: string } & Asset)
| { status: "rejected"; path: string; error: string }
```

## Errors

Exits non-zero before importing anything if `--folder` doesn't resolve to a folder.
