<p align="center">
  <img src="assets/banner.png" alt="Diffusion Studio" width="700" />
</p>

<p align="center">
  <a href="https://discord.com/invite/zPQJrNGuFB"><img src="https://img.shields.io/discord/1115673443141156924?style=flat&logo=discord&logoColor=F8F8F8&label=Discord&labelColor=000000&color=161616" alt="Discord" /></a>
  <a href="https://x.com/diffusionhq"><img src="https://img.shields.io/badge/Follow%20for-Updates-161616?style=flat&logo=x&logoColor=F8F8F8&labelColor=000000" alt="Follow on X" /></a>
  <a href="https://www.ycombinator.com/companies/diffusion-studio"><img src="https://img.shields.io/badge/Combinator-F24-161616?style=flat&logo=ycombinator&logoColor=F8F8F8&labelColor=000000" alt="Y Combinator F24" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MPL--2.0-161616?style=flat&labelColor=000000&color=161616" alt="License: MPL-2.0" /></a>
</p>

**Diffusion Studio** is an open-source video editor built for agents. It bundles video analysis tools like speech-to-text and multimodal understanding with an editable timeline into a single CLI: everything agents need to edit videos and generate motion graphics.

Every output opens in a full video editing interface, so you can pick up and refine exactly where the agent left off.

## Getting started

Use with Claude Code, Codex, Cursor, Copilot, or Gemini CLI. Install the skill once, globally:

```sh
npx skills add diffusionstudio/skills -g
```

`/editor` is the main skill you'll use. Ask for what you want in plain language.

## Prompt examples

**Motion graphics**

```text
/editor Create a ~20-second promo for vercel-labs/native in Vercel's presentation style. Research its official website, GitHub, and brand guidelines; use authentic assets and verified product features, with crisp typography, polished motion, and a strong final CTA.
```

```text
/editor Recreate the 3blue1brown animation from https://youtu.be/HEfHFsfGXjs, closely matching its visual style, pacing, framing, colors, labels, and transitions. Use the exact collision mathematics from Gregory Galperin's original paper, do not approximate the physics.
```

**Video editing**

```text
/editor edit the footage in /path/to/folder
```

```text
/editor turn this footage into a polished YouTube video. Add readable captions and an attention-grabbing graphic in the opening to give viewers a strong visual hook.
```

**Clipping**

```text
/editor Can you pull the best 30-second moment from https://youtu.be/MtQ0qxyf-Ds and make a vertical version for social?
```

```text
/editor Make a 15-second version of this launch video. https://x.com/claudeai/status/2045156267690213649
```


**Video understanding and reasoning**

```text
/watch In three bullets, explain what starts the conflict. Include timestamps. https://youtu.be/aqz-KE-bpKQ
```

```text
/watch Name three recurring locations and give one visual cue that distinguishes each. https://youtu.be/dQw4w9WgXcQ
```

## Compositions as code

