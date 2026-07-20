# Getting started

## Install the CLI

The CLI is built from this repository. With Node 20+ installed:

```sh
git clone https://github.com/diffusionstudio/editor.git
cd editor
npm install
npm run symlink:create --workspace=@diffusionstudio/cli
```

`symlink:create` builds `dapi` and links it into `/opt/homebrew/bin` (the macOS/Homebrew layout). On other setups, build with `npm run build --workspace=@diffusionstudio/cli` and link `apps/cli/dist/index.js` onto your PATH yourself.

## Launch the editor

Every `dapi` command except `open` and `fonts` talks to a running Diffusion Studio instance. Start one:

```sh
dapi open        # launch the app
dapi open -b     # launch headless (no window), ideal for agents and CI
```

When developing from source, `npm run dev:desktop` starts the app too.

## Turn a folder of footage into a project

Point `open` at a directory and it becomes a project: every supported media file underneath is imported, with the directory structure mirrored as library folders.

```sh
dapi open ./shoot-2026-07
```

The first run creates the project and writes a `.dapi` marker file into the folder; later runs read the marker and just switch to that project. Commit the marker to share one project across a team, or add it to `.gitignore` to keep the association per-clone.

You can also manage projects directly: `dapi project create`, `dapi project ls`, `dapi project set <id>`.

## Look around

```sh
dapi context      # the open project: scenes, active scene, playhead, fonts
dapi asset tree   # the media library as a folder tree
```

`dapi context` (alias `ctx`) is the right first call in any session; it tells you what is on the canvas before you change it.

## Mount your first composition

Compositions are Solid JSX modules rendered into the document with `dapi mount`. For a one-liner, pass code inline:

```sh
dapi mount --code '<Scene key="hello" name="Hello" width={1920} height={1080} fill="black">
  <Text textAlign="center" textBaseline="middle" fontSize={120} fill="white">Hello World</Text>
</Scene>'
```

The `key` is the scene's stable identity: re-running the mount rebuilds that scene in place instead of adding a copy. For anything real, put the module in a file (`dapi mount hero.tsx`) and see [Writing compositions](composition.md).

Check the result visually:

```sh
dapi node capture        # prints { "time": null, "path": "/tmp/….png" }
```

## Render

```sh
dapi node render -o hello.mp4
```

Renders the active scene locally with sensible defaults (MP4, H.264, 1080p). Codec, bitrate, resolution, and trim are configurable; see [`node render`](cli.md#node-render) in the CLI reference.

## Next

- [CLI reference](cli.md): the full command surface
- [Writing compositions](composition.md): timing, paints, generative assets, captions
- [Working with media](assets.md): probe, transcribe, and listen to footage
