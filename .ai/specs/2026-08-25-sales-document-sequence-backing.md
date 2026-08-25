# Sequence-backed sales document numbering

**Status:** implemented in #5613
**Issue:** [#5604](https://github.com/open-mercato/open-mercato/issues/5604) — hot-row lock contention on `sales_document_sequences` and `entity_index_coverage`

## Problem

Two hand-rolled counters serialized concurrent writes on a single row each.

`sales_document_sequences` holds one row per `(organization_id, tenant_id, document_kind)`. Every document number claimed issued its own `UPDATE … SET current_value = current_value + 1`, so concurrent order creation queued on that row's lock, and each claim left a dead tuple behind — the row's own bloat then made every subsequent claim slower.

`entity_index_coverage` holds one row per `(entity_type, tenant_id, organization_id, with_deleted)`. Every indexed write adjusted it through `applyCoverageAdjustments`, which read the row, added the delta in JavaScript, and wrote the resulting total back. That read-modify-write is not atomic: two adjustments that overlap read the same row and write the same total, so one is silently lost.

## Design

### Document numbering — one Postgres sequence per scope

`nextval` is atomic, takes no row lock, and produces no dead tuples, which is exactly the shape this counter needs.

Each `sales_document_sequences` row is now backed by its own sequence named after that row's primary key: `sales_docseq_<row id with dashes removed>`. Deriving the name from the id keeps the mapping recomputable from the table alone — no extra column, no ORM snapshot change, and `\ds sales_docseq_*` in psql lines up with the registry.

A claim is a single round trip that recomputes the name in SQL:

```sql
select nextval(('sales_docseq_' || replace(id::text, '-', ''))::regclass) as claimed
  from sales_document_sequences
 where organization_id = ? and tenant_id = ? and document_kind = ?
```

The registry row survives as the record of which scopes exist; the hot path only reads it. `peekNextSequence` uses `pg_sequence_last_value`, which reports the sequence's state without consuming a value. `setNextSequence` uses `setval(…, next, false)`.

Sequences are created in three places, all idempotent: this change's migration (for existing rows), `setup.ts`'s `onTenantCreated` (for new tenants), and a lazy fallback in `claimSequence` when a claim finds no sequence — which covers rows created by any path that predates or bypasses the other two.

**Exhaustion now fails loudly.** The previous implementation clamped a claim above `MAX_SEQUENCE` to `MAX_SEQUENCE`, which hands the same number to more than one document. Refusing to issue a number is the better failure: the caller's transaction rolls back cleanly and no two documents collide.

**Trade-off:** this creates one sequence object per actively-used `(organization, tenant, kind)` scope. Sequences materialize lazily on first use rather than for every scope that could exist, but a deployment with many organizations will accumulate them, and they appear individually in `pg_dump` output. This was accepted as the cost of a lock-free claim; a shared-sequence or block-allocation design would trade that back for coarser numbering guarantees.

### Coverage counters — increment in SQL

`applyCoverageAdjustments` now applies each aggregated delta as one `INSERT … ON CONFLICT DO UPDATE` whose `SET` clause increments the stored columns in SQL:

```sql
base_count = greatest("entity_index_coverage"."base_count" + ?, 0)
```

Overlapping adjustments compose instead of clobbering each other, and the `SELECT` that preceded every write — along with the window between it and the write — is gone, which is a larger contention win than deferring the write would have been.

The adjustment therefore stays **awaited and inside the caller's transaction** on the `OM_CACHE_SAFETY_ALWAYS_CONSISTENT` path. That flag exists to make the read projection and its counters commit together; a single incrementing UPSERT holds the coverage row's lock only for the duration of that statement, so there is no longer a reason to move it out. An earlier iteration of #5613 deferred these writes with `void`; that is what made the lost updates systematic rather than occasional, and it was reverted.

## Migration & Backward Compatibility

`sales_document_sequences` keeps every column, so the ORM snapshot is unchanged and no client of the table breaks structurally.

`Migration20260825120000_sales_document_sequences_backing_sequences` creates a sequence for every existing registry row and seeds it from that row's `current_value`, so numbering resumes exactly where it stopped. The `down()` path is symmetric and deliberately restores authority before dropping: it writes each sequence's `last_value` back into `current_value`, then drops the sequence. Without that, rolling back would resume from a `current_value` frozen at migration time and re-issue numbers already printed on documents.

**`SalesDocumentSequence.currentValue` is deprecated.** It is retained, carries a `@deprecated` annotation naming the replacement, and is refreshed only by `setNextSequence` and the down-migration. It is no longer the authoritative counter and must not be read as one — use `SalesDocumentNumberGenerator.peekSequences()`. Per `BACKWARD_COMPATIBILITY.md`, the column stays for at least one minor version before any removal is proposed.

Public service contracts are unchanged: `generate`, `peekSequences`, and `setNextSequence` keep their signatures and semantics. The one behavior change is exhaustion, described above.

## Test Coverage

- `packages/core/src/modules/sales/services/__tests__/salesDocumentNumberGenerator.test.ts` — claims go through `nextval` and not the old `UPDATE`; concurrent callers never share a number; the first claim for a scope creates the registry row and sequence; kinds stay independent; exhaustion throws rather than clamping; claim failures propagate; `peekSequences` does not consume; `setNextSequence` repositions the sequence. `documentSequenceName` is tested for stability and for rejecting non-UUID input rather than building an injectable identifier.
- `packages/core/src/modules/query_index/__tests__/coverage-adjustment-atomicity.test.ts` — compiles the real SQL on Kysely's `DummyDriver` and asserts the conflict branch increments the column's own value, that no `SELECT` of the coverage row precedes the write, that adjustments aggregate to one statement per scope, and that a fully-cancelling delta touches the database not at all.

## Out of scope

The `entity_index_coverage` read-path refresh-on-stale-TTL herd ([#2968](https://github.com/open-mercato/open-mercato/issues/2968)). This change covers the write path only.
