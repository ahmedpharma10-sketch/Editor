# `dapi asset ls [ids...]`

The raw asset records, as persisted minus the file handles: every serializable property the asset carries (per-type media metadata, `folderId`, a stored `transcript`, …). The property-level counterpart to [`asset tree`](./tree.md)'s structure. With no ids, returns every asset in the library. Alias: `get`.

## Input

- `[ids...]`: zero or more asset ids (optional)

## Output

JSON Lines, one per asset:

```ts
AssetRecord = { id: string } & { [property: string]: unknown }
// e.g. name, type, mimeType, size, createdAt, folderId; duration/width/height/… by type
```

## Errors

If any input id fails to resolve, writes a per-id message to stderr and exits non-zero after emitting all successful records to stdout.
