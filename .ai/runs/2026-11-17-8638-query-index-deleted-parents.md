# Execution plan — keep soft-deleted customer profiles out of search (adopted from PR #9677)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-11-17 because PR #9677 carried no execution plan.
**PR:** #9677 · **Branch:** `fix/8638-query-index-deleted-parents` · **Base:** `main`
**Author:** @pgaluszk — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Make the PR mergeable again: bring in current `main` and keep the #8638 exclusion handling working inside the `SearchIndexer` restructured by #8410.

## Scope

- `packages/search/src/indexer/search-indexer.ts` — conflict resolution only.
- `packages/search/src/__tests__/search-indexer-excluded-records.test.ts` — pass `encryptedCustomFieldKeysResolver`.

## Non-goals

- No new behavior beyond the reviewed fix.
- The red `test` check caused by `main`'s `.ai/lessons.md` count (186 declared vs 187 files) is a base-branch defect and is not fixed here.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The only remaining blocker is the merge conflict with `main` | review 5933256004 by @haxiorz and its completion comment (earlier findings rechecked and fixed) | high |
| Tests must pass `encryptedCustomFieldKeysResolver` | same review; `packages/search/AGENTS.md` Always #1 | high |

## Assumptions

- Merging `main` (not rebasing) is acceptable: it preserves the reviewed history and follows the no-history-rewrite rule.
- `buildIndexableRecords` is private, so extending its `{ records, dropped }` result with `excludedRecordIds` / `checkFailures` keeps the contract.

## Risks

- `search-indexer.ts` is shared by all search strategies; the full search suite and the PR's core tests cover the touched paths.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Exclude profiles with soft-deleted parents on every index path, fail loud on exclusion failures — 6c472e3d75

### Phase 2: Resolve the conflict with main

- [x] 2.1 Merge main and re-integrate isRecordExcluded into the restructured SearchIndexer — 6672475780
- [x] 2.2 Pass encryptedCustomFieldKeysResolver in the excluded-record tests — 6672475780
- [ ] 2.3 Run the full validation gate and request re-review
