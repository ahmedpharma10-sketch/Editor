# Diffusion Studio

**FFmpeg for agents:** a video editor you drive from the command line, with a generative-AI and vision toolchain built in.

Diffusion Studio is a canvas-based video editor. What makes it different is `dapi`, its CLI: every part of the editor (projects, the scene graph, the asset library, AI generation, rendering) is scriptable over a local socket, with JSON on stdout and deterministic exit codes. A human uses the canvas; an agent uses `dapi`. Both edit the same document.

```sh
dapi open                       # use -b to run the editor headless
dapi mount hero.tsx             # render a composition into it
dapi node export -o hero.mp4    # encode the scene to disk
```

## Compositions as code

Compositions are [SolidJS](https://www.solidjs.com) modules. `dapi mount` compiles them and renders each element into an editable node in the document; re-mounting rebuilds in place, like reloading a webpage. Solid's control flow (`<For>`, `<Show>`, …) and any npm package are available to compose the tree, and generative assets are declared as values and produced on mount:

```tsx
import { For } from "solid-js";
import { generate } from "@diffusionstudio/jsx";

const hero = generate.image({ prompt: "A neon city at night, cinematic" });
const motion = generate.video({ prompt: "slow camera push-in", startFrame: hero });

const TITLES = [
  { text: "The Grid", inPoint: 0, outPoint: 2.5 },
  { text: "Neon Nights", inPoint: 2.5, outPoint: 5 },
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
              inPoint={t.inPoint}
              outPoint={t.outPoint}
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
dapi asset probe clip.mp4                                # container + codec metadata, like ffprobe
dapi asset frame clip.mp4 -t 0 12 45                     # decode frames to PNGs
dapi asset visualize track.mp3                           # waveform / filmstrip previews
dapi asset transcript interview.wav                      # timed, word-level transcript
dapi asset analyze b-roll.mp4 -p "when is the product shown?"   # ask a vision model
dapi asset sync lav.wav -v camera.mp4                    # align external audio to camera audio
dapi node screenshot                                     # see the canvas itself
```

## CLI at a glance

| Command | Purpose |
| --- | --- |
| `dapi open` | Launch the app, open a file, or turn a folder of footage into a project |
| `dapi context` | Summary of the open project: scenes, playhead, fonts |
| `dapi mount` | Compile and mount a JSX composition |
| `dapi node …` | The scene graph: `ls`, `tree`, `grep`, `patch`, `insert`, `cp`, `rm`, `screenshot`, `export` |
| `dapi asset …` | The media library: `add`, `ls`, `probe`, `frame`, `visualize`, `analyze`, `transcript`, `sync`, `export` |
| `dapi project …` / `dapi folder …` / `dapi selection …` | Projects, library folders, canvas selection |
| `dapi models` / `dapi voices` / `dapi fonts` | Discover generation models, speech voices, local fonts |

Conventions throughout: single results are one JSON value, collections are JSON Lines, errors go to stderr with exit code `1`. Everything is built to be piped, grepped, and driven by a program.

## Documentation

- [Getting started](docs/getting-started.md): install the CLI, open a project, first mount, first export
- [CLI reference](docs/cli.md): every command, its options, and its output
- [Writing compositions](docs/composition.md): the JSX API with elements, timing, paints, generative assets, and captions
- [Working with media](docs/assets.md): the asset library and the vision/audio toolchain

## Repository layout

| Path | Package | What it is |
| --- | --- | --- |
| `apps/web` | `@diffusionstudio/web` | The editor UI (Solid + Vite) |
| `apps/desktop` | `@diffusionstudio/desktop` | Electron shell hosting the editor |
| `apps/cli` | `@diffusionstudio/cli` | The `dapi` CLI |
| `packages/jsx` | `@diffusionstudio/jsx` | Solid JSX runtime and types for compositions |

## Contributing / local setup

Requirements: Node 20+ and npm.

```sh
git clone https://github.com/diffusionstudio/editor.git
cd editor
npm install

npm run dev            # editor in the browser (Vite dev server)
npm run dev:desktop    # editor as a desktop app (Electron)
```

To build the CLI and put `dapi` on your PATH (macOS/Homebrew layout; adjust the link target for other setups):

```sh
npm run symlink:create --workspace=@diffusionstudio/cli
```

Before sending a PR:

```sh
npm run check    # typecheck all workspaces
npm run lint     # lint all workspaces
```

## License

[MPL-2.0](LICENSE)
