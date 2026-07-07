# Dapi CLI Reference

User-facing reference for the `dapi` CLI. All canvas/project commands talk to the running Diffusion Studio app over a local socket. Responses are JSON written to stdout. Errors print to stderr and exit non-zero.

**Top-level:** `open`, `whoami`, `context` (alias `ctx`), `mount`, `models`, `voices`.
**Groups:** `selection` (alias `sel`), `node` (aliases `n`, `entity`), `project` (alias `p`), `asset` (alias `a`), `folder` (alias `fld`), `font` (alias `f`).
Selection reads and mutations live under `selection`. Anything that targets one or more nodes lives under `node` — scenes are nodes too; they are created declaratively via `mount` (`<scene key="...">`). Declarative composition happens through `mount`, which renders a Solid JSX project into the canvas (see [jsx-spec.md](./jsx-spec.md)); `node insert` runs the same pipeline but inserts the rendered nodes into an existing parent entity instead of mounting document roots. AI asset generation (image / video / speech / audio) is **declared in the project module** and produced on mount (see the JSX API); the `models` and `voices` commands list what's available to reference from those declarations. Inspecting an existing asset (probe / transcript / analyze / visualize / frame) lives under `asset`; writing an asset's original file back out to disk is `asset export`. Organizing the asset library into folders lives under `folder`; moving assets between folders is `asset mv`.

Shared types used below:

```ts
NodeRef = { id: number; name: string; type: string }   // node ids are entity ids — integers
Size    = { width: number; height: number }
Asset   = { id: string; name: string; type: string } // asset ids are opaque strings (sqids)
Folder  = { id: string; name: string; type: 'folder' } // folder ids are opaque strings (sqids)
Time    = number | `${number}f` | "MM:SS"            // seconds, frames at 30 fps ("45f"), or a clock string — see jsx-spec.md
```

Time inputs take the `Time` format unless noted otherwise. Times in **outputs** are plain seconds — except the raw records of `node ls`, which use engine units (frames at 30 fps, packed colors, dB).

---

## App

### `dapi open [target]`

Launches Diffusion Studio, or opens a target. Behavior depends on what `[target]` resolves to.

- **Input:** `[target]` — optional. One of:
  - *omitted* — launches the app.
  - **`diffusion://...` URL** — follows the deep link.
  - **file path** — opens the file in the app.
  - **folder path** — see "Folder open" below.
- **Options:**
  - `-b, --background` — launch with the window hidden (`show: false`), so the app runs headlessly and can be driven by other CLI commands without any visible UI.
- **Output:**
  - File / URL / no target: nothing.
  - Folder: one JSON object (see below).
- **Notes:** does not require the app to already be running.

#### Folder open

When `[target]` is a directory, `open` either creates a project from the folder's contents or switches to a previously created one. The decision is driven by a `.dapi` marker file at the folder root.

**First time** (no marker present):

1. Creates a new project named after the folder.
2. Imports every supported asset file under the folder (recursively, excluding the marker itself), mirroring the on-disk directory structure as library folders. Directories without any supported assets beneath them produce no folder.
3. Writes the `.dapi` marker at the folder root with the new project id.
4. Opens the project.

**Subsequent times** (marker present):

1. Reads the project id from the marker.
2. Switches to that project. No re-import.
3. If the referenced project no longer exists, the marker is treated as stale and the first-time flow runs again, overwriting the marker.

**Marker file** — `.dapi` at the folder root. JSON:

```ts
{
  version:   1;
  projectId: string;
  createdAt: string;   // ISO 8601
}
```

Add to `.gitignore` to keep project association per-clone, or commit it to share the same project across teammates.

**Output:** one JSON object

```ts
{
  project:  { id: string; name: string };
  created:  boolean;     // true if a new project was created this run (first-time or stale-marker)
  imported: number;      // assets imported this run; 0 on switch-only
}
```

---

### `dapi whoami`

Prints the authenticated account, or `null` if signed out.

- **Input:** none
- **Output:** one JSON value
  ```ts
  { id: string; email: string; provider: string } | null
  ```

---

## Document

### `dapi context`

Essential context about the open project. Call this first to understand the canvas situation. Alias: `ctx`.

- **Input:** none
- **Output:** one JSON object
  ```ts
  {
    project:        { id: string; name: string };
    entityCount:    number;
    scenes:         Array<{ id: number; name: string; size: Size }>;
    activeSceneId:  number | null;   // null if no scene is active
    currentFrame:   number;          // current timeline playhead position, in frames
    fontFamilies:   string[];
  }
  ```
