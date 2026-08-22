# `<audio>`

An audio clip: no picture, carries volume. When timing is omitted, the node fits its natural duration (see [timing.md](./timing.md)). It draws nothing inside a scene; placed directly on the canvas (see [roots.md](./roots.md)) the editor shows its waveform in a box, which `x`/`y`/`width`/`height` place.

```tsx
<audio src="https://my.videoarchive.com/audio/clip.wav" start={2.2} sourceOut={16} volume={-6} />
```

## Props

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `src` | `string \| AssetRef` | **required** | See [media.md](./media.md). |
| `name` | `string` | none | Human-readable node name. |
| `x`, `y` | `number` | `0` | Where the waveform box sits on the canvas. No meaning inside a scene. |
| `width`, `height` | `number` | `500`, `150` | Size of that box. |
| `start`, `end`, `sourceIn`, `sourceOut` | `Time` | see [timing.md](./timing.md) | Temporal placement. |
| `volume` | `number` | `0` | Decibels: `0` = unity, negative attenuates (`-6` ≈ half as loud), `-Infinity` = silence. Not linear. |
| `muted` | `boolean` | `false` | Excludes the node's audio from the mix; independent of `volume`. |
| `syncTo` | `string` | none | Key of another element carrying audio; derives `start` by audio alignment (see [audio-sync.md](./audio-sync.md)). Mutually exclusive with `start`. |
| `animations` | `AnimationSpec[]` | none | Preset in/out animations (see [animations.md](./animations.md)); only `"gain"` is audible. |
