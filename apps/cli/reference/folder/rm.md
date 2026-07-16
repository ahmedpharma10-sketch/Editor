# `dapi folder rm <ids...>`

Deletes one or more folders. **Deletion cascades:** every descendant folder and every asset inside the subtree is deleted with it. The fulfilled record reports what the cascade removed, so callers can detect when a delete swept more than intended. Alias: `remove`.

## Input

- `<ids...>`: folder ids (required)

## Output

JSON Lines on stdout, one per deleted folder:

```ts
{ id: string; deletedFolders: number; deletedAssets: number }
// deletedFolders counts the folder itself plus all descendants
```

## Errors

An unknown id fails the whole command before anything is deleted.
