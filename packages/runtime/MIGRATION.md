# bitecs → koota migration status

Working doc for moving the editor engine from bitecs (`apps/web/src/components/engine/`) into this headless runtime package, and for tracking how far `apps/web` has gotten consuming it. Kept short on purpose: the code carries the "how", this carries what a fresh session cannot read off it.

## Ground rules

- `@diffusionstudio/runtime` holds everything that runs without a DOM and without solid-js (the CLI/node capture path consumes it). Browser-only systems (input, keyboard, camera, HUD, dom sync, timeline UI), persistence, history and Solid reactivity stay in `apps/web`; Solid bindings live in `packages/koota-solid`.
- Persistence to IndexedDB is **not** required for now. `EntityRecord` (`src/world/serialize.ts`) is an in-memory snapshot format for copy/paste, duplicate and split-on-overlap only, free to change.
- Breaking API/type changes inside the codebase are fine.
- Comments: lean, only constraints the code can't show. No em dashes in prose. Tabs, MPL header on ported files.

## Runtime package

Fully ported. Layout: `src/traits/*` (~85 components split by concern), `src/world/` (create-world, `store`, serialize, observers), `src/queries/`, `src/systems/` (playback → motion → transform → render, sequenced by `runSystems`), `src/actions/`, `src/media/`, `src/math/`, `src/fonts/`, `src/utils/`. Encoders live in their own package, `@diffusionstudio/encoder`.

Call-outs that outlive the port:

- Use `store(world, trait)` (`src/world/store.ts`) in systems, never bare `getStore`: koota registers stores on first add/query, so `getStore` throws on a fresh world.
- Renames: the `ScaleMode` enum is `ScaleModeType` (the trait took the name); `Computed.delay` is `Computed.origin`; predicates lost the world param (`isScene(entity)`); `TimelineNode.eid` is `entity: Entity`; media handle traits carry a `Handle` suffix so trait and class can share an export surface.
- Nothing in the runtime may import the encoder (cycle). The encoder's tsconfig must mirror this one (`DOM.Iterable`, `@webgpu/types`, `@types/audioworklet`), since exports point at TS sources and consumers compile them.
- DOM access is lazy everywhere; nothing touches DOM at import time.
- Verification so far: `npx tsc --noEmit` in the package plus a throwaway `smoke-test.tmp.ts` run with `npm exec --yes tsx@latest`, deleted afterwards. No test infra in the package yet.

## Stage model

Every world spawns one `Stage` entity; all rendered entities descend from it. "Top-level" means "direct child of the stage", never "has no parent".

- `world.get(Root)` is it, `isStage()` tests it, `getParentNode()` returns null when the parent is the stage (use it wherever top-level matters), `getParentEntity()` returns the raw parent including the stage.
- `ChildOf` is `{ exclusive: true, autoDestroy: 'orphan' }`, so destroying the stage tears down the document; clearing a project is destroy + respawn.
- The stage id is per-session: `serializeEntity` omits `ChildOf` to the stage and `cloneFromRecords` attaches parentless records to the target world's stage. `appendChild` asserts top-level and relies on exclusive re-targeting; `removeChild` re-parents to the stage rather than dropping `ChildOf`.

## Authored time model

`Delay`/`Trim` became four one-value traits in the JSX's vocabulary, all frames: `Start`, `End` (parent-relative placement) and `SourceIn`, `SourceOut` (the slice of the node's own source that plays). One trait per value because a clip rarely says more than one of these, and absence is the usual answer.

- Defaults (`resolveDuration`): absent Start/SourceIn are 0; an absent bound means the whole source, or 16s (`DEFAULT_DURATION_FRAMES`) without one. Scenes and groups without an End fit their children.
- **Every bound caps, shortest wins**: nothing silently overrides anything, and caps are read at resolve time, so no value is rewritten behind the user's back (`clampTrimToAssetDuration` is gone: a shorter asset shortens the clip, swapping back restores the reach).
- `trimEntityIn/Out(world, entity, frame)` move an in/out point at a scene frame. `trimEntityIn` pins the implied End first so a head trim doesn't drag the tail; `trimEntityOut` writes SourceOut only when one is already authored.
- The five timing traits share one observer loop, propagating through the subtree. Removal passes the departing trait as `ignore`, because koota fires onRemove *before* clearing it.

