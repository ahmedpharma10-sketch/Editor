# Project module

The entry file is a standard Solid component module:

```tsx
export default function Project() {
  return (
    <rect scene="intro" name="Intro" fill="black" width={1920} height={1080}>
      {/* ... */}
    </rect>
  );
}
```


The component receives no props; which document node each rendered root maps onto is declared in the JSX itself via `key` (see [roots.md](./roots.md)).

## Module environment

Imports resolve by category:

- **Host modules** (marked external at compile time, resolved in-app so the project shares the editor's reactive runtime): `solid-js`, `solid-js/store`, `@diffusionstudio/jsx`. These must be the editor's own instance and never come from anywhere else.
- **Userland packages** — any other bare specifier (`three`, `gsap`, `d3-scale`, …). A project folder is a real npm package, so these work as they normally do: install one (`npm i three`) and esbuild resolves it from the project's `node_modules` and bundles it into the compiled module, subpath imports and `exports` maps included. Nothing is installed for you and there is no CDN fallback — a specifier that does not resolve fails the compile with `Could not resolve "three"`, and the canvas keeps the last good render. Libraries must be browser-compatible (no Node builtins); sources under `node_modules` skip the JSX transform, so a package must ship compiled JavaScript rather than raw JSX.
- **Local imports**: relative/absolute paths (`./helper`, local JSON) are resolved on disk and bundled. Static `https://…` imports are **not** supported — they survive bundling as a require the renderer cannot satisfy, and fail at mount.
- The module executes **inside the editor process**, unsandboxed. This is local tooling with a local trust model, the same trust as running the CLI itself. Only effects made through the JSX runtime are part of the document (and its undo history); anything else the module does is unsupported.
- Solid's control flow (`<For>`, `<Show>`, `<Index>`, `<Switch>`) and primitives (`createSignal`, `createMemo`, …) are fully available during mount. See [lifecycle.md](./lifecycle.md) for what happens after mount.

## Types and tooling

`@diffusionstudio/jsx` ships the JSX namespace (which types the camelCase composition tags), for editor IntelliSense and typechecking in a project folder:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@diffusionstudio/jsx"
  }
}
```

The CLI does not typecheck; types are stripped at compile time. Run `tsc --noEmit` in the project folder for type safety.

Installing a userland package gives it both its runtime code and its types. A package that ships no declarations of its own needs its `@types/…` alongside it (`npm i -D @types/three`). `@diffusionstudio/jsx` and `solid-js` are the exception: they are declared in the scaffolded `package.json` for types only, since the compiler always keeps them external and the running composition uses the app's own instance.
