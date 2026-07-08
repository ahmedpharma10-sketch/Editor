# CLI reference

`dapi` drives a running Diffusion Studio instance over a local socket. Every command except `open` and `fonts` needs the app running; launch it with `dapi open` (add `-b` for headless).

## Conventions

- **stdout is JSON.** Single results are one JSON value; collections and batch results are JSON Lines (one object per line, no surrounding array). `mount` and `node insert` print nothing on success.
- **stderr is for humans:** error messages and progress spinners.
- **Exit codes:** `0` on success, `1` on any error.
- **Unix names are canonical:** `ls`, `rm`, `cp`, `mv`, `grep`. The English forms (`list`, `remove`, `duplicate`, `move`) are aliases, and `get` is an alias for every `ls`.
- **Group aliases:** `selection`→`sel`, `node`→`n`, `project`→`p`, `asset`→`a`, `folder`→`fld`, `context`→`ctx`.
- **Batch commands** (`node rm`, `node patch`, `asset add`, …) emit one `{ status: "fulfilled" | "rejected", … }` line per input, so partial failures are visible per item.

### Time values

Wherever a command takes a time, three formats are accepted (frames are at 30 fps):

| Format | Example | Meaning |
| --- | --- | --- |
| number | `2.2` | seconds |
| `"<n>f"` | `"45f"` | frames |
| clock | `"02:30"`, `"01:02:30"` | MM:SS or HH:MM:SS |

Times in output are plain seconds, except in `node ls`, whose raw records use engine units (frames, packed `0xRRGGBB` colors, dB).

## App

### `open`

```sh
dapi open [target] [-b, --background]
```

Launches the app, or opens a target: a file, a `diffusion://` deep link, or a **folder**, which creates a project from the folder's media (or switches to the one created earlier; see [Getting started](getting-started.md#turn-a-folder-of-footage-into-a-project)). `--background` launches with no window, for headless use. The only command that doesn't need the app already running (besides `fonts`).

### `whoami`

Prints the signed-in account `{ id, email, provider }`, or `null`.

### `context`

Prints the open project's essentials: project id and name, entity count, scenes with sizes, the active scene, the playhead position (frames), and available font families. Call it first.

## Composing

### `mount`

```sh
dapi mount (<path> | --code <str>)
```

Compiles a Solid JSX module and mounts its rendered roots into the document. Re-mounting rebuilds keyed roots in place, like reloading a webpage. Declared generative assets are produced during the mount, which blocks until they land. With `--code`, a bare JSX expression is wrapped into a module automatically. See [Writing compositions](composition.md).

### `node insert`

```sh
dapi node insert <parentId> (<path> | --code <str>) [-i, --index <N>]
```

Same pipeline as `mount`, but inserts the rendered roots as children of an existing entity instead of mounting document roots. Roots take no `key`; every run inserts fresh nodes. `--index` sets the position among the parent's children (node roots only). Also how you extend sub-entities, e.g. adding a stop to a gradient:

```sh
dapi node insert <paintId> --code '<colorStop offset={0.5} color="#FF0055" />'
```

### `node patch`

```sh
dapi node patch ([path.json] | --json <str>)
```

Assigns JSX props on existing entities. The payload is an array of `{ id, …props }`, taking exactly the props a JSX element takes (see the [element reference](composition.md#elements)). A rejected entry applies none of its props. Renaming is patching `name`; recoloring is patching `fill`; paints and color stops are patchable too. A [transition](composition.md#transitions) is patched as a `transition` prop on the outgoing clip (`null` removes it).

```sh
dapi node patch --json '[{ "id": 42, "x": 100, "opacity": 0.5 }]'
```

Note: `src` resolves asynchronously after the other props; patch it on its own to keep failure reporting unambiguous.

## Inspecting the scene graph

### `node tree`

```sh
dapi node tree [id] [--depth N]
```

An entity's subtree as nested JSON: structure only, with a compact `description` per node. The way to discover ids. Default depth `3`; `0` means the full subtree. Omit the id for one tree per top-level node.

### `node ls`

```sh
dapi node ls [ids...]
```

The raw entity records: every component the entity carries, in engine units. The property-level counterpart to `tree`. With no ids, lists the top-level nodes.

### `node grep`

```sh
dapi node grep <pattern> [id] [-i] [-t <types...>] [-k <components...>] [-l] [-c]
```

Searches entity records by regex and prints matching entities with the components that matched. `[id]` scopes to a subtree. `-t` filters by node type, `-k` restricts to specific components, `-l` prints refs only, `-c` prints a count. Find nodes by name with `dapi node grep -k Name Title`; find every entity with a `Trim` component with `dapi node grep -k Trim .`.

### `node screenshot`

```sh
dapi node screenshot [id] [-t, --time <time>]
```

Focuses the node (or the active scene, if omitted) and captures it to a PNG at the given timeline position. Prints `{ path }`.

### `selection`

```sh
dapi selection ls            # the selected nodes
dapi selection set [ids...]  # replace the selection (no ids = clear)
dapi selection focus         # pan/zoom the canvas to the selection
```

Mutations print the resulting selection, so calls can be chained without a follow-up read.

## Editing nodes

### `node cp`

Deep-clones nodes including descendants: `dapi node cp <ids...>`. Prints `{ sourceId, newId }` per input.

### `node rm`

Deletes nodes and their descendants: `dapi node rm <ids...>`.

## Rendering

### `node render`

```sh
dapi node render [id] [-o, --output <path>] ([config.json] | --json <str>)
```

Renders a scene to a video file, locally. Defaults to the active scene and an MP4 (H.264, 10 Mbps, 1080p, AAC 128 kbps) in the temp directory; prints `{ path }`. Long-running: progress goes to stderr, stdout stays clean JSON. The encode window follows the scene's workarea.

All config fields are optional:

```jsonc
{
  "format": "mp4",                 // "mp4" | "webm" | "ogg" | "mov"
  "video": {
    "codec": "avc",                // "avc" | "hevc" | "vp9" | "av1" | "vp8"
    "bitrate": 10000000,           // bits/sec
    "fps": 30,                     // default: the scene's frame rate
    "resolution": 1080,            // target height; width follows the scene's aspect
    "enabled": true
  },
  "audio": {
    "codec": "aac",                // "aac" | "opus"
    "bitrate": 128000,
    "sampleRate": 48000,
    "numberOfChannels": 2,
    "enabled": true                // false = video only
  },
  "trim": { "end": 30 }            // seconds; cap the encode
}
```

## Projects

```sh
dapi project active          # the open project, or null
dapi project ls              # all projects, most recent first
dapi project create [name]   # create and open
dapi project set <id>        # switch to a project
dapi project rm <id>         # delete
```

## Assets and folders

The library commands (`asset add/ls/mv/rm/export`, `folder ls/create/rename/mv/rm`) and the media-inspection commands (`probe`, `transcribe`, `analyze`, `visualize`, `frame`) are covered in [Working with media](assets.md).

## Discovery

### `models`

```sh
dapi models [image|video|audio]
```

Lists the generation models available per media type, with each model's id and its constraints (durations, aspect ratios, features). These are what you reference from `generate.*` declarations.

### `voices`

Lists the speech voices for `generate.voice` declarations.

### `fonts`

```sh
dapi fonts [-f <pattern>] [-w <weights...>] [-s normal|italic] [-l <n>] [-n]
```

Lists local font families and variants (macOS only). `-n` prints plain family names. Works without the app running.
