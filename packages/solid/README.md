# @diffusionstudio/solid

Solid JSX runtime and types for authoring [Diffusion Studio](https://diffusion.studio)
compositions as code. Projects written against this package are compiled and
mounted into the running editor with `dapi mount`; every JSX element becomes an
editable node in the composition — there is no hidden DOM, no CSS resolution,
and no measuring pass.

```tsx
import { generate } from "@diffusionstudio/ai";

const hero = generate.image({ prompt: "A neon city at night, cinematic" });

export default function Project() {
  return (
    <scene key="intro" name="Intro" width={1920} height={1080}>
      <image src={hero} />
      <text textAlign="center" textBaseline="middle" fontSize={128} fontWeight="bold">
        Hello World
      </text>
      <captions />
    </scene>
  );
}
```

## Setup

The editor supplies the runtime when a project is mounted, so this package is
needed for **types and tooling** — IntelliSense, `tsc --noEmit`, and testing
components outside the editor.

```sh
npm install --save-dev @diffusionstudio/solid solid-js
```

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@diffusionstudio/solid"
  }
}
```

## Documentation

See the JSX API specification shipped with the Diffusion Studio CLI for the 
full element reference, timing model, and media source resolution. Generated
assets (the `generate.*` declaration API) live in `@diffusionstudio/ai`.

## Testing outside the editor

`renderProject` renders a component into any `ProjectDocument` implementation,
so a test can supply a lightweight in-memory document and assert on what the
renderer wrote into it:

```ts
import { renderProject } from "@diffusionstudio/solid";
import type { ProjectDocument } from "@diffusionstudio/solid";
import Project from "./project";

const document: ProjectDocument = /* your in-memory implementation */;
const dispose = renderProject(Project, document);
dispose();
```

## License

[MPL-2.0](./LICENSE)
