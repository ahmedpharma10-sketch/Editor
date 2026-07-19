/* @jsxImportSource @diffusionstudio/jsx */
/* Ref-provided canvas: the <Surface> element hands its backing bitmap to the
 * ref callback, which owns it from then on.
 *
 *   dapi mount samples/reconciler/08-surface-paint.tsx
 *
 * The ref runs once at materialization, inside the mount's reactive owner:
 * the effect below redraws from a signal and the playhead ticker, and the
 * engine samples the bitmap into the node's box every frame. The standalone
 * <SurfacePaint> on the right stacks over a solid fill inside a plain <Rect>.
 */

import { createEffect, createSignal } from "solid-js";
import { Scene, Surface, useTicker } from "@diffusionstudio/jsx";

export default () => {
  const { time } = useTicker();
  const [canvas, setCanvas] = createSignal<HTMLCanvasElement>();

  createEffect(() => {
    const cvs = canvas();
    const ctx = cvs?.getContext("2d");
    if (!ctx || !cvs) return;
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.fillStyle = "#1b1b22";
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.beginPath();
    ctx.arc(
      cvs.width / 2 + Math.cos(time() * 2) * 140,
      cvs.height / 2 + Math.sin(time() * 2) * 120,
      40,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = "#44dd88";
    ctx.fill();
  });

  return (
    <Scene key="sample-surface" name="Surface paint" width={960} height={540} fill="#101014">
      <Surface
        x={40}
        y={60}
        width={520}
        height={420}
        cornerRadius={16}
        ref={setCanvas}
      />
    </Scene>
  );
};
