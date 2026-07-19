# Writing compositions

Compositions are **Solid JSX modules**. `dapi mount` compiles the module, runs it in the app, and renders every JSX element into an editable node in the document: no hidden DOM, no CSS, no layout pass. All positioning is explicit pixels.

```tsx
import { Scene } from "@diffusionstudio/jsx";

export default function Project() {
  return (
    <Scene key="intro" name="Intro" width={1920} height={1080} fill="black">
      {/* ... */}
    </Scene>
  );
}
```

The element import is optional at runtime — the compiler auto-imports PascalCase elements used without an in-scope binding — but explicit imports make the file typecheck (`tsc` doesn't see the auto-import).

The module's default export is the project component. Solid's control flow (`<For>`, `<Show>`, …) and primitives (`createSignal`, `createMemo`, …) are available to *compose* the tree; the render is one-shot: after commit, the nodes belong to the document and signal changes no longer affect it. The update path is re-running the mount.

**Dependencies:** `solid-js` and `@diffusionstudio/jsx` are provided by the app; everything else you import (npm packages, local files, JSON) is bundled by the CLI. Libraries must be browser-compatible.

## Roots and keys

Every top-level element declares its identity with a `key`:

- Mounting rebuilds the existing node carrying that key, or creates it. Entity id and canvas position are preserved across re-mounts.
- Keyed nodes the render no longer produces are **deleted**; the mount owns its keyed roots. Unkeyed nodes (made by hand in the editor) are never touched.
- Keys must be unique within a render. Give roots a `name` too: the key identifies, the name labels.

The first rendered root becomes the active scene. New roots are auto-placed on the canvas near the viewport center; `<Scene>` has no `x`/`y` because canvas arrangement is an editor concern, not part of the composition.

## Elements

| Element | What it makes |
| --- | --- |
| `<Scene>` | A scene; clips children to its `width`×`height`. Document root only; scenes don't nest. |
| `<Group>` | Container with a transform; give it `fill` to draw a rectangle. |
| `<Rect>` | A filled rectangle. |
| `<Text>` | Editable text. |
| `<Video>` / `<Image>` | Media; `src` is required. |
| `<Audio>` | Sound only, no spatial props. |
| `<Sequence>` | Track container for back-to-back clips (positions are explicit); hosts transitions. |
| `<Captions>` | Styled captions: transcribes the scene's audio, or mounts a transcript given via `src`. |
| `<Html>` | A rectangle whose children are HTML/SVG, laid out by the browser at the node's box size and drawn into it. Equivalent to a `<Rect>` with an `<HtmlPaint>`. |
| `<Surface>` | A rectangle whose `ref` hands you a canvas to draw yourself (2d, webgl, webgpu); the bitmap is sampled into the box every frame. Equivalent to a `<Rect>` with a `<SurfacePaint>`. |
| `<SolidPaint>`, `<LinearGradientPaint>`, `<RadialGradientPaint>`, `<ColorStop>` | Fills, declared as children; see [Paints](#paints). |

User-defined components are ordinary Solid components; only the built-in PascalCase elements produce nodes.

### Common props

| Prop | Default | Meaning |
| --- | --- | --- |
| `key` | none | Stable identity; required on document roots. |
| `name` | none | Node name in the editor. |
| `x`, `y` | `0` | Position in px, relative to the parent, origin top-left. Animatable. |
| `width`, `height` | parent size | Box size in px. Animatable. |
| `rotation` | `0` | Degrees. Animatable. |
| `opacity` | `1` | `0`–`1`. Animatable. |
| `cornerRadius` | `0` | Px. Animatable. |
| `start`, `end`, `sourceIn`, `sourceOut` | see [Timing](#timing) | Temporal placement. |
| `transition` | none | Cut into the next clip; `<Sequence>` children only. See [Transitions](#transitions). |

Animatable props also take a keyframe list — see [Animation](#animation).

**Every box defaults to its parent's box**, the JSX analog of `position: absolute; inset: 0`. So a centered full-frame title is just:

```tsx
<Text textAlign="center" textBaseline="middle" fontSize={128}>Hello</Text>
```

### Per-element props

- **`<Scene>`**: `key`, `width`, `height` (all required), `name`, `fill`. No timing or transform props.
- **`<Rect>` / `<Group>`**: `fill` (any CSS color; alpha is ignored, use `opacity`).
- **`<Video>`**: `src` (required), `objectFit` (`"cover"` | `"contain"` | `"fill"`, default `"cover"`), `volume` (dB; `0` = unity, negative attenuates), `muted`, `syncTo` (see [Audio sync](#audio-sync)).
- **`<Image>`**: `src` (required), `objectFit` (default `"contain"`).
- **`<Audio>`**: `src` (required), `volume` (dB; `0` = unity, negative attenuates), `muted`, `syncTo`, timing props.
- **`<Text>`**: string children (required), `fontFamily` (see `dapi fonts`), `fontSize`, `fontWeight`, `fontStyle`, `fill`, `textAlign`, `textBaseline`.
- **`<Html>`**: HTML/SVG children. Fully reactive: signals in attributes, styles, and text update the drawn content. Event handlers are dropped (the content is painted, not interactive).
- **`<Surface>`**: `ref` (required, callback form) receives the backing `HTMLCanvasElement` once at materialization; draw with any context type, create effects inside the ref to redraw from signals or the ticker.

These same props are what `dapi node patch` assigns on existing nodes.

## Media sources

`src` accepts:

- an **absolute path** like `"/Movies/clip.mp4"`
- a **remote URL**, registered as a remote asset
- an **asset id**: an imported library asset (see `dapi asset tree`)
- an **`AssetRef`**: the value returned by a `generate.*` declaration

To read a source's raw bytes inside an effect instead of mounting it as a node, pass the same input to `useFile`, which resolves it to a `File`. It returns Solid's `createResource` tuple (`[file, { mutate, refetch }]`): the `file` accessor reads `undefined` until it resolves, then the `File`. Useful for drawing a library image onto a `<Surface>` or parsing a data file:

```tsx
import { createSignal, createEffect } from "solid-js";
import { useFile } from "@diffusionstudio/jsx";

const [canvas, setCanvas] = createSignal<HTMLCanvasElement>();
const [file] = useFile("/assets/logo.png");

createEffect(async () => {
  const el = canvas();
  const f = file();
  if (!el || !f) return;
  el.getContext("2d")!.drawImage(await createImageBitmap(f), 0, 0);
});

// <Surface ref={setCanvas} width={640} height={360} />
```

## Timing

`start`/`end` place a clip on the parent timeline; `sourceIn`/`sourceOut` select which part of its source plays. The two are independent. Values take any [time format](cli.md#time-values) (seconds, `"45f"` frames, `"MM:SS"`).

| Prop | Meaning |
| --- | --- |
| `start` / `end` | Parent-timeline window. `start` defaults to 0; omit both and media fits its natural duration, groups auto-fit their children. |
| `sourceIn` / `sourceOut` | The source window to play. Default: the source's natural extent. `end` and `sourceOut` are the same out edge in timeline vs. source time. |

```tsx
<Video src="/Movies/clip.mp4" start={5} sourceIn={10} sourceOut={20} />
// plays source seconds 10-20 (a 10 s clip), beginning at timeline second 5

<Rect start={2} end={5} fill="red" />
// a sourceless node placed straight on the timeline: on screen from 2 s to 5 s
```

`<Sequence>` groups a track of back-to-back clips and hosts clip [transitions](#transitions). It does not position clips at mount — give each an explicit `start` (the next clip's `start` is the previous clip's end). In the editor it keeps children from overlapping as you drag or regroup them.

### Audio sync

`syncTo` computes a node's `start` by cross-correlating its audio against another element's audio (named by `key`), so two recordings of the same take coincide on the timeline: a lav track against camera audio, two cameras, two microphones. Any pairing with audio tracks works (audio-to-video, audio-to-audio, video-to-video). `muted` silences the side that shouldn't be heard; alignment reads source content regardless of `muted` or `volume`.

```tsx
<Video key="camera" src="/Movies/take-3.mp4" sourceOut={45} muted />
<Audio src="/Movies/lav.wav" syncTo="camera" />
```

`syncTo` and `start` are mutually exclusive; `sourceIn`/`sourceOut` stay yours, and when omitted the window defaults to the overlap with the target's window. Alignment runs after generated assets land (either side may be generated), locally and cached, and blocks the mount; an alignment too weak to trust fails the mount and the node keeps its default placement.

## Transitions

A clip inside a `<Sequence>` takes a `transition` prop rendering the cut into the clip that follows it:

```tsx
<Sequence>
  <Video src="/Movies/a.mp4" start={0} end={8} transition={{ type: "fadeToBlack", duration: 0.5 }} />
  <Video src="/Movies/b.mp4" start={8} />
</Sequence>
```

| Type | Effect |
| --- | --- |
| `"dissolve"` (default) | Crossfade: the incoming clip fades in over the outgoing one. |
| `"slideFromRight"` | The incoming clip slides in over the outgoing one, decelerating. |
| `"slideFromLeft"` | Same, from the left. |
| `"fadeToBlack"` | Dip to black: fade out, then fade the incoming clip in. |
| `"fadeToWhite"` | Same, through white. |

- `duration` takes any [time format](cli.md#time-values) (default 1 s) and runs centered on the cut. Timing is untouched: the clips stay back-to-back and the renderer overlaps them only while the transition runs.
- `transition` only renders on a direct child of `<Sequence>` that has a clip after it. On the last clip it waits until one follows, matching the editor's inspector; outside a sequence the engine drops it.
- It's the same transition the inspector edits, and `dapi node patch` takes it like any other prop: a partial value merges into the clip's existing transition (`{ "id": 42, "transition": { "duration": 2 } }` keeps the type), and `"transition": null` removes it.

## Animation

Animatable props (`x`, `y`, `width`, `height`, `rotation`, `opacity`, `cornerRadius`, `volume`, `color`, `offset`) accept a keyframe list in place of a static value:

```tsx
<Image
  src="/photo.jpg"
  start={0} end={5}
  x={[
    { time: 0, value: -400 },
    { time: 1, value: 200, easing: "easeOut" },
  ]}
  opacity={[{ time: 0, value: 0 }, { time: "15f", value: 1 }]}
/>
```

- `time` is **node-local** (0 = the node's in point), in any [time format](cli.md#time-values); animation moves with the clip. Outside the keyframed range the value holds at the first/last keyframe.
- `easing` shapes the segment from its keyframe to the next (ignored on the last). Default `"linear"`.
- A static value replaces any existing keyframes on the property; mounted keyframes are regular editor keyframes, editable in the timeline and inspector. Props the render doesn't set keep their hand-made tracks.
- `color`, `opacity`, and `offset` also animate on paints and color stops, so gradients can move.

| Easing | Use for |
| --- | --- |
| `"linear"` (default) | Constant-rate change. |
| `"easeIn"`, `"easeOut"`, `"easeInOut"` | Standard acceleration curves (CSS equivalents). |
| `"gentle"`, `"snappy"`, `"bouncy"`, `"strong"` | Spring presets, from soft settle to hard overshoot. |
| `"cubicBezier(x1,y1,x2,y2)"` | Custom curve, CSS control points. |
| `"spring(bounce,duration)"` | Custom spring: bounce `0`–`1`, duration in ms. |
| `"steps(n)"` | Discrete hold: n equal steps, no interpolation. |

## Paints

A node's fill is a **paint child**; the `fill` prop is shorthand for a solid paint. Declaring paints as children unlocks gradients and stacking (later paints render on top, including over the media paint of a `<Video>` or `<Image>`):

```tsx
<Rect width={640} height={360} cornerRadius={24}>
  <LinearGradientPaint rotation={90}>
    <ColorStop offset={0} color="#FF0055" />
    <ColorStop offset={1} color="#0055FF" />
  </LinearGradientPaint>
</Rect>
```

`<SolidPaint>` takes `color` (required) and `opacity`; gradient paints take `rotation` and `opacity` and only `<ColorStop>` children (`offset` and `color` required). Colors are any CSS color; alpha is ignored, use `opacity`. `<HtmlPaint>` draws browser-laid-out HTML/SVG children into the node's box; the `<Html>` element is shorthand for a `<Rect>` carrying one. `<SurfacePaint>` draws a canvas your `ref` callback owns into the node's box; the `<Surface>` element is likewise shorthand for a `<Rect>` carrying one.

## Generated assets

Assets that don't exist yet are declared as values with the `generate` namespace and passed wherever a source is expected:

```tsx
import { generate } from "@diffusionstudio/jsx";

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

**Caching:** results are cached by content (model, prompt, resolved refs, seed, …) in the asset library: re-mounting an unchanged project reuses its assets instead of regenerating, even across sessions, and identical declarations collapse to one asset. Deleting a generated asset clears its cache entry. Set `seed` for reproducibility.

## Captions

`<Captions />` inside a scene transcribes that scene's audio into a styled, timed caption node. It runs after generated assets land and [audio sync](#audio-sync) resolves (so it can caption generated voice-over at its final placement), attaches asynchronously, and is cached against the scene's audible mix, so re-mounting with unchanged audio doesn't re-transcribe.

```tsx
<Captions preset="spotlight" colors={["#FF0055"]} />
```

### Manual captions

`src` supplies the transcript instead of transcribing: a path, URL, or asset id of an `.srt` or `.vtt` subtitle file, or a transcript `.json` (the `dapi transcribe` output format: `[{ text, words: [{ text, start, end }] }]`, times in seconds). Subtitle cues carry no word timings, so word-level presets highlight on timings synthesized within each cue.

```tsx
<Captions src="./subtitles.srt" preset="classic" />
```

Times are scene-relative; set `start` to shift the whole caption track when the transcript was written against a clip that begins later in the scene.

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
npm install --save-dev @diffusionstudio/jsx solid-js
```

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@diffusionstudio/jsx"
  }
}
```

The CLI strips types without checking them; run `tsc --noEmit` for type safety.

## Errors

Compile errors surface on stderr before the app is contacted. Evaluate/mount errors (invalid props, a root without `key`, nested `<Scene>`, an unknown or cyclic `syncTo` key, …) abort with **nothing inserted**. Generation errors surface after all generations settle; the mounted tree stays committed and the affected placeholder is left without media. Audio-sync failures (no decodable audio, no reliable alignment) surface the same way; the node keeps its default placement. Runtime errors map back to your source via sourcemaps.
