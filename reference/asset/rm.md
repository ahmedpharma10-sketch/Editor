# `dapi asset rm <ids...>`

Deletes one or more assets from the open project by id. Alias: `remove`.

## Input

- `<ids...>`: asset ids (required)

## Output

JSON Lines on stdout, one per deleted asset:

```ts
{ id: string; name: string }
```

## Errors

An unknown id fails the whole command before anything is deleted.
