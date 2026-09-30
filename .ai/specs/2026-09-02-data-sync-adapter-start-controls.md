# Data Sync — adapter-declared applicability for the dashboard's start controls

**Status:** draft
**Module:** `packages/core/src/modules/data_sync`
**Related:** `.ai/specs/implemented/SPEC-045b-data-sync-hub.md` (§ Run parameters — the end-to-end
precedent this mirrors)

## TLDR

The Data Sync dashboard's "Run once now" card renders a fixed pair of controls — **Run as full sync**
and **Batch size** — for every adapter and every entity type. Whether either one means anything for the
selected entity type is adapter knowledge, and the adapter has no way to say so. This adds an optional
per-entity-type predicate, `supportsStartControl(control, entityType)`, resolves it in
`GET /api/data_sync/options`, and has the dashboard render only the controls that apply. Fully
additive: an adapter that declares nothing sees an identical form and an identical request body, and
`POST /api/data_sync/run` keeps honouring both fields whatever any adapter declares.

## Overview

One optional method on `DataSyncAdapter`, one pure resolution module, one new field on the options
response, and conditional rendering on one card. No cursor resolution, no engine behaviour, no database
change, no new extension point.

The shape deliberately mirrors two things already merged in this module: `persistsSharedCursor` for the
*mechanism* (an optional per-entity-type predicate defaulting to prior behaviour) and `runParameters`
for the *path* (an entity-type-scoped declaration, resolved through `api/options.ts`, driving what the
dashboard renders).

## Problem Statement

`backend/data-sync/page.tsx` renders the start card's two controls as inline JSX, driven by bare local
state (`React.useState(false)` for `fullSync`, `React.useState('100')` for `batchSize`). There are no
props, no widget slot, and `extension-points.ts` declares only a data-table host, so nothing on that
card is extensible today.

### The `fullSync` case

`api/run.ts` resolves the run's start cursor as:

```ts
const cursor = parsed.data.fullSync
  ? null
  : await resolveStartCursor({ syncRunService, adapter, integrationId, entityType, direction, scope })
```

and `lib/start-cursor.ts` branches on the existing per-entity-type predicate:

```ts
if (persistsSharedCursor(adapter, entityType)) {
  return syncRunService.resolveCursor(...)        // the shared `sync_cursors` row
}
return syncRunService.resolveResumeCursor(...)    // this entity type's own most recent run
```

The switch's own help text is *"Ignore the saved cursor and process the entire source again for this
run"*. For an entity type whose adapter opted out of the shared row there is no saved shared cursor to
ignore.

**The switch is not therefore dead, and this spec does not claim it is.** The two settings still hand
the adapter different values:

| `fullSync` | cursor passed to the adapter |
|---|---|
| `true` | `null` |
| `false` | `resolveResumeCursor(...)` — the most recent run's position |

Whether that difference is *observable* depends on what the adapter does with an inherited cursor for
that entity type, and core has no way to find out:

- An adapter whose cursor is a plain watermark honours the distinction — starting from `null` really
  does re-read everything.
- An adapter whose cursor carries identity — one that checks whether an arriving cursor is its own and
  mints a fresh position when it is not — collapses both settings into the same outcome. For that
  adapter, on that entity type, ticking the switch changes the request body and changes nothing
  observable.

Core cannot infer which kind it has. The adapter knows exactly. There is no channel for it to say so —
that is the defect. The result is a control on the primary operator path that may silently do nothing,
and an operator who cannot distinguish *"it had no effect"* from *"it worked"*.

Stated at the framework level:

> The dashboard renders a fixed set of start controls regardless of whether they are meaningful for the
> selected adapter and entity type. Applicability is adapter knowledge; the adapter cannot declare it.

### The `batchSize` case

The same gap, one step milder. `batchSize` reaches the adapter on `StreamImportInput` /
`StreamExportInput`, and an adapter whose paging is fixed by the source — a provider-paged export, a
whole-table cursor walk with a server-chosen page size — ignores it. The operator is still offered a
numeric input, and a value they type is still validated (1–1000) before a run they cannot influence.

### Core already believes applicability is entity-type-dependent

`buildDefaultScheduleState` in the same file guesses it from hardcoded entity-type name strings:

```ts
const normalized = entityType.trim().toLowerCase()
const longerInterval = normalized === 'categories' || normalized === 'attributes'
return {
  scheduleValue: longerInterval ? '6h' : '1h',
  fullSync: normalized !== 'products',
  ...
}
```

Generic dashboard code branching on provider-shaped names to decide whether full sync is appropriate.
It only works for entity types core happens to know by name and misfires silently for any adapter that
names things differently, and it breaks the module's own rule — *"Keep declarations provider-agnostic —
never special-case a provider in `data_sync`"* (`data_sync/AGENTS.md`).

