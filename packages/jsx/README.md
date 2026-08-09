# @diffusionstudio/jsx

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

## License

[MPL-2.0](./LICENSE)
