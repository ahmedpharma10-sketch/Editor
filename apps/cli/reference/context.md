# `dapi context`

Essential context about the open project. Call this first to understand the canvas situation. Alias: `ctx`.

## Input

None.

## Output

One JSON object:

```ts
{
  project:        { id: string; name: string };
  entityCount:    number;
  scenes:         Array<{ id: number; name: string; size: Size }>;
  activeSceneId:  number | null;   // null if no scene is active
  currentFrame:   number;          // current timeline playhead position, in frames
  fontFamilies:   string[];
}
```