---

## Scripting

### `dapi mount (<path> | --code <str>)`

Compiles a Solid JSX project module and executes it in the app, mounting the rendered roots into the document — like reloading a webpage, re-mounting rebuilds them in place instead of adding copies. Every top-level element declares its identity in the JSX with a `key`: `<scene key="intro">` replaces the node carrying that key (or creates it). With `--code`, the `export default () =>` wrapper is optional — a bare JSX expression (no `export default` in the source) is wrapped into a component module automatically. Full specification: [jsx-spec.md](./jsx-spec.md).

- **Output:** none.

---

## Selection

All under `dapi selection` (alias `dapi sel`). Mutating commands return the resulting selection state in the same shape as `selection ls`, so callers can chain or assert without a follow-up read.

### `dapi selection ls`

The currently selected nodes. Alias: `get`.

- **Input:** none
- **Output:** JSON Lines, one per selected node (no output if nothing is selected)
  ```ts
  NodeRef
  ```

---

### `dapi selection set [ids...]`

Replaces the current selection with exactly the given node ids. No ids = clear the selection.

- **Input:** `[ids...]` — zero or more node ids
- **Output:** JSON Lines, one per selected node (no output when clearing)
  ```ts
  NodeRef
  ```

---

### `dapi selection focus`

Pans and zooms the canvas to fit the currently selected nodes in view, framing them with padding — the same focus used by `node screenshot` before it captures. No-op if nothing is selected (the canvas is left unchanged).

- **Input:** none
- **Output:** JSON Lines, one per selected node (no output if nothing is selected)
  ```ts
  NodeRef
  ```

---

## Node operations

All under `dapi node` (aliases `dapi n`, `dapi entity`).

### `dapi node ls [ids...]`

The raw entity records, exactly as persisted — every component the entity carries, keyed by component name. The property-level counterpart to `node tree`'s structure. With no ids, returns the root (top-level nodes). Alias: `get`.

- **Input:** `[ids...]` — zero or more entity ids (optional)
- **Output:** JSON Lines, one per entity
  ```ts
  EntityRecord = { id: string; eid: number } & { [component: string]: unknown }
  // e.g. Name, Size, Position, Rotation, Paint, Color, Trim, ChildOf (parent eid), …
  ```
  Records are raw engine data: times are frames at 30 fps, colors are packed `0xRRGGBB` integers, volume is dB.
- **Errors:** if any input id fails to resolve, writes a per-id message to stderr and exits non-zero after emitting all successful records to stdout.


---

### `dapi node tree [id] [--depth N]`

An entity's subtree as a nested JSON object — structure only, every entity and sub-entity included, and the way to discover their ids. Key characteristics are folded into a compact `description` built from whatever the entity carries; use `node ls` for exact property values. The root is level 0, so `--depth 1` yields the root plus its immediate children.

- **Input:**
  - `[id]` — root entity id (optional; omitted = one tree per top-level node, mirroring `ls`)
  - `--depth <N>` — max depth, non-negative integer (optional; default `3`, `0` = full subtree)
- **Output:** JSON Lines, one nested object per root; category arrays are omitted when empty
  ```ts
  NodeTree = NodeRef & {
    description:     string;      // e.g. "hidden; size: 200x300; text: Hello World"
    children?:       NodeTree[];  // child nodes (masks listed separately)
    masks?:          NodeTree[];
    paints?:         NodeTree[];  // fills
    strokes?:        NodeTree[];
    shadows?:        NodeTree[];
    effects?:        NodeTree[];
    colorStops?:     NodeTree[];  // on gradient paints
    textRanges?:     NodeTree[];  // on text nodes
    keyframeTracks?: NodeTree[];  // keyframes nest beneath their track
    keyframes?:      NodeTree[];
    animations?:     NodeTree[];
  }
  ```

---

### `dapi node grep <pattern> [id]`

