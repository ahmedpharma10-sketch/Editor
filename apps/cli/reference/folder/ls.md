# `dapi folder ls [parentId]`

Lists the direct child folders of a parent folder, sorted by name. With no id, lists the root-level folders. Aliases: `list`, `get`.

Folders organize the asset library and nest arbitrarily; assets reference their containing folder via `folderId` (`null` = library root). Everywhere a folder id is optional, omitting it means the library root; there is no sentinel value for the root. Read the full hierarchy (folders and assets together) with [`asset tree`](../asset/tree.md); move assets between folders with [`asset mv`](../asset/mv.md).

## Input

- `[parentId]`: parent folder id (optional; omitted = the library root)

## Output

JSON Lines, one per child folder (no output if the parent has no subfolders):

```ts
Folder   // { id: string; name: string; type: 'folder' }
```

## Errors

Exits non-zero if `[parentId]` doesn't resolve to a folder.
