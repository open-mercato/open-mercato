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

## 2026-05-26T08:45Z — Phase 13 scope extension complete
- ds-guardian pass: clean (subagent — no commits needed, no DS surface touched by Phase 13).
- Self code-review + BC sweep: additive across all 13 contract surfaces. 2 new exports from `optimistic-lock.ts` + 1 from `optimistic-lock-store.ts` + 1 new internal side-effect inside `makeCrudRoute` (env-gated short-circuit precedes the registry write).
- `auto-review-pr` subagent (autofix mode): APPROVE on iteration 1, zero actionable findings. Lock NOT released by the subagent — parent session owns it.
- PR body extended with Phase 13 section, decision matrix Q5/Q6 flipped to **C**, Tests block expanded (+19 new unit cases + TC-LOCK-OSS-004), checkpoint-3 validation block appended.
- Comprehensive summary comment posted: https://github.com/open-mercato/open-mercato/pull/2055#issuecomment-4540400311.
- Pipeline labels stay at `feature` + `qa` + `needs-qa`. New auto-coverage surface needs QA's exercise; `auto-review-pr` verdict is APPROVE so `review` is not needed.
- `in-progress` lock released next.

## 2026-05-26T08:30Z — checkpoint 3 (Phase 13: all CRUD entities)
- Steps verified: 13.1, 13.2, 13.3, 13.4, 13.5 (SHA range 8932cd344..284b72b38).
- Targeted validation: build:packages ✓, generate ✓, i18n-sync ✓ (4 locales, 47 modules), i18n-usage advisory baseline unchanged; shared 995/995, ui 1067/1067, core 4189/4189 unit tests green.
- Targeted optimistic-lock surface: shared 78/78, core 33/33, ui 66/66 across the suites that touch the new factory / store / docs / integration paths.
- UI verification: **skipped** — Phase 13 is server-side only (factory.ts hook + shared library + docs + CI env). No `.tsx` / widget / page / portal file changed.
- Known pre-existing failure (not introduced here): `yarn workspace @open-mercato/core typecheck` errors on `tsconfig.json(7,27): TS5103 Invalid value for '--ignoreDeprecations'`. Verified identical on `origin/develop`. Documented in `checkpoint-3-checks.md`; out of scope.

## 2026-05-25T11:25Z — spec complete
- Final validation gate: all green — build:packages ✓, generate ✓, i18n×2 ✓, typecheck ✓ (standalone retry on apps/mercato after parallel SIGHUP), test ✓ (6132 tests across 677 suites), build:app ✓.
- ds-guardian pass: clean.
- Self code-review + BC review: clean (every change ADDITIVE; one documented behavior addition for useGuardedMutation default 409 flash).
- `auto-review-pr` autofix subagent: APPROVE, zero blocking findings; one false-positive docs nit dismissed after verifying the referenced file exists.
- Comprehensive PR summary comment posted: https://github.com/open-mercato/open-mercato/pull/2055#issuecomment-4533881146
- PR body flipped: `Status: in-progress` → `Status: complete`, Phases 7–11 added to "What Changed", decision matrix markers updated to reflect all 3 reference entities landed, Tests section updated.
- Labels kept: `feature`, `review`, `needs-qa`. `in-progress` will be released as the next action. PR stays in `review` pipeline state.
- Resume run is finalized. PR #2055 awaits human review.

## 2026-05-28T15:30Z — auto-continue-pr-loop resume (QA #2055 fix cycle)
- Resumed by: @pkarw
- Resume point: appended Phase 15 (QA-fix increment) on top of the prior `complete` state (PR head `99c9f851c`).
- Trigger: `/auto-continue-pr-loop 2055 ... crm and sales fully + safely supported for OSS locks on delete and update ... fix alinadivante reported issues`.
- @alinadivante QA verdict (2026-05-27T22:11): flash showed raw `record_modified`; same-user-two-tabs company silently overwrote; people-v2 / deals / catalog products / sales.orders / sales channel delete unprotected.
- Diagnosis: flash already fixed (`f79cc3e7c`); CrudForm update paths already wired (`6c5956367`). Remaining real gaps = **custom non-CrudForm handlers** that omit the lock header on update/delete. Same-user-two-tabs = enterprise pessimistic lock artifact; OSS version-compare wiring (post-her-test) fixes it.

## 2026-05-28T16:05Z — checkpoint 4 (Phase 15: QA #2055 CRM + sales update/delete)
- Steps verified: 15.1..15.5 (SHA range 8c35339d5..5c9ceeeb0).
- Targeted validation: build:packages ✓, generate ✓, i18n:check-sync ✓ (4 locales, no new keys), core touched unit tests 9/9 ✓, root-tsc 6.0.3 typecheck ✓.
- Known env-only failures (pre-existing, not this change): workspace tsc 5.9.3 `ignoreDeprecations` TS5103; lint eslint-plugin-react `testReactVersion` crash. CI runs both clean.
- UI/Playwright: skipped locally (no Postgres/Redis/.env). DELETE enforcement covered by TC-LOCK-OSS-004 in CI ephemeral-integration; server delete-guard path is entity-agnostic (`factory.ts` runMutationGuards op:'delete').
- Deferred (documented in coverage-completion spec): sales.order document command endpoints (Phase 4) + nested panels (Phase 3).
- Code review: focused self-review + background code-review subagent on diff `99c9f851c..HEAD`.

## 2026-05-28T18:55Z — checkpoint 5 (Phases 16–17: command-level locking)
- Steps verified: 16.0, 16.1, 17.1–17.6 (SHA range 20b4ba3ff..d6448082e).
- New generalist helper `optimistic-lock-command.ts` (shared) + sales document-aggregate wiring (lines/adjustments/returns/convert). 57 shared + 5 sales-command unit tests green.
- Targeted validation: build:packages ✓, generate ✓ (no committed drift), shared typecheck ✓, core typecheck via turbo (root tsc 6.0.3) ✓.
- Design decision logged: payments/shipments keep their makeCrudRoute row-level guard (flat mapInput → candidateId set); lines/adjustments skip it (`{ body }` wrapping → candidateId null) so the doc-aggregate command check is their sole guard — no double-409. Quote convert closes the #2114 race.
- UI/Playwright skipped (no UI touched in 16–17). Phase 18 = client wiring; TC-LOCK-OSS-005 integration proof runs in CI.
- Merge conflict resolution (CHANGELOG + yarn.lock) landed `20b4ba3ff`; PR no longer DIRTY.

## 2026-05-28T19:12Z — Phases 18–20 complete (resume finalized)
- Phase 18 (`b2d94520f`): quote convert client sends the version header + 409 conflict flash/reload (closes #2114 end-to-end). Sales document-section client wiring deferred to #2215.
- Phase 19 (`d8dcee93c`): docs/specs — main spec §10, coverage-completion spec (Phase 4 partial), concurrency-locking.mdx "Protecting command/action endpoints", AGENTS.md Task Router, CHANGELOG.
- Phase 20: filed follow-up issue #2215 (extend command-level lock to catalog/workflows/staff/resources + finish sales doc UI client wiring + TC-LOCK-OSS-005). Final gate green for the locally-runnable subset (build:packages, generate, shared+core typecheck via turbo, 57 shared + 5 sales tests, i18n sync). build:app + integration suites → CI authoritative (no PG/Redis locally).
- Independent code-review subagent + self review: no blocker/should-fix findings. BC strictly additive. DS clean.
- PR stays `feature, qa, needs-qa`; in-progress lock released. Status remains `complete` (now 20 phases).
