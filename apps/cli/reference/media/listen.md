# `dapi media listen <id|path>`

Puts a multimodal model in front of an audio track and returns its answer. With no prompt it returns a general description of what is heard; with `--prompt` it answers that question about the audio (e.g. "who is speaking?", "what music is playing?", "summarize what is said"). Accepts an audio file or a video, but only the audio track is analyzed: for what is on screen in a video, use `visualize` first.

## Input

- `<id|path>`: an audio or video asset id, or a local file to analyze in place without adding it to the library (required).
- `-p, --prompt <str>`: question or instruction about the audio (optional; defaults to a general description).
- `-s, --start <time>`: start of the segment to analyze, a `Time` value (optional; default `0`). Timestamps in the analysis are relative to this point.
- `-e, --end <time>`: end of the segment to analyze, a `Time` value (optional; default the asset's duration).

## Output

One JSON object, the model's answer:

```ts
{ analysis: string }
```

## Errors

Exits non-zero if the id is unknown, or the asset isn't a video or audio asset.
