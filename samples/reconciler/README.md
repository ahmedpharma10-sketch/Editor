# Reconciler samples

Mountable projects exercising the shadow-tree reconciler (`WorldDocument`).
Run from the repo root with the editor open:

| Sample | Command | Exercises |
| --- | --- | --- |
| [01-static-tree.tsx](01-static-tree.tsx) | `dapi mount samples/reconciler/01-static-tree.tsx` | deferred materialization, prop replay, paints, text segments, timing |
| [02-live-signals.tsx](02-live-signals.tsx) | `dapi mount --live samples/reconciler/02-live-signals.tsx` | reactive props, replaceText, Show insert/remove |
| [03-live-list.tsx](03-live-list.tsx) | `dapi mount --live samples/reconciler/03-live-list.tsx` | \<For\> moves (reorder without recreate), list insert/remove |
| [04-ticker.tsx](04-ticker.tsx) | `dapi mount --live samples/reconciler/04-ticker.tsx` | useTicker playhead reactivity (press play) |
| [05-html-paint.tsx](05-html-paint.tsx) | `dapi mount --live samples/reconciler/05-html-paint.tsx` | DOM/SVG materialization under \<html\>; needs html-in-canvas |
| [06-anime-timeline.tsx](06-anime-timeline.tsx) | `dapi mount --live samples/reconciler/06-anime-timeline.tsx` | anime.js timeline seeked from useTicker, driving an ECS node and \<html\> content in lockstep |
| [07-anime-mini.tsx](07-anime-mini.tsx) | `dapi mount --live samples/reconciler/07-anime-mini.tsx` | minimal anime.js + useTicker sync, sized for a social post |
| [08-canvas-paint.tsx](08-canvas-paint.tsx) | `dapi mount --live samples/reconciler/08-canvas-paint.tsx` | ref-provided canvas: \<canvas\> element and \<canvasPaint\> child, effect-driven redraws |
| [09-three-helmet.tsx](09-three-helmet.tsx) | `dapi mount --live samples/reconciler/09-three-helmet.tsx` | three.js WebGL renderer owning a \<canvas\>, glTF model loaded over the network, rotation seeked from useTicker |

Each root scene carries a stable key, so re-mounting a sample replaces its
scene in place. Inspect results with `dapi node tree`; entity ids in sample 03
stay stable across shuffles (moves, not recreates).
