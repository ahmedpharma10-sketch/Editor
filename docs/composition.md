# Writing compositions

Compositions are **Solid JSX modules**. `dapi mount` compiles the module, runs it in the app, and renders every JSX element into an editable node in the document: no hidden DOM, no CSS, no layout pass. All positioning is explicit pixels.

```tsx
export default function Project() {
  return (
    <scene key="intro" name="Intro" width={1920} height={1080} fill="black">
      {/* ... */}
    </scene>
  );
}
```

The module's default export is the project component. Solid's control flow (`<For>`, `<Show>`, …) and primitives (`createSignal`, `createMemo`, …) are available to *compose* the tree; the render is one-shot: after commit, the nodes belong to the document and signal changes no longer affect it. The update path is re-running the mount.

**Dependencies:** `solid-js`, `@diffusionstudio/solid`, and `@diffusionstudio/ai` are provided by the app; everything else you import (npm packages, local files, JSON) is bundled by the CLI. Libraries must be browser-compatible.

## Roots and keys

Every top-level element declares its identity with a `key`:

- Mounting rebuilds the existing node carrying that key, or creates it. Entity id and canvas position are preserved across re-mounts.
- Keyed nodes the render no longer produces are **deleted**; the mount owns its keyed roots. Unkeyed nodes (made by hand in the editor) are never touched.
- Keys must be unique within a render. Give roots a `name` too: the key identifies, the name labels.

The first rendered root becomes the active scene. New roots are auto-placed on the canvas near the viewport center; `<scene>` has no `x`/`y` because canvas arrangement is an editor concern, not part of the composition.

## Elements