## Decisions the code doesn't show

- **No history layer.** Actions write directly; the app groups undo steps by observing koota events. No `Deleted` tombstone either: `deleteEntity` is `entity.destroy()` and the subtree cascades. Entity ids are not stable across delete/undo, so key external refs by `Key`.
- **Keyframe auto-sync deliberately stayed out of observers**: koota change events don't say which field changed, so syncing every field would mint spurious keyframes. Editing surfaces call `syncKeyframeTrack` for the property they changed (`resizeEntity` already does for width/height).
- Actions are plain world-first functions, not koota `createActions`; the bound-record pattern only obscured that they call each other.
- Motion has no iteration order and no top-level exclusion, so keyframed scenes promoted to top level now play instead of silently freezing. Strip tracks in the promotion action if freezing is wanted.
- `TextStyle` defaults are all-undefined: a range override carries only its set fields (sparse slot = inherit). Node-level fallbacks (16px/Inter/400/leading 1) live in the text renderer's accessors.
- `HitRegions` entries are callback-less; the app's input system drains the list each frame and attaches handlers. Headless worlds push nothing, so it can't grow unbounded.
- The app's history layer must treat `Transition` onRemove during a tick as system-driven, not undoable.
- Still app-side from the old `api/observers.ts`: persistence scheduling, timeline index rebuilds, `syncInteractiveState`, Selected waveform show/hide, ClipHeight/Expanded, ExportSettings defaults, drag-origin traits.

## koota gotchas (0.6.6)

- **Local patch, do not lose:** `patches/koota+0.6.6.patch`, applied by the root `postinstall`. `Or(...)` was evaluated per 32-trait bitmask generation and required a match in every one, so Or queries created after the Or'd traits straddle a generation boundary silently returned empty. On a koota bump, retest (register 40 dummy traits, then create a fresh Or query) before dropping it.
- `Not(...)` takes plain traits only; relation pairs (`Not(ChildOf('*'))`) throw at runtime. Maintain a tag via observers if an indexed exclusion is needed.
- No hierarchy-ordered queries (no bitecs `Hierarchy(ChildOf)`). Transform does its own parent-first DFS, and that ordering is load-bearing there.
- Object/array trait fields need callback initializers (`colors: () => []`); AoS traits are `trait(() => instance)` and accept instances or null through plain `set`.
- Max 16 live worlds; `world.destroy()` in test loops and throwaway offline worlds. Stores are indexed by `entity.id()`; `world.id()` is a world slot, not an entity. World traits sit on a hidden internal entity that is not public API.
- `set` throws if the trait is missing and merges partials; `add` is idempotent and never resets values, hence add-then-set everywhere. On an exclusive relation, `add` re-targets in place.
- Events: exclusive re-target fires remove(old) then add(new); a redundant same-pair add fires nothing; **remove events fire while the departing child is still in the old target's queries** (hence the `exclude`/`ignore` params in `rebuildCaches` and the timing observers). onAdd fires after initial values are applied and may set traits. onChange fires even when the value is unchanged.

## apps/web integration

Depends on `@diffusionstudio/runtime` + `@diffusionstudio/koota-solid`, migrating slice by slice. The bitecs engine in `apps/web/src/components/engine/` is still fully intact and untouched; both providers are mounted side by side in `pages/home.tsx`, keyed on `projectId`.

Done:

