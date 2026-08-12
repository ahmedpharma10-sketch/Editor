# bitecs → koota migration status

Working doc for migrating the editor engine from bitecs (in `apps/web/src/components/engine/`) into this headless runtime package. Written so a fresh session can continue without prior context.

## Goal and ground rules

- `@diffusionstudio/runtime` holds everything that must run without a DOM and without solid-js (so the CLI/node capture path can consume it). Browser-only systems (input, keyboard, camera controller, HUD, dom sync, timeline canvas UI), persistence (`db/`, Dexie), history, and Solid reactivity stay in `apps/web`. Solid bindings live in `packages/koota-solid`.
- The persisted document format (`EntityRecord`, was `DBEntity`) is frozen: field names and value shapes must keep loading existing projects. Enums stay numbers, tags stay `{}`, `Hidden`/`ClipsContent` stay `true`, `Playback` persists only `loop` as 0/1, `KeyframeTrack` persists only `property`.
- Breaking API/type changes inside the codebase are fine (established convention); the storage format is not.
- Comments: lean, only constraints code can't show. No em dashes in prose. Tabs, MPL header on ported files.

## Done

| Slice | Where | Notes |
|---|---|---|
| Traits (all ~85 components) | `src/traits/*` | Split by concern: node, transform, style, text, timing, audio, motion, derived, media, interaction, relations, world |
| Constants/enums | `src/constants.ts` | `ScaleMode` enum renamed `ScaleModeType` (collides with the ScaleMode trait; matches Geometry/GeometryType pattern) |
| World singletons | `src/traits/world.ts` | The bitecs `createWorld({...})` context bag became world traits: Project, Mode, ActiveScene, Camera, Background, Time (was timestamp), FrameRate, RenderSurface (canvas+ctx+resolution), AudioEngine (injected, no ctor arg), Fonts, Mounts, FramePromises (was world.promises), DocumentRoot |
| `createRuntimeWorld(projectId)` | `src/world/create-world.ts` | Side-effect free except spawning the document root. No AudioContext/window access |
| Document root model | everywhere | See below, this replaced "parentless = top-level" |
| Serialization | `src/world/serialize.ts` | serializeEntity / deserializeEntity / cloneFromRecords / stripMountIdentity / cloneSubtree. No events layer; plain add+set. `defined()` strips undefined so partial records merge over trait defaults |
| Store access helper | `src/world/store.ts` | `store(world, trait)`: memoized lazy registration + `getStore`. koota registers stores on first add/query; bare `getStore` throws on a fresh world. Use this in all systems |
| Read queries | `src/queries/{predicates,hierarchy,timeline-index}.ts` | Predicates lost the world param (`isScene(entity)`). `getNextName` scans `world.query(Name)` incl. Deleted tombstones. `TimelineNode.eid` became `entity: Entity` |
| Transform system | `src/systems/transform.ts` | Store-indexed hot path (`store()` + `entity.id()`), no snapshots, no change events. Roots = `ChildOf(getDocument(world))`. Headless world without canvas skips culling instead of crashing |
| Motion system | `src/systems/motion.ts` | resetAnimatedValues + getPropertyPaths (property table) + sampleTrack + applyAnimation. animejs dep. See semantic notes |
| Moved verbatim | `src/math/*`, `src/utils/{text-motion,live-mounts}.ts`, `src/fonts/types.ts` | All dependency-free |
| Time utils | `src/utils/time.ts` | snap/frames helpers, `computeTrimStart/End` (entity-based), `findGeometryAsset`, `findAssetDuration` (Assets + FrameRate world traits). `src/utils/assert.ts` added (was `@/utils`) |
| Asset/folder model | `src/assets/types.ts`, world traits `Assets`/`Folders`/`AssetIds` | Structural types (no zod); `AssetFileHandle = { getFile() }` so node/Electron handles satisfy it. sqids dep for id allocation |
| Actions: entities, hierarchy | `src/actions/{entities,hierarchy}.ts` | See semantic notes. `createEntity` spawns Computed (with non-default width/height/end/duration/strokeWidth) + Cache + ChildOf(document) |
| Actions: cache + timing upkeep | `src/actions/{cache,timing}.ts` | Split of `api/utils.ts`: rebuildCaches/aggregateKeyframeTracks/findClosestParentGeometry; recomputeEntityTimeRange, propagate/bubble, trim clamp/pin, reactTo* hooks |
| Actions: resize, keyframe, overlap | `src/actions/{resize,keyframe,overlap}.ts` | Constraint seeding = ConstraintCache trait presence (was undefined store slots). Overlap uses cloneSubtree + computeTrimStart/End |
| Actions: group, frame, clipboard | `src/actions/{group,frame,clipboard}.ts` | frame.ts also hosts `switchActiveScene` (was api/base.ts): sets the ActiveScene world trait, nothing else |
| Actions: assets, folders (model) | `src/actions/{assets,folders}.ts` | allocateId/raiseIdCounter, appendAssets/upsertAsset/removeAssets, getAssetFile/Blob, insertAssetInTimeline; folder tree ops return changed records for app persistence |
| Observers (runtime half) | `src/world/observers.ts` | koota subscriptions wiring cache upkeep, Computed mirrors, and time-range reactions; auto-registered by `createRuntimeWorld` (returns a disposer). See semantic notes |
| Media: decoders + audio bus | `src/media/*` | frame-cache, keyframe-index, time-stretcher, surface, html, audio-peaks moved verbatim; image, video, sequence, audio, shader with entity-based resolvers; audio-bus koota-ported; dispose walkers in `src/media/dispose.ts` and wired as observers |
| Media: caption family | `src/media/caption/*` | types, subtitles, utils (incl. `setChars`), position, seven presets, resolver. See semantic notes on sparse TextStyle |
| Text rendering | `src/utils/text.ts` (full port) | tokenize/shape/render joined the Token seed; reads RenderSurface.ctx + Camera; no-ops without a surface. Gradient construction split into `src/systems/gradients.ts` (render system reuses it) |
| Fonts | `src/fonts/{fixtures,utils}.ts` | WebFonts fixtures verbatim; `loadWebFont` uses the Fonts world trait, resolves the FontFaceSet via globalThis (worker-capable), guards on missing FontFace (headless), and drops db persistence (app wraps it). `getLocalFonts` + `restoreFonts` stay app-side |
| Support utils | `src/utils/{color,async}.ts`, `clamp` in math | parseColor/colorToHex/rgbToColor (colord dep), AsyncMutex/attempt |
| Seeds (types only, rest follows) | `src/utils/text.ts` (Token/Line/TokenOptions), `src/capture/format.ts` (ContainerFormat) | The remaining engine files merge into these on their slice |

