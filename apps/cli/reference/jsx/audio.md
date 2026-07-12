# `<audio>`

An audio clip: no visual output, no spatial props; carries volume. When timing is omitted, the node fits its natural duration (see [timing.md](./timing.md)).

```tsx
<audio src="https://my.videoarchive.com/audio/clip.wav" start={2.2} sourceOut={16} volume={0.5} />
```

## Props

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `src` | `string \| AssetRef` | **required** | See [media.md](./media.md). |
| `name` | `string` | none | Human-readable node name. |
| `start`, `end`, `sourceIn`, `sourceOut` | `Time` | see [timing.md](./timing.md) | Temporal placement. |
| `volume` | `Animatable<number>` | `1` | `0`-`1`; `1` = unity gain. |
| `muted` | `boolean` | `false` | Excludes the node's audio from the mix; independent of `volume`. |
| `syncTo` | `string` | none | Key of another element carrying audio; derives `start` by audio alignment (see [audio-sync.md](./audio-sync.md)). Mutually exclusive with `start`. |
