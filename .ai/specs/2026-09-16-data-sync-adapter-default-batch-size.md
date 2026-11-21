# Data Sync — an adapter declares its own default batch size

**Status:** draft
**Module:** `packages/core/src/modules/data_sync`
**Related:** `.ai/specs/2026-09-02-data-sync-adapter-start-controls.md` (the sibling declaration this
mirrors — that one decides whether the control is *offered*, this one what it *starts at*)

## TLDR

**Batch size** starts at 100 on every start path, for every adapter and every entity type. 100 is a
safe number for a source paged over HTTP and a starving one for a batch the adapter applies across
parallel workers, and core cannot tell the two apart. This adds an optional per-entity-type hook,
`defaultBatchSize(entityType)`, resolves it in `startDataSyncRun` — the one helper every start path
funnels through — and ships the resolved values on `GET /api/data_sync/options` so the dashboard
seeds its field with the number the run will actually use. Fully additive at runtime: an adapter that
declares nothing gets 100 everywhere, exactly as today.

## Overview

One optional method on `DataSyncAdapter`, one pure resolution module, one new field on the options
response, one line in the shared start helper, and a seeded form field. No cursor resolution, no
engine behaviour, no database change, no new extension point.

The shape mirrors what is already merged in this module: `persistsSharedCursor` and
`supportsStartControl` for the *mechanism* (an optional per-entity-type declaration defaulting to
prior behaviour, resolved through a pure module and shipped sparsely through `api/options.ts`).

## Problem Statement

`batchSize` reaches the adapter on `StreamImportInput` / `StreamExportInput` and sets the page the
walk reads with, which for a backfill is also the commit boundary. Its value comes from one of five
places, and every one of them says 100:

| Where | Today |
|---|---|
| `data/validators.ts` | `batchSize: z.number().int().min(1).max(1000).default(100)` |
| `lib/start-run.ts` | `batchSize: input.batchSize ?? 100` |
| `api/runs/[id]/retry.ts` | `batchSize: 100`, hardcoded |
| `components/IntegrationScheduleTab.tsx` | `batchSize: 100`, hardcoded in the request body |
| `backend/data-sync/page.tsx` | `DEFAULT_BATCH_SIZE = '100'`, the form's initial value |

`workers/sync-scheduled.ts` passes nothing and so lands on the second row.

### Why the operator cannot simply fix it

The dashboard's field is editable, so in principle an operator types the right number. Three things
make that a poor answer:

1. **They have to know it.** The right page is a property of the adapter — how much work a document
   costs, whether the apply is parallel, how much of a page an interrupt re-does. Nothing on the
   card says any of it.
2. **Most starts have no field at all.** A recurring schedule, the integration page's schedule row
   and **Retry** all start runs with no form in front of them. Whatever an operator learns about the
   right page size, those three paths keep using 100.
3. **It composes badly with `runParameters`.** An adapter that declares, say, a parallelism knob with
   a sensible default gets that default honoured on every path — including the scheduled worker,
   which deliberately normalizes an empty input against the declaration for exactly this reason. The
   page size that parallelism needs is the one value that stays at core's.

The result is a default nobody chose, on the path operators are steered to. An adapter whose natural
page is 500 and which applies a page across 4 parallel workers gets 100 — 25 documents each. The page
is the barrier, so every worker waits on the slowest document in its own quarter of it, and the
smaller the page the larger that tail is relative to the work. Nothing in the product explains why.

### Retry is the sharpest case

`api/runs/[id]/retry.ts` pins 100 regardless of what the original run used, because the run row does
not record a page size at all — `batchSize` rides the queue job and is never persisted. So retrying a
run started at 500 silently re-runs it at 100. That is not a behaviour anyone chose; it is a
hardcoded constant standing in for a value the system never kept.

### Core already believes this is entity-type knowledge

`supportsStartControl(control, entityType)` exists precisely because whether `batchSize` *means*
anything is per entity type and adapter-owned. The value it should start at is the same kind of fact,
declared by the same party, for the same reason: one adapter commonly serves both an incremental feed,
where the page is a drain window, and a whole-table backfill, where it is a commit boundary.

## Proposed Solution

```ts
defaultBatchSize?(entityType: string): number | undefined
```

Return `undefined`, or omit the hook, to keep core's 100.

### Why resolution lives in `startDataSyncRun`

All four start paths — the run route, Retry, the scheduled worker, and any provider-owned route that
enqueues a run of its own — call `startDataSyncRun`. Resolving there rather than in each caller means
one answer for all of them, and a start path added later cannot forget to ask. `resolveAdapterForIntegration`
is synchronous and already the single source of truth for "the adapter serving this integration", so
the helper needs no new dependency beyond it.

