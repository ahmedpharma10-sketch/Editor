# Lifecycle

## One-shot render (default)

Mounting is a **one-shot render**: the reactive graph exists to *compose* the document (loops, conditionals, derived values, component props), not to drive it afterward.

1. The component tree renders synchronously into the staging root; `onMount` callbacks flush once.
2. The subtree commits and the reactive root is **disposed**. Signal changes after commit do not affect the document.
3. Ownership transfers to the document: every materialized node is a fully editable composition node. Asset generation is owned by the engine, not the reactive graph, so it proceeds normally after disposal.

The update path is **re-running the project**, which rebuilds the mount root in place, like refreshing a webpage; unchanged asset specs hit the generation cache.

## Live mode (`dapi mount --live`)

`--live` skips the disposal in step 2: the reactive root stays mounted after the command returns, so signals, effects, and timers keep driving the composition. Everything else is unchanged; the nodes are ordinary editable entities and generation blocks the command as usual.

A live run ends when:

- a later `mount` (live or not) claims one of its root keys: the keyed replacement swaps the entities and disposes the old graph (`onCleanup` callbacks flush), or
- the project or app closes.

Inside a live graph, updates behave as in any Solid app: prop writes, conditional inserts and removals (`<Show>`, `<For>`), and text updates land in the document immediately. They are not recorded as undo steps. A reactive `src` swap works, including `generate.*` refs (the node shows its generating state until the new asset lands). Two things stay mount-only and throw if changed after commit: `syncTo` and creating new `<captions>`; re-mount for those.

`node insert` is always one-shot; only `mount` supports `--live`.

## `useTicker`

Live graphs can subscribe to the project's timeline instead of reaching for wall-clock timers:

```tsx
import { useTicker } from "@diffusionstudio/jsx";

export default function Project() {
  const { time, frame } = useTicker();
  return (
    <scene key="hud" width={1920} height={1080}>
      <text fontSize={80}>{`frame ${frame()}`}</text>
      <rect x={860 + Math.sin(time() * 4) * 200} y={490} width={100} height={100} fill="#f43" />
    </scene>
  );
}
```

Call it in a component body. It returns accessors for the playhead of the scene the mount's root lives in (or is):

| Accessor | Value |
| -------- | ----- |
| `time()` | Playhead in seconds (sub-frame precision while playing) |
| `frame()` | Playhead in frames (30 fps) |
| `delta()` | Seconds advanced since the previous engine tick: 0 while paused, negative on a backward scrub or loop |
| `playing()` | Whether the scene is playing |

The values respect play, pause, scrubbing, looping, and playback speed, which wall-clock timers do not. Each accessor only propagates when its value changes, so a paused scene re-runs nothing and `frame()` consumers update at most once per frame. In a one-shot mount the first value renders and then freezes; the hook is only useful with `--live`.
