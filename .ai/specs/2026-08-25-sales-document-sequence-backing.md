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

The registry row survives as the record of which scopes exist; the hot path only reads it. `peekNextSequence` uses `pg_sequence_last_value`, which reports the sequence's state without consuming a value.

`setNextSequence` parks the sequence on `setval(…, next - 1, true)`, so the next `nextval` returns exactly `next` **and** the value stays readable. The `setval(…, next, false)` form arrives at the same next claim, but leaves `is_called = false` — and that is precisely the state `pg_sequence_last_value` reports as NULL, which `peekNextSequence` reads back as the start value. Because the settings form posts back the counter the API reports, that under-report was written into the sequence on the next save and rewound the whole series (found in UI QA on [#5613](https://github.com/open-mercato/open-mercato/pull/5613); it re-issued a number an existing order already carried and died on `sales_orders_number_unique`). The start value is the one exception: it has no predecessor to park on and `minvalue` forbids one, so it stays the untouched never-called state, which already claims and reports the start value.

Sequences are created in three places, all idempotent: this change's migration (for existing rows), `setup.ts`'s `onTenantCreated` (for new tenants), and a lazy fallback in `claimSequence` when a claim finds no sequence — which covers rows created by any path that predates or bypasses the other two. `onTenantCreated` derives the ids from the registry rows it just flushed rather than re-reading them: `createDocumentSequence` issues its DDL over `em.getConnection()`, which runs outside the EntityManager's transaction context, so a read on that connection would not see rows the hook wrote inside a transaction and the eager loop would silently create nothing (the lazy fallback would still cover it, but the point of the eager pass is that the first document does not pay for it).

**Exhaustion now fails loudly, on both paths.** The previous implementation clamped a claim above `MAX_SEQUENCE` to `MAX_SEQUENCE`, which hands the same number to more than one document. Refusing to issue a number is the better failure: the caller's transaction rolls back cleanly and no two documents collide. `setNextSequence` refuses an out-of-range target for the same reason instead of clamping to it — parking the series on the ceiling makes every later claim collide there, which is the identical hazard one step earlier. `salesSettingsUpsertSchema` already rejects the range at the API boundary, so the throw only reaches a direct service caller.

**Trade-off:** this creates one sequence object per actively-used `(organization, tenant, kind)` scope. Sequences materialize lazily on first use rather than for every scope that could exist, but a deployment with many organizations will accumulate them, and they appear individually in `pg_dump` output. This was accepted as the cost of a lock-free claim; a shared-sequence or block-allocation design would trade that back for coarser numbering guarantees.

### Coverage counters — increment in SQL

`applyCoverageAdjustments` now applies each aggregated delta with one statement whose `SET` clause increments the stored columns in SQL:

```sql
base_count = greatest("base_count" + ?, 0)
```

Overlapping adjustments compose instead of clobbering each other, and the `SELECT` that preceded every write — along with the window between it and the write — is gone, which is a larger contention win than deferring the write would have been.

**That statement is an `UPDATE`, not an `INSERT … ON CONFLICT DO UPDATE`.** The first iteration used the upsert and its conflict target `(entity_type, tenant_id, organization_id, with_deleted)`, which matches `entity_index_coverage_scope_idx`. That index is a plain `UNIQUE` constraint, and Postgres treats NULLs in one as distinct — so for any scope with a NULL tenant the conflict branch never fired. Every adjustment took the insert branch, stored its own delta as if it were the whole total, and `pruneDuplicateCoverageRows` then deleted the accumulated row: the counter was overwritten rather than incremented, `hasGap` reported a phantom index gap, and the engine scheduled a spurious full reindex — the exact failure this section exists to prevent. NULL-tenant scopes are a supported, reachable case: `resolveQueryIndexRecordScope` has a `global` branch that returns `{ tenantId: null, organizationId: null }`, and its `row` branch yields whatever the source table's tenant column holds. A NULL-aware `UPDATE … WHERE tenant_id IS NULL` matches those rows and still increments in SQL, so it composes exactly the way the conflict branch did for tenant-scoped rows. The upsert is retained only as the seeding path taken when the scope has no row yet, where its conflict branch still closes the insert race for the scopes the constraint can see.

Three alternatives were considered for the NULL-tenant match and rejected: normalizing `tenant_id` to a placeholder the way `organization_id` already is (needs a data migration over every existing NULL-tenant row, and `tenant_id IS NULL` is read in several other places); adding `NULLS NOT DISTINCT` to the index (Postgres 15+, so it pins a server floor the project has not declared, and needs a dedup pass before the constraint can be recreated); and keeping the upsert with a partial unique index per NULL-ness combination (two more indexes on a hot table). The `UPDATE`-first shape needs no schema change at all.

In steady state the adjustment is still one statement. The other statements in `incrementCoverageRow` are recovery paths that stop firing once a scope settles: the legacy NULL-organization fold runs only for global-organization scopes, the seeding insert only until the scope's row exists, and the duplicate prune only when the scope somehow holds more than one row.

The adjustment therefore stays **awaited and inside the caller's transaction** on the `OM_CACHE_SAFETY_ALWAYS_CONSISTENT` path. That flag exists to make the read projection and its counters commit together; a single incrementing statement holds the coverage row's lock only for its own duration, so there is no longer a reason to move it out. An earlier iteration of #5613 deferred these writes with `void`; that is what made the lost updates systematic rather than occasional, and it was reverted.

## Migration & Backward Compatibility

`sales_document_sequences` keeps every column, so the ORM snapshot is unchanged and no client of the table breaks structurally.

`Migration20260825120000_sales_document_sequences_backing_sequences` creates a sequence for every existing registry row and seeds it from that row's `current_value`, so numbering resumes exactly where it stopped. The `down()` path is symmetric and deliberately restores authority before dropping: it writes each sequence's `last_value` back into `current_value`, then drops the sequence. Without that, rolling back would resume from a `current_value` frozen at migration time and re-issue numbers already printed on documents.

**`SalesDocumentSequence.currentValue` is deprecated.** It is retained, carries a `@deprecated` annotation naming the replacement, and is refreshed only by `setNextSequence` and the down-migration. It is no longer the authoritative counter and must not be read as one — use `SalesDocumentNumberGenerator.peekSequences()`. Per `BACKWARD_COMPATIBILITY.md`, the column stays for at least one minor version before any removal is proposed.

Public service contracts are unchanged: `generate`, `peekSequences`, and `setNextSequence` keep their signatures and semantics. The one behavior change is exhaustion, described above.

## Test Coverage

- `packages/core/src/modules/sales/services/__tests__/salesDocumentNumberGenerator.test.ts` — claims go through `nextval` and not the old `UPDATE`; concurrent callers never share a number; the first claim for a scope creates the registry row and sequence; kinds stay independent; exhaustion throws rather than clamping; claim failures propagate; `peekSequences` does not consume; `setNextSequence` repositions the sequence, reports back the value it was set to, survives a re-save of that reported value without rewinding, and round-trips the start value. The connection double models `is_called`, because a double that always reported a value is what let the rewind past this suite. `documentSequenceName` is tested for stability and for rejecting non-UUID input rather than building an injectable identifier.
- `packages/core/src/modules/sales/__integration__/TC-SALES-5604-document-number-sequence-roundtrip.spec.ts` — drives the real `GET`/`PUT /api/sales/settings/document-numbers` and `POST /api/sales/document-numbers` against Postgres: the saved counter is what the API reports, what the next claim returns, and what survives a no-op re-save. This is the layer the mocked unit suite cannot reach, since the defect lived in `is_called` state the double did not model.
- `packages/core/src/modules/query_index/__tests__/coverage-adjustment-atomicity.test.ts` — compiles the real SQL on Kysely's `DummyDriver` and asserts that the incrementing statement adds to the column's own value, that a NULL-tenant scope is matched by an explicit `tenant_id is null` predicate rather than through a conflict target that cannot see it, that no `SELECT` of the coverage row precedes the write, that adjustments aggregate to one statement per scope, that the seeding insert still increments on conflict, and that a fully-cancelling delta touches the database not at all. `DummyDriver` answers every statement with no rows, so this suite pins the *shape* of what is sent and nothing about the counters that come back — which is why a well-formed statement matching the wrong rows escaped its first version, and why the spec below is not optional.
- `packages/core/src/modules/query_index/__integration__/TC-QIDX-5613-coverage-accumulation.spec.ts` — runs the real `applyCoverageAdjustments` against the ephemeral shard's Postgres and asserts the resulting totals: three sequential `+1` adjustments accumulate to `3` in a tenant-scoped, a NULL-tenant, and a NULL-tenant/NULL-organization scope, and five overlapping adjustments add `5` to an existing counter without fanning out into duplicate rows. This is the layer that distinguishes "incremented" from "overwritten"; the rows belong to a throwaway `entity_type` unique per run, so no other suite's coverage is touched.

## Out of scope

The `entity_index_coverage` read-path refresh-on-stale-TTL herd ([#2968](https://github.com/open-mercato/open-mercato/issues/2968)). This change covers the write path only.