The counterpart obligation is stated in the module's `AGENTS.md`: a start path MUST leave `batchSize`
undefined rather than substitute a number of its own, or it silently shadows the declaration. The two
call sites that did exactly that (Retry, the schedule row) are fixed here.

### Why the run route needs a schema whose `batchSize` is not defaulted

With `.default(100)`, `POST /api/data_sync/run` always forwards an explicit 100, so the resolution in
`startDataSyncRun` is unreachable from the dashboard — the one path that matters most. More
fundamentally, a schema-level default erases the distinction the feature is built on: *the operator
asked for 100* and *nobody named a page size* must be different states, because only the second may
be answered by the adapter.

The distinction ships as a **new export** rather than an edit to the existing one. `runSyncSchema` is
a FROZEN §1 contract surface; changing its `batchSize` to `.optional()` in place would narrow
`RunSyncInput['batchSize']` from `number` to `number | undefined` in a single release, and an
out-of-tree caller that parses the schema itself and paginates with the result — rather than handing
the parsed input to `startDataSyncRun` — would silently receive `undefined` where it received `100`.
So `runSyncRequestSchema` carries the optional field and the run route parses it, while
`runSyncSchema` keeps its exact behaviour and gains `@deprecated` JSDoc pointing at the replacement.
Accepted input, the `1..1000` bound and the resolved-to-100 fallback are identical across both. See
"Migration & Backward Compatibility".

### Why the dashboard has to seed its field

The form submits its field value whenever the control applies, so a field initialized to `'100'`
keeps shadowing the declaration no matter what the server does. Seeding it from the resolved value
also makes the number visible *before* the run starts, which is the difference between a default and
a surprise.

The alternative — declaring `supportsStartControl('batchSize', …) === false` so the field disappears
and the request omits the key — was rejected: it buys the same server behaviour by taking away a
control the operator legitimately uses to page smaller for one run.

### A default, not a ceiling

An explicit `batchSize` on the run request always wins. The declaration sets what an operator gets
when they choose nothing; it never constrains what they may choose. This separation matches
`supportsStartControl`'s ("what the dashboard offers, never what the API accepts") and must hold for
any future change here.

### Handling a bad declaration

- **Outside `1..1000`** → clamped. An adapter asking for 5000 wants the largest page it can have, and
  1000 is nearer that intent than 100.
- **Not a positive integer** (a float, `NaN`, `Infinity`, a string, `undefined`) → ignored. That is
  not an intent at all.
- **Throws** → treated as *not declared*. `api/options.ts` resolves every registered adapter in one
  response, so one broken hook must not take the dashboard down for the rest; and on the start paths a
  throw would refuse a run outright over a knob that only sets its page size.

An adapter must not be able to make itself unstartable over its page size.

## Architecture

### 1. `lib/adapter.ts` — the declaration

`defaultBatchSize?(entityType: string): number | undefined` on `DataSyncAdapter`, optional, documented
as a default rather than a ceiling. Types compile away, so nothing else changes here.

### 2. `lib/default-batch-size.ts` — resolution, pure and isomorphic

New module, the same split `lib/start-controls.ts` uses:

- `resolveDefaultBatchSizeMap(adapter)` — server-side, across `supportedEntities`, for the options
  response. Sparse: an entity type with no declaration is omitted, so an adapter that declares nothing
  serializes to `{}`. The accumulator has a null prototype, so an entity type named `__proto__` stays a
  serializable own property instead of silently becoming a prototype assignment.
- `defaultBatchSizeFor(adapter, entityType)` — server-side, one entity type, for the start paths.
- `declaredDefaultBatchSize(map, entityType)` — client-side read, own-property only, re-validating the
  value because the map arrives over the wire.
- `DATA_SYNC_DEFAULT_BATCH_SIZE` (100) and the `1..1000` bounds, shared with `runSyncSchema` so a
  declaration cannot exceed what the API accepts.

### 3. `lib/start-run.ts` — the chokepoint

```ts
batchSize: input.batchSize ?? defaultBatchSizeFor(
  resolveAdapterForIntegration(input.integrationId),
  input.entityType,
),
```

### 4. `data/validators.ts`, `api/run.ts`, `api/runs/[id]/retry.ts`, `components/IntegrationScheduleTab.tsx`

New `runSyncRequestSchema` — `runSyncSchema` with `batchSize` `.optional()` instead of
`.default(100)` — which the run route parses; `runSyncSchema` itself is untouched and `@deprecated`.
The two hardcoded `batchSize: 100` request fields are removed.

