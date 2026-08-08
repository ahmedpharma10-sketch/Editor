# Examples

Self-contained compositions demonstrating the JSX API (see [reference/jsx](../reference/jsx/README.md)).
Run from the repo root with the editor open (`dapi open`). Each root carries a stable `scene`
identity, so re-mounting an example replaces its scene in place.

| Example | Command | Shows |
| --- | --- | --- |
| [01-basics.tsx](01-basics.tsx) | `dapi mount examples/01-basics.tsx` | the `scene` prop promoting a root, `<sequence>` with a dissolve, `<video>`, `<audio>`, `<image>`, `<text>` titles from data via `<For>` |
| [02-genai.tsx](02-genai.tsx) | `dapi mount examples/02-genai.tsx` | multi-stage generation: `generate.image` refs feeding `generate.video`, TTS voiceover, generated ambience, `<captions>` |
| [03-ticker.tsx](03-ticker.tsx) | `dapi mount examples/03-ticker.tsx` | declarative animation: `useTicker` + `createMemo` derived values driving props |
| [04-html-in-canvas.tsx](04-html-in-canvas.tsx) | `dapi mount examples/04-html-in-canvas.tsx` | `<html>`: an AI prompt box as real DOM, typed out from the playhead |
| [05-anime-timeline.tsx](05-anime-timeline.tsx) | `dapi mount examples/05-anime-timeline.tsx` | anime.js timeline seeked from `useTicker`, driving an ECS node and `<html>` content in lockstep |
| [06-three.tsx](06-three.tsx) | `dapi mount examples/06-three.tsx` | three.js WebGL renderer owning a `<surface>`, glTF model loaded over the network |
| [07-webgpu.tsx](07-webgpu.tsx) | `dapi mount examples/07-webgpu.tsx` | raw WebGPU on a `<surface>`: a triangle whose colors cycle with composition time |
| [08-shader-paint.tsx](08-shader-paint.tsx) | `dapi mount examples/08-shader-paint.tsx` | `<shaderPaint>` post-processing a `<video>`: WGSL chromatic aberration + vignette, uniforms patchable live |

Requirements: `02-genai.tsx` consumes generation credits (results are cached per session);
`01-basics.tsx`, `06-three.tsx`, and `08-shader-paint.tsx` fetch remote media.

Typecheck with `tsc -p examples --noEmit` (part of `npm run check`).
