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

## 2026-05-25T11:15Z — auto-continue-pr-loop re-entry
- Re-entered by: @pkarw
- Reason: prior session checkpoint-2'd and stopped before the final gate. All Tasks-table rows already `done`; this re-entry runs step 5 (final gate) → step 6 (BC/code-review self-check) → step 7 (auto-review-pr autofix) → step 8 (summary comment) → step 9 (PR body flip + labels + lock release).
- PR head SHA at re-entry: 24fb640ef (checkpoint 2 commit).
- No new code Steps planned; only the final-gate ceremony and post-finalization commits (handoff + final-gate-checks).

## 2026-05-26T07:55Z — auto-continue-pr-loop resume (scope extension)
- Resumed by: @pkarw
- Resume point: PLAN.md → new Phase 13.1 (resume scope: "add support for all other entities")
- PR head SHA: 8d49a82f4
- Trigger: user invocation `/auto-continue-pr-loop 2055 add support for all other entities`.
- Approach (recommended option, user declined to disambiguate): hook
  `makeCrudRoute` to auto-register a generic optimistic-lock reader
  for every CRUD route's `resourceKind` using the factory's own ORM
  config. Hand-wired readers (customers.company/person, sales.order)
  always win because they register first via `customers/di.ts` /
  `sales/di.ts` (Step 13.2 introduces an "if-absent" store helper).
- Re-review expected: PR is currently in `qa` (non-terminal) — after
  this scope extension lands it moves back to `review` with a comment
  explaining why, then through `auto-review-pr` autofix and back to
  `qa` / `merge-queue`.
- 5 new Steps appended (13.1..13.5). One commit per Step per the
  `auto-continue-pr-loop` lean contract; checkpoint pass after Step
  13.5 batches verification.

## 2026-05-25T11:25Z — spec complete
- Final validation gate: all green — build:packages ✓, generate ✓, i18n×2 ✓, typecheck ✓ (standalone retry on apps/mercato after parallel SIGHUP), test ✓ (6132 tests across 677 suites), build:app ✓.
- ds-guardian pass: clean.
- Self code-review + BC review: clean (every change ADDITIVE; one documented behavior addition for useGuardedMutation default 409 flash).
- `auto-review-pr` autofix subagent: APPROVE, zero blocking findings; one false-positive docs nit dismissed after verifying the referenced file exists.
- Comprehensive PR summary comment posted: https://github.com/open-mercato/open-mercato/pull/2055#issuecomment-4533881146
- PR body flipped: `Status: in-progress` → `Status: complete`, Phases 7–11 added to "What Changed", decision matrix markers updated to reflect all 3 reference entities landed, Tests section updated.
- Labels kept: `feature`, `review`, `needs-qa`. `in-progress` will be released as the next action. PR stays in `review` pipeline state.
- Resume run is finalized. PR #2055 awaits human review.