### 5. `api/options.ts` and `backend/data-sync/page.tsx` — the wire and the form

`defaultBatchSizes: resolveDefaultBatchSizeMap(adapter)` on each item; the dashboard seeds its Batch
size field from it and re-seeds when the selected entity type changes — which also discards a value
the operator set for a different entity type, the same reasoning as the existing `fullSync` reset.

## Data Models

None. No new table, no migration, and deliberately no new column: persisting the page size a run used
would let Retry replay it, but that is a separate change with its own schema cost.

## API Contracts

### `GET /api/data_sync/options` — additive response field

```jsonc
{
  "integrationId": "sync_orders",
  "supportedEntities": ["orders.feed", "orders.backfill"],
  "startControls": { "orders.backfill": { "fullSync": false, "batchSize": true } },
  "defaultBatchSizes": { "orders.backfill": 500 }   // new, sparse
}
```

### `POST /api/data_sync/run` — same request shape

`batchSize` is still accepted and still bounded `1..1000`; an omitted value now resolves to the
adapter's declared default instead of a constant 100 (identical for an adapter that declares nothing).

## Migration & Backward Compatibility

Runtime behaviour is unchanged for every existing adapter: the method is optional, and everything that
resolves to nothing falls back to the same 100 as before. The full surface-by-surface classification is
in [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md) → *Data Sync Adapter Default Batch
Size (2026-09-16)*.

No existing surface is changed or narrowed. `runSyncSchema` and `RunSyncInput` keep their runtime and
their inferred types and are deprecated in favour of the new `runSyncRequestSchema` /
`RunSyncRequestInput`, whose `batchSize` is `number | undefined`. In-repo there is exactly one
consumer (`api/run.ts`), which parses the new schema and forwards the value to `startDataSyncRun`'s
optional field. The deprecated pair is kept for at least one minor version, removal no earlier than
one minor after 0.9.0.

**Migration path for adapters**: none required. To opt in, add the hook.

## Risks & Impact Review

- **A run suddenly pages larger than an operator expects.** Only for an adapter that opts in, and only
  where it declared the value — which is the point. The clamp to 1000 bounds the worst case to what
  the API already accepted.
- **A larger page re-does more on an interrupt.** True and inherent to page size; it is why this is the
  adapter's call rather than a global constant.
- **A stale browser tab keeps posting 100.** It gets 100, exactly as today. The declaration governs
  runs started without a value.
- **Retry still cannot replay an explicit page size.** Unchanged from today in kind — it used to
  hardcode 100, now it resolves the adapter's default, which is strictly closer to the original. Fixing
  it properly needs the value persisted on the run row; called out as a non-goal.

## Non-goals

- Persisting `batchSize` on `sync_runs` so Retry can replay the exact value a run used.
- Letting a `SyncSchedule` pin a page size (the same gap `runParameters` has there today).
- Any change to how the engine uses the page once it has one.
- Deriving the default from other run parameters. The hook sees the entity type only; an adapter whose
  right page depends on a parallelism parameter can still read that parameter itself and page
  internally.

## Testing

- `lib/__tests__/default-batch-size.test.ts` — sparse map, clamping, every non-intent input, a throwing
  hook, `__proto__`-named entity types over the wire, and the client-side read.
- `lib/__tests__/start-run.test.ts` (new) — the chokepoint: core's default with no adapter, the declared
  value per entity type, an explicit value winning, and a throwing hook falling back.
- `data/__tests__/validators.test.ts` (new) — the bridge: the deprecated `runSyncSchema` still
  substitutes 100 for an omitted page size, `runSyncRequestSchema` leaves it absent, and both accept
  the same bodies and the same `1..1000` bound.
- `api/__tests__/options.test.ts` — the map is shipped, sparse, and a throwing hook still answers 200.
- `api/__tests__/run.test.ts` — the route forwards no page size when the request names none.
- `api/runs/[id]/__tests__/retry-parameters.test.ts` — Retry forwards no page size of its own.
- `backend/data-sync/__tests__/page.test.tsx` — the field seeds from the declaration, and falls back to
  100 for an undeclared entity type.
- `__integration__/TC-DS-012.spec.ts` — every integration advertises a well-formed `defaultBatchSizes`
  object, keyed only by its own `supportedEntities` and valued only within the bounds the run API
  accepts.

## Changelog

- **2026-09-16** — initial draft.
- **2026-09-22** — review follow-up: the optional `batchSize` moves to a new `runSyncRequestSchema`
  instead of narrowing `runSyncSchema` in place, so no FROZEN contract surface changes and the
  deprecation protocol is followed literally.
