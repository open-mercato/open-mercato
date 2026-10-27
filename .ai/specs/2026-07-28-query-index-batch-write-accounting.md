# Query index batch write accounting

Status: implemented
Scope: `packages/core/src/modules/query_index`, `packages/shared/src/lib/{db,indexers}`

## Problem

A reindex batch could lose records and still report success.

Observed in production on 2026-07-28: `customers:customer_activity` had `base_count=11` but `indexed_count=10`. The whole index for that entity had been rebuilt by a bulk reindex running in 4 hash partitions. Partition 3 held exactly one record; its `entity_index_jobs` row showed `processed=1/1` with `finished_at` set, the coverage counter had been incremented, and no `entity_indexes` row was ever written. `indexer_error_logs` was empty and no BullMQ job had failed.

### Root cause

`upsertIndexBatch` (`lib/batch.ts`) writes a batch with a bulk `INSERT … ON CONFLICT`. That statement was wrapped in a bare `catch {}` which fell through to a per-row fallback loop, and the loop ran inside `db.transaction()`. Its per-row insert had its own `catch {}` annotated "ignore duplicate insert race".

That annotation was never true. In Postgres, any failing statement aborts the enclosing transaction and every subsequent statement fails with `25P02`; ignoring an error inside a transaction requires a savepoint. Two outcomes followed:

- **Failing row not last** — the next row's `UPDATE` raised `25P02` and propagated. Loud, but attributed to the wrong record.
- **Failing row last** — the loop ended, Kysely issued `COMMIT`, and Postgres answered a `COMMIT` on an aborted transaction with a `ROLLBACK` command tag **and no error**. `transaction().execute()` resolved normally and every row in the batch (up to `DEFAULT_BATCH_SIZE = 500`) was discarded silently.

The single-record partition made the second case trivially reachable.

Three further defects compounded it:

- `reindexer.ts` credited `deltaIndex` and `processed` from `rows.length` regardless of what landed, so the job's own counters corroborated the lie. Only the closing `refreshCoverageSnapshot` recount corrected coverage — which is why the count mismatch was the sole surviving evidence.
- `purgeOrphans` deletes `entity_indexes` rows with `updated_at < startedAt`. Rows whose write was rolled back still carried their pre-run `updated_at`, so the purge **deleted their pre-existing index entries**. The batch was not left stale, it was erased.
- `encryptDoc` failures were swallowed, leaving the plaintext document to be written into `entity_indexes` — a violation of the encryption-at-rest rule in `packages/core/AGENTS.md`.

## Design

### `upsertIndexBatch` reports what it wrote

```ts
export type UpsertIndexBatchResult = {
  attempted: number          // rows handed to the batch
  written: number            // rows confirmed in entity_indexes
  failedRecordIds: string[]
  searchTokenFailures: number
}
```

The function still never throws on a partial write; callers reconcile via `assertIndexBatchWritesLanded(entityType, result)`, which raises `QueryIndexBatchWriteError`. This keeps external callers that ignore the result on today's behavior, and `Promise<void>` → `Promise<UpsertIndexBatchResult>` is assignment-compatible, so no deprecation bridge is needed.

Per failure class:

| Failure | Treatment | Counted as written |
|---|---|---|
| Bulk `ON CONFLICT` statement | `logger.warn` + `recordIndexerError` (`query_index:reindex-batch:bulk`), fall through to per-row | n/a |
| Per-row insert, unique violation | Retry the `UPDATE` once; only a match proves the row exists | Yes, if the retry matches |
| Per-row insert, any other error | `recordIndexerError` (`query_index:reindex-batch:row`) with the record id | No |
| `encryptDoc` | Row excluded from the write entirely — writing plaintext is worse than not writing | No |
| `decryptDoc` | `recordIndexerError` with `source: 'fulltext'`; only affects search tokens | Yes |
| `replaceSearchTokensForBatch` | `recordIndexerError`, counted in `searchTokenFailures` | Yes |

The per-row fallback no longer runs in a transaction. The rows share no invariant worth one — the bulk path is a single atomic statement, and the fallback is per-row upsert emulation — so autocommitting each statement is both correct and the only way one bad row cannot discard its siblings.

Per-row error recording is capped at 50 per batch (`MAX_RECORDED_ROW_ERRORS_PER_BATCH`). Under a systemic failure every row fails, and one `indexer_error_logs` insert per record would hammer a database that is already failing. The suppressed failures still reach the caller through `failedRecordIds`.

### `reindexEntity` reconciles, then fails

Complete-then-fail rather than fail-fast: aborting on the first short batch would make every queue retry re-write the preceding batches and die on the same poison record, so one bad record would block an entity's index permanently. Instead the run processes every batch, accumulates failures, and throws once at the end.

The exception is a **fast-abort** when a whole batch fails (`written === 0 && attempted > 0`) — that is infrastructural (pool exhausted, disk full, KMS down), not a poison record, so grinding through the rest of the table is pointless.

Order of operations at the end of a run:

