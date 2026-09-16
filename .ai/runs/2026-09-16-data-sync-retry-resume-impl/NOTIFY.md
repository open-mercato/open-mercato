# Notify — 2026-09-16-data-sync-retry-resume-impl

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-09-16T12:57:32Z — run started
- Brief: implement `.ai/specs/2026-09-16-data-sync-retry-resume-actions.md` in full — all three
  phases, all fifteen steps — and ship it on a PR against the **fork**, `fullstackhouse/open-mercato`,
  base `develop`.
- External skill URLs: none.

## 2026-09-16T12:57:32Z — decision: the PR targets the fork, not upstream
- The user asked for the work to land on `fullstackhouse/open-mercato` and explicitly not upstream yet.
  `open-mercato/open-mercato#6154` was closed rather than retargeted, because GitHub does not allow
  changing a pull request's base *repository*. Every commit and the branch itself are unchanged.

## 2026-09-16T12:57:32Z — decision: spec and implementation share one PR
- `om-auto-implement-spec` normally keeps a spec PR design-only and ships implementation separately.
  The user asked for "a PR with the whole spec implemented", which overrides that default.

## 2026-09-16T13:12:00Z — Phase 1 complete, plus Step 2.4 out of order
- Steps 1.1–1.7 and 2.4 have landed. 300 unit/component tests pass; locale parity is green.
- Step 1.5 (`TC-DS-012`) and Step 2.4 (`TC-DS-013`) were written by a dispatched executor and then
  reworked here: both originally carried ~35 lines of duplicated `pg` plumbing each, because
  `seedSyncRuns` hard-coded `batches_completed = 0` and inserted no cursor columns — it could not
  express a fixture whose whole point IS those columns. `helpers/db.ts` now takes `cursor`,
  `initialCursor` and `batchesCompleted`, and gained `seedSyncCursors` / `deleteSyncCursorsByIntegration`
  for the shared-cursor row. The executor's own recommendation, and worth doing before the duplication
  set.
- One correction to the executor's SQL: it inserted `created_at` into `sync_cursors`, which has no such
  column. Verified against `data/entities.ts` before fixing.

## 2026-09-16T13:12:00Z — process slip: a commit mixed two Steps
- Step 1.7's documentation edits (`data_sync/AGENTS.md`, `BACKWARD_COMPATIBILITY.md`) were written by a
  background agent while the Step 1.3/1.4 commit ran `git add -A`, so they landed inside `14390cb03a`
  rather than a commit of their own. The tree is correct; the history does not bisect cleanly across
  those two Steps. Not rewritten, because the commits were already pushed at that point in the run.
  Lesson recorded: never `git add -A` while a background agent is writing to the worktree.

## 2026-09-16T13:12:00Z — finding: mocking the shared chrome provider hangs the page suites
- `jest.mock('@open-mercato/ui/backend/BackendChromeProvider', ...)` makes the run-detail suite time out
  at 30s, with or without `jest.requireActual` spread in — isolated by bisecting the page and the test
  file independently. Resolved by extracting `components/useDataSyncRunAccess.ts` and mocking that
  instead, which is the house precedent (`customers`' `useDealsAccess`) and takes the suite back to
  ~2s. Worth knowing for any other module that adds client-side feature gating.