Verification style used so far: `npx tsc --noEmit` in the package, plus throwaway `smoke-test.tmp.ts` in the package root run with `npm exec --yes tsx@latest -- smoke-test.tmp.ts`, deleted afterwards (no test infra in the package yet). koota caps live worlds at 16; call `world.destroy()` in test loops.

## Document root model

Every world spawns one entity tagged `DocumentRoot` (`createRuntimeWorld`). All rendered entities are its descendants; "top-level" means "direct child of the document", never "has no parent".

- `getDocument(world)` returns it; `getParentNode(entity)` returns the parent or null when the parent is the document (use wherever top-level matters); `getParentEntity` returns the raw parent including the document.
- Serialization contract: the document id is per-session, so `serializeEntity` omits `ChildOf` when the parent is the root, and `cloneFromRecords` attaches parentless records to the target world's document. Record shape on disk is unchanged.
- `cloneSubtree` still keeps an outside-the-subtree parent (records with `ChildOf` are not rehomed).
- `ChildOf = relation({ exclusive: true, autoDestroy: 'orphan' })`, so `getDocument(world).destroy()` tears down the whole document; clearing a project = destroy + respawn root.
- Actions honor this: `createEntity` spawns as a document child; `appendChild` asserts `getParentNode(entity) === null` ("already has a parent" = has a non-document parent) and relies on exclusive re-targeting; `removeChild` re-parents to the document instead of dropping ChildOf. `cloneFromRecords` attaches parentless records to the document, so paste/duplicate roots land there too.

## Deliberate semantic changes vs bitecs

