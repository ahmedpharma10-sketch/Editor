# JSX API Specification

The JSX API defines the code contract for injecting content into the editor via the
CLI. Compositions are authored as **Solid components** that a custom renderer (built
on `solid-js/universal`, Solid's equivalent of React's reconciler) mounts **directly
into the editor's ECS**. Every JSX element becomes an entity; every prop is a
component write. There is no hidden DOM, no CSS resolution, and no measuring pass.

A project is structured like a SolidJS app: a **root** is established on the canvas —
typically a Scene, identified by its key and created if absent — and the project's
component tree renders into it.

**All positioning is explicit** (`x`, `y`, `width`, `height` in pixels).

## Pipeline

1. **Compile** — the CLI bundles the entry file with esbuild + `babel-preset-solid`
   in `universal` mode, so JSX compiles against the editor's renderer runtime
   (`@diffusionstudio/jsx`) instead of the DOM. Compile errors fail here, before the
   app is contacted.
2. **Ship** — the resulting single-file ESM bundle is sent to the running app over
   the local socket.
3. **Evaluate** — the app imports the module. Top-level code (including top-level
   `await`) runs to completion. The module's **default export** is the project
   component.
4. **Mount** — the component tree is rendered into a **staging root**. The universal
   renderer materializes each element as an ECS entity with the appropriate
   components (see [Element reference](#element-reference)). Mounting is synchronous;
   an error here aborts the import with nothing inserted.
5. **Commit** — the rendered roots are reconciled against the document (see
   [Roots](#roots)) as a **single undoable operation** that also covers the
   generated assets below.
6. **Generate** — declared assets generate in dependency order, **blocking the
   command** until every one has landed. Each placeholder renders a generating
   state until its asset lands, then the node's paint is attached.
7. **Sync** — nodes declaring `syncTo` are aligned once every generated asset
   has landed: each node's audio is cross-correlated against its target's and
   its `startTime` is written from the measured offset (see
   [Audio sync](#audio-sync)). Local and blocking; captions wait for it.

## Project module contract

The entry file is a standard Solid component module:

```tsx
export default function Project() {
  return (
    <scene key="intro" name="Intro" fill="black" width={1920} height={1080}>
      {/* ... */}
    </scene>
  );
}
```

The component receives no props — which document node each rendered root
maps onto is declared in the JSX itself via `key` (see [Roots](#roots)).

### Module environment

- **Provided by the host** (marked external at compile time, resolved in-app so the
  project shares the editor's reactive runtime): `solid-js`, `solid-js/store`,
  `@diffusionstudio/jsx`.
- **Everything else is bundled** by the CLI at compile time — npm dependencies,
  local imports, JSON, etc. A project folder is an ordinary npm package: install
  any helper library (`date-fns`, `zod`, `d3-scale`, …) and import it; it is
  resolved from the project's `node_modules` and baked into the shipped bundle.
  Libraries must be browser-compatible (no Node builtins) — violations surface as
  compile errors, before the app is contacted.
- The module executes **inside the editor process**, unsandboxed. This is local
  tooling with a local trust model — the same trust as running the CLI itself. Only
  effects made through the JSX runtime are part of the document (and its undo
  history); anything else the module does is unsupported.
- Solid's control flow (`<For>`, `<Show>`, `<Index>`, `<Switch>`) and primitives
  (`createSignal`, `createMemo`, …) are fully available during mount. See
  [Lifecycle](#lifecycle) for what happens after mount.

## Roots

A mount renders one or more root elements (a fragment of roots is allowed) and
**refreshes the document** — like reloading a webpage, re-running a mount
rebuilds its roots in place instead of accumulating copies; a rendered root
with no existing node to replace is created. Roots are typically `<scene>`
elements, but any element can be a root (e.g. a bare `<rect>`). Every
top-level element must declare its identity with a `key`:

| Identity | Contract |
| -------- | -------- |
| `<scene key="intro">` | Rebuilds the existing node carrying the same key, or creates it (storing the key) if none does. Keyed nodes in the document that the render no longer produces are **deleted** — the mount owns its keyed roots. |

Keys must be unique within a render, and rebuilding keeps the node's
entity id and canvas position. Nodes without a key (e.g. hand-made scratch
scenes) are never touched. The **first** rendered root becomes the active
scene. Assigning a `name` alongside the key (e.g.
`<scene key="intro" name="Intro">`) is recommended — the key identifies the
node across mounts, the name labels it in the editor.

`<scene>` is valid **only** at the document root — scenes do not nest.

### Canvas placement

The canvas holds many roots, but a root's position on the canvas is an **editor
concern, not part of the composition** — `<scene>` has no `x`/`y`, and a project
describes content, not canvas arrangement.

- **Rebuilt roots** (matched by `key`) keep their existing canvas
  position.
- **New roots** are placed automatically: in the nearest empty space around the
  current viewport center, gapped so they never overlap existing content — the
  same auto-placement the editor uses when generating onto the canvas. A mount
  that creates multiple roots places them side by side in render order.

The camera is not moved; because placement anchors to the viewport center, new
roots typically land in view. Use `dapi selection focus` to frame them explicitly.

## Element reference

Lowercase intrinsic elements map 1:1 onto internal node types:

| Element      | Internal node | Notes |
| ------------ | ------------- | ----- |
| `<scene>`    | **Geometry with Scene tag** | Clips its children to `width`×`height`. Document root only. |
| `<group>`    | **Geometry with Group tag** | Container with a transform; give it `fill` to draw a rectangle. |
| `<rect>`     | **Geometry with Solid paint** | A filled rectangle; takes only paint children. |
| `<video>`    | **Geometry with Video paint** | `src` resolves to a video asset. |
| `<image>`    | **Geometry with Image paint** | `src` resolves to an image asset. |
| `<audio>`    | **Geometry with Audio component and a hidden Waveform paint** | No visual output; carries volume. |
| `<text>`     | **Geometry with Text component** | Children become editable glyphs. |
| `<sequence>` | **Sequential group** | See [Sequences](#sequences). |
| `<captions>` | **Caption node** | Transcribes the enclosing scene's audio. See [Captions](#captions). |
| `<solidPaint>` | **Solid paint** | Paint child — see [Paints](#paints). |
| `<linearGradientPaint>` / `<radialGradientPaint>` | **Gradient paint** | Paint child; takes `<colorStop>` children — see [Paints](#paints). |
| `<colorStop>` | **Gradient color stop** | Valid only inside gradient paints. |

User-defined components are ordinary Solid components — they compose intrinsics and
carry no runtime cost; only intrinsic elements produce entities.

### Coordinates and sizing

- Coordinates are **pixels relative to the parent's box**, origin top-left. No
  percentages, no layout keywords — explicit numbers until the layout engine lands.
- **Every element's box defaults to its parent's box**: `x` and `y` default to `0`,
  `width` and `height` default to the parent's size (the JSX analog of
  `position: absolute; inset: 0`). The scene's box is its required
  `width`×`height`.
- How media pixels map into the box is controlled by `objectFit`, never by the box itself.
  A generated asset's placeholder therefore always has a definite size, even before
  the asset exists.

### Common props

All visual elements accept:

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `key` | `string` | — | Stable identity across mounts; **required** on document roots (see [Roots](#roots)). |
| `name` | `string` | — | Human-readable node name. |
| `x`, `y` | `number` | `0` | Position relative to the parent, px. |
| `width`, `height` | `number` | parent size | Box size, px. |
| `rotation` | `number` | `0` | Rotation in degrees. |
| `opacity` | `number` | `1` | `0`–`1`. |
| `cornerRadius` | `number` | `0` | Uniform corner radius, px. |
| `inPoint`, `outPoint`, `startTime` | `Time` | see [Timing](#timing) | Temporal placement. |

Common and per-element props share one property table, exported as
`PatchProps`. `dapi node patch` accepts exactly these keys with the same value
requirements as patch entries on existing nodes (see
[CLI_API.md](./CLI_API.md#dapi-node-patch-path---json-str)).

### Per-element props

**`<scene>`** — `key` (**required** — see [Roots](#roots)), `width`
(**required**), `height` (**required**), `name` (recommended), `fill`. No
timing or transform props.

**`<group>`** — common props plus `fill` (any CSS color, applied to the node's
fill; alpha is ignored — use `opacity`).

**`<rect>`** — common props plus `fill` (any CSS color, default light gray;
alpha is ignored — use `opacity`). Takes only [paint children](#paints); use
`cornerRadius` for rounded corners.

**`<video>`** — common props plus:

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `src` | `string \| AssetRef` | **required** | See [Media source resolution](#media-source-resolution). |
| `objectFit` | `"cover" \| "contain" \| "fill"` | `"cover"` | How the source maps into the box. |
| `volume` | `number` | `1` | `0`–`1`; `1` = unity gain. |
| `muted` | `boolean` | `false` | Excludes the node's audio from the mix; independent of `volume`. |
| `syncTo` | `string` | — | Key of another element carrying audio; derives `startTime` by audio alignment (see [Audio sync](#audio-sync)). Mutually exclusive with `startTime`. |

**`<image>`** — common props plus `src` (**required**) and `objectFit` (default
`"contain"`).

**`<audio>`** — `name`, timing props, `src` (**required**), `volume`, `muted`,
`syncTo` (see [Audio sync](#audio-sync)). No spatial props; no visual output.

**`<text>`** — common props plus:

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| children | `string` (or expressions resolving to strings) | **required** | The text content. |
| `fontFamily` | `string` | editor default | A family available on the machine (`dapi fonts`). |
| `fontSize` | `number` | editor default | Px. |
| `fontWeight` | `number \| "normal" \| "bold"` | `"normal"` | CSS weights `100`–`900`. |
| `fontStyle` | `"normal" \| "italic"` | `"normal"` | |
| `fill` | `string` | none | Any CSS color. |
| `textAlign` | `"left" \| "center" \| "right"` | `"left"` | Horizontal alignment of glyphs within the box. |
| `textBaseline` | `"top" \| "middle" \| "bottom"` | `"top"` | Vertical alignment within the box. |

Because the box defaults to the parent's box, a centered full-frame title is simply
`<text textAlign="center" textBaseline="middle">…</text>`.

**`<sequence>`** — `name` only. Purely structural (see [Sequences](#sequences)).

**`<captions>`** —

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `preset` | `"classic" \| "cascade" \| "spotlight" \| "whisper" \| "paper" \| "guinea" \| "stark"` | `"classic"` | Caption style preset (see [Captions](#captions)). |
| `colors` | `string[]` | preset defaults | Fills the preset's color slots in order; any CSS color, alpha ignored — use per-preset defaults by omitting. Ignored by presets without slots. |

## Paints

Internally a node's fill is not a property but a **paint child** — a sub-entity
appended to the geometry, exactly like the editor's fill list. The `fill` prop is
shorthand for a solid paint; declaring paints as JSX children exposes the full
model, including gradients:

```tsx
<rect width={640} height={360} cornerRadius={24}>
  <linearGradientPaint rotation={90}>
    <colorStop offset={0} color="#FF0055" />
    <colorStop offset={1} color="#0055FF" />
  </linearGradientPaint>
</rect>
```

Paint elements are valid inside any visual element (`<rect>`, `<group>`,
`<scene>`, `<text>`, `<video>`, `<image>`). Multiple paints stack in document
order — later paints render on top; a paint child on a `<video>`/`<image>`
draws over the media paint created by `src`.

| Element | Props | Meaning |
| ------- | ----- | ------- |
| `<solidPaint>` | `color` (**required**), `opacity` | Solid fill; equivalent to the `fill` prop. |
| `<linearGradientPaint>` | `rotation`, `opacity` | Linear gradient across the parent's box; `rotation` in degrees, `0` = left → right. |
| `<radialGradientPaint>` | `rotation`, `opacity` | Radial gradient centered in the parent's box. |
| `<colorStop>` | `offset` (**required**, `0`–`1`), `color` (**required**), `opacity` | Gradient color stop. Valid only inside gradient paints, which take no other children. |

Colors accept any CSS color; alpha is ignored — use `opacity`. Paints have no
spatial or timing props and cannot be document roots.

## Media source resolution

`src` accepts:

- **Global path** — e.g. `"/Movies/video.mp4"`, resolved against the user's OS.
- **Remote URL** — e.g. `"https://my.videoarchive.com/audio/clip.wav"`, registered
  as a remote asset.
- **Asset id** — e.g. `"gbHJ"`, an imported asset.
- **`AssetRef`** — the value returned by an `generate.*` declaration (see
  [Generated assets](#generated-assets)). The node is inserted immediately as a
  placeholder and its paint is attached once the asset has generated.

## Timing

Timing props follow Lottie-inspired semantics. All values are
**composition-relative** (measured against the parent's timeline), in any supported
[time format](#time-formats).

| Prop | Lottie | Meaning |
| ---- | ------ | ------- |
| `inPoint` | `ip` | Composition time at which the node becomes visible/audible. |
| `outPoint` | `op` | Composition time at which the node stops. |
| `startTime` | `st` | Composition time at which the node's *source* time 0 is placed. Shifts the source content within the in/out window. Defaults to the in point. |

### Semantics

- `inPoint` / `outPoint` define the **visible/audible window** on the parent
  timeline. They are a pair; if omitted, a media node fits its natural duration and
  a group auto-fits its children.
- `startTime` controls **which part of the source plays inside that window**. It is
  the composition time where source frame 0 sits, so it may be negative to skip into
  the source.
- Instead of declaring `startTime`, a media node can derive it from another node's
  audio with `syncTo` (see [Audio sync](#audio-sync)).

> Example: `inPoint={0} outPoint={16} startTime="-30f"` shows the clip from
> composition second 0 to 16, but because source-time-0 is placed 30 frames *before*
> the in point, the first 30 frames (1s @ 30fps) of the source are trimmed —
> playback begins 1s into the source.

### Time formats

```ts
type Time = number | `${number}f` | `${string}:${string}`;
```

The canonical internal unit is frames at **30 fps**; all formats are converted on
import. All values may be negative.

| Format | Example | Meaning |
| ------ | ------- | ------- |
| `number` | `2.2` | Seconds (may be fractional). |
| `"${number}f"` | `"-30f"` | Frames. |
| `"MM:SS"` | `"02:30"` | Minutes and seconds. |
| `"HH:MM:SS"` | `"01:02:30"` | Hours, minutes, seconds. |

## Sequences

`<sequence>` enforces **sequential, non-overlapping** placement of its children —
the editor's track-like behavior. It has no spatial or temporal properties of its
own; it lays its children out back-to-back in document order.

```tsx
<sequence>
  <video src="/Movies/intro.mp4" inPoint={0}       outPoint={12} />
  <video src="/Movies/main.mp4"  inPoint={12}      outPoint="02:30" />
  <video src="/Movies/outro.mp4" inPoint="02:30"   outPoint="02:45" />
</sequence>
```

## Audio sync

`syncTo` places a node in time by listening instead of arithmetic: the node's
audio is cross-correlated against another node's audio, and its `startTime` is
computed so the two recordings coincide on the timeline. It replaces manual
offset measurement for multi-recorder material: a lav or voice track against
camera audio, two cameras on the same take, two microphones in one room.

```tsx
<scene key="talk" width={1920} height={1080}>
  <video key="camera" src="/Movies/take-3.mp4" inPoint={0} outPoint={45} muted />
  <audio src="/Movies/lav.wav" syncTo="camera" />
</scene>
```

- `syncTo` names the `key` of another element in the same render. Both sides
  must carry an audio track; any pairing works (audio-to-video, audio-to-audio,
  video-to-video).
- The computed placement is `startTime = target.startTime + offset`, where
  `offset` is the measured source-time offset between the two recordings
  (positive when this node's recording started after the target's; possibly
  negative). `syncTo` and `startTime` are mutually exclusive.
- `inPoint`/`outPoint` keep their normal meaning and remain yours to set. When
  omitted on a synced node, the window defaults to the intersection of the
  node's natural extent with the target's window (instead of the usual
  natural-duration fit), so a lav track simply covers its take.
- Alignment reads source content: `muted` and `volume` on either side do not
  affect the measurement. Use `muted` to keep only one side audible, as on the
  camera track above.
- Chains resolve in dependency order (A may sync to B while B syncs to C).
  Unknown keys, cycles, and combining `syncTo` with `startTime` are mount
  errors; nothing is inserted.

Alignment runs at the [sync stage](#pipeline) of the pipeline: after generated
assets land (either side may be generated), before captions read the scene. It
is local, consumes no credits, and blocks the command, so exit `0` means final
placement. Each resolved node logs `{ offsetSeconds, confidence }` on stderr; a
clear match scores above ~0.9, and a correlation too weak to trust fails the
command (see [Errors](#errors)) while the node keeps its default placement.
Offsets are **cached** by the pair of source contents, so re-mounting an
unchanged project re-measures nothing.

Because `syncTo` is part of the shared property table, `dapi node patch`
accepts it too: patching `syncTo` onto an existing node re-aligns it against
the document node carrying that key.

## Captions

`<captions />` inside a scene transcribes that scene's audio into a caption node — a
styled, timed transcript, produced on import. To caption an already-open scene,
insert one with `dapi node insert.

Transcription is **asynchronous and non-blocking**: the caption node is inserted at
commit and its transcript attaches once ready. Because it reads the scene's audio,
it runs **after** any generated assets in the scene have landed and after
[audio sync](#audio-sync) has resolved — so captioning a generated
`voice`/`audio` track transcribes the finished audio at its final placement. The
scene must contain an unmuted audio or video source; otherwise the caption node
is left empty.

Transcripts are **cached**: every transcript asset records a fingerprint of the
scene's audible mix (source content, placement, source offset, playback rate,
gain). When a scene's fingerprint matches an existing transcript, that asset is
reused instead of transcribing again — re-mounting a project with unchanged
audio consumes no credits. Any change to the scene's audio invalidates the
fingerprint.

### Presets

`preset` selects the caption style — the same presets as the editor's caption
inspector. Some presets expose **color slots**, filled in order by the `colors`
prop; a missing or omitted entry falls back to the slot's default.

| Preset | Style | Color slots (defaults) |
| ------ | ----- | ---------------------- |
| `"classic"` (default) | Centered lowercase text with a soft drop shadow, a few words at a time. | — |
| `"cascade"` | Light text in the lower left; words appear progressively as they are spoken. | — |
| `"spotlight"` | Bold italic centered line; the spoken word lights up in the highlight color. | 1: highlight (`#24D5FF`) |
| `"whisper"` | Small, wide, understated line shown in ~2 s phrases. | — |
| `"paper"` | Centered two-line block; the line being spoken is emphasized with a heavier weight. | — |
| `"guinea"` | Uppercase display text; the spoken word enlarges and cycles through the three colors. | 3: `#F55353`, `#FEB139`, `#F6F54D` |
| `"stark"` | Heavy uppercase text blended into the footage with a difference blend. | — |

```tsx
<captions preset="spotlight" colors={["#FF0055"]} />
```

## Generated assets

Assets that don't exist yet are **declared as values** with the `generate` namespace
from `@diffusionstudio/jsx`. A declaration returns an **`AssetRef`** that is passed
wherever a source is expected — `src`, `startFrame`, `endFrame`, `refs`. This makes
generative content declarative: the project describes the asset it wants and the
editor produces it on mount.

```tsx
import { generate } from "@diffusionstudio/jsx";

const hero = generate.image({
  prompt: "A neon city at night, cinematic",
  model: "flux-2-turbo",
  aspectRatio: "16:9",
  seed: 42,
});

// one generated asset can feed another
const heroMotion = generate.video({
  prompt: "slow camera push-in",
  model: "kling-3-pro",
  startFrame: hero,
  duration: 5,
});

export default function Project() {
  return (
    <scene key="intro" name="Intro" width={1920} height={1080}>
      <video src={heroMotion} inPoint={0} outPoint={5} />
      <image src={hero} x={40} y={40} width={200} height={112} />
    </scene>
  );
}
```

Declarations are **pure**: calling `generate.*` registers a spec and returns a ref; no
generation starts until [commit](#pipeline). A ref that is never used by a mounted
element (directly or as an input to another asset) is dropped. Declarations may live
at module scope or inside components.

### Declaration options

Run `dapi models <type>` to discover valid `model` ids and per-model constraints;
`dapi voices` lists voices.

```ts
type AssetInput = string | AssetRef;   // path, URL, asset id, or another declaration

generate.image(opts: {
  prompt: string;                  // required
  model?: string;                  // default: first model from `dapi models image`
  aspectRatio?: "1:1" | "4:3" | "3:4" | "16:9" | "9:16";   // default "16:9"
  refs?: AssetInput[];             // image references
  seed?: number;                   // reproducible generation
}): AssetRef;

generate.video(opts: {
  prompt: string;                  // required
  model?: string;                  // default: first model from `dapi models video`
  aspectRatio?: "1:1" | "4:3" | "3:4" | "16:9" | "9:16";   // default "16:9"
  duration?: number;               // whole seconds; default 5
  audio?: boolean;                 // generate audio alongside; models with the `audio` feature only
  startFrame?: AssetInput;         // image used as the first frame
  endFrame?: AssetInput;           // image used as the last frame; `end-frame` feature only
  seed?: number;
}): AssetRef;

generate.voice(opts: {
  prompt: string;                  // required — the text to speak
  voice?: string;                  // default: first voice from `dapi voices`
}): AssetRef;

generate.audio(opts: {
  prompt: string;                  // required
  model?: string;                  // default: first model from `dapi models audio`
}): AssetRef;
```

### Dependency order

`startFrame`, `endFrame`, and `refs` accept other `AssetRef`s. The dependency graph
is built from these values and generated in topological order, so referenced assets
exist before the assets that consume them. Because dependencies are **values, not
string ids**, a declaration can only reference refs that already exist — reference
cycles are impossible by construction. Assets referenced only as inputs generate
too, but produce no node of their own.

### Caching and idempotency

Generation is long-running and consumes credits, so results are **cached by
content** — a key derived from the fully-resolved spec (`type`, `model`, `prompt`,
resolved references, `seed`, …). Within a session, re-running an unchanged project
reuses cached assets instead of regenerating, and two declarations with identical
specs collapse to a single asset; changing any option produces a new asset. Set
`seed` to make a spec reproducible. The cache is per-session and is not persisted
across app restarts.

## Lifecycle

Mounting is a **one-shot render**: the reactive graph exists to *compose* the
document (loops, conditionals, derived values, component props), not to drive it
afterward.

1. The component tree renders synchronously into the staging root; `onMount`
   callbacks flush once.
2. The subtree commits and the reactive root is **disposed**. Signal changes after
   commit do not affect the document.
3. Ownership transfers to the document: every materialized node is a fully editable
   composition node. Asset generation is owned by the engine, not the
   reactive graph, so it proceeds normally after disposal.

The update path is **re-running the project**, which rebuilds the mount root in
place — like refreshing a webpage; unchanged asset specs hit the generation cache. A future *live
mode* may keep the reactive root mounted so signals animate the document — the
one-shot contract above is deliberately forward-compatible with it.

## Errors

| Stage | Where it surfaces | Effect |
| ----- | ----------------- | ------ |
| Compile (syntax/type-stripping/bundling) | CLI stderr, exit 1 | App never contacted. |
| Evaluate / mount (thrown errors, invalid props, invalid root — e.g. nested `<scene>`, a root element without `key`, missing `src`, malformed `Time`, an unknown or cyclic `syncTo` key, `syncTo` combined with `startTime`) | CLI stderr, exit 1 | Staging root discarded; **nothing inserted**. |
| Generation (per-model constraints: `aspectRatio`, `duration`, feature flags) | CLI stderr, exit 1, after every generation settled | No rollback — the mounted tree stays committed; the affected placeholder stops showing its generating state and is left without a paint. |
| Sync (a side without a decodable audio track, or no reliable alignment) | CLI stderr, exit 1, after every alignment settled | No rollback; the tree stays committed and the node keeps its default placement. |

Runtime errors are mapped back to the source via inline sourcemaps produced at
compile time.

## CLI surface

The JSX pipeline is a single command, `dapi mount`; `dapi node insert` runs the
same pipeline into an existing parent, and `dapi node patch` assigns the same
props on existing nodes. `dapi models` and `dapi voices`
(see [CLI_API.md](./CLI_API.md)) describe what can be referenced from `generate.*`
declarations.

### `dapi mount (<path> | --code <str>)`

Compiles a project module, executes it in the app, and mounts the rendered roots
into the document (see [Pipeline](#pipeline)). Which nodes are replaced is
declared in the JSX via the root elements' `key` (see [Roots](#roots)).

- **Input:**
  - `<path>` — path to a `.tsx` / `.jsx` / `.ts` / `.js` entry module. Exactly one
    of `<path>` or:
  - `--code <str>` — inline module source, compiled identically.
- **Output:** none. The command exits `0` once the tree is committed and every
  declared asset has generated; inspect the result with `dapi context`,
  `dapi node ls`, or `dapi node tree`.
- **Notes:** a newly added top-level scene becomes the active scene. The command
  is long-running when assets are declared — it blocks until generation
  finishes.

## Types and tooling

`@diffusionstudio/jsx` ships the JSX namespace (intrinsic elements and props),
`Time`, `AssetRef`, and the `generate` namespace. For editor IntelliSense and
typechecking in a project folder:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@diffusionstudio/jsx"
  }
}
```

The CLI does not typecheck — types are stripped at compile time. Run `tsc --noEmit`
in the project folder for type safety.

## Full example

```tsx
import { For } from "solid-js";
import { generate, type Time } from "@diffusionstudio/jsx";

const hero = generate.image({
  prompt: "A neon city at night, cinematic",
  aspectRatio: "16:9",
  seed: 42,
});

const heroMotion = generate.video({
  prompt: "slow camera push-in",
  startFrame: hero,
  duration: 5,
});

const TITLES = [
  { text: "Hello World", inPoint: 3, outPoint: 6 },
  { text: "Chapter One", inPoint: 6, outPoint: 9 },
];

function Title(props: { text: string; inPoint: Time; outPoint: Time }) {
  return (
    <text
      textAlign="center"
      textBaseline="middle"
      fill="#FFFFFF"
      fontSize={128}
      fontWeight="bold"
      height={1080}
      width={1920}
      inPoint={props.inPoint}
      outPoint={props.outPoint}
    >
      {props.text}
    </text>
  );
}

export default function Project() {
  return (
    <scene key="my-first-scene" name="MyFirstScene" fill="black" width={1920} height={1080}>
      <sequence>
        <video src={heroMotion} inPoint={0} outPoint={5} />
        <video src="/Movies/video.mp4" inPoint={5} outPoint={16} startTime="-30f" />
      </sequence>

      <image src={hero} x={40} y={40} width={200} height={112} />

      <For each={TITLES}>{(t) => <Title {...t} />}</For>

      <audio
        src="https://my.videoarchive.com/audio/video-xyz.wav"
        inPoint={2.2}
        outPoint={16}
        volume={0.5}
      />

      <captions />
    </scene>
  );
}
```
