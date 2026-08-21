# Data Sync — run-scoped cursors via `persistsSharedCursor(entityType)`

**Status:** implemented (pending release)
**Module:** `packages/core/src/modules/data_sync`
**Related:** `.ai/specs/implemented/SPEC-045b-data-sync-hub.md`

## TLDR

`data_sync` mirrors every committed cursor into a single shared `sync_cursors` row per
`(integration, entityType, direction, organization, tenant)`. That is right for an incremental feed and
wrong for a whole-table backfill, and two *sequential* backfill runs with different windows are enough
to leave the next run starting mid-table and reporting `completed`, silently skipping everything before
that point. Adapters can now opt a given entity type out of the shared row via
`persistsSharedCursor(entityType)`; those entity types resume from their own last run instead.

## Overview

The change is additive and opt-in. It adds one optional predicate to the adapter contract, one options
object on the two cursor-writing service methods, one resume resolver, one reset primitive, and a
shared `resolveStartCursor` helper used by all three "start an incremental run" paths. An adapter that
does not implement the predicate behaves exactly as it does today.

## Problem Statement

`data_sync` persists a run's cursor in two places on every batch commit:

1. `sync_runs.cursor` — the run's own row, which a redelivered queue job resumes from.
2. `sync_cursors` — one row per `(integration_id, entity_type, direction, organization_id, tenant_id)`,
   overwritten unconditionally by whichever run commits last.

The second write is right for an incremental feed and wrong for a whole-table backfill, and one adapter
commonly serves both under a single provider key.

- A **feed cursor** is a position in a change log. Losing it means re-draining the whole queue, so it
  must outlive the run that advanced it.
- A **backfill cursor** is one run's scan state over a table the adapter re-walks idempotently. Losing
  it costs a re-walk, which is what the walk does anyway.

Sharing one row between the two silently corrupts the backfill's start position, and it does not need
concurrency to fire — two *sequential* runs are enough:

| | run A (full walk) | run B (scoped to the last week) |
|---|---|---|
| cursor mid-run | `{"lastId":0,"beforeId":900000,"topId":1380000}` | `{"lastId":0,"since":"2026-08-05","beforeId":1379000}` |

Both write the same row, last writer wins. If B commits last, the row reads *"position 1379000, window
= last week"*. The next resume starts there, walks ~1,000 records and finishes `completed`. The 900,000
records A never reached are skipped and nothing reports a problem.

## Proposed Solution

An optional, per-entity-type predicate on the adapter contract. The predicate is per entity type, not a
per-adapter boolean, because one adapter's `supportedEntities` commonly mixes feed and backfill types
and an adapter-level flag cannot express "persist for the feed, not for the backfill".

## Architecture

### 1. `lib/adapter.ts`

```ts
persistsSharedCursor?(entityType: string): boolean
```

Defaults to `true`. An adapter that does not implement it keeps today's behaviour exactly.

### 2. `lib/sync-run-service.ts`

- New exported `CursorCommitOptions = { persistSharedCursor?: boolean; expectedBatchesCompleted?: number }`,
  taken as a single trailing options object by `commitBatchProgress`. `updateCursor` takes the narrower
  `SharedCursorOption` (`persistSharedCursor` only), because it applies no ownership fence.
- The two concerns in that object are orthogonal and compose: `expectedBatchesCompleted` fences the
  write against a concurrent delivery, `persistSharedCursor` decides whether the cursor is mirrored. A
  fenced commit for an opted-out entity type advances the run row alone and still throws
  `SyncRunOwnershipConflictError` on a stale fence.
- When `persistSharedCursor === false` the run row still advances, and the service skips **both** the
  `sync_cursors` read and the write — one query less per batch on a long import, against a row nothing
  will read.
- New `resolveResumeCursor(integrationId, entityType, direction, scope)` returns the cursor of the most
  recent run, or `null` when that run reached `completed`. It reads the latest run rather than the
  latest *incomplete* one on purpose: after a walk finishes, an older interrupted run's cursor would
  make the next run skip everything before it — the same class of silent skip this spec exists to fix.
- New `resetResumePosition(integrationId, entityType, direction, scope)` clears the cursor on every run
  for that entity type that never reached `completed`, and returns how many it cleared. See
  § Reset semantics.

### 3. `lib/sync-engine.ts`

Resolves `adapter.persistsSharedCursor?.(run.entityType) ?? true` once per run (next to
`operationalTelemetry`) and threads it into `commitBatchProgress` in both `runImport` and `runExport`,
alongside the fence token.

### 4. Start-cursor resolution — `lib/start-cursor.ts`