This is cited as evidence that the judgement is real and currently unaskable. **Changing that default
is out of scope here**: it is a different control (the schedule-level switch) with its own
back-compat surface.

## Proposed Solution

Let the adapter declare, per entity type, which of the dashboard's manual-start controls apply. The
dashboard renders only those — exactly as it already does for adapter-declared `runParameters`.

```ts
supportsStartControl?(control: 'fullSync' | 'batchSize', entityType: string): boolean
```

Omitted method, or any return other than an explicit `false`, means "applies", so an adapter that
declares nothing keeps today's behaviour byte-for-byte.

### Why per entity type and not per adapter

Per-adapter is the simpler shape and it cannot express the case. The argument is core's own, already
accepted by maintainers on the `persistsSharedCursor` docstring (`lib/adapter.ts`):

> The predicate is per entity type because one adapter commonly serves both kinds — an incremental feed
> and a whole-table backfill.

One provider key routinely serves both:

- **change-feed entity types**, whose cursor is a durable position in a queue or log, where full sync
  genuinely means *re-drain from the beginning* — the control is meaningful;
- **backfill entity types**, whose cursor is one run's scan state over a table, where a fresh start
  already begins from the top — the control is inert.

Same adapter, same dashboard, opposite answers. The module already reasons per entity type in
`persistsSharedCursor` and in `RunParameter.entityType`; a per-adapter flag would be the only
coarse-grained declaration in the set.

### Why not derive it from `persistsSharedCursor`

A tempting shortcut is to hide the switch whenever `persistsSharedCursor(entityType) === false`. It is
wrong on both counts:

- it conflates *where the cursor is stored* with *whether restarting from scratch is meaningful* — an
  opted-out entity type can still have a genuine beginning to restart from;
- it would silently change the UI for every existing adapter that opted out of the shared cursor row,
  which is not an additive change.

The two facts are independent and both belong to the adapter to state.

### The serialization boundary

`runParameters` is serializable data; `persistsSharedCursor` is a function and therefore server-side
only. `api/options.ts` currently ships `runParameters: adapter.runParameters ?? []` alongside
`supportedEntities`, `direction` and `runMode` — a predicate cannot be shipped as-is. Two options:

1. **The options route resolves it.** Evaluate the predicate for each `supportedEntities` entry and
   send a resolved map. Keeps the adapter-facing API consistent with `persistsSharedCursor` — an
   adapter author writes one kind of thing for both.
2. **Declare data, not a function** — `startControls?: { control: ...; entityType?: string | string[] }[]`,
   consistent with `runParameters` and serializable without a resolution step.

**This spec takes (1).** The adapter-facing surface is the important one to keep coherent, the
resolution is four lines, and a predicate composes with whatever the adapter already knows (its own
entity-kind table) rather than forcing it to enumerate a static list. Option (2) stays available
additively if a future need arises for declarations the server cannot evaluate.

## Architecture

### 1. `lib/adapter.ts` — the declaration

```ts
export type DataSyncStartControl = 'fullSync' | 'batchSize'

export interface DataSyncAdapter {
  // ...
  supportsStartControl?(control: DataSyncStartControl, entityType: string): boolean
}
```

### 2. `lib/start-controls.ts` — resolution, pure and isomorphic

```ts
export type StartControlApplicability = Record<DataSyncStartControl, boolean>
export type StartControlMap = Record<string, StartControlApplicability>

/** Server side: evaluate the predicate across `supportedEntities`. */
export function resolveStartControlMap(adapter: DataSyncAdapter | null | undefined): StartControlMap

/** Client side: read the resolved map for the selected entity type. */
export function applicableStartControls(
  map: StartControlMap | null | undefined,
  entityType: string,
): StartControlApplicability
```

`resolveStartControlMap` is **sparse**: an entity type for which every control applies is omitted, so an
adapter that declares nothing produces `{}` and adds nothing to the wire. `applicableStartControls`
reads own properties only and returns all-`true` for a missing entry, which makes "no declaration" and
"nothing restricted" the same single default.

A predicate that throws is treated as *applies*. One adapter's bad predicate must not take down the
options list — and with it the whole dashboard — for every other integration. `api/options.ts` already
degrades the same way for credential resolution.

### 3. `api/options.ts` — the wire

One added field per item:

```ts
startControls: resolveStartControlMap(adapter),
```

### 4. `backend/data-sync/page.tsx` — conditional rendering

```ts
const startControls = React.useMemo(
  () => applicableStartControls(selectedIntegration?.startControls, selectedEntityType),
  [selectedIntegration, selectedEntityType],
)
```

