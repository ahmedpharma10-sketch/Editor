/* @jsxImportSource @diffusionstudio/jsx */
/* Keyed list: <For> reorders, inserts, and removes materialized subtrees.
 *
 *   dapi mount --live samples/reconciler/03-live-list.tsx
 *
 * Every 1.2s the first card cycles to the back: Solid MOVES the existing
 * nodes (reorder/reparent path, not delete + recreate; entity ids in
 * `dapi node tree` stay stable across shuffles). Every 4s card E is
 * removed or re-inserted (fresh subtree each time).
 */

import { For, createSignal } from "solid-js";

const COLORS: Record<string, string> = {
  A: "#ff4466",
  B: "#22ccff",
  C: "#44dd88",
  D: "#ffaa22",
  E: "#aa66ff",
};

const [items, setItems] = createSignal(["A", "B", "C", "D"]);

setInterval(() => setItems((prev) => [...prev.slice(1), prev[0]]), 1200);
setInterval(() => {
  setItems((prev) => (prev.includes("E") ? prev.filter((x) => x !== "E") : [...prev, "E"]));
}, 4000);

export default () => (
  <scene key="sample-list" name="Live list" width={960} height={540} fill="#101014">
    <For each={items()}>
      {(label, i) => (
        <group x={40 + i() * 180} y={180}>
          <rect width={150} height={150} cornerRadius={16} fill={COLORS[label]} />
          <text x={55} y={45} fontSize={56} fontFamily="Inter" fontWeight={700}>
            {label}
          </text>
        </group>
      )}
    </For>
  </scene>
);
