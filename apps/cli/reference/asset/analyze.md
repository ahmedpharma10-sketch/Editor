# `dapi asset analyze <id|path>`

Analyzes an image, video, or audio asset with a multimodal model. With no prompt it returns a general description of the asset; with `--prompt` it answers that question about the asset (e.g. "what's the dominant color?", "summarize what happens").

## Input

- `<id|path>`: an image, audio, or video asset id, or a local file to add and analyze (required).
- `-p, --prompt <str>`: question or instruction about the asset (optional; defaults to a general description).
- `-s, --start <time>`: start of the segment to analyze, a `Time` value (optional; default `0`). Timestamps in the analysis are relative to this point. Ignored for images.
- `-e, --end <time>`: end of the segment to analyze, a `Time` value (optional; default the asset's duration). Ignored for images.

## Output

One JSON object, the model's answer:

```ts
{ id: string; analysis: string }   // id = the analyzed asset id
```

## Errors

Exits non-zero if the id is unknown, or the asset's media type isn't supported by the chosen model.