The opt-out opens a hole on the "start an incremental run" paths: they read the shared row, which for
an opted-out entity type now returns `null` for a reason that has nothing to do with intent, so a
non-`fullSync` run silently becomes a full one — no error, just a re-walk that looks like it worked.

`resolveStartCursor(...)` centralises the decision: the shared row when the adapter persists it,
otherwise `resolveResumeCursor` (the most recent run, or `null` when that run completed). It is used by
all three start paths — `api/run.ts`, `api/runs/[id]/retry.ts` (after the existing `previous.cursor`
preference) and `workers/sync-scheduled.ts`. `fullSync` / `fromBeginning` still start from `null`.

Adapter resolution lives in `lib/adapter-registry.ts` (`resolveProviderKey`,
`resolveAdapterForIntegration`) and is imported by both the engine and the start paths. That is
deliberate rather than incidental: the engine decides whether to **write** the shared row and the start
paths decide whether to **read** one, and those two decisions must agree for every integration or an
opted-out entity type resumes wrong.

### 5. Reset semantics

The only way to reset "where the next incremental run starts" was to delete the shared `sync_cursors`
row. An opted-out entity type has no such row, so a reset flow that deletes only that leaves the resume
position on the last interrupted run, and the next incremental run re-imports just the tail of the walk
it was reset against — the same silent partial import, arriving through the reset path.

`resetResumePosition` is the run-scoped counterpart. Reset flows MUST call it alongside their
`SyncCursor` delete; it is a no-op when nothing is interrupted, so it is safe to call unconditionally.
The one in-tree reset flow (`packages/sync-akeneo/.../delete-imported-products.ts`) does.

## Data Models

No schema change. No migration. The change reads and writes existing columns only:

| Table | Column | Role in this change |
|---|---|---|
| `sync_runs` | `cursor` | The run-scoped position. Written on every commit; read by `resolveResumeCursor`; cleared by `resetResumePosition` |
| `sync_runs` | `status` | Distinguishes an interrupted run (resumable) from a `completed` one (starts fresh) |
| `sync_runs` | `batches_completed` | Existing ownership fence token, unchanged by this spec |
| `sync_cursors` | `cursor` | The shared position. No longer written for opted-out entity types |

## API Contracts

No HTTP surface change. `api/run.ts` and `api/runs/[id]/retry.ts` swap an internal cursor-resolution
call; no zod schema, request shape, response shape or `openApi` export changes.

TypeScript contracts (all additive):

| Symbol | Kind | Note |
|---|---|---|
| `DataSyncAdapter.persistsSharedCursor?` | new optional member | defaults to `true` when absent |
| `CursorCommitOptions` | new exported type | trailing optional argument |
| `SharedCursorOption` | new exported type | `updateCursor`'s narrower option |
| `SyncRunService.resolveResumeCursor` | new method | |
| `SyncRunService.resetResumePosition` | new method | |
| `resolveStartCursor`, `persistsSharedCursor` | new exports from `lib/start-cursor` | |
| `resolveProviderKey`, `resolveAdapterForIntegration` | new exports from `lib/adapter-registry` | `resolveProviderKey` was a private helper in `sync-engine.ts` |

## Backward Compatibility

Additive only. No schema change, no HTTP surface change, no change to any existing signature's required
arguments. `persistsSharedCursor` and the options objects are optional; adapters and callers that
ignore them behave exactly as before.

One signature was reshaped rather than extended: `commitBatchProgress`'s `expectedBatchesCompleted`
(added by the batch-commit ownership fence) moved from a fifth positional parameter into the same
trailing options object as `persistSharedCursor`. Both concerns are orthogonal cursor-commit flags and
two trailing optionals would have grown a positional tail for every future flag. The engine is the only
caller of the fence in-tree; external callers passing a bare number in that slot must pass
`{ expectedBatchesCompleted: n }` instead.

## Risks & Impact Review

