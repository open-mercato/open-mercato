# Data Sync — run-scoped cursors via `persistsSharedCursor(entityType)`

**Status:** implemented (pending release)
**Module:** `packages/core/src/modules/data_sync`
**Related:** `.ai/specs/implemented/SPEC-045b-data-sync-hub.md`

## Problem

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

## Solution

An optional, per-entity-type predicate on the adapter contract. The predicate is per entity type, not a
per-adapter boolean, because one adapter's `supportedEntities` commonly mixes feed and backfill types
and an adapter-level flag cannot express "persist for the feed, not for the backfill".

### 1. `lib/adapter.ts`

```ts
persistsSharedCursor?(entityType: string): boolean
```

Defaults to `true`. An adapter that does not implement it keeps today's behaviour exactly.

### 2. `lib/sync-run-service.ts`

- New exported `CursorCommitOptions = { persistSharedCursor?: boolean }`.
- `updateCursor(runId, cursor, scope, options?)` and
  `commitBatchProgress(runId, delta, cursor, scope, options?)` take it as a trailing optional argument.
- When `persistSharedCursor === false` the run row still advances, and the service skips **both** the
  `sync_cursors` read and the write — one query less per batch on a long import, against a row nothing
  will read.
- New `resolveResumeCursor(integrationId, entityType, direction, scope)` returns the cursor of the most
  recent run that never reached `completed`, or `null` when the last attempt finished.

### 3. `lib/sync-engine.ts`

Resolves `adapter.persistsSharedCursor?.(run.entityType) ?? true` once per run (next to
`operationalTelemetry`) and threads it into `commitBatchProgress` in both `runImport` and `runExport`.

### 4. Start-cursor resolution — `lib/start-cursor.ts`

The opt-out opens a hole on the "start an incremental run" paths: they read the shared row, which for
an opted-out entity type now returns `null` for a reason that has nothing to do with intent, so a
non-`fullSync` run silently becomes a full one — no error, just a re-walk that looks like it worked.

`resolveStartCursor(...)` centralises the decision: shared row when the adapter persists it, most recent
incomplete run otherwise. It is used by all three start paths — `api/run.ts`, `api/runs/[id]/retry.ts`
(after the existing `previous.cursor` preference) and `workers/sync-scheduled.ts`. `fullSync` /
`fromBeginning` still start from `null`.

## Backward compatibility

Additive only. No schema change, no HTTP surface change, no change to any existing signature's required
arguments. `persistsSharedCursor` and `CursorCommitOptions` are optional; adapters and callers that
ignore them behave exactly as before.

## Testing

- `lib/__tests__/sync-run-service.shared-cursor.test.ts` — default writes the shared row; opt-out
  advances only the run row; an inherited `sync_cursors` row is left byte-identical; the row lookup is
  skipped entirely; `updateCursor` honours the same flag; `resolveResumeCursor` filter and empty case.
- `lib/__tests__/sync-engine-shared-cursor.test.ts` — an adapter that opts out for one of two entity
  types produces exactly one shared row after running both; an adapter without the hook is unaffected;
  the export path passes the verdict through.
- `api/__tests__/run.test.ts` — default reads the shared row; an opted-out entity type resumes from the
  last incomplete run and never reads the shared row; `fullSync` still starts from `null`.

## Changelog

- 2026-08-12 — implemented.
