# `dapi mount (<path> | --code <str>)`

Compiles a Solid JSX project module and executes it in the app, mounting the rendered roots into the document. Like reloading a webpage, re-mounting rebuilds the roots in place instead of adding copies: every top-level element declares its identity in the JSX with a `key`, and `<scene key="intro">` replaces the node carrying that key (or creates it).

The full JSX code syntax lives in [jsx/](./jsx/README.md); start with the [pipeline](./jsx/README.md#pipeline) and [roots](./jsx/roots.md).

## Input

Exactly one of:

- `<path>`: path to a `.tsx` / `.jsx` / `.ts` / `.js` entry module.
- `--code <str>`: inline module source, compiled identically. The `export default () =>` wrapper is optional; a bare JSX expression (no `export default` in the source) is wrapped into a component module automatically.

Optionally:

- `--live`: keep the reactive graph alive after mounting, so signals, effects, timers, and [`useTicker`](./jsx/lifecycle.md#useticker) keep driving the mounted entities. Without it the graph is disposed once the mount lands (the entities stay, reactivity stops). A live run ends when a later mount claims one of its root keys or the project closes (see [jsx/lifecycle.md](./jsx/lifecycle.md)).

## Output

None. The command exits `0` once the tree is committed and every declared asset has generated; inspect the result with [`dapi context`](./context.md), [`dapi node ls`](./node/ls.md), or [`dapi node tree`](./node/tree.md).

## Notes

- A newly added top-level scene becomes the active scene.
- The command is long-running when assets are declared: it blocks until generation finishes (see [jsx/generate.md](./jsx/generate.md)).
- Compile errors fail before the app is contacted; mount errors insert nothing (see [jsx/errors.md](./jsx/errors.md)).
