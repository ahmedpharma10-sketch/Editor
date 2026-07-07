# Working with media

The asset library holds a project's media. Beyond storage, the CLI ships an inspection toolchain (probe, decode, visualize, transcribe, analyze) so an agent can *look at* footage before cutting it. All of it runs locally except `analyze` and `transcript`, which use hosted models.

**Id or path:** every inspection command takes either an asset id or a local file path. A path is imported into the library first, then inspected, so `dapi asset probe clip.mp4` works on a file that isn't in the project yet.

## The library

```sh
dapi asset add <paths...> [--folder <id>]   # import files
dapi asset ls [--folder <id>] [--depth N]   # the library as a folder tree
dapi asset mv <ids...> [--to <folderId>]    # move assets between folders
dapi asset rm <ids...>                      # delete assets
dapi asset export <ids...> [-o <path>]      # write original file bytes back to disk (no re-encode)
```

Folders nest arbitrarily and are managed with `dapi folder`:

```sh
dapi folder ls [parentId]
dapi folder create <name> [-p, --parent <id>]
dapi folder rename <id> <name>
dapi folder mv <ids...> [--to <folderId>]
dapi folder rm <ids...>    # cascades: deletes all descendant folders AND assets;
                           # the output reports the deleted counts
```

Omitting a folder id anywhere always means the library root. (Opening a folder with `dapi open ./dir` builds this tree automatically from the directory structure; see [Getting started](getting-started.md#turn-a-folder-of-footage-into-a-project).)

## Inspecting media

### `asset probe`

```sh
dapi asset probe <id|path>
```

Container and per-track technical metadata (format, duration, codec parameters), demuxed locally without decoding, like `ffprobe`. Packet stats (frame rate, bitrate) are estimated from a leading sample, so they're fast but approximate.

### `asset frame`

```sh
dapi asset frame <id|path> [-t <time...>] [-o <dir>]
```

Decodes video frames at the given timestamps to PNGs, at the asset's full resolution. Prints `{ time, path }` per frame. (For the *composited* canvas instead of the raw asset, use `dapi node screenshot`.)

### `asset visualize`

```sh
dapi asset visualize <id|path> [-s <start>] [-e <end>] [-x <scale>] [-o <path>]
```

Renders a one-image preview chosen by media type: audio gets an amplitude **waveform** with a time axis, video gets a **filmstrip** of evenly sampled frames with the audio waveform beneath it, and images get a thumbnail. `-s`/`-e` window the preview; `-x` trades thumbnail size against grid density. Prints `{ path }`.

### `asset transcript`

```sh
dapi asset transcript <id|path>
```

Transcribes speech in a video or audio asset. Returns segments with **word-level start/end times in seconds**: the raw material for caption timing, jump cuts, and content search.

### `asset analyze`

```sh
dapi asset analyze <id|path> [-p <prompt>] [-s <start>] [-e <end>]
```

Puts a multimodal model in front of an image, video, or audio asset. Without a prompt, returns a general description; with one, answers it ("what's the dominant color?", "when is the product shown?"). `-s`/`-e` scope the analyzed segment; timestamps in the answer are relative to `-s`.


## A typical agent pass

```sh
dapi open -b ./shoot                                  # project from footage
dapi asset ls --depth 1                               # what's here?
dapi asset probe gbHJ                                 # what format is it?
dapi asset visualize gbHJ                             # what does it look like over time?
dapi asset transcript gbHJ                            # what is said, and when?
dapi asset analyze gbHJ -p "best moment for a thumbnail?"
dapi mount cut.tsx                                    # compose the edit
dapi node screenshot                                  # verify visually
dapi node export -o cut.mp4                           # ship it
```
