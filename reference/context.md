# `dapi context`

Summary of app state. Alias: `ctx`.

## Input

None.

## Output

One JSON object:

```ts
{
  project: {
    id:         string;   // package.json `projectId`, stable across renames
    name:       string;   // package.json `displayName`, what the user calls it
    dir:        string;   // absolute project folder — where the JSX being edited lives
  };
  currentTime:  number | null;   // playhead in the active scene, in seconds; null if no scene is active
  fontFamilies: string[];        // families registered in the running world, valid as `fontFamily`
}
```

With no project open (the app sits at the dashboard) the report is just
`{ project: null }`: there is no playhead, no world, and no fonts to speak of.
Open one with [`dapi open`](./open.md).

`currentTime` is local to the active scene, the same origin a clip's `start`
and `end` are placed against, and in the same unit.

`project.dir` is the folder the app is editing, which is not necessarily the
one a command was run from: check it before writing to source files.

`fontFamilies` is what text can be drawn with right now — loaded into the world,
not merely named in the source — and always includes the editor default. For
every family installed on the machine, see [`dapi fonts`](./fonts.md).
