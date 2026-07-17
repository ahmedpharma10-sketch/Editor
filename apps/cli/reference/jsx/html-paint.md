# `<htmlPaint>`

A paint whose children are **real HTML**. The browser lays them out at the parent geometry's box size and the result is drawn into the box via the [html-in-canvas](https://github.com/WICG/html-in-canvas) API. Use it for content that is painful to build from `<rect>` and `<text>`: styled cards, tables, code blocks, flex/grid layouts.

```tsx
<rect x={40} y={40} width={800} height={120} cornerRadius={24}>
  <htmlPaint>
    <div style="display:flex;align-items:center;gap:16px;height:100%;
                background:#111;color:#fff;font:500 40px Inter;padding:0 32px;">
      <span style="color:#7c9cff;">01</span> Introduction
    </div>
  </htmlPaint>
</rect>
```

Inside `<htmlPaint>`, lowercase tags are DOM elements with Solid's own HTML typings, not composition elements (`<audio>` and `<video>` stay the editor's). Composition elements cannot nest inside it, and HTML tags are invalid outside it.

## Reactivity

The children are part of the project's Solid graph: signals in attributes and text update the live DOM, and the drawn content follows on the next frame. With [`dapi mount --live`](../mount.md) the graph stays alive, so `useTicker` or timers can drive the markup:

```tsx
const [count, setCount] = createSignal(0);
setInterval(() => setCount((c) => c + 1), 1000);

<rect width={400} height={200}>
  <htmlPaint>
    <div style="font:700 96px Inter;color:#fff;">{count()}</div>
  </htmlPaint>
</rect>
```

## Props

| Prop | Type | Default | Meaning |
| ---- | ---- | ------- | ------- |
| `opacity` | `Animatable<number>` | `1` | Paint opacity, `0`-`1`. |

Like all paints it stacks with siblings in document order and clips to the parent's box (including `cornerRadius`).

## Requirements and limitations

- Requires Chromium's html-in-canvas API, currently behind `chrome://flags/#canvas-draw-element`. Mounting `<htmlPaint>` fails with an explicit error when the API is unavailable.
- Markup renders with the page's fonts and full CSS. Event handlers are dropped — the content is painted, not interactive.
- The content lives only as long as its mount: it is not persisted and does not render in exports yet.
- CSS animations in the markup play on the wall clock, not the composition playhead. Animate the parent element's props with [keyframes](./keyframes.md) for frame-accurate motion.
- Cross-origin subresources (e.g. remote images) are excluded from the painted output by the browser's read-back rules; use local assets.
