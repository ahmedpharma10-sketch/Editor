# `dapi asset export <ids...>`

Writes one or more assets' original file bytes to a location on the file system: the exact bytes stored in the library, streamed to disk in chunks (never buffered whole). No re-encode, no processing, no credits. Any asset type is accepted except image sequences. The counterpart of [`asset add`](./add.md).

## Input

- `<ids...>`: asset ids (required)
- `-o, --output <path>`: where to write (optional; default the system temp directory). Interpreted as:
  - **a directory** when the path is an existing directory, ends with a path separator, or multiple ids are given. Created if missing. Each asset is written into it named after the asset, with an extension derived from its media type when the name lacks one. A name that collides with an existing file is uniquified with a ` (N)` suffix, never overwritten.
  - **a file path** otherwise (single id only). Written exactly there, overwriting an existing file.

## Output

JSON Lines on stdout, one per exported asset, in the requested order:

```ts
{ id: string; path: string }   // path = the file actually written
```

## Errors

Exits non-zero before writing anything if `--output` must be a directory (multiple ids, or a trailing path separator) but resolves to an existing file, if the output directory can't be created, if an id is unknown, or if an id is an image-sequence asset. An I/O failure mid-batch aborts the remaining writes and leaves no partial file for the failing asset; files written before it stay.