- Single-value components became `{ value }` traits (Rotation, Name, Volume, Geometry, Paint, ...). `Playback.playing/loop` and `AudioPlayback.wasPlaying` are booleans on the trait, mapped to/from 0/1 at the serialize boundary.
- `Caption.colors` and `Shader.uniforms` are copied on restore (fixed latent aliasing between clones from shared records).
- Restoring `Size` no longer calls `resizeEntity`; it is a plain set (resize side effects belong to actions).
- Motion has no iteration ordering (bitecs used `Hierarchy(ChildOf)`, but the loop only writes the entity's own Computed and its sub-entity cluster, so order cannot matter). Also no top-level exclusion: anything carrying animation data animates. Under bitecs, keyframed scenes promoted to top level silently froze; now they play. If freezing is wanted, strip tracks in the promotion action.
- Deleted is a runtime-only tombstone tag (undo support), never serialized.
- Actions are plain world-first functions (matching queries/systems), not koota `createActions`: they return entities/records and call each other freely, which the bound-record pattern only obscures. No history layer: bitecs `world.history.push/transaction` wrappers are gone; actions write directly and the app groups undo steps by observing koota events. Selection-scoped actions (group, frame, reorderSelection, clipboard) still key off the runtime-defined `Selected` trait.
- appendChild/removeChild dropped their bitecs side calls: `persistEntity`, `syncInteractiveState`, `rebuildTimelineIndex` (app-side via observers/signals) and `disconnectAudioBus` (media slice; decoder/bus disposal hooks return with it). `unpersistEntity` and the dispose* helpers from `api/utils.ts` were likewise not ported yet.
- Observers: the runtime half of `api/observers.ts` became koota subscriptions in `world/observers.ts` (`observeWorld`, auto-registered by `createRuntimeWorld`). appendChild/removeChild are assert + re-target only; cache/size/constraint/time-range fixups ride the ChildOf add/remove events, so `cloneFromRecords`/restore prime Cache, Computed, and time ranges through the same path as actions. `rebuildCaches`/`aggregateKeyframeTracks` take an `exclude` param because koota fires relation remove events while the departing child is still in the old parent's queries.
- Observer-driven behavior faithful to bitecs: Sequential onAdd group-ifies and strips spatial traits; Group/Scene/Audio onAdd, Paint/AssetId/Delay/PlaybackRate/Trim onChange, and Trim onRemove run the timing recomputes; Keyframe/ItemIndex onChange resort caches; Deleted onAdd/onRemove rebuild caches (+ `reactToChildDetached`); Trim onAdd defaults `end` to the current Computed.duration (the bitecs setComponent fallback). Authored→Computed mirrors register on add and change; trait removal does not reset Computed (same as bitecs).
- Not faithful on purpose: keyframe auto-sync on authored edits did not move into observers. koota change events don't say which field changed, and syncing every field of a trait would mint spurious keyframes on untouched properties. Editing surfaces call `syncKeyframeTrack` for the property they changed (resizeEntity already does for width/height).
- Size propagation is a Size observer now (`propagateSize` on add/change): bitecs restored sizes through `resizeEntity`, koota deserialization is a plain set. `resizeEntity` no longer calls propagateSize itself.
- `clampTrimToAssetDuration` now goes through `entity.set(Trim)` (fires change events) but only when actually clamping; bitecs wrote the store silently. The Trim onChange handler re-enters once through the clamp and no-ops on the second pass.
- Still app-side from `api/observers.ts`: persistence scheduling, timeline index rebuilds, `syncInteractiveState`, Selected waveform show/hide, ClipHeight/Expanded, ExportSettings defaults, drag-origin traits.
- Media handle traits renamed with a `Handle` suffix (`VideoDecoderHandle`, `AudioBusHandle`, ...) and typed to the concrete classes via type-only imports, so the trait and the class it stores (`AudioDecoder`, `HtmlHost`, ...) share one export surface without colliding. Resolvers are entity-based (`resolveVideoDecoder(world, entity)`), read Assets/Mode world traits, and store instances with add+set on the handle trait.
- Dispose hooks are observers now: Deleted onAdd disposes decoders/hosts/buses across the tombstoned subtree, Culled onAdd disposes decoders, ChildOf add/remove disconnects audio buses, and `reactToAssetChange`'s Caption branch drops the caption decoder. The walkers (`src/media/dispose.ts`) deliberately recurse through Deleted descendants, like bitecs.
- TextStyle became all-undefined defaults: a range override carries ONLY its explicitly set fields (sparse store slot = inherit from the node), which is what the bitecs set-observer's TextRange special case enforced. Node-level fallbacks (16px/Inter/400/leading 1) live in the text renderer's accessors, restoring the bitecs `?? 1` leading semantics the earlier trait defaults had drifted from.
- Caption presets write playhead-driven text via `setChars` (raw store write, no change events) so per-frame caption content never reaches app persistence, same as the bitecs raw array writes. Preset fills/ranges go through createEntity/appendChild, so caches prime via the observers.
- DOM caveats, all lazy (nothing touches DOM at import time): HtmlHost/SurfaceHost create elements at construction (html-in-canvas is Chromium-flag-only anyway), ShaderHost needs WebGPU, `loadWebFont` no-ops without FontFace. tsconfig gained `DOM.Iterable` + `@webgpu/types`.
- `SequenceDecoder` iterates the structural `AssetDirectoryHandle` (entries with `getFile`) instead of concrete FileSystemFileHandle, so node hosts can feed frame directories.
- `switchActiveScene` only sets the ActiveScene world trait; timeline buffer clearing and index rebuild stay app-side. `frameSelection` calls it once (bitecs called it redundantly inside and outside the transaction).
- `insertAssetInTimeline` returns the created entity or null when no scene is active (no toast). Folder ops are sync and return the changed records (`deleteFolder` returns removed folder/asset ids) so the app can persist; `moveAssetsToFolder` updates records in place instead of re-fronting them like `saveAsset` did. Panel navigation state (current folder) stays app-side.
- Decoder/host handle traits (`src/traits/media.ts`) are AoS traits typed as opaque `object` until the decoders move in; `entity.get(VideoDecoder)` returns the instance directly.

## koota facts learned (0.6.6)

- **Local patch (do not lose):** `patches/koota+0.6.6.patch`, applied by the root `postinstall` (`patch-package`). Fixes `checkQuery`/`checkQueryTracking`: `Or(...)` was evaluated per trait bitmask generation (32 traits each) and required a match in every generation, so Or queries created after the Or'd traits straddle a generation boundary silently returned empty. On a koota bump, retest (register 40 dummy traits, then create a fresh Or query) before dropping the patch.
- `Not(...)` accepts plain traits only. Relation pairs, wildcard or concrete (`Not(ChildOf('*'))`, `Not(ChildOf(doc))`), throw at runtime. If an indexed exclusion is ever needed, maintain a tag via `onAdd/onRemove(ChildOf(target))` observers.
- No hierarchy-ordered queries (bitecs `Hierarchy(ChildOf)` has no equivalent). Transform does its own parent-first DFS from the document; that ordering is load-bearing there (world matrices, cull inheritance).
- Trait schemas allow primitives/null/undefined; object or array fields need callback initializers (`colors: () => [] as number[]`). AoS traits: `trait(() => instance)`.
- World traits are backed by a hidden internal world entity (`world[$internal].worldEntity`, IsExcluded). Do not build on it; it is not public API. `world.id()` is a world slot index, not an entity.
- Max 16 live worlds. Entity numbers encode worldId+generation; stores are indexed by `entity.id()`.
- Entities read back from store arrays / trait fields keep their methods (they are numbers; koota patches the prototype).
- `entity.set(trait, data)` throws if the trait is missing; `entity.add` is idempotent and never resets existing values; `set` with a partial object merges over current values. Hence the add-then-set pattern everywhere in serialize and actions. On an exclusive relation, `add(ChildOf(newParent))` re-targets in place.
- Events: `world.onAdd/onChange/onRemove(trait | ChildOf('*'), cb)` exist; relation callbacks get `(entity, target)`. Exclusive re-target fires remove(old) then add(new); a redundant same-pair add fires nothing; remove events fire while the departing child is still in the old target's queries (hence rebuildCaches' `exclude` param). onAdd fires after initial values are applied (`spawn(Trait({...}))` included) and handlers may set traits on the entity. onChange fires even when the written value is unchanged. Destroy cascades and `world.destroy()` fire remove events with still-usable entities.

