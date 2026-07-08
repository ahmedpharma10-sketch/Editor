# `dapi open [target]`

Launches Diffusion Studio, or opens a target. Behavior depends on what `[target]` resolves to. Does not require the app to already be running.

## Input

- `[target]` (optional), one of:
  - *omitted*: launches the app.
  - **`diffusion://...` URL**: follows the deep link.
  - **file path**: opens the file in the app.
  - **folder path**: see [Folder open](#folder-open) below.

## Options

- `-b, --background`: launch with the window hidden (`show: false`), so the app runs headlessly and can be driven by other CLI commands without any visible UI.

## Output

- File / URL / no target: nothing.
- Folder: one JSON object (see below).

## Folder open

When `[target]` is a directory, `open` either creates a project from the folder's contents or switches to a previously created one. The decision is driven by a `.dapi` marker file at the folder root.

**First time** (no marker present):

1. Creates a new project named after the folder.
2. Imports every supported asset file under the folder (recursively, excluding the marker itself), mirroring the on-disk directory structure as library folders. Directories without any supported assets beneath them produce no folder.
3. Writes the `.dapi` marker at the folder root with the new project id.
4. Opens the project.

**Subsequent times** (marker present):

1. Reads the project id from the marker.
2. Switches to that project. No re-import.
3. If the referenced project no longer exists, the marker is treated as stale and the first-time flow runs again, overwriting the marker.

**Marker file**: `.dapi` at the folder root. JSON:

```ts
{
  version:   1;
  projectId: string;
  createdAt: string;   // ISO 8601
}
```

Add it to `.gitignore` to keep the project association per-clone, or commit it to share the same project across teammates.

**Output:** one JSON object

```ts
{
  project:  { id: string; name: string };
  created:  boolean;     // true if a new project was created this run (first-time or stale-marker)
  imported: number;      // assets imported this run; 0 on switch-only
}
```
