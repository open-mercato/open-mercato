# Fix #4677 — `buildIndexDoc` must never return an unencrypted index document

**Issue:** [#4677](https://github.com/open-mercato/open-mercato/issues/4677)
**Branch:** `fix/issue-4677-unencrypted-index-doc`
**Base:** `develop`

## Goal

Make it impossible for `buildIndexDoc` to hand its caller a plaintext document that then gets
written into `entity_indexes`, which must stay encrypted at rest.

## Problem

`packages/core/src/modules/query_index/lib/indexer.ts` wrapped both the aggregate-search-field
step and the encryption step in a single `try { … } catch {}`. Any throw inside that block —
from the aggregation, from resolving the tenant encryption service, or from
`encryptIndexDocForStorage` itself — was swallowed, `encryptIndexDocForStorage` never ran, and
the function returned the **plaintext** document. `upsertIndexRow` then wrote it straight into
`entity_indexes.doc`.

## Root cause

The empty `catch {}` conflated three different failures (aggregation bug, encryption-service
resolution, genuine encryption failure) and treated all of them as "carry on with whatever
`doc` currently holds". Because `encryptIndexDocForStorage` already returns the document
untouched when encryption is absent or disabled, a throw out of it is *always* a real
encryption failure — never a benign "not applicable" — so falling through could only ever
mean persisting plaintext.

## Approach

1. Move `attachAggregateSearchField(doc)` **above** the guard, so an aggregation or
   search-config bug fails loudly instead of being mistaken for an encryption failure.
2. Narrow the guard to the encryption call and stop swallowing: log via the structured logger
   and rethrow.

Rethrow rather than `return null`: `null` is the established "record no longer exists" signal
and makes `upsertIndexRow` **delete** the index row and its search tokens, so returning it on a
transient encryption failure would destroy a healthy, correctly-encrypted row. Throwing leaves
the projection untouched; the sole caller (`query_index.upsert_one`) already persists the error
via `recordIndexerError` and rethrows, and the event bus logs it without failing the user's
CRUD write. This mirrors `packages/search/src/vector/services/vector-index.service.ts:210`
("Vector entry encryption failed; refusing to persist plaintext").

## Progress

- [x] Triage the issue against `develop` (`om-verify-in-repo`) — real and unfixed
- [x] Root-cause the swallow and map every caller of `buildIndexDoc` / `upsertIndexRow`
- [x] Move `attachAggregateSearchField` out of the guarded block
- [x] Replace the empty `catch {}` with a logged rethrow
- [x] Add regression tests (encryption throws, aggregate throws, no write and no delete)
- [x] Verify the new tests fail against the pre-fix code
- [x] Run the full validation gate
- [x] Open the PR

## Scope notes

- **The batch path is untouched.** The issue cites `batch.ts:283-296` as already refusing
  plaintext ("Falling through would write the plaintext document…"). That guard does **not**
  exist on `develop`, nor in PR #4654's diff — `upsertIndexBatch` still has
  `catch { /* best-effort; ignore encrypt errors during indexing */ }` and pushes the plaintext
  doc into `basePayloads`. So the same defect is live on the reindex path. It is a separate
  change with a different blast radius (a batch must decide per row whether to skip or abort),
  and the issue's acceptance criteria are scoped to `buildIndexDoc`, so it is reported back on
  the issue rather than folded in here.
- **The optional `SearchConfig.entityBlocklistedFields` item is not applicable to `develop`.**
  That field is introduced by the still-open PR #4654; `packages/shared/src/lib/search/config.ts`
  does not have it yet. The null-prototype hardening belongs in that PR's own diff.
- **`attachAggregateSearchField` takes one argument on `develop`.** PR #4654 adds the
  `{ entityType }` second argument the issue quotes. Both PRs touch these lines, so whichever
  merges second needs a trivial conflict resolution.
