/* @jsxImportSource @diffusionstudio/jsx */
/* Environment split: the tag (and, for shared names, its SVG ancestry)
 * decides the environment.
 *
 *   dapi mount samples/reconciler/05-html-paint.tsx
 *
 * Requires the html-in-canvas API (chrome://flags/#canvas-draw-element;
 * not available in Electron 35, so use a supporting build): without it the
 * mount fails cleanly at <html> materialization.
 *
 * The left <rect> is an ECS entity. <html> is a node too (a rect carrying an
 * html paint), but its children are browser DOM. The names both vocabularies
 * share (rect/text/image) resolve lexically: the <rect> inside <svg> below is
 * the SVG element, <div> is plain HTML, and the counter text updates
 * reactively in the drawn DOM.
 */

import { createSignal } from "solid-js";

const [n, setN] = createSignal(0);
setInterval(() => setN(n() + 1), 500);

export default () => (
  <scene key="sample-html" name="HTML paint" width={960} height={540} fill="#101014">
    <rect x={40} y={120} width={200} height={300} cornerRadius={16} fill="#22ccff" />

    <html x={280} y={60} width={640} height={420}>
      <div style={{ color: "white", "font-family": "Inter", "font-size": "28px", padding: "16px" }}>
        DOM counter: {n()}
      </div>
      <svg viewBox="0 0 200 100" width={640} height={320}>
        <rect x={10} y={10} width={80} height={50} fill="#ff4466" />
        <circle cx={140 + (n() % 3) * 15} cy={35} r={20} fill="#44dd88" />
        <path d="M 10 80 H 190" stroke="#ffaa22" stroke-width={4} />
      </svg>
    </html>
  </scene>
);
