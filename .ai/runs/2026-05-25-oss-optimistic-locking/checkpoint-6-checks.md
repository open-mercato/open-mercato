# Checkpoint 6 — resume 2 (QA-fix + framework + unified conflict bar)

**Date:** 2026-05-29
**Steps covered:** 21.1, 22.1, 22.2, 24.1, 25.1 (SHA range 336632f96..35fbd4d30, + i18n sort fix in this checkpoint commit)
**Touched packages:** `@open-mercato/shared`, `@open-mercato/ui`, `@open-mercato/core`, app i18n.

## What landed
- **21.1** (`336632f96`) — live QA root-cause report (`qa-repro-report.md`). Booted branch on :3100, proved CRM v2 already correct; gaps are sales doc page + sub-sections + catalog variant delete.
- **22.1** (`42e1feffd`) — `createCommandOptimisticLockGuardService` + `resolveExpected` hook (enterprise command-level extension seam).
- **22.2** (`f2a23716c`) — unified record-conflict **error bar** (`conflicts/store` + `RecordConflictBanner` in AppShell + `surfaceRecordConflict`), CrudForm + useGuardedMutation routed through it; i18n `ui.forms.conflict.*` ×4 locales.
- **24.1** (`b914ae7bb`) — catalog variant delete: defensive conflict→bar helper + test (was already covered via CrudForm).
- **25.1** (`35fbd4d30`) — sales document detail page: `updateDocument` + all 15 inline-edit catches + `handleDelete` + `handleConvert` now send the lock header and route 409 → bar + refresh.

## Validation (this checkpoint)
- `yarn build:packages` ✅ (green, cached).
- Unit tests (touched surfaces):
  - shared `optimistic-lock-command` ✅ 23/23 (incl. 6 new factory/hook tests).
  - ui `conflicts/store` + `optimisticLock` + `useGuardedMutation.optimisticLock` + `CrudForm.optimisticLock` ✅ 24/24.
  - core `handleVariantDeleteError` + `handleDocumentMutationError` ✅ 5/5.
- `yarn i18n:check-sync` ✅ after `--fix` re-sorted the 4 locale files (the new `ui.forms.conflict.*` keys were inserted out of sort order; auto-fixed, keys retained in all 4).

## UI / Playwright verification
- **Server-side 409 proven live** on :3100: `TC-LOCK-OSS-001` passed against the running branch; an ad-hoc browser run on `companies-v2` produced a real `PUT … 409` and the localized message.
- **Conflict-bar visual capture: deferred to Phase 27.2.** The `companies-v2` page uses react-query refetch-on-focus, which keeps a single tab's `updatedAt` fresh and defeats single-tab stale-save simulation (this is exactly why only QA's *two-tab* case failed). The bar itself is covered by 4 unit suites (store, helper, CrudForm routing, useGuardedMutation routing). Deterministic visual proof will use the two-session/two-tab path in Phase 27.2. **UI verification did not block development** per the skill contract.

## Notes / pre-existing (not introduced here)
- Workspace `tsc` `ignoreDeprecations` TS5103 env error reproduces on develop — out of scope (use turbo typecheck for the real check at the final gate).
