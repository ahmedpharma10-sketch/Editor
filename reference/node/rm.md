# `dapi node rm <ids...>`

Deletes one or more entities and all their descendants. Alias: `remove`.

## Input

- `<ids...>`: one or more entity ids (required)

## Output

JSON Lines on stdout, one per deleted entity:

```ts
{ id: number }
```

## Errors

An unknown id fails the whole command before anything is deleted.
