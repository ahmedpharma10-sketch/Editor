# Media source resolution

`src` (on [`<video>`](./video.md), [`<image>`](./image.md), [`<audio>`](./audio.md), and the DOM [`<img>`](./html.md#images) inside `<html>`) accepts:

- **Library path**: e.g. `"b-roll/drone.mp4"`, an asset of the project's library by its path there (folder + name, as shown in the asset panel and recorded in the project's `assets.yml`). The preferred form: it is portable and survives the file being relinked. A directory of numbered images is an image sequence and plays on `<video>` or `<image>`.
- **Asset id**: e.g. `"9f3a2c1d7e4b8a01"`, the content hash of a library asset (`assets.yml` lists them).
- **Global path**: e.g. `"/Movies/video.mp4"`, resolved against the user's OS. Not added to the library.
- **Remote URL**: e.g. `"https://my.videoarchive.com/audio/clip.wav"`, fetched on mount. Not added to the library.
- **`AssetRef`**: the value returned by a `generate.*` declaration (see [generate.md](./generate.md)). The node is inserted immediately as a placeholder and its paint is attached once the asset has generated; the result is stored under the library's `generated/` folder.

## Source modifiers

`<image>` and `<video>` take props that put the source through a model before the element shows it:

| Prop | On | Meaning |
| ---- | -- | ------- |
| `removeBackground` | `<image>` | Cuts the subject out, leaving the rest transparent. |
| `upscale` | both | Resolution multiplier — `upscale={2}` asks for twice the pixels. Enlarges the source, not the box. |
| `addAudio` | `<video>` | Scores footage that has no sound. |

```tsx
<image src="footage/fox.png" removeBackground upscale={2} width={800} height={450} />
```

The `src` goes on naming what the picture was made from, so taking a modifier off gives the original back — nothing is overwritten and nothing is lost. Results are cached by source and modifiers, like [generated assets](./generate.md#caching-and-idempotency) and stored in the same `generated/` folder, so one is made however many elements ask for it, and adding a second modifier does not re-run the first. They are applied in the order of the table above, whatever order they are written in.

Modifiers compose with declarations: `<image src={generate.image({ prompt: "a red fox" })} removeBackground />` generates, then cuts out.

## The library

A project's assets are recorded in `assets.yml` next to its entry file: for each asset, its library `path`, where its bytes are (`source`: the absolute path of a file imported from disk — imports never move or copy files — or a project-relative path under `assets/` for files the app produced), and what it was found to be. Folders are virtual: they are the prefixes of the paths. Renaming or moving an asset in the panel rewrites the `src` props that named it. Files placed under `assets/` by hand are taken into the library on the next load.

An `<img>` additionally takes a `data:` or `blob:` URL, which goes to the browser as it is.

To read a source's raw bytes inside an effect (rather than mount it as a node), pass the same input to [`useFile`](./lifecycle.md#usefile), which resolves it to a `File`.
