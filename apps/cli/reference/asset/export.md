# `dapi asset export <ids...>`

Writes one or more assets' original file bytes to a location on the file system: the exact bytes stored in the library, streamed to disk in chunks (never buffered whole). No re-encode, no processing, no credits. Any asset type is accepted except image sequences. The counterpart of [`asset add`](./add.md).

## Input

- `<ids...>`: asset ids (required)
- `-o, --output <path>`: where to write (optional; default the system temp directory). Interpreted as:
  - **a directory** when the path is an existing directory, ends with a path separator, or multiple ids are given. Created if missing. Each asset is written into it named after the asset, with an extension derived from its media type when the name lacks one. A name that collides with an existing file is uniquified with a ` (N)` suffix, never overwritten.
  - **a file path** otherwise (single id only). Written exactly there, overwriting an existing file.

## Output

JSON Lines, one per input id, in the requested order:

```ts
| { status: "fulfilled"; id: string; path: string }   // path = the file actually written
| { status: "rejected"; id: string; error: string }
```

## Errors

Exits non-zero before writing anything if `--output` must be a directory (multiple ids, or a trailing path separator) but resolves to an existing file, or if the output directory can't be created. An unknown id, or an image-sequence asset, rejects that id only; a rejected asset leaves no partial file behind.
