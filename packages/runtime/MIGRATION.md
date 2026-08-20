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
- **`destroy()` strips an entity's traits before it fires the ChildOf removal**, so a handler on that event cannot ask the departing child what it was. `rebuildCaches` files by trait and so filed nothing on the way out, leaving every destroyed entity in its parent's `Cache` lists (a deleted stroke kept its row, a deleted node kept its place in `children`); `evictFromCaches` drops it by identity instead. Anything else keyed on what a child *is* has the same hole.

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
| Panels: header, background, scene template, asset info, time, appearance, alignment, export, layout, text, strokes, shadows, effects, animations, transition, masks, audio, fills | `components/sidebar-right/inspector/` |
| Local font families (web fonts and loading are the runtime's) | `engine/fonts.ts` (`getLocalFonts`) |

Hosted JSX surface is `COMPOSITION_TAGS` (`packages/jsx/src/source.ts`): the structural tags, the media tags, `<captions>`, the paint family, `<stroke>`, `<shadow>`, `<effect>`, `<animation>`, `<keyframeTrack>`/`<keyframe>`, `<html>`/`<surface>`. `mask` is a `<rect>` prop, not a tag.

Conventions worth repeating when migrating the next panel:

- Reads of `Computed` (anything the systems write without events) go through `useDerived`, which samples once per engine tick; `useTrait`/`useHas` cannot follow them.
- Writes go through `editor.editProperty` in JSX vocabulary. `false` is the value the writer removes an attribute for, so a default is unset rather than written.
- `syncKeyframe` after a prop write keeps an existing track in step, since the motion system would otherwise overwrite the edit next tick. **Exception:** `width`/`height` sync *before* the write, because the document's handler is `resizeEntity`, which syncs the track itself and would mint an unsourced keyframe first. The canvas resize in `engine/input/interactions.ts` has the same gap, unfixed.
- State with no JSX spelling (`KeepAspectRatio`, `ClipsContent`, `Skew`) is written to the trait alone and does not survive a recompile. Giving any of them a prop is a separate decision; a lock snapshot would then have to come from the authored size, not from whatever `Size` holds at mount.
- Panels still on bitecs import the diamond from `components/ui/keyframe-bitecs.tsx` until they move.
- A picker that previews on hover writes the trait alone, so while it is open the trait holds the hover and not the authored value. Keep the authored one in a signal seeded at mount (panels remount per selection) and move it only on a selection: it is what the control displays *and* what the close restores. Reading it back off the trait restores the hover instead, permanently. `AppearanceSettings`' blend mode and the text panel's family/weight both do this.
- What a `<text>` says is its children, not a prop, so it travels as its own edit end to end: `editor.editText` -> `TextEdit` -> the writer's `SourceSet.text` -> `RuntimeDocument.setText`. The document keeps the reconciler's text nodes: the first says all of it and the rest say nothing, so a project that later re-renders one of them still lands.
- A text is the one element whose box is optional (`Size` absent = sized to its glyphs), so the text panel's "Grow" toggle is `width`/`height` being authored at all. Unsetting a bound drops `Size` only once neither is left, which is why the toggle writes `width` before `height`.
- `Cache`'s lists are derived like `Computed` (store writes, no events), so a panel listing sub-entities reads them through `useDerived` too. Keep the empty fallback a module constant: a fresh `[]` per sample defeats the memo's comparison.
- Reordering siblings is a swap through `editor.reparent`, not an index write: `ItemIndex` is the document's to assign (`insertNode` renumbers the whole sibling list), and a move needs an anchor, since `reparent` appends without one and refuses an append into the parent the element already has. So "move later" moves the *next* sibling in front of this one.
- A shared control that knows *which* prop it edits keyframes it itself, off an `Entity` (`ColorOpacityPicker`'s `keyframeTarget`, now koota's); only a control that cannot know takes the diamond as a slot (`ControlledTextField`, `ColorOpacityRow`). Moving one of these moves it whole: the bitecs panels still calling it lose their diamonds until they migrate, and its recent-colors palette now queries the koota world for them too (both providers are mounted).

Still on bitecs: transform, caption-settings, interpolation panels; the timeline's keyframe layer; the whole timeline UI.

The stroke panel moved with the model: `StrokeStyle` is the stroke's, not the node's (as `<stroke width join cap miterLimit>` always was), so Weight/Join/Miter sit under each stroke's row instead of once per node. `<stroke>` is a solid paint that takes no paint children, so its picker is the color one alone, with no gradient or asset tab and no `FillPicker` behind it. `cap` still has no control (it shows only on open paths, and there are no icons for it).

The effects panel dropped its add menu: the plus authors an `<effect type="blur" value={8}>` outright and opens the inspector on it, where a select in the header (standing where a title would, as the export inspector's does) changes which filter it is. Every effect is the same one number under a different name, so the type is a control like any other rather than a question asked before the element exists. What that select has to answer for is the unit: `value` is px for `blur`, degrees for `hueRotate` and a 0-1 amount for the six others (`effect-types.ts` carries the table), so a switch within a unit keeps the value while one across it takes the new type's default and drops the `value` track, whose numbers meant the old unit. `type` and `value` are both required props and so are always written, never unset. `<effect>` gained `hidden` (`Pick<CompositeProps, "hidden">`, as `<shadow>` has it): the renderer already skipped a hidden effect, and the panel's row menu had no way to say so.

The animations panel took the same plus: it authors `<animation type="fade">` (every node can play a fade) and opens the inspector, whose header select picks the preset out of the groups the node can play, `animation-types.ts` carrying them. The Text and Audio groups are offered on a text node and on one with something to hear (an audio clip, a video paint, a video fill), plus whichever group holds the preset already set, so an animation authored before the node lost its audio still has a value the select can show. `type` is required and always written; `phase`, `duration` and `delay` unset at "in", 1s and 0. Phase moved out of the header into a row of its own, since the header now names the animation. Rows list the in-animations before the out ones, each in the file's order, which is the order two animations on one property resolve in.

The transition panel is the odd one of the three: `transition` is a prop of the clip (a `TransitionSpec`, one per clip), not a child element, so there is one row and the plus goes once a transition is there, the way the export panel's does. Its plus authors `{ type: "dissolve", duration: 1 }` and opens the inspector, where the same header select changes the style. **Both fields are written every time**: `setProperty` merges a partial into the transition already set, while the writer spells the attribute as whatever it was last handed, so a partial write would leave the file and the trait saying different things (and a switch back to `dissolve` would never land). Removal writes `false`, not `null`: `null` is a spelling the prop accepts but the writer would put it in the file, while `false` is what it drops the attribute for.

The masks panel got shorter with the model. A mask is `<rect mask>`, a rect like any other, so it needs no inspector of its own: a row selects it and the transform, time and appearance panels are then its own. Three things the bitecs "Add mask" authored are gone with them: the white solid fill and the trim to the parent's window (a mask is never drawn, and without an `end` it already clips for the parent's whole window), and the `[Mask Shape]` name suffix, which was there for a timeline that could not tell a mask apart otherwise. What it still authors is the parent's own size (a mask without one is 500x500, which is what an empty group gets) at a 20px inset, so the new mask shows itself instead of landing invisibly on top of the parent. `Expanded` is not set on the parent: that is app-side timeline state the koota side has not picked up yet.

The audio panel kept its knob, meter and buttons; what moved is where they write. `volume` (decibels, unset at 0 since that is unity) and `muted` are props; **solo is not** — `Soloed` is a runtime-only tag with no JSX spelling, so the button writes the trait alone and the solo is gone on the next recompile, which is what a monitoring toggle should be. The knob writes whole decibels: it is what the field and the knob both display, and a dragged knob would otherwise mint a new fraction (and a new keyframe) per frame. The meter is unchanged, reading `AudioBusHandle` through `useTrait` (the playback system spins the bus up once the node has audio, and sets it back to null when the decoders are released, so the accessor holds null while the trait is still there).

Fixed while the panel moved: the `gain` animation used to write a 0-1 linear ramp into `Computed.volume`, which everything else reads as decibels (`audio-bus.ts` does `10 ** (db / 20)`), so a Volume animation ramped 0 dB to 1 dB, inaudibly, instead of silence to unity. It now ramps the *amplitude* and adds it to the volume as decibels (`amplitudeToDecibels`, -Infinity at silence, which the bus already reads as a gain of zero). Two consequences worth knowing: it reads `Computed.volume` instead of replacing it, unlike the visual presets, so a clip set to -6 dB fades to -6 dB rather than up to unity and an overlapping in and out compose; and a fade sounds even because it is even in amplitude, not in decibels.

The fills panel needed two tags that did not exist. The runtime renders an image or a video **fill** (`renderFills` handles the media paints), but the paint family had no word for one: media was only ever a `<video>`/`<image>` node. So `<imagePaint>` and `<videoPaint>` were added to `COMPOSITION_TAGS`, the intrinsics, `elements.ts` and `PAINT_TYPES`; they mirror the node tags exactly (`src`, `objectFit`, and `bindAsset`'s rule that a frames directory plays as a sequence), which is why they are two tags rather than one `<mediaPaint>` taking its kind from the asset.

What that panel now says that the old one did not: **a fill's kind is its tag**, so changing it is not a property write but a swap. `FillPicker.replaceFill` inserts the new element in front of the next fill (keeping its place in the paint stack) and removes the old one, then hands the caller the entity it ended up with (`onReplace`) — the panel's `picked` signal has to move with it, and the old element's keyframe tracks go with it, which is honest: they drove a paint that no longer exists. The same swap is what linear ↔ radial does, writing the stops and the rotation out onto the new element. Picking another asset for a fill that already is one of the same kind is a plain `src` write, so the fit and the tracks survive.

Two details worth keeping: gradient stops have no `Cache` list of their own (`readGradientStops` queries `ColorStop, ChildOf(fill)` and sorts by offset, since where a stop sits is its `offset` and the file's order says nothing), and the fill picker's asset tab reuses the sidebar's `LazyAssetItem`, so renaming, replacing and deleting an asset work the same from both places. `ScaleModeType.NONE` is not offered: `Fit` has no word for it. The stub "Preview" and "Replace media" toasts of the old asset picker were dropped rather than carried over.

The shadow panel kept the shape it had: a row per `<shadow>` opening a floating inspector, since nothing in the shadow model moved the way the stroke's line style did. The one thing it says that the file does not is what "Add shadow" authors (`opacity` 0.25, `blur` 4, `offsetY` 4): `<shadow>`'s own defaults are all zero, which casts the silhouette back onto itself, so a shadow added from the panel has to spell out where it sits. Every control unsets at the prop's default (0 for the offsets and the blur, 1 for opacity); `color` is required and always written.

Two deliberate departures from the old text panel: `letterSpacing` is shown in px (the trait's unit and the prop's; the bitecs panel showed the same number as a percentage), and the font a text is set in — family, weight, size — is written out plainly rather than unset at its default, since a font is what a text *is* and not a modifier of it. `<captions>` has no host yet, so the caption half of the panel is unreachable and was carried over as it stood.

**Left stale on purpose** (deferred to a docs/examples pass): the eight `examples/*.tsx` still open with `<rect scene="...">` and no `<stage>`, so `tsc -p examples --noEmit` fails on them, and `reference/jsx/*` still describes the pre-`<stage>` model and `key` as the `syncTo` target. `reference/jsx` is stale as a whole; patching rows piecemeal would hide that.

## Remaining work

1. **apps/web**: remaining panels and the timeline UI, app-side world traits (store, timelineIndex signal), history via koota events, re-adding the editing-surface `syncKeyframeTrack` calls the observers slice dropped. `utils/captions.ts` stays app-side, rewired to `@diffusionstudio/encoder`. Once real content loads into the koota world, delete the hidden bitecs canvas and `engine/components`, `engine/api` progressively.
2. **CLI**: point node capture at the runtime + encoder packages, importing `MAX_FRAMES_PER_SHEET` from the encoder instead of redefining it in `cli-channels.ts`.

## Package reminders

- Exports: root `.` plus `./traits`, `./systems`, `./media`; everything is also re-exported from `src/index.ts`. The `./capture` entry in package.json is dangling (`src/capture/` no longer exists) and wants deleting.
- tsconfig sets `erasableSyntaxOnly: false` (enums with reverse lookups, same as apps/web).
- Deps: koota (patched), mediabunny, animejs, colord, `@diffusionstudio/assets` (the asset model moved out into its own package; sqids went with the id allocator). Dev: `@webgpu/types`.
