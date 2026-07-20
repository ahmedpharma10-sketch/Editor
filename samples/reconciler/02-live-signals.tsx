/* @jsxImportSource @diffusionstudio/jsx */
/* Live reactivity: post-commit updates flow through the materialized nodes.
 *
 *   dapi mount samples/reconciler/02-live-signals.tsx
 *
 * Watch the stage:
 * - the blue rect slides and recolors (reactive setProperty)
 * - the counter text updates in place (replaceText into Chars)
 * - the green badge blinks (Show insert/remove; its placeholder text node
 *   sits under the scene without crashing the ECS side)
 * Re-mount without to freeze and dispose the graph.
 */

import { Show, createSignal } from "solid-js";
import { Rect, Scene, Text } from "@diffusionstudio/jsx";

const [n, setN] = createSignal(0);
setInterval(() => setN(n() + 1), 400);

export default () => (
  <Scene key="sample-live" name="Live signals" width={960} height={540} fill="#101014">
    <Rect
      x={40 + (n() * 24) % 700}
      y={60}
      width={120}
      height={120}
      cornerRadius={n() % 2 === 0 ? 8 : 60}
      fill={n() % 2 === 0 ? "#2288ff" : "#22ccff"}
    />

    <Text x={40} y={260} fontSize={64} fontFamily="Inter">
      tick {n()}
    </Text>

    <Show when={n() % 4 < 2}>
      <Rect x={40} y={380} width={80} height={80} fill="#44dd88" />
      <Text x={140} y={400} fontSize={36}>on air</Text>
    </Show>
  </Scene>
);
