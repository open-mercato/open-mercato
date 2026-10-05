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

## 2026-09-16T14:05:00Z — code review found a blocker in the feature's headline path
- A fresh-context reviewer, given only the code diff and the project's rules, found that **"Run again"
  did not seed the form at all**, while the banner asserted that four fields had been copied. Two
  independent causes: the `[runParameters]` effect is declared before the `[selectedIntegration]` one,
  so it cleared the shared ref first and entity type and direction were dropped; and when the source
  run's integration was already selected, `setSelectedIntegrationId` was a no-op write, so neither
  effect re-ran and nothing was seeded at all.
- **My tests did not catch it because they were vacuous** — every assertion targeted banner copy,
  `router.replace` or call counts, and not one read the form. The reviewer demonstrated they all pass
  with the seed consumption deleted. They now assert the entity-type combobox and the parameter input,
  and cover the already-selected-integration path explicitly.
- Also fixed: `seedMountedRef` was never re-armed on remount, so StrictMode killed the seed in dev on
  every render; `seedAttemptedRef` permanently blocked a repeat "Run again" on the same run and left
  `?from=` in the URL; a stale seed ref could hijack the operator's next integration change; the banner
  never cleared; `RETRYABLE` was a plain object indexed by an API-supplied string, so `toString` and
  `__proto__` answered truthy; the dashboard's from-scratch retry bypassed `useGuardedMutation`; and the
  schedule controls were missed by the feature gate — they need `data_sync.configure`, a different
  feature from `data_sync.run`.

## 2026-09-16T14:05:00Z — unrelated SIGSEGV flake in the full unit suite
- `yarn test` fails intermittently with `A jest worker process was terminated ... signal=SIGSEGV` in
  `@open-mercato/documents` and `@open-mercato/cli`. Both packages are untouched by this branch
  (`git diff --name-only origin/develop...HEAD -- packages/cli` is empty), and both pass in isolation —
  `cli` runs 1924/1924 green, `documents` 1008/1008. It is a local worker crash under
  `turbo --concurrency=2` with `--max-old-space-size=1024`, not a test failure, and it is reported as
  such rather than hidden behind a re-run.