| # | Failure scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|---|
| 1 | A reset deletes the shared row for an opted-out entity type, which does not exist, and the next incremental run resumes from a stale mid-walk cursor — re-importing only the tail | High | Adapter reset flows | `resetResumePosition` ships and the one in-tree reset flow calls it; documented as a MUST in the module `AGENTS.md` and the framework docs | A third-party reset flow that deletes `SyncCursor` directly and does not call it stays exposed. Nothing in code forces the pairing |
| 2 | `resolveResumeCursor` resumes from a `paused` or `cancelled` run whose window differs from what the caller now intends (e.g. a narrowed backfill), so the new run inherits the old run's scan window | Medium | Opted-out entity types | `fullSync` starts from `null`; a `completed` latest run also yields `null`, so only a genuinely interrupted run is inherited | Real. Resuming an interrupted run is the intended behaviour, but "interrupted with a different window" is indistinguishable from "interrupted with the same window" without a window fingerprint on the run row |
| 3 | An adapter's `persistsSharedCursor` disagrees between the write path (engine) and the read path (start paths) — e.g. two provider-key resolutions drift | Medium | All opted-out entity types | Both paths resolve the adapter through the single `resolveAdapterForIntegration` in `adapter-registry.ts` | Low; a non-deterministic predicate (reading mutable state) could still disagree between calls |
| 4 | An external caller passes a bare number as `commitBatchProgress`'s fifth argument after the fence moved into the options object | Low | External adapters | TypeScript rejects it at compile time | Only untyped/`any` call sites are affected, and they would have to be fencing manually |
| 5 | An opted-out entity type accumulates run rows and `resolveResumeCursor` sorts by `created_at`, which the `SyncRun` index does not cover | Low | Query performance | The leading indexed columns narrow the scan and only one row is fetched per run start | Negligible at realistic run-history sizes; worth revisiting if run retention grows large per entity type |

## Testing

- `lib/__tests__/sync-run-service.shared-cursor.test.ts` — default writes the shared row; opt-out
  advances only the run row; an inherited `sync_cursors` row is left byte-identical; the row lookup is
  skipped entirely; `updateCursor` honours the same flag; the ownership fence and the opt-out compose on
  a single commit, and a stale fence still throws when the entity type opted out; `resolveResumeCursor`
  resumes from a failed or cancelled latest run and returns `null` for a completed latest run or no runs
  at all; `resetResumePosition` clears only interrupted runs, leaves a reset entity type resuming from
  `null`, and is a no-op when nothing is interrupted.
- `lib/__tests__/sync-engine-shared-cursor.test.ts` — an adapter that opts out for one of two entity
  types produces exactly one shared row after running both; an adapter without the hook is unaffected;
  the export path passes the verdict through.
- `lib/__tests__/start-cursor.test.ts` — the adapter-resolution path used by
  `api/runs/[id]/retry.ts` and `workers/sync-scheduled.ts`, which resolve the adapter by integration id
  rather than receiving one in scope: provider-key resolution and its fallback, shared row vs resume
  cursor, and an unregistered integration defaulting to the shared row.
- `api/__tests__/run.test.ts` — default reads the shared row; an opted-out entity type resumes from the
  most recent unfinished run and never reads the shared row; `fullSync` still starts from `null`.
- `packages/sync-akeneo/.../__tests__/delete-imported-products.reset.test.ts` — the reset flow clears the
  run-scoped position alongside the shared row, and does neither when nothing was imported.

**Integration coverage: intentionally none.** Root `AGENTS.md` requires a spec to list integration
coverage for affected API paths. This change alters no HTTP surface (both touched routes swap an
internal call, with no schema or response change), has no UI, and exercising the opt-out end to end
requires an adapter that returns `false` — no in-tree adapter does. The route-level decision is covered
by `api/__tests__/run.test.ts` against the real handler. Integration tests should be added with the
first adapter that opts out, which is when they can assert something the unit tests cannot.

Not covered: no test exercises two genuinely concurrent runs against a real database. The sequential
interleave is what this change is about, and the unit tests reproduce it.

## Final Compliance Report

| Check | Result |
|---|---|
| Schema / migration | None — no entity or column change |
| HTTP surface | Unchanged — no zod, response or `openApi` change |
| `BACKWARD_COMPATIBILITY.md` contracts | Additive; one positional-to-options reshape on a fence parameter, documented above |
| Tenant scoping | Every new query filters `organizationId` + `tenantId` and `deletedAt: null` |
| Encryption helpers | `resolveResumeCursor` reads via `findWithDecryption`; `resetResumePosition` is a scoped `nativeUpdate` with no decryptable payload |
| `yarn generate` | No diff — no auto-discovered file added |
| Locales / user-facing strings | None added |
| Unit tests | `packages/core` full suite green; `data_sync` 23 suites |
| Docs updated | `apps/docs/docs/framework/modules/integrations-data-sync.mdx`, `packages/core/src/modules/data_sync/AGENTS.md` |

## Changelog

- 2026-08-12 — implemented.
- 2026-08-13 — merged `develop`; folded the ownership fence and the shared-cursor flag into one
  `CursorCommitOptions` object; added `resetResumePosition` and wired the Akeneo reset flow to it;
  deduplicated provider-key resolution into `adapter-registry.ts`; added start-cursor and reset
  coverage; corrected the stale "most recent incomplete run" wording and completed the required spec
  sections. All in response to upstream review.
