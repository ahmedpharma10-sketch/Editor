# `dapi context`

Essential context about the open project. Call this first to understand the canvas situation. Alias: `ctx`.

## Input

None.

## Output

One JSON object:

```ts
{
  projectId:      string;
  entityCount:    number;
  scenes:         number[];        // ids of the top-level scenes
  activeSceneId:  number | null;   // null if no scene is active
  currentFrame:   number;          // current timeline playhead position, in frames
  workarea:       { start: number; end: number } | null;   // seconds, null if the active scene has none
  fontFamilies:   string[];
  selection:      number[];        // ids of the selected nodes, empty if nothing is selected
}
```
