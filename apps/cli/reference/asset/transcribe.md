# `dapi asset transcribe <id|path>`

Transcribes the speech in a video or audio asset and returns the timed transcript. Word-level start/end times are in **seconds** (source/content time).

## Input

- `<id|path>`: a video or audio asset id, or a local file to add and transcribe (required).

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

Exits non-zero if the id is unknown or the asset is not a video/audio asset, or if no speech is detected in the audio (`No speech detected`).
