# `dapi asset add <paths...>`

Adds one or more local files as assets in the open project. The counterpart of [`asset export`](./export.md).

## Input

- `<paths...>`: absolute or relative file paths (resolved against CWD)
- `--folder <id>`: folder to place the new assets in (optional; default the library root)

## Output

JSON Lines on stdout, one `AssetRecord` per added file (the same shape [`asset ls`](./ls.md) prints).

## Errors

Exits non-zero before importing anything if `--folder` doesn't resolve to a folder. A file that fails to import fails the whole command with `<path>: <reason>` on stderr; files imported before the failure stay in the library.