Compositions are [SolidJS](https://www.solidjs.com) modules. `dapi mount` compiles them and renders each element into an editable node in the document; re-mounting rebuilds in place, like reloading a webpage. Solid's control flow (`<For>`, `<Show>`, …) and any npm package are available to compose the tree, and generative assets are declared as values and produced on mount:

```tsx
import { For } from "solid-js";
import { generate } from "@diffusionstudio/jsx";

const hero = generate.image({ prompt: "A neon city at night, cinematic" });
const motion = generate.video({ prompt: "slow camera push-in", startFrame: hero });

const TITLES = [
  { text: "The Grid", start: 0, end: 2.5 },
  { text: "Neon Nights", start: 2.5, end: 5 },
];

export default function Project() {
  return (
    <rect scene="intro" name="Intro" width={1920} height={1080} fill="black">
      <video src={motion} width={1920} height={1080} />
      <sequence>
        <For each={TITLES}>
          {(t) => (
            <text
              textAlign="center"
              textBaseline="middle"
              fontSize={128}
              width={1920}
              height={1080}
              fill="white"
              start={t.start}
              end={t.end}
            >
              {t.text}
            </text>
          )}
        </For>
      </sequence>
    </rect>
  );
}
```

Everything a mount produces stays a first-class editor node, so a person can pick up in the UI exactly where the script left off.

## Seeing and hearing the media

Cutting footage requires understanding it. The CLI ships the inspection tools an agent needs to work with media it cannot watch:

```sh
dapi media probe clip.mp4                                # container + codec metadata, like ffprobe
dapi media grab clip.mp4 -t 0 12 45                      # decode frames to PNGs
dapi media filmstrip clip.mp4                            # grid of video frames
dapi media waveform track.mp3                            # audio waveform, silence flagged
dapi media transcribe interview.wav                      # timed, word-level transcript
dapi media listen interview.mp4 -p "what is said in the intro?"   # ask a multimodal model
dapi node capture                                        # see the canvas itself
```

## CLI at a glance

The core loop is three commands:

```sh
dapi open                       # use -b to run the editor headless
dapi mount hero.tsx             # render a composition into it
dapi node render -o hero.mp4    # encode the scene to disk
```

| Command | Purpose |
| --- | --- |
| `dapi open` | Launch the app, open a file, or turn a folder of footage into a project |
| `dapi context` | Summary of the open project: scenes, playhead, fonts |
| `dapi mount` | Compile and mount a JSX composition |
| `dapi node …` | The scene graph: `ls`, `tree`, `grep`, `patch`, `insert`, `cp`, `rm`, `capture`, `render` |
| `dapi asset …` | The media library: `add`, `ls`, `tree`, `mv`, `rm`, `export` |
| `dapi media …` | Inspect a file by id or path: `probe`, `grab`, `filmstrip`, `waveform`, `transcribe`, `listen` |
| `dapi project …` / `dapi folder …` / `dapi selection …` | Projects, library folders, canvas selection |
| `dapi models` / `dapi voices` / `dapi fonts` | Discover generation models, speech voices, local fonts |
| `dapi screenshot` / `dapi logs` | The app itself: capture the window, read recent console output |
| `dapi fetch` | Download a video from yt/tt/ig, ready for `dapi asset add` |
| `dapi whoami` | The authenticated account |
| `dapi report` | Report a bug in the CLI or the app: diagnostics bundled, filed as a GitHub issue via `gh` |

Conventions throughout: single results are one JSON value, collections are JSON Lines, errors go to stderr with exit code `1`. Everything is built to be piped, grepped, and driven by a program.

## Documentation

- [CLI reference](reference/README.md): every command, its options, and its output
- [JSX reference](reference/jsx/README.md): the composition markup with elements, timing, paints, generative assets, and captions
- [Examples](examples/README.md): runnable compositions, from basic scenes and generative assets to three.js and raw WebGPU

## Repository layout

| Path | Package | What it is |
| --- | --- | --- |
| `apps/web` | `@diffusionstudio/web` | The editor UI (Solid + Vite) |
| `apps/desktop` | `@diffusionstudio/desktop` | Electron shell hosting the editor |
| `apps/cli` | `@diffusionstudio/cli` | The `dapi` CLI |
| `packages/jsx` | `@diffusionstudio/jsx` | JSX runtime, types, and generated assets (`generate.*`) for compositions |

## Contributing / local setup

Requirements: Node 20+ and npm.

```sh
git clone https://github.com/diffusionstudio/editor.git
cd editor
npm install

cp apps/web/.env.example apps/web/.env   # required: the app won't run without it

npm run dev:web        # editor in the browser (Vite dev server)
# or
npm run dev:desktop    # editor as a desktop app (Electron): builds the CLI, starts the web server, launches the app
```

To put `dapi` on your PATH (macOS/Homebrew layout; adjust the link target for other setups), link it once:

```sh
npm run symlink:create --workspace=@diffusionstudio/cli
```

The link points at the CLI build, which `npm run dev:desktop` refreshes on every start, so the linked `dapi` always runs the latest code.

Before sending a PR:

```sh
npm run check    # typecheck all workspaces
npm run lint     # lint all workspaces
```

## License

[MPL-2.0](LICENSE)

The brand assets in [apps/desktop/assets](apps/desktop/assets) are not covered by this license. Copyright (c) Diffusion Studio Inc. All rights reserved.