| Slice | Where |
|---|---|
| Engine shell (canvas mount/resize/DPR, AudioContext, tick + `frame` signal) | `engine/create-engine.ts`, `engine/context.tsx` |
| Projects on disk (desktop): folder with an `index.tsx` exporting `<stage>` | `apps/web/src/projects/`, `apps/desktop/src/projects.ts` |
| Editing commands, reported as source-vocabulary edits for write-back | `engine/editor.ts` (`DocumentEditor`, `useEditor()`) |
| Keyframes as edits (`writeKeyframe`/`toggleKeyframe`/`syncKeyframe`/`removeKeyframeTrack`) | `engine/keyframes.tsx`, `components/ui/keyframe.tsx` |
| Hooks | `engine/hooks/` (`useSelection`, `useAssetSelection`, `useDerived`, `useTool`, `useEditor`) plus koota-solid's `useTrait`/`useHas`/`useQuery`/`useWorld` |
| Draw tools + toolbar (armed tool is the `Tool` world trait) | `components/canvas/draw-overlay.tsx` |
| Input, HUD, camera, alignment | `engine/input/`, `engine/hud/`, `engine/align.ts` |
| Project config (per-scene export settings in package.json) | `engine/project-config.ts` |
| Panels: header, background, scene template, asset info, time, appearance, alignment, export, layout | `components/sidebar-right/inspector/` |

Hosted JSX surface is `COMPOSITION_TAGS` (`packages/jsx/src/source.ts`): the structural tags, the media tags, `<captions>`, the paint family, `<stroke>`, `<shadow>`, `<effect>`, `<animation>`, `<keyframeTrack>`/`<keyframe>`, `<html>`/`<surface>`. `mask` is a `<rect>` prop, not a tag.

Conventions worth repeating when migrating the next panel:

- Reads of `Computed` (anything the systems write without events) go through `useDerived`, which samples once per engine tick; `useTrait`/`useHas` cannot follow them.
- Writes go through `editor.editProperty` in JSX vocabulary. `false` is the value the writer removes an attribute for, so a default is unset rather than written.
- `syncKeyframe` after a prop write keeps an existing track in step, since the motion system would otherwise overwrite the edit next tick. **Exception:** `width`/`height` sync *before* the write, because the document's handler is `resizeEntity`, which syncs the track itself and would mint an unsourced keyframe first. The canvas resize in `engine/input/interactions.ts` has the same gap, unfixed.
- State with no JSX spelling (`KeepAspectRatio`, `ClipsContent`, `Skew`) is written to the trait alone and does not survive a recompile. Giving any of them a prop is a separate decision; a lock snapshot would then have to come from the authored size, not from whatever `Size` holds at mount.
- Panels still on bitecs import the diamond from `components/ui/keyframe-bitecs.tsx` until they move.

Still on bitecs: transform, caption-settings, text, fills, strokes, shadows, effects, animations, transition, masks, audio, interpolation panels; the timeline's keyframe layer; the whole timeline UI.

**Left stale on purpose** (deferred to a docs/examples pass): the eight `examples/*.tsx` still open with `<rect scene="...">` and no `<stage>`, so `tsc -p examples --noEmit` fails on them, and `reference/jsx/*` still describes the pre-`<stage>` model and `key` as the `syncTo` target. `reference/jsx` is stale as a whole; patching rows piecemeal would hide that.

## Remaining work

1. **apps/web**: remaining panels and the timeline UI, app-side world traits (store, timelineIndex signal), history via koota events, re-adding the editing-surface `syncKeyframeTrack` calls the observers slice dropped. `utils/captions.ts` stays app-side, rewired to `@diffusionstudio/encoder`. Once real content loads into the koota world, delete the hidden bitecs canvas and `engine/components`, `engine/api` progressively.
2. **CLI**: point node capture at the runtime + encoder packages, importing `MAX_FRAMES_PER_SHEET` from the encoder instead of redefining it in `cli-channels.ts`.

## Package reminders

- Exports: root `.` plus `./traits`, `./systems`, `./media`; everything is also re-exported from `src/index.ts`. The `./capture` entry in package.json is dangling (`src/capture/` no longer exists) and wants deleting.
- tsconfig sets `erasableSyntaxOnly: false` (enums with reverse lookups, same as apps/web).
- Deps: koota (patched), mediabunny, animejs, colord, `@diffusionstudio/assets` (the asset model moved out into its own package; sqids went with the id allocator). Dev: `@webgpu/types`.
