# Diffusion Studio

**FFmpeg for agents:** a multimedia editor you drive from the command line, with generative AI and multimodal understanding built in.

What sets Diffusion Studio apart is `dapi`: a CLI that makes every part of the editor (projects, scene graphs, assets, AI generation, and rendering) scriptable over a local socket.

```sh
dapi open                       # use -b to run the editor headless
dapi mount hero.tsx             # render a composition into it
dapi node render -o hero.mp4    # encode the scene to disk
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
    <scene key="intro" name="Intro" width={1920} height={1080} fill="black">
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
    </scene>
  );
}
```

Everything a mount produces stays a first-class editor node, so a person can pick up in the UI exactly where the script left off.

## Seeing and hearing the media

Cutting footage requires looking at it. The CLI ships the inspection tools an agent needs to work with media it cannot watch:

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
