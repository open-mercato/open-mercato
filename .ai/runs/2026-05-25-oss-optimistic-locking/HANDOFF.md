# Handoff — 2026-05-25-oss-optimistic-locking

**Last updated:** 2026-05-25T10:50Z
**Branch:** feat/oss-optimistic-locking
**PR:** https://github.com/open-mercato/open-mercato/pull/2055
**Current phase/step:** Phase 7 Step 7.1 (resume entry)
**Last commit:** 7f98bfe47 (`docs(runs): mark oss-optimistic-locking Phase 6 complete — PR #2055`)

## What just happened
- PR #2055 shipped Phases 1–6 (spec + core guard + client helpers + customers.company reference + integration test + docs + Task Router) via `auto-create-pr`.
- This resume migrates the legacy flat-file run plan to a per-spec folder (`.ai/runs/2026-05-25-oss-optimistic-locking/{PLAN.md,HANDOFF.md,NOTIFY.md}`) and appends Phases 7–11 to finish the spec.

## Next concrete action
- Phase 7.1: extend `packages/core/src/modules/customers/di.ts` with a `customers.person` reader on the same `OptimisticLockGuardService`. Single registration, two-entry `readers` map.

## Blockers / open questions
- Known limitation (documented in PLAN.md Risks): both `customers` and `sales` modules will register `crudMutationGuardService`. Last-write-wins. Mitigation in this PR: CI env opts in one entity at a time per test (env value can list both `customers.company` + `customers.person` because they live on the SAME module, but sales lives separately). Composition is queued as follow-up; not blocking this resume.

## Environment caveats
- Worktree path (relative to repo root): `.ai/tmp/auto-continue-pr/pr-2055-20260525-104412/`. Cleaned up at end of resume.
- Dev server: not started in this resume; integration tests run against ephemeral CI stack.
- UI verification per resume directive: every commit touching a UI file gets a UI test in the same Step batch.

## Worktree
- Path: .ai/tmp/auto-continue-pr/pr-2055-20260525-104412 (created this resume, will clean up)
