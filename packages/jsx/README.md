# @diffusionstudio/jsx

JSX runtime, types, and declarative generated assets for authoring
[Diffusion Studio](https://diffusion.studio) compositions as code. Projects
written against this package are compiled and mounted into the running editor
with `dapi mount`; every JSX element becomes an editable node in the
composition — there is no hidden DOM, no CSS resolution, and no measuring pass.

```tsx
import { Captions, Image, Scene, Text, generate } from "@diffusionstudio/jsx";

const hero = generate.image({ prompt: "A neon city at night, cinematic" });

export default function Project() {
  return (
    <Scene key="intro" name="Intro" width={1920} height={1080}>
      <Image src={hero} />
      <Text textAlign="center" textBaseline="middle" fontSize={128} fontWeight="bold">
        Hello World
      </Text>
      <Captions />
    </Scene>
  );
}
```

## Setup

The editor supplies the runtime when a project is mounted, so this package is
needed for **types and tooling** — IntelliSense, `tsc --noEmit`, and testing
components outside the editor.

```sh
npm install --save-dev @diffusionstudio/jsx solid-js
```

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@diffusionstudio/jsx"
  }
}
```

## Generated assets

A `generate.*` call is pure: it validates its options and returns an
`AssetRef` value that is passed wherever a source is expected (`src`,
`startFrame`, `endFrame`, `refs`). Nothing generates until the mounted tree
commits; refs never used by a mounted element are dropped.

## Documentation

See the JSX API specification shipped with the Diffusion Studio CLI for the
full element reference, timing model, media source resolution, and the
`generate.*` declaration API.

## Testing outside the editor

`renderProject` renders a component into any `ProjectDocument` implementation,
so a test can supply a lightweight in-memory document and assert on what the
renderer wrote into it:

```ts
import { renderProject } from "@diffusionstudio/jsx";
import type { ProjectDocument } from "@diffusionstudio/jsx";
import Project from "./project";

const document: ProjectDocument = /* your in-memory implementation */;
const dispose = renderProject(Project, document);
dispose();
```

## License

[MPL-2.0](./LICENSE)
