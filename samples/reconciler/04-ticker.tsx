/* @jsxImportSource @diffusionstudio/jsx */
/* Timeline clock: useTicker drives props from the scene's playhead.
 *
 *   dapi mount samples/reconciler/04-ticker.tsx
 *
 * Values only move during playback: press play in the editor. The orange
 * rect orbits with the frame, the readout shows time/frame, and the
 * "PLAYING" badge exists only while the transport runs.
 */

import { Show } from "solid-js";
import { useTicker } from "@diffusionstudio/jsx";

export default () => {
  const { time, frame, playing } = useTicker();

  return (
    <scene key="sample-ticker" name="Ticker" width={960} height={540} fill="#101014">
      <rect
        x={420 + Math.round(Math.cos(time() * 2) * 300)}
        y={220 + Math.round(Math.sin(time() * 2) * 150)}
        width={100}
        height={100}
        cornerRadius={50}
        fill="#ffaa22"
      />

      <text x={40} y={40} fontSize={40} fontFamily="Inter">
        t = {time().toFixed(2)}s / frame {frame()}
      </text>

      <Show when={playing()}>
        <text x={40} y={460} fontSize={36} fontWeight={700}>PLAYING</text>
      </Show>
    </scene>
  );
};
