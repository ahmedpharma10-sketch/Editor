# `dapi asset transcribe [options] <id|path>`

Transcribes the speech in a video or audio asset and returns the timed transcript. Word-level start/end times are in **seconds** (source/content time).

## Input

- `<id|path>`: a video or audio asset id, or a local file to add and transcribe (required).

## Options

- `-s, --start <time>`: start of the range to print — seconds (`"1.5"`), frames (`"45f"`), or `"MM:SS"` (default: `0`).
- `-e, --end <time>`: end of the range to print — same formats (default: the asset duration).

The whole asset is always transcribed once (and cached on the asset); the range only limits which words are printed. Words keep their absolute source-time timestamps, and segments that straddle a range boundary are trimmed to the words inside it. A range with no speech yields `segments: []`.

## Output

One JSON object, the transcript:

```ts
{
  id:       string;     // the asset id
  segments: Array<{
    text:  string;      // spoken words only (no silence markers)
    words: Array<{ text: string; start: number; end: number }>;  // seconds
  }>;
}
```

## Errors

Exits non-zero if the id is unknown or the asset is not a video/audio asset, if `--start`/`--end` are malformed or `--start >= --end`, or if no speech is detected in the audio at all (`No speech detected`).