## Remaining work (suggested order)

1. **Playback system**: `systems/playback.ts` (computes `Computed.localTime/start/end/duration/visibility`, drives decoders via the media resolvers, pushes into `FramePromises`, uses AudioEngine + Mounts; `resolveAudioBus` lives here).
2. **Capture** (`src/capture/`): `engine/encode/*` (encoder, image-encoder, buffer, format, utils). Uses Mode, FramePromises, RenderSurface.
3. **Render system**: `systems/render.ts` is runtime-capable (OffscreenCanvas) and needed for headless capture; text rendering and gradients are already in (`utils/text.ts`, `systems/gradients.ts`; `addStopsTo` stayed private to gradients).
4. **Remaining utils**: captions, transition, contact-sheet, audio-sync, transcode (audit each for DOM/app deps; DOM-touching ones stay app-side).
5. **App rewrite** (`apps/web`): engine shell wires canvas/AudioContext/DPR into world traits, app-side world traits (input, HUD, selection tool, history, store, timelineIndex signal), history/persistence via koota events (including wrapping the folder/asset model ops with Dexie writes, font persistence around `loadWebFont` + `restoreFonts`/`getLocalFonts`, re-implementing `syncInteractiveState` over `ChildOf(document)` queries: `Not(ChildOf('*'))` throws in koota, and re-adding the editing-surface `syncKeyframeTrack` calls the observers slice dropped), Deleted-tombstone pruning + `unpersistEntity`, UI to `packages/koota-solid` hooks, timeline UI consumes new `TimelineNode.entity`. Delete `engine/components`, `engine/api` progressively.
6. **CLI**: point node capture at the runtime package.

## Layout reminders

- Package exports: root `.` plus `./traits`, `./systems`, `./media`, `./capture` (see package.json). Everything currently also re-exported from root `src/index.ts`.
- tsconfig sets `erasableSyntaxOnly: false` (enums with reverse lookups, same as apps/web).
- Deps: koota (patched), mediabunny, animejs, sqids (asset/folder id allocation), colord (parseColor). Dev: @webgpu/types (shader host).
- AoS handle traits accept class instances and null through plain `entity.set(trait, value)`; `getStore` returns the value array.
