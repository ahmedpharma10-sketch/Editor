/* @jsxImportSource @diffusionstudio/jsx */
/* Anime.js timeline scrubbed by the playhead: canvas and DOM in lockstep.
 *   dapi mount samples/reconciler/07-anime-mini.tsx
 */
import { createEffect, createSignal } from "solid-js";
import { createTimeline } from "animejs";
import { useTicker } from "@diffusionstudio/jsx";

const box = { x: 60, spin: 0, pct: 0 };

export default function HtmlInCanvasDemo() {
  const { time } = useTicker();
  const [v, setV] = createSignal(box, { equals: false });

  const tl = createTimeline({ autoplay: false })
    .add(box, { x: 700, pct: 100, duration: 2400, ease: "inOutQuad" })
    .add(box, { spin: 360, duration: 900, ease: "outBack" });

  createEffect(() => {
    tl.seek((time() * 1000) % tl.duration);
    setV(box);
  });

  return (
    <scene key="sample-anime-mini" name="Anime mini" width={960} height={540} fill="#101014">
      <rect x={v().x} y={280} width={140} height={140} rotation={v().spin} cornerRadius={28} fill="#22ccff" />

      <html x={60} y={90} width={840} height={120} name="Live HTML">
        <div style="color: white; font-family: Inter; font-size: 60px; font-weight: 700">
          Timeline at <span style="color: #22ccff">{Math.round(v().pct)}%</span>
        </div>
      </html>
    </scene>
  );
};