- Each control renders only when it applies. When neither applies, the whole knob row is omitted.
- When a control does not apply its state is reset to the request default (`fullSync` → `false`,
  `batchSize` → `'100'`), so switching entity types cannot carry a hidden value forward.
- A control that does not apply is **omitted from the request body**, letting `runSyncSchema`'s existing
  defaults (`fullSync: false`, `batchSize: 100`) supply the value — the same value today's form sends.
- `batchSize`'s client-side 1–1000 check runs only when the input is rendered, so a stale value cannot
  block a run whose form no longer shows the field.
- The card's description switches to a variant that does not enumerate controls when any control is
  hidden.

Before an entity type is selected, `selectedEntityType` is `''`, which matches no entry and so renders
both controls — today's behaviour for an unselected form.

## Data Models

None. No entity, column, migration or snapshot change.

## API Contracts

### `GET /api/data_sync/options` — additive response field

```jsonc
{
  "items": [
    {
      "integrationId": "sync_example",
      "supportedEntities": ["orders.feed", "orders.backfill"],
      "runParameters": [],
      // New. Only entity types with a restriction appear; `{}` when nothing is restricted.
      "startControls": {
        "orders.backfill": { "fullSync": false, "batchSize": true }
      }
    }
  ]
}
```

### `POST /api/data_sync/run` — unchanged

`runSyncSchema` is untouched and the route keeps honouring both fields. A client that posts
`fullSync: true` for an entity type whose adapter declares the control inapplicable still gets a `null`
start cursor. This is a UI-applicability change, not a behaviour change — covered by a test.

## Risks & Impact Review

| # | Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|---|
| 1 | An adapter declares a control inapplicable when it is in fact meaningful, removing a control the operator needs | Medium | Dashboard start card | The declaration is opt-in and defaults to "applies"; the API keeps accepting the field, so a scripted or API client can still send it; documented in `AGENTS.md` and the framework docs | An adapter can misdeclare its own UI. This is the same trust already extended to `runParameters` and `persistsSharedCursor` |
| 2 | Hidden state is submitted anyway after an entity-type switch | Medium | `POST /api/data_sync/run` | State is reset when a control stops applying **and** the field is omitted from the request body; covered by a test | None |
| 3 | A throwing predicate breaks the options route for every integration | High | Dashboard load | Each evaluation is guarded and falls back to "applies" | A broken predicate is silent. It cannot make the form show less than today |
| 4 | The new field breaks an older client reading the options response | Low | API consumers | Purely additive optional field; unknown fields are ignored by existing consumers | None |
| 5 | Scope creep into cursor semantics | Medium | Engine, run lifecycle | `lib/start-cursor.ts`, `lib/sync-engine.ts` and the run lifecycle are untouched by this change | None |

## Non-goals

- What `fullSync` or `batchSize` **do** when submitted — unchanged.
- Cursor resolution or engine behaviour of any kind.
- The schedule-level full-sync switch and its `buildDefaultScheduleState` default (cited as evidence
  only).
- New extension points or widget hosts on the dashboard page.

## Final Compliance Report

- **Provider-agnostic** — no provider name or entity-type string is special-cased; the new module reads
  only `supportedEntities` and the adapter's own predicate.
- **Backward compatible** — optional interface method (`BACKWARD_COMPATIBILITY.md` §2, Type Definitions
  & Interfaces) and an additive response field (§7, API Route URLs). Recorded in
  `BACKWARD_COMPATIBILITY.md`.
- **Adapter contract growth** — `data_sync/AGENTS.md` asks to check in before changing adapter
  contracts. Cursor semantics are unchanged, but the contract grows by one optional method; that is the
  call being requested.
- **i18n** — one new key added to all five locale files; no hardcoded user-facing string.
- **Docs** — `data_sync/AGENTS.md` beside the existing "Run parameters" section, and
  `apps/docs/docs/framework/modules/integrations-data-sync.mdx`.

## Testing

| Surface | Coverage |
|---|---|
| `lib/start-controls.ts` | Sparse-map construction, per-entity-type resolution, undeclared adapter → `{}`, non-boolean and throwing predicates, own-property lookup |
| `GET /api/data_sync/options` | The resolved map on the wire; `{}` for an adapter that declares nothing |
| `POST /api/data_sync/run` | `fullSync: true` still yields a `null` cursor when the adapter declares the control inapplicable |
| Dashboard start card | The control does not render for a restricted entity type, renders for an unrestricted one, and an undeclared adapter renders both |
| Integration (`TC-DS-011`) | Every integration advertises a well-formed `startControls` object keyed only by its own `supportedEntities` |

## Changelog

- **2026-09-02** — Initial spec.
