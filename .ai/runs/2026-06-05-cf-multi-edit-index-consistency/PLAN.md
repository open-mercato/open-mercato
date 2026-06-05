# CF multi-select edit — make the query index consistent (not eventually consistent)

**PR:** #2549 (`fix/cf-multi-edit-index-diag`)
**Re-approach driver:** maintainer rejected the "poll the eventually-consistent index in tests"
workaround. Root cause: `query_index.upsert_one` / `query_index.delete_one` are emitted
fire-and-forget (`void bus.emitEvent(...)`) in the data engine, so the query index that list
endpoints read (`customValues`) lags the synchronous write. Fix the system, not the test:
await the **projection** update in the write path so the index is consistent the moment the
write returns, while keeping the heavy search-token / vector / fulltext passes asynchronous to
bound write latency.

## Design (maintainer-approved: "projection only")

- The write path already awaits `flushOrmEntityChanges → emitOrmEntityEvent`. The only reason
  the index is eventually consistent is the `void` on the index emit.
- Make the **index row projection** (`entity_indexes.doc`, the part list reads serve) update
  synchronously; keep the **search-token rebuild** (DELETE + chunked INSERT into `search_tokens`),
  vectorize, and fulltext passes asynchronous.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <sha>` when a step lands.

### Phase 1: Make the query index projection synchronous

- [x] 1.1 `indexer.ts`: split `upsertIndexRow` — add `deferSearchTokens`, extract `reindexSearchTokensForRecord`
- [x] 1.2 `upsert_one.ts` subscriber: projection + coverage sync; token reindex + vectorize + fulltext deferred (fire-and-forget)
- [x] 1.3 `engine.ts`: `await` the `query_index.upsert_one` / `query_index.delete_one` emits (was `void`); update the stale "settles out-of-band" comments

### Phase 2: Tests prove consistency (remove the workaround)

- [x] 2.1 `TC-CRM-CF-MULTI-EDIT-001.spec.ts`: read `customValues` from the query INDEX (list endpoint) with immediate reads — no live-EAV detour, no poll
- [x] 2.2 `TC-CAT-CF-MULTI-EDIT-001.spec.ts`: immediate query-index reads — drop `expect.poll`
- [x] 2.3 Unit coverage for the indexer split (`deferSearchTokens` skips tokens; `reindexSearchTokensForRecord` writes them)

### Phase 3: Cleanup + validation

- [x] 3.1 Confirm CI `OM_CF_DEBUG` env + `helpers.ts` debug block removal (already in branch); sweep for any remaining diag
- [x] 3.2 Full validation gate + targeted integration specs
