# @diffusionstudio/reconciler

Renders a project's JSX into a `@diffusionstudio/runtime` world. Sits between the compiler (which turns a project folder into a CommonJS bundle with `babel-preset-solid` in universal mode, `moduleName: "@diffusionstudio/jsx"`) and the runtime (which knows nothing about JSX):

```
project folder → compile (esbuild + babel) → code string → reconciler → runtime entities
```

- `evaluate(code)` runs the bundle against the app's own `solid-js` and `@diffusionstudio/jsx` (one reactive graph, one JSX runtime) and returns its default-exported component.
- `RuntimeDocument` implements `ProjectDocument` from `@diffusionstudio/jsx` over a runtime world: `<stage>` becomes a Scene entity, `<rect>` a rect entity, `fill` a solid paint child. It is the only place that knows how the runtime models nodes.
- `mount(code, world)` does both and returns a disposer that also destroys the rendered entities (Solid's universal render disposer only tears down the reactive graph).

```ts
import { mount } from '@diffusionstudio/reconciler';

const mounted = mount(compiled.code, world);
// ...later, e.g. on a file change:
mounted.dispose();
```

Supported today: `<stage>` and `<rect>` with `x`, `y`, `width`, `height`, and `fill` (rect only).
