# Notification log — 2026-05-25-oss-optimistic-locking

Append-only event log. Newest at the bottom.

## 2026-05-25T10:50Z — auto-continue-pr-loop resume
- Resumed by: @pkarw
- Resume point: 7.1 (source: PLAN.md Tasks table — first todo row)
- PR head SHA: 7f98bfe47
- Migrated legacy flat-file plan `.ai/runs/2026-05-25-oss-optimistic-locking.md` into a per-spec folder per `auto-continue-pr-loop` step 1 contract.
- Resume scope: Phases 7–11 (customers.person, sales.order, CrudForm prop, useGuardedMutation flash, end-to-end wiring on customers.company edit page).
- User directive: every commit that touches UI gets a paired UI test.

## 2026-05-25T11:00Z — checkpoint 1
- Steps verified: 7.1, 7.2, 8.1, 8.2 (SHA range 23b28c066..ff7841453).
- Decision: introduced `optimistic-lock-store.ts` (Step 8.1) to resolve the Awilix `crudMutationGuardService` last-write-wins risk between customers and sales modules. Spec PLAN.md Risks block updated.
- UI verification: **skipped** — no UI files touched in window. Expected at next checkpoint after Phase 9 (CrudForm prop).
- Validation: 27/27 shared optimistic-lock + 10/10 ui helpers pass; i18n in sync; 0 new typecheck errors.

## 2026-05-25T11:10Z — checkpoint 2 (UI-touch window)
- Steps verified: 9.1, 9.2, 10.1, 10.2, 11.1 (SHA range a3d13cc5b..4e4438ad6).
- UI files touched: `CrudForm.tsx`, `useGuardedMutation.ts`, `companies-v2/[id]/page.tsx`. Per the user's resume directive, each got a paired UI test in the same commit batch (4 + 4 + 2 = 10 new UI assertions across 3 test files).
- UI verification approach: contract-pinning unit tests with prop-capture mocks. Playwright integration tests for the API path (TC-LOCK-OSS-001..003) will run in CI's ephemeral stack — local dev server not running.
- All Tasks-table rows are now `done`. Next: final gate (step 5 of auto-continue-pr-loop) → auto-review-pr autofix → summary comment → flip PR body to `complete`.
