# `dapi asset tree`

Prints the asset library of the open project as its folder tree: folders and assets interleaved in one array, each folder carrying its contents in `children`.

## Input

- `--folder <id>`: folder whose contents to list (optional; default the library root)
- `--depth <N>`: max depth, positive integer (optional; default = full tree). `--depth 1` yields just the direct entries of the listing root; a folder at the cutoff is listed without `children` (indistinguishable from a genuinely empty folder; raise the depth to tell them apart).

## Output

JSON Lines, one per entry of the listing root (no output if the listing root is empty); each entry carries its own subtree in `children`:

```ts
AssetTree = Array<(Asset | Folder) & { children?: AssetTree }>   // one root entry per line
```

Folders are the entries with type `folder`. `children` is present only on folders with contents; assets never carry it.

## Errors

Exits non-zero if `--folder` doesn't resolve to a folder.
