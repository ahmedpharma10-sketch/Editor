# `dapi project ls`

Lists all projects, most recently accessed first. Alias: `list`.

## Input

None.

## Output

JSON Lines, one per project:

```ts
{ id: string; name: string; createdAt: string; lastAccessedAt: string }
```
