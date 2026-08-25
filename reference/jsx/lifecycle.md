# Lifecycle

## A mount stays live

Opening a project compiles the entry file and renders it into the document. After that the reactive graph **keeps running**: signals, effects, timers, and [`useTicker`](#useticker) keep driving the mounted entities for as long as the project is open. Updates land in the document immediately — prop writes, conditional inserts and removals (`<Show>`, `<For>`), text, and reactive `src` swaps including `generate.*`. The materialized nodes are ordinary editable entities; asset resolution is owned by the engine.

A save re-runs the pipeline. The old mount is disposed and the new render takes the stage, the way reloading a page rebuilds it — scenes are rebuilt rather than accumulated, and the entities the previous render owned go with it. A compile error changes nothing: the last good render stays on the canvas and the failure is reported.

The compiled bundle is remembered with the project, so the next open puts the last known render on the canvas while the compile chews through the sources; whichever finishes first shows, and the fresh compile replaces it either way.

**Export and capture re-execute the module** in a world of their own — the same source, a fresh mount, the ticker driven across the frames being rendered. That is what makes a live composition reproducible rather than ephemeral, and it requires the module's structure to be deterministic: `Math.random()` and `Date.now()` must not decide element counts or `<Show>`/`<For>` branches. Using them inside an effect, or inside a draw callback, is fine.

## Edits come back

The other direction is the point of the [`id`](./module.md#ids) on every element: a rect dragged on the canvas, a clip trimmed on the timeline, a keyframe moved, a line retyped — each lands as a prop on the element that authored it, written into your file. So the two directions do not fight: hand edits and canvas edits are edits to the same document.

What the editor writes is what it changed. Elements it inserted or moved are written as new JSX; an element rendered inside a `<For>` is unrolled into one element per iteration first, since a single element cannot hold one iteration's value.

## `useTicker`

A project can subscribe to the timeline instead of reaching for wall-clock timers:

```tsx
import { useTicker } from "@diffusionstudio/jsx";

export default function Project() {
  const { time, frame } = useTicker();
  return (
    <stage>
      <scene name="HUD" width={1920} height={1080}>
        <text width={600} height={100} fontSize={80} color="#FFFFFF">{`frame ${frame()}`}</text>
        <rect x={860 + Math.sin(time() * 4) * 200} y={490} width={100} height={100} fill="#f43" />
      </scene>
    </stage>
  );
}
```

Call it in a component body. It returns accessors for the playhead of the scene the mount renders into:

| Accessor | Value |
| -------- | ----- |
| `time()` | Playhead in seconds (sub-frame precision while playing) |
| `frame()` | Playhead in frames (30 fps) |
| `delta()` | Seconds advanced since the previous engine tick: 0 while paused, negative on a backward scrub or loop |
| `playing()` | Whether the scene is playing |

The values respect play, pause, scrubbing, looping, and playback speed, which wall-clock timers do not. Each accessor only propagates when its value changes, so a paused scene re-runs nothing and `frame()` consumers update at most once per frame. Ticker-driven drawing follows the playhead in the editor **and in exports and captures**; wall-clock timers (`setInterval`, `requestAnimationFrame`) render live but do not appear in the output.

`useTicker` is host-bound: it only works inside a mounted project, and throws with a message saying so anywhere else.

> **Status:** the runtime document does not provide a timeline clock yet, so `useTicker()` currently throws inside a mounted project too (`useTicker: this host does not provide a timeline clock`) — and, being called in a component body, takes the whole mount with it. Until it is wired, drive motion with [`<animation>`](./animations.md) and [`<keyframeTrack>`](./keyframes.md), which run on the same playhead.
