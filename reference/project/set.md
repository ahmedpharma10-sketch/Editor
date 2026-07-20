# `dapi project set <id>`

Sets the active project by id, opening it. Returns `null` if no project has that id.

## Input

- `<id>`: project id (required)

## Output

One JSON value:

```ts
{ id: string; name: string } | null
```