Searches entity records for a pattern and prints the matching entities, with the components that matched. The search corpus is the raw records [`node ls`](#dapi-node-ls-ids) would emit — component values stringified — so anything `ls` can show, `grep` can find; the caveat carries over too: values are raw engine units (frames at 30 fps, packed colors, dB). `[id]` scopes the search to a subtree, like giving `grep -r` a path. The structural counterpart of `tree` (find entities by content rather than by position) and the discovery front-end to `ls`, `selection set`, and `patch`: `grep` to find ids, then read, select, or edit them.

The common case — find nodes by name — is `dapi node grep -k Name Title`. Presence queries work with a match-anything pattern: `dapi node grep -k Trim .` lists every entity carrying a `Trim` component.

- **Input:**
  - `<pattern>` — JavaScript regex, unanchored (required). Case-sensitive unless `-i` is given.
  - `[id]` — root entity id (optional; omitted = every top-level node's subtree)
  - `-i, --ignore-case` — case-insensitive matching
  - `-t, --type <types...>` — only match entities of these node types (e.g. `-t text image`; the `type` values of `node tree`)
  - `-k, --component <names...>` — restrict matching to these components (e.g. `-k Name Chars`; the component keys of `node ls`)
  - `-l, --refs-only` — output only the matching entity refs, no match detail
  - `-c, --count` — output only the number of matching entities
- **Output:** JSON Lines, one per matching entity (no output if nothing matches — this is a successful run, exit `0`); the structured analog of grep's `file:line:content`
  ```ts
  NodeRef & { matches: Array<{ component: string; value: string }> }
  // value is the stringified component value the pattern matched
  ```
  With `--refs-only`, plain `NodeRef` lines; with `--count`, a single number.
- **Errors:** exits non-zero if the pattern is not a valid regex, or if `[id]` doesn't resolve to a live entity.

---

### `dapi node screenshot [id] [-t, --time <time>]`

Focuses the node on the canvas and captures a screenshot, written to a PNG file in the system temp directory. If `[id]` is omitted, captures the canvas (the active scene).

- **Input:**
  - `[id]` — node id (optional; defaults to the canvas)
  - `-t, --time <time>` — timeline position at which to record the node, a `Time` value (optional; defaults to the current playhead position)
- **Output:** one JSON object — the absolute path to a freshly written PNG in the system temp directory with a uuid filename
  ```ts
  { path: string }   // e.g. "/tmp/3f2c1a8e-....png"
  ```

---

### `dapi node insert <parentId> (<path> | --code <str>) [--index <N>]`

Compiles a Solid JSX project module and executes it in the app — the same pipeline as [`mount`](#dapi-mount-path---code-str), including declared asset generation — but instead of mounting the rendered roots into the document, inserts them as children of an existing entity. Because the result is inserted rather than reconciled, root elements take no `key`: every run inserts fresh entities; there is no replace-or-create matching and nothing is deleted. Full specification: [jsx-spec.md](./jsx-spec.md).

The rendered roots must be valid as children of the target parent, following the JSX containment rules: a node parent takes any element or paint root except `<scene>` (scenes only exist at the document top level) and `<colorStop>`; a gradient paint parent takes only `<colorStop>` roots — this is how a stop is added to an existing gradient (`node insert <paintId> --code '<colorStop offset={0.5} color="#FF0055" />'`); other sub-entities take no children.

- **Input:**
  - `<parentId>` — entity id of the parent to insert into (required)
  - project module — exactly one of:
    - `<path>` — path to the module file
    - `--code <str>` — inline module source; the `export default () =>` wrapper is optional, a bare JSX expression is wrapped automatically (e.g. `--code '<rect width={100} height={100} />'`)
  - `-i, --index <N>` — the inserted node's 0-based position among the parent's children, a non-negative integer (optional; default = append after the last child; values past the end are clamped). Node roots only: paints stack in insertion order and color stops render sorted by `offset`, so `--index` is rejected for them.
- **Output:** none.
- **Errors:** exits non-zero if `<parentId>` doesn't resolve to a live entity, if compilation or evaluation fails, if a rendered root is invalid as a child of the parent (e.g. a `<scene>`, or a non-`<colorStop>` in a gradient paint), or if `--index` is given for a paint or color stop root. On any of these, **nothing is inserted**.

---

### `dapi node rm <ids...>`

Deletes one or more entities and all their descendants. Alias: `remove`.

- **Input:** `<ids...>` — one or more entity ids (required)
- **Output:** JSON Lines, one per input id
  ```ts
  | { status: "fulfilled"; id: number }
  | { status: "rejected"; id: number; error: string }
  ```

---

### `dapi node patch ([path] | --json <str>)`

Assigns JSX props on one or more existing entities in a single call. Every patch entry takes the same properties, with the same value requirements, as a JSX element in [`mount`](#dapi-mount-path---code-str) — the full table lives in [jsx-spec.md](./jsx-spec.md#element-reference) and is not repeated here; the payload type is `PatchProps` from `@diffusionstudio/jsx`. Patches are applied through the same setters as a render, so the two surfaces cannot diverge. Changes are tracked for undo like a UI edit.

Any live entity is addressable — not just nodes: paints and color stops can be patched too (`color`, `offset`, `opacity`, gradient `rotation`). There is no separate rename command: renaming a node is patching its `name`.

- **Input:** exactly one of:
  - `[path]` — path to a `.json` file containing the patch array
  - `--json <str>` — the array inline

  Payload shape:
  ```ts
  Array<{ id: number } & PatchProps>
  ```

  All props are optional; a patch may set any subset. An unsupported property or an out-of-range value rejects that entity; a rejected patch applies none of its props (no half-applied patches). Notes beyond the JSX table:
  - `fill` recolors the entity's existing solid fill(s), or creates one if the entity has none.
  - `src` takes a path, URL, or asset id (`generate.*` declarations are JSX-only). The source resolves asynchronously after the other props land — if resolution fails, the entity is reported rejected even though its other props were applied; patch `src` on its own to avoid ambiguity.
  - `syncTo` re-runs audio alignment against the document node carrying the given key and writes the entity's `startTime` from the measured offset (see [jsx-spec.md](./jsx-spec.md#audio-sync)). The command blocks until alignment settles; a failed alignment rejects the entity.
  - Element applicability is not checked: props are applied wherever `mount` would apply them (e.g. `fontSize` only makes sense on a text node).
- **Output:** JSON Lines, one per input id
  ```ts
  | { status: "fulfilled"; id: number }
  | { status: "rejected"; id: number; error: string }
  ```

---

### `dapi node cp <ids...>`

Deep-clones one or more nodes, including all descendants. Alias: `duplicate`.

- **Input:** `<ids...>` — one or more node ids (required)
- **Output:** JSON Lines, one per input id
  ```ts
  | { status: "fulfilled"; sourceId: number; newId: number }
  | { status: "rejected"; sourceId: number; error: string }
  ```

---

### `dapi node render [id] ([config] | --json <str>)`

Renders a scene to a video file. Composes the scene frame-by-frame and muxes the result, writing it to disk. Operates on one scene — scenes are nodes, so this is the node-level render. If `[id]` is omitted, renders the active scene.

Encode settings are passed as a single JSON config — the same object the in-app render method takes (`EncoderConfig`), minus the runtime-only fields the CLI fills in for you (`scene`, `target`, `onProgress`). The whole config is **optional**; omit it to render with the defaults below. The encode window follows the scene's timeline workarea (its `Trim`): the render starts at the workarea start and runs to the scene's end, unless capped earlier with `trim.end`. Renders locally; **no credits** and no authenticated account required.

Like the generators, this is **long-running** — the CLI blocks until the render finishes (or fails) before printing. While waiting, a progress spinner with elapsed time is shown on **stderr** (a single static line when stderr isn't a TTY), so stdout stays clean JSON for piping.

- **Input:**
  - `[id]` — scene node id (optional; defaults to the active scene).
  - `-o, --output <path>` — write the video here (optional; default a uuid-named file in the system temp directory). The container extension is derived from the config's `format`.
  - Encode config (optional) — at most one of:
    - `[config]` — path to a `.json` file containing the config object. Node ids are integers, so a lone non-numeric positional is read as the config path (`dapi node render encode.json` works without an id).
    - `--json <str>` — the object inline

    Config shape (every field optional; all defaults shown):
    ```ts
    {
      format?: "mp4" | "webm" | "ogg" | "mov";    // default "mp4"; sets the output extension
      video?: {
        codec?:      "avc" | "hevc" | "vp9" | "av1" | "vp8";  // default "avc" (H.264); valid codecs depend on format
        enabled?:    boolean;   // default true
        bitrate?:    number;    // bits/sec, default 10_000_000 (10 Mbps)
        fps?:        number;    // default the scene's frame rate
        resolution?: number;    // target height in px (e.g. 720, 1080, 1440, 2160); default 1080. Width follows the scene's aspect ratio
      };
      audio?: {
        enabled?:          boolean;          // default true; set false to render video only
        codec?:            "aac" | "opus";   // default "aac"; valid codecs depend on format
        bitrate?:          number;           // bits/sec, default 128_000 (128 kbps)
        sampleRate?:       number;           // Hz, e.g. 44100, 48000, 96000; default 48000
        numberOfChannels?: number;           // default 2
      };
      trim?: {
        end?: number;   // seconds; cap the encode here. Default the scene's full duration. Caps the workarea end; cannot extend past the scene
      };
    }
    ```
- **Output:** one JSON object — the absolute path to the written video file
  ```ts
  { path: string }   // e.g. "/tmp/3f2c1a8e-....mp4", or the --output path
  ```
- **Errors:** exits non-zero if the id is unknown or the node is not a scene (`Not a scene`), if no scene is active and `[id]` is omitted, if the config is malformed or holds a value out of range or incompatible with the chosen `format` (e.g. an unsupported codec), if `--output` can't be written, or if the render fails or is canceled.

---

## Projects

All under `dapi project` (alias `dapi p`).

### `dapi project active`

Prints the currently active project, or `null` if none is open.

- **Input:** none
- **Output:** one JSON value
  ```ts
  { id: string; name: string } | null
  ```

---

### `dapi project ls`

Lists all projects, most recently accessed first. Alias: `list`.

- **Input:** none
- **Output:** one JSON object per line (newline-delimited)
  ```ts
  { id: string; name: string; createdAt: string; lastAccessedAt: string }
  ```

---

### `dapi project create [name]`

Creates a new project and opens it.

- **Input:** `[name]` — optional project name
- **Output:** one JSON object
  ```ts
  { id: string; name: string }
  ```

---

### `dapi project set <id>`

Sets the active project by id, opening it. Returns `null` if no project has that id.

- **Input:** `<id>` — project id (required)
- **Output:** one JSON value
  ```ts
  { id: string; name: string } | null
  ```

---

### `dapi project rm <id>`

Deletes a project by id. Alias: `remove`.

- **Input:** `<id>` — project id (required)
- **Output:** one JSON object
  ```ts
  { id: string; name: string }
  ```

---

## Assets

All under `dapi asset` (alias `dapi a`). Operate on the open project.

### `dapi asset add <paths...>`

Adds one or more local files as assets in the open project.

- **Input:**
  - `<paths...>` — absolute or relative file paths (resolved against CWD)
  - `--folder <id>` — folder to place the new assets in (optional; default the library root)
- **Output:** JSON Lines, one per input path
  ```ts
  | ({ status: "fulfilled"; path: string } & Asset)
  | { status: "rejected"; path: string; error: string }
  ```
- **Errors:** exits non-zero before importing anything if `--folder` doesn't resolve to a folder.

---

### `dapi asset ls`

Lists the asset library of the open project as its folder tree — folders and assets interleaved in one array, each folder carrying its contents in `children`. Aliases: `list`, `get`.

- **Input:**
  - `--folder <id>` — folder whose contents to list (optional; default the library root)
  - `--depth <N>` — max depth, positive integer (optional; default = full tree). `--depth 1` yields just the direct entries of the listing root; a folder at the cutoff is listed with an empty `children` array (indistinguishable from a genuinely empty folder — raise the depth to tell them apart).
- **Output:** JSON Lines, one per entry of the listing root (no output if the listing root is empty); each entry carries its own subtree in `children`
  ```ts
  AssetTree = Array<(Asset | Folder) & { children: AssetTree }>   // one root entry per line
  ```
  Folders are the entries with type `folder`. An asset's `children` is always empty.
- **Errors:** exits non-zero if `--folder` doesn't resolve to a folder.

---

### `dapi asset rm <ids...>`

Deletes one or more assets from the open project by id. Alias: `remove`.

- **Input:** `<ids...>` — asset ids (required)
- **Output:** JSON Lines, one per input id
  ```ts
  | { status: "fulfilled"; id: string; name: string }
  | { status: "rejected"; id: string; error: string }
  ```

---

### `dapi asset mv <ids...> [--to <folderId>]`

Moves one or more assets into a folder. Alias: `move`.

- **Input:**
  - `<ids...>` — asset ids (required)
  - `--to <folderId>` — destination folder (optional; omitted = the library root)
- **Output:** JSON Lines, one per input id
  ```ts
  | { status: "fulfilled"; id: string; folderId: string | null }
  | { status: "rejected"; id: string; error: string }
  ```
- **Errors:** exits non-zero before moving anything if `--to` doesn't resolve to a folder; an unknown asset id rejects that id only.

---

### `dapi asset export <ids...>`

Writes one or more assets' original file bytes to a location on the file system — the exact bytes stored in the library, streamed to disk in chunks (never buffered whole). No re-encode, no processing, no credits. Any asset type is accepted except image sequences. The counterpart of `asset add`.

- **Input:**
  - `<ids...>` — asset ids (required)
  - `-o, --output <path>` — where to write (optional; default the system temp directory). Interpreted as:
    - **a directory** — when the path is an existing directory, ends with a path separator, or multiple ids are given. Created if missing. Each asset is written into it named after the asset, with an extension derived from its media type when the name lacks one. A name that collides with an existing file is uniquified with a ` (N)` suffix — never overwritten.
    - **a file path** — otherwise (single id only). Written exactly there, overwriting an existing file.
- **Output:** JSON Lines, one per input id, in the requested order
  ```ts
  | { status: "fulfilled"; id: string; path: string }   // path = the file actually written
  | { status: "rejected"; id: string; error: string }
  ```
- **Errors:** exits non-zero before writing anything if `--output` must be a directory (multiple ids, or a trailing path separator) but resolves to an existing file, or if the output directory can't be created. An unknown id — or an image-sequence asset — rejects that id only; a rejected asset leaves no partial file behind.

---

### `dapi asset probe <id|path>`

Reads the container and per-track technical metadata of an asset — like `ffprobe`, but demuxed locally with mediabunny. Reports the container format, duration, metadata tags, and every track's codec parameters without decoding any media. Reads locally; no credits.

- **Input:**
  - `<id|path>` — an asset id, or a local file to add and probe (required). Any asset type is accepted.
- **Output:** one JSON object. The shape is **not yet stable** — it reports whatever mediabunny surfaces about the container and its tracks. Packet stats (frame rate, bitrate, packet count) are estimated from a leading sample of packets, so they are fast but approximate. Assets mediabunny can't demux (images, transcripts) don't error; they report file-level info only, with `format: null` and no tracks.
- **Errors:** exits non-zero if the id is unknown.

---

### `dapi asset transcript <id|path>`

Transcribes the speech in a video or audio asset and returns the timed transcript. Word-level start/end times are in **seconds** (source/content time).

- **Input:**
  - `<id|path>` — a video or audio asset id, or a local file to add and transcribe (required).
- **Output:** one JSON object — the transcript:
  ```ts
  {
    id:       string;     // the asset id
    segments: Array<{
      text:  string;      // spoken words only (no silence markers)
      words: Array<{ text: string; start: number; end: number }>;  // seconds;
    }>;
  }
  ```
- **Errors:** exits non-zero if the id is unknown or the asset is not a video/audio asset, or if no speech is detected in the audio (`No speech detected`).

---

### `dapi asset analyze <id|path>`

Analyzes an image, video, or audio asset with a multimodal model. With no prompt it returns a general description of the asset; with `--prompt` it answers that question about the asset (e.g. "what's the dominant color?", "summarize what happens").

- **Input:**
  - `<id|path>` — an image, video, or audio asset id, or a local file to add and analyze (required).
  - `-p, --prompt <str>` — question or instruction about the asset (optional; defaults to a general description).
  - `-s, --start <time>` — start of the segment to analyze, a `Time` value (optional; default `0`). Timestamps in the analysis are relative to this point. Ignored for images.
  - `-e, --end <time>` — end of the segment to analyze, a `Time` value (optional; default the asset's duration). Ignored for images.
- **Output:** one JSON object — the model's answer
  ```ts
  { id: string; analysis: string }   // id = the analyzed asset id
  ```
- **Errors:** exits non-zero if the id is unknown, or the asset's media type isn't supported by the chosen model.

---

### `dapi asset visualize <id|path>`

Renders a visual preview of an asset to a PNG, written to a file in the system temp directory. The visualization is chosen by the asset's media type, so a single command covers the whole library. Renders locally; no credits. Alias: `viz`.

- **By media type:**
  - **audio** — an amplitude waveform with a time axis (tick labels along the bottom in `mm:ss`), drawn from decoded audio peaks.
  - **video** — a composite: a **filmstrip** of frames sampled at even intervals across the window, with the **waveform** of the video's audio track drawn beneath it, sharing one `mm:ss` (or milliseconds) time axis. Videos with no audio track render the filmstrip alone.
  - **image** — a thumbnail of the image, auto-scaled.
- **Input:**
  - `<id|path>` — an image, audio, or video asset id, or a local file to add and visualize (required).
  - `-s, --start <time>` — start of the window to visualize, a `Time` value in source/content time (optional; default `0`). Ignored for images.
  - `-e, --end <time>` — end of the window to visualize, a `Time` value (optional; default the asset's duration). Ignored for images.
  - `-x, --scale <factor>` — scale factor for the thumbnails (optional; default `1`, clamped to `0.25`–`4`). The overall canvas size stays fixed, so smaller thumbnails fit **more rows and columns** (a denser grid sampling more moments) and larger thumbnails fit fewer but show more detail each. For images, scales the output resolution instead (never above the source size).
  - `-o, --output <path>` — write the PNG here instead of a temp file (optional).
- **Output:** one JSON object — the absolute path to the written PNG
  ```ts
  { path: string }   // e.g. "/tmp/3f2c1a8e-....png", or the --output path
  ```
- **Errors:** exits non-zero if the id is unknown, the media type isn't visualizable (e.g. a transcript asset, or an audio asset with no decodable audio), `--start`/`--end` fall outside the asset or cross (`--start` ≥ `--end`), `--scale` isn't a positive number, or `--output` can't be written.

---

### `dapi asset frame <id|path>`

Decodes one or more frames of a video asset at the given times and writes each to a PNG file — like `node screenshot`, but grabs the asset's own pixels at full resolution (unlike `node screenshot`, which captures the composited canvas). Renders locally; no credits.

- **Input:**
  - `<id|path>` — a video asset id, or a local video file to add and grab frames from (required).
  - `-t, --time <time...>` — one or more timestamps to grab, `Time` values in source/content time (optional; default `0`). Order is preserved in the output regardless of the order given.
  - `-o, --output <dir>` — directory to write the PNGs into (optional; default the system temp directory). Each frame is written as a uuid-named `.png`.
- **Output:** JSON Lines, one object per requested timestamp, in the requested order
  ```ts
  { time: number; path: string }   // time = the requested timestamp in seconds; path = the written PNG
  ```
- **Errors:** exits non-zero if the id is unknown, the asset is not a video, any `--time` is past the asset's duration, or a PNG can't be written.

---

## Folders

All under `dapi folder` (alias `dapi fld`). Operate on the open project. Folders organize the asset library and nest arbitrarily; assets reference their containing folder via `folderId` (`null` = library root). Everywhere a folder id is optional, omitting it means the library root — there is no sentinel value for the root. Read the full hierarchy (folders and assets together) with [`asset ls`](#dapi-asset-ls); move assets between folders with [`asset mv`](#dapi-asset-mv-ids---to-folderid).

### `dapi folder ls [parentId]`

Lists the direct child folders of a parent folder, sorted by name. With no id, lists the root-level folders. Aliases: `list`, `get`.

- **Input:** `[parentId]` — parent folder id (optional; omitted = the library root)
- **Output:** JSON Lines, one per child folder (no output if the parent has no subfolders)
  ```ts
  Folder
  ```
- **Errors:** exits non-zero if `[parentId]` doesn't resolve to a folder.

---

### `dapi folder create <name> [-p, --parent <id>]`

Creates a folder.

- **Input:**
  - `<name>` — folder name (required)
  - `-p, --parent <id>` — parent folder (optional; omitted = the library root)
- **Output:** one JSON object
  ```ts
  Folder
  ```
- **Errors:** exits non-zero if `--parent` doesn't resolve to a folder.

---

### `dapi folder rename <id> <name>`

Renames a folder.

- **Input:**
  - `<id>` — folder id (required)
  - `<name>` — new name (required)
- **Output:** one JSON object
  ```ts
  Folder
  ```

---

### `dapi folder mv <ids...> [--to <folderId>]`

Moves one or more folders under a new parent. A folder cannot be moved into itself or any of its descendants — such a move rejects that id and leaves it where it was. Alias: `move`.

- **Input:**
  - `<ids...>` — folder ids (required)
  - `--to <folderId>` — destination parent folder (optional; omitted = the library root)
- **Output:** JSON Lines, one per input id
  ```ts
  | { status: "fulfilled"; id: string; parentId: string | null }
  | { status: "rejected"; id: string; error: string }   // unknown id, or a cycle
  ```
- **Errors:** exits non-zero before moving anything if `--to` doesn't resolve to a folder.

---

### `dapi folder rm <ids...>`

Deletes one or more folders. **Deletion cascades:** every descendant folder and every asset inside the subtree is deleted with it. The fulfilled record reports what the cascade removed, so callers can detect when a delete swept more than intended. Alias: `remove`.

- **Input:** `<ids...>` — folder ids (required)
- **Output:** JSON Lines, one per input id
  ```ts
  | { status: "fulfilled"; id: string; deletedFolders: number; deletedAssets: number }
      // deletedFolders counts the folder itself plus all descendants
  | { status: "rejected"; id: string; error: string }
  ```

---

## Generation reference

**Asset generation (image / video / speech / audio) is declared in the project module** (`generate.*` declarations, see the JSX API) and produced by the editor on mount. There are no CLI commands that generate; the two commands below only list what you can reference from those declarations. (Captioning is also declarative — a `<captions>` element in a mounted or inserted project, see [Captions](./jsx-spec.md#captions).) Both require the app to be running.

### `dapi models [type]`

Lists the generation models available for a media type, including each model's capabilities — use it to discover valid model ids and the per-model constraints (durations, aspect ratios, features) to set on an asset declaration (see the JSX API).

- **Input:** `[type]` — optional; one of `image`, `video`, `audio`. Omit to list all three groups.
- **Output:** JSON Lines, one per model
  ```ts
  {
    type:         "image" | "video" | "audio";
    id:           string;     // the model id to set on <asset model="…">
    name:         string;
    durations?:   string[];   // video only, e.g. ["5s","10s"]
    aspectRatios?: string[];  // video only
    features?:    Array<"start-frame" | "end-frame" | "audio">;  // video only
  }
  ```

---

### `dapi voices`

Lists the speech voices available for declared voice assets (see the JSX API).

- **Input:** none
- **Output:** JSON Lines, one per voice
  ```ts
  { id: string; label: string; description: string }
  ```

---

## Fonts

### `dapi fonts`

Lists local fonts available on this machine. macOS only.

- **Input:**
  - `-f, --family <pattern>` — filter to families whose name contains `<pattern>` (case-insensitive)
  - `-w, --weight <weights...>` — filter to variants with the given CSS weight(s), e.g. `-w 400 700`
  - `-s, --style <style>` — `"normal"` or `"italic"`
  - `-l, --limit <n>` — output at most `<n>` families
  - `-n, --names-only` — output only family names, one per line, plain text (no JSON)
- **Output:** JSON Lines, one per family — or plain family names when `--names-only` is set
  ```ts
  {
    family:   string;
    variants: Array<{
      weight: string;            // CSS weight, e.g. "400"
      style:  "normal" | "italic";
      source: string;            // CSS local() source
    }>;
  }
  ```

---

## Conventions

- **Stdout:** JSON. Commands that return a single record emit one JSON value. Commands that return a collection emit JSON Lines (one JSON object per line, no surrounding array) so per-item results stay streamable — this covers list reads (`selection ls`, `selection focus`, `node ls`, `node grep`, `asset ls`, `folder ls`, `models`, `voices`, `fonts`), selection mutations that return the new state, and batch operations (`node rm`, `node patch`, `node cp`, `asset add`, `asset rm`, `asset mv`, `asset export`, `folder mv`, `folder rm`). `node tree` emits one nested JSON object per root, and `asset ls` emits one nested object per root entry. Exceptions: `open` for file / URL / no-target writes nothing; `fonts --names-only` writes plain family names; `mount` and `node insert` write nothing.
- **Unix-style names are canonical:** list/read → `ls`, delete/remove → `rm`, duplicate → `cp`, move/reparent → `mv`, search → `grep`. The longer English forms (`list`, `remove`, `duplicate`, `move`) are aliases of the Unix forms, not the other way around. `get` is a universal alias for `ls` on every command that has one. Applied wherever the semantics match; commands without a natural Unix equivalent (`tree`, `rename`, `patch`, `add`, `create`, `active`, `context`, `whoami`, `open`, `focus`, `set`) keep their descriptive names.
- **Stderr:** human-readable error messages.
- **Exit codes:** `0` on success, `1` on any error (missing file, app not running, invalid input, IPC error).
- **App must be running:** every command except `open` and `fonts` talks to the open Diffusion Studio instance. If the app isn't running, the CLI prints an instruction to launch it and exits `1`.
