# @diffusionstudio/ai

Declarative generated assets for [Diffusion Studio](https://diffusion.studio)
compositions. A `generate.*` call is pure: it validates its options and returns
an `AssetRef` value that is passed wherever a source is expected (`src`,
`startFrame`, `endFrame`, `refs`) in a `@diffusionstudio/solid` composition.
Nothing generates until the mounted tree commits; refs never used by a mounted
element are dropped.

```tsx
import { generate } from "@diffusionstudio/ai";

const hero = generate.image({ prompt: "A neon city at night, cinematic" });

export default function Project() {
  return (
    <scene key="intro" name="Intro" width={1920} height={1080}>
      <image src={hero} />
    </scene>
  );
}
```

## Setup

The editor supplies the runtime when a project is mounted, so this package is
needed for **types and tooling** — IntelliSense, `tsc --noEmit`, and testing
components outside the editor.

```sh
npm install --save-dev @diffusionstudio/ai
```

## Documentation

See the JSX API specification shipped with the Diffusion Studio CLI for the
full `generate.*` declaration API.

## License

[MPL-2.0](./LICENSE)
