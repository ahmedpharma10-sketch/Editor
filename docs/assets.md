# Working with media

The asset library holds a project's media. Beyond storage, the CLI ships an inspection toolchain under `dapi media` (probe, grab, visualize, transcribe, listen) so an agent can *look at* footage before cutting it. All of it runs locally except `listen` and `transcribe`, which use hosted models.

**Id or path:** every inspection command takes either an asset id or a local file path. A path is read directly, so `dapi media probe clip.mp4` works on a file that isn't in the project yet.

## The library

```sh
dapi asset add <paths...> [--folder <id>]   # import files
dapi asset ls [ids...]                      # raw asset records (all assets if no ids)
dapi asset tree [--folder <id>] [--depth N] # the library as a folder tree
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

Inspection lives under its own group, `dapi media`, because none of these commands touch the library: they read a media file by asset id or by local path and never mutate the project.

### `media probe`

```sh
dapi media probe <id|path>
```

Container and per-track technical metadata (format, duration, codec parameters), demuxed locally without decoding, like `ffprobe`. Packet stats (frame rate, bitrate) are estimated from a leading sample, so they're fast but approximate.

### `media grab`

```sh
dapi media grab <id|path> [-t <time...>] [-o <dir>]
```

Decodes video frames at the given timestamps to PNGs, at the asset's full resolution. Prints `{ time, path }` per frame. (For the *composited* canvas instead of the raw asset, use `dapi node screenshot`.)

### `media visualize`

```sh
dapi media visualize <id|path> [-s <start>] [-e <end>] [-x <scale>] [-o <path>]
```

Renders a one-image preview chosen by media type: audio gets an amplitude **waveform** with a time axis, video gets a **filmstrip** of evenly sampled frames with the audio waveform beneath it, and images get a thumbnail. `-s`/`-e` window the preview; `-x` trades thumbnail size against grid density. Prints `{ path }`.

### `media transcribe`

```sh
dapi media transcribe <id|path>
```

Transcribes speech in a video or audio file. Returns segments with **word-level start/end times in seconds**: the raw material for caption timing, jump cuts, and content search.

### `media listen`

```sh
dapi media listen <id|path> [-p <prompt>] [-s <start>] [-e <end>]
```

Puts a multimodal model in front of an audio track. Without a prompt, returns a general description of what is heard; with one, answers it ("who is speaking?", "what music is playing?"). Accepts an audio file or a video, but only the audio track is analyzed. `-s`/`-e` scope the analyzed segment; timestamps in the answer are relative to `-s`.


## A typical agent pass

```sh
dapi open -b ./shoot                                  # project from footage
dapi asset tree --depth 1                             # what's here?
dapi media probe gbHJ                                 # what format is it?
dapi media visualize gbHJ                             # what does it look like over time?
dapi media transcribe gbHJ                            # what is said, and when?
dapi media listen gbHJ -p "what is said in the intro?"
dapi mount cut.tsx                                    # compose the edit
dapi node screenshot                                  # verify visually
dapi node render -o cut.mp4                           # ship it
```
