# `<stage>`

The infinite canvas every project renders into: the **root element**, and the only thing that may be one. It holds [`<scene>`](./scene.md) children — one per frame you cut in — and, alongside them, loose nodes parked on the canvas.

```tsx
export default function Project() {
  return (
    <stage background="#161616">
      <scene name="Intro" width={1920} height={1080} fill="black">{/* ... */}</scene>
      <scene name="Outro" x={2120} width={1920} height={1080} fill="black">{/* ... */}</scene>
    </stage>
  );
}
```

A node at root level is material rather than composition: a generated clip that has not been cut into a scene yet, a reference still lying about. It draws on the canvas and can be dragged, selected and inspected, but it has no scene's clock to be placed against, so it plays nothing and exports nowhere — that is what moving it into a scene is for. It is where the editor puts what it generates.

The stage is a **singleton**: it is the canvas already on screen rather than something the project creates, so a project spelling `<stage>` addresses the one that is there. One mount per world — a save disposes the running mount before the new one takes the stage, and the scenes it owned go with it.

## Props

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `background` | `string` | `#161616` | Canvas color behind the scenes, any CSS color. Not part of a render: it is what surrounds the frame, not what is in it. |
| `camera` | `[a, b, c, d, e, f]` | `[1, 0, 0, 1, 0, 0]` | The editor's viewport when the project is opened, as a 2D affine matrix in the order CSS `matrix()` and canvas `setTransform` take: `a`/`d` scale, `b`/`c` skew, `e`/`f` translate. |

Both are editor state rather than composition: nothing rendered or exported depends on either, but the source is the document, so a panned canvas has nowhere else to be written back to. A project that never says where to look opens at the origin, at 100%.

The stage takes no timing, no transform and no paints — it is not a node, it is where the nodes are.

## Canvas placement

A root's place on the canvas is its own `x`/`y`, in the same document space the camera matrix moves through. Roots that do not say where they sit all sit at the origin, on top of each other; give each after the first an `x` clear of the ones before it, as the example above does.

Which scene the playhead, the timeline and [`dapi capture`](../capture.md) are pointed at is a scene's `active`, not the stage's business. At most one scene carries it, and only a direct child of `<stage>` can.
