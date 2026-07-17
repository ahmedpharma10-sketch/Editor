/* @jsxImportSource @diffusionstudio/jsx */
/* Static materialization: a deep tree lands in one mount, fully formed.
 *
 *   dapi mount samples/reconciler/01-static-tree.tsx
 *
 * Check with `dapi node tree`:
 * - nested group with children, props replayed in authored order
 * - `fill` prop and explicit paint children coexist (no duplicate paints)
 * - multi-segment text renders "sum = 42" (concatenated, not last-wins)
 * - timing props land as Delay/Trim ("start: 1s; in: 1s; out: 3s")
 * Re-mounting replaces the scene in place (same key, same position).
 */

export default () => (
  <scene key="sample-static" name="Static tree" width={960} height={540} fill="#101014">
    <group x={40} y={40}>
      <rect width={200} height={120} cornerRadius={16} fill="#ff4466" />
      <rect x={220} width={200} height={120} rotation={8} opacity={0.8}>
        <linearGradient>
          <stop offset={0} color="#22ccff" />
          <stop offset={1} color="#7744ff" opacity={0.5} />
        </linearGradient>
      </rect>
    </group>

    <text x={40} y={220} fontSize={48} fontFamily="Inter" fontWeight={700}>
      sum = {6 * 7}
    </text>

    <rect
      x={40}
      y={320}
      width={160}
      height={90}
      fill="#44dd88"
      start={1}
      end={3}
      animations={[{ type: "fade", phase: "in", duration: 0.5 }]}
    />
  </scene>
);