1. `purgeOrphans(..., { excludeRecordIds })` — failed records keep their existing index rows. Above `MAX_PURGE_EXCLUSIONS = 1000` the purge is skipped entirely (fail closed: keep stale data rather than delete it, and avoid a pathological `NOT IN`).
2. `refreshCoverageSnapshot` — the authoritative recount, which must run **on the failure path too**. Skipping it on the `resetCoverage === false` path (partitions 1..n-1) would leave `indexed_count` inflated above `base_count`, worse than the pre-fix state.
3. `assertIndexBatchWritesLanded` — throws, so the queue job fails and the subscriber's existing catch records the failure.

Coverage deltas, `processed`, `updateJobProgress` and the `query_index.vectorize_one` fan-out all use the written rows only.

`finalizeJob` stays in the `finally`. `reindexer.ts` refuses a non-`force` reindex while an unfinished job row exists for the scope, so leaving `finished_at` null would wedge every subsequent re-run behind `--force`.

### Failure visibility

`entity_index_jobs.status` already exists and is inert once `finished_at` is set (`api/status.ts` derived `completed` purely from `finished_at`). `finalizeJob` now accepts `{ status: 'failed' }`, the status API derives `failed`, and the query-index table renders it as an error badge. No migration required.

### Supporting changes

- `isUniqueViolation` promoted to `@open-mercato/shared/lib/db/pg-errors`; the `communication_channels` copy re-exports it with `@deprecated` (importing it cross-module from `query_index` would breach the module-isolation rule).
- `recordIndexerError` now also emits `logger.error`, so failures survive the process instead of living only in a table nobody watches. `input.payload` is deliberately not logged — it can carry record documents.
- The query-index CLI's `encryptDoc`/`decryptDoc` wrappers no longer swallow their own errors, which would have made the batch-level handling dead code on that path.

## Migration & Backward Compatibility

- `upsertIndexBatch` keeps its parameters and partial-write behavior. Its return changes from `Promise<void>` to `Promise<UpsertIndexBatchResult>`, which remains assignment-compatible for callers that ignore the resolved value; callers that need failure accounting can adopt `assertIndexBatchWritesLanded` additively.
- `finalizeJob` adds an optional third parameter, so existing callers keep compiling and retain their current behavior.
- The status API adds the `failed` value to its existing status enums without removing or retyping response fields.
- `isUniqueViolation` moves to the cross-module path `@open-mercato/shared/lib/db/pg-errors`. The previous `@open-mercato/core/modules/communication_channels/lib/pg-errors` path remains functional through a deprecated re-export for at least one minor release, and `UPGRADE_NOTES.md` names the replacement import.
- No database migration is required because `entity_index_jobs.status` is already an unconstrained text column.

## Out of scope

OpenTelemetry spans and metrics on the async indexing path. `@open-mercato/telemetry` ships with PR #4475, which is unmerged. Once it lands, `recordIndexerError` should also emit a span/metric, and the events worker and reindexer should be wrapped in `withSpan` with `event`, `entityType`, `partitionIndex`, `rowsFetched` and `rowsWritten` attributes.

## Test coverage

`packages/core/src/modules/query_index/__tests__/batch-write-accounting.test.ts`

- happy bulk path reports every row written
- bulk failure is recorded and the fallback still writes every row
- **one failing row does not prevent the remaining rows from being written** (the regression; verified failing against the pre-fix implementation, which committed nothing at all)
- the fallback opens no transaction
- unique violation resolved by the `UPDATE` retry counts as written; unresolved does not
- an unencryptable document is skipped rather than indexed in plaintext, and is absent from both the insert and the token payloads
- a search token failure is reported without failing the indexed rows

`packages/core/src/modules/query_index/__tests__/reindexer-partial-write.test.ts`

- a lost record fails the run after the batches complete; coverage deltas and job progress count only written rows; the purge excludes the failed id; the coverage snapshot and `finalizeJob` still run
- a fully failed batch aborts immediately without scanning the rest of the table
- the happy path is unchanged

`packages/core/src/modules/query_index/__tests__/status-coverage-waterfall.test.ts` — a finished job with `status='failed'` derives `failed` rather than `completed`.

`packages/core/src/modules/query_index/components/__tests__/QueryIndexesTable.test.tsx` — the failed job status renders with the error badge variant.

## Integration coverage

`packages/core/src/modules/query_index/__integration__/TC-QIDX-4593-failed-status.spec.ts` loads `/backend/query-indexes` in a real browser with a scoped failed-status API response and verifies the failed entity and semantic error badge are visible. The write-failure mechanics remain covered at unit level because reproducing an intentionally rejected database write through the public API would require corrupting a shared integration schema.

## Manual verification

Against a dev database: make one record's document fail to write, run `yarn mercato query_index reindex --entity <type> --force`, and confirm a non-zero exit, an `indexer_error_logs` row naming the record, the record's pre-existing index row still present, and `failed` in the query-index status table.

## Changelog

- 2026-07-28 — Implemented. Batch write accounting, non-transactional per-row fallback, purge exclusions, failed-job status.