| Element | What it makes |
| --- | --- |
| `<scene>` | A scene; clips children to its `width`×`height`. Document root only; scenes don't nest. |
| `<group>` | Container with a transform; give it `fill` to draw a rectangle. |
| `<rect>` | A filled rectangle. |
| `<text>` | Editable text. |
| `<video>` / `<image>` | Media; `src` is required. |
| `<audio>` | Sound only, no spatial props. |
| `<sequence>` | Lays children out back-to-back in time. |
| `<captions>` | Transcribes the scene's audio into styled captions. |
| `<solidPaint>`, `<linearGradientPaint>`, `<radialGradientPaint>`, `<colorStop>` | Fills, declared as children; see [Paints](#paints). |

User-defined components are ordinary Solid components; only intrinsic elements produce nodes.

### Common props

| Prop | Default | Meaning |
| --- | --- | --- |
| `key` | none | Stable identity; required on document roots. |
| `name` | none | Node name in the editor. |
| `x`, `y` | `0` | Position in px, relative to the parent, origin top-left. |
| `width`, `height` | parent size | Box size in px. |
| `rotation` | `0` | Degrees. |
| `opacity` | `1` | `0`–`1`. |
| `cornerRadius` | `0` | Px. |
| `inPoint`, `outPoint`, `startTime` | see [Timing](#timing) | Temporal placement. |

**Every box defaults to its parent's box**, the JSX analog of `position: absolute; inset: 0`. So a centered full-frame title is just:

```tsx
<text textAlign="center" textBaseline="middle" fontSize={128}>Hello</text>
```

### Per-element props

- **`<scene>`**: `key`, `width`, `height` (all required), `name`, `fill`. No timing or transform props.
- **`<rect>` / `<group>`**: `fill` (any CSS color; alpha is ignored, use `opacity`).
- **`<video>`**: `src` (required), `objectFit` (`"cover"` | `"contain"` | `"fill"`, default `"cover"`), `volume` (`0`–`1`), `muted`, `syncTo` (see [Audio sync](#audio-sync)).
- **`<image>`**: `src` (required), `objectFit` (default `"contain"`).
- **`<audio>`**: `src` (required), `volume`, `muted`, `syncTo`, timing props.
- **`<text>`**: string children (required), `fontFamily` (see `dapi fonts`), `fontSize`, `fontWeight`, `fontStyle`, `fill`, `textAlign`, `textBaseline`.

These same props are what `dapi node patch` assigns on existing nodes.

## Media sources

`src` accepts:

- an **absolute path** like `"/Movies/clip.mp4"`
- a **remote URL**, registered as a remote asset
- an **asset id**: an imported library asset (see `dapi asset tree`)
- an **`AssetRef`**: the value returned by a `generate.*` declaration

## Timing

Composition-relative, Lottie-inspired. Values take any [time format](cli.md#time-values) (seconds, `"45f"` frames, `"MM:SS"`).

| Prop | Meaning |
| --- | --- |
| `inPoint` / `outPoint` | The window on the parent timeline where the node is visible/audible. Omitted: media fits its natural duration, groups auto-fit their children. |
| `startTime` | Where source time 0 sits on the composition timeline (defaults to the in point). May be negative to skip into the source. |

```tsx
<video src="/Movies/clip.mp4" inPoint={0} outPoint={16} startTime="-30f" />
// plays from composition 0-16 s, starting 1 s (30 frames) into the source
```

`<sequence>` removes the arithmetic for back-to-back cuts: children are placed sequentially and non-overlapping in document order.

### Audio sync

`syncTo` computes a node's `startTime` by cross-correlating its audio against another element's audio (named by `key`), so two recordings of the same take coincide on the timeline: a lav track against camera audio, two cameras, two microphones. Any pairing with audio tracks works (audio-to-video, audio-to-audio, video-to-video). `muted` silences the side that shouldn't be heard; alignment reads source content regardless of `muted` or `volume`.

```tsx
<video key="camera" src="/Movies/take-3.mp4" inPoint={0} outPoint={45} muted />
<audio src="/Movies/lav.wav" syncTo="camera" />
```

`syncTo` and `startTime` are mutually exclusive; `inPoint`/`outPoint` stay yours, and when omitted the window defaults to the overlap with the target's window. Alignment runs after generated assets land (either side may be generated), locally and cached, and blocks the mount; an alignment too weak to trust fails the mount and the node keeps its default placement.

## Paints

A node's fill is a **paint child**; the `fill` prop is shorthand for a solid paint. Declaring paints as children unlocks gradients and stacking (later paints render on top, including over the media paint of a `<video>` or `<image>`):

```tsx
<rect width={640} height={360} cornerRadius={24}>
  <linearGradientPaint rotation={90}>
    <colorStop offset={0} color="#FF0055" />
    <colorStop offset={1} color="#0055FF" />
  </linearGradientPaint>
</rect>
```

`<solidPaint>` takes `color` (required) and `opacity`; gradient paints take `rotation` and `opacity` and only `<colorStop>` children (`offset` and `color` required). Colors are any CSS color; alpha is ignored, use `opacity`.

## Generated assets

Assets that don't exist yet are declared as values with the `generate` namespace and passed wherever a source is expected:

```tsx
import { generate } from "@diffusionstudio/ai";

const hero = generate.image({ prompt: "A neon city at night, cinematic", seed: 42 });
const motion = generate.video({ prompt: "slow camera push-in", startFrame: hero, duration: 5 });
const vo = generate.voice({ prompt: "Welcome to the future." });
```

- `generate.image({ prompt, model?, aspectRatio?, refs?, seed? })`
- `generate.video({ prompt, model?, aspectRatio?, duration?, audio?, startFrame?, endFrame?, seed? })`
- `generate.voice({ prompt, voice? })` where `prompt` is the text to speak
- `generate.audio({ prompt, model? })`

Run `dapi models <type>` for valid model ids and per-model constraints, `dapi voices` for voices.

Declarations are pure: nothing generates until the mount commits, and refs never used by a mounted element are dropped. Because `startFrame`/`endFrame`/`refs` take refs as values, dependencies generate in the right order and cycles are impossible.

**Caching:** results are cached by content (model, prompt, resolved refs, seed, …) within a session: re-mounting an unchanged project reuses assets instead of regenerating, and identical declarations collapse to one asset. Set `seed` for reproducibility.

## Captions

`<captions />` inside a scene transcribes that scene's audio into a styled, timed caption node. It runs after generated assets land and [audio sync](#audio-sync) resolves (so it can caption generated voice-over at its final placement), attaches asynchronously, and is cached against the scene's audible mix, so re-mounting with unchanged audio doesn't re-transcribe.

```tsx
<captions preset="spotlight" colors={["#FF0055"]} />
```

| Preset | Style |
| --- | --- |
| `"classic"` (default) | Centered lowercase text, soft drop shadow, a few words at a time. |
| `"cascade"` | Light text lower-left; words appear as spoken. |
| `"spotlight"` | Bold italic centered line; the spoken word lights up (1 color slot). |
| `"whisper"` | Small, wide, understated ~2 s phrases. |
| `"paper"` | Centered two-line block; the spoken line is emphasized. |
| `"guinea"` | Uppercase display; the spoken word enlarges and cycles 3 colors (3 slots). |
| `"stark"` | Heavy uppercase, difference-blended into the footage. |

`colors` fills a preset's color slots in order; presets without slots ignore it.

## Types and tooling

For IntelliSense and typechecking in a project folder:

```sh
npm install --save-dev @diffusionstudio/solid @diffusionstudio/ai solid-js
```

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@diffusionstudio/solid"
  }
}
```

The CLI strips types without checking them; run `tsc --noEmit` for type safety.

## Errors

Compile errors surface on stderr before the app is contacted. Evaluate/mount errors (invalid props, a root without `key`, nested `<scene>`, an unknown or cyclic `syncTo` key, …) abort with **nothing inserted**. Generation errors surface after all generations settle; the mounted tree stays committed and the affected placeholder is left without media. Audio-sync failures (no decodable audio, no reliable alignment) surface the same way; the node keeps its default placement. Runtime errors map back to your source via sourcemaps.
