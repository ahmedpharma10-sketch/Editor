# `<image>`

An image. `src` resolves to an image asset (see [media.md](./media.md)).

```tsx
<image src="/photo.jpg" x={40} y={40} width={200} height={112} />
```

## Props

All [common props](./elements.md#common-props), plus:

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `src` | `string \| AssetRef` | **required** | See [media.md](./media.md). |
| `objectFit` | `"cover" \| "contain" \| "fill"` | `"cover"` | How the source maps into the box. |
| `removeBackground` | `boolean` | `false` | Cuts the subject out, leaving the rest transparent (see [media.md](./media.md#source-modifiers)). |
| `upscale` | `number` | `1` | Resolution multiplier; enlarges the source, not the box (see [media.md](./media.md#source-modifiers)). |

A paint child draws over the media paint created by `src` (see [paints.md](./paints.md)); a [`<shaderPaint>`](./shader-paint.md) child instead post-processes it, so the image renders through the shader.
