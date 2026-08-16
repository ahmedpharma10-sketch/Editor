# @diffusionstudio/jsx

The editor supplies the runtime when a project is mounted, so this package is
needed for **types and tooling** — IntelliSense and `tsc --noEmit`. It carries
no renderer: `useTicker` and `useFile` are declarations that throw outside a
mount, and elements only become a composition once the editor renders them.

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

## License

[MPL-2.0](./LICENSE)
