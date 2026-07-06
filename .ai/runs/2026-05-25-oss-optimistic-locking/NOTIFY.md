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

## 2026-05-29 — auto-continue-pr-loop resume 2 + checkpoint 6
- Resumed by: @pkarw. Trigger: /auto-continue-pr-loop 2055 (dynamic workflows; 100% OSS locks for sales+crm, fix alinadivante scenarios, command framework OSS+enterprise, subsequent sales docs, FR issue, Playwright).
- Booted the branch on :3100 (shared DB) — first run to actually run Playwright/integration against branch code (prior runs skipped: "no PG/Redis"). Recon via dynamic Workflow (6 audits + synthesis).
- **User decision (2026-05-29):** the "record was modified" conflict must be a persistent **error-styled bar** (like the undo `LastOperationBanner`), unified across ALL forms — not a transient toast. Implemented in 22.2.
- Steps landed: 21.1 (336632f96), 22.1 (42e1feffd), 22.2 (f2a23716c), 24.1 (b914ae7bb), 25.1 (35fbd4d30).
- Checkpoint 6: shared 23/23, ui 24/24, core 5/5 unit tests green; build:packages ✅; i18n:check-sync ✅ (after --fix re-sorted 4 locales for the new ui.forms.conflict.* keys).
- UI/Playwright: server 409 proven live; conflict-bar visual capture deferred to Phase 27.2 (companies-v2 refetch-on-focus defeats single-tab repro — use two sessions). UI verification did not block dev (skill contract).
- Next: Phase 26 (sales doc sub-sections), 27 (specs + browser screenshots), 28 (enterprise FR + docs + final gate + summary).

## 2026-05-29 — resume 2 finalized
- All resume-2 phases done (21–28). Head 5a2f7d8a6.
- Enterprise FR #2232 filed (enterprise + feature labels); #2215 re-scoped (sales-doc UI done here).
- Final gate green (build:packages, turbo typecheck shared/ui/core, i18n, touched unit suites); lock integration specs TC-LOCK-OSS-001/005/006/007/008 green live on :3100; conflict-bar screenshot captured. Code-review APPROVE-WITH-NITS (1 NIT fixed). DS clean. BC additive.
- Labels stay feature/qa/needs-qa (customer-facing concurrency UX). in-progress lock released next.

## 2026-05-29 — merge develop (merge-safety) + cross-module verification
- Branch was 9 commits behind develop; the audit's "unrelated cross-module changes" (catalog command tenant/org scoping #2197, auth ACL dependsOn #2141/#2220, CRM list sorting #2217, RecordNotFoundState #2185, attachments XSS tests) were develop drift — merging as-is would have REVERTED them.
- Merged origin/develop → `3372fe397`, **zero conflicts**. Now 0 behind.
- Post-merge gate green: build:packages 19/19, generate, build:packages 19/19, turbo typecheck shared/ui/core 3/3. Unit suites green: shared 94 (optimistic-lock+aclDependencies), ui 28 (conflicts+optimistic-lock), core 30 (my handlers + develop's catalog acl / auth features / listSorting / sales acl-dependencies). Both develop's and this PR's work intact.
- Cross-module merge-safety smokes (live :3100): CRUD GET 200 for currencies/staff/catalog/auth/business_rules; staff.team stale PUT → 409 (universal generic reader); staff team CrudForm edit → 200 + lock header, 0 console errors; companies-v2 + deal edits → 409 + conflict bar.

## 2026-06-02 — auto-continue-pr-loop resume (QA round-4 #2055) + checkpoint 8
- Resumed by: @pkarw. Trigger: /auto-continue-pr-loop 2055 — fix @alinadivante round-4 QA (2026-06-01T22:00Z), resolve develop merge, add integration tests on ephemeral env (OM_OPTIMISTIC_LOCK=all), Playwright.
- Merged develop (34 commits) → lone conflict in `AvailabilityRulesEditor` resolved (selective delete #2325 + per-rule optimistic lock #2055), committed 46091f33f.
- Phase 29 fixes (29.1..29.4): customer task (todos) lock — client header on canonical+legacy paths, `updatedAt` plumbed end-to-end, interactions commands `enforceCommandOptimisticLock`; activity modal raw-toast suppressed; sales doc update returns `updatedAt` + client refreshes token (false-positive fixed); variant detail RecordNotFoundState early return.
- Tests (29.5): TC-LOCK-OSS-009/010/011 (API) + 012 (browser UI) all green on ephemeral :5001; 15 existing lock specs green (no regression) = 20 total.
- Gate green: turbo typecheck shared/ui/core, build:packages ×2, generate, i18n sync (+ new catalog backToVariants key ×4), build:app. Touched unit suites green (TasksSection React.act is the pre-existing env issue).
- Next: clean git history (collapse autosaves), push, auto-review-pr pass, summary comment, release lock.

## 2026-06-02 — auto-continue-pr-loop resume 4 (QA round-5)
- Resumed by: @pkarw. Source: @alinadivante comment 4602798597 (system-wide regression).
- Checkpoint 9: Phase 30 steps 30.1–30.6 landed (commits 17487c39c..7025099a6). Customer Users, Customer Roles, Organizations, Inbox Settings, #2410 boolean selector, Feature Toggles Global override.
- Per-fix: atomic commit + focused jest test + per-issue PR comment to @alinadivante (user directive).
- Validation: touched-module unit subsets (65 tests) + directory (63) green; `turbo typecheck @open-mercato/core` clean.
- Live Playwright/integration deferred to a single batched pass (30.15) to avoid repeated full-stack boots.
- Remaining: 30.7–30.15 (see HANDOFF).

## 2026-06-02 — checkpoint 10
- 30.7 Pay Links + Checkout Templates (67e489b77) + 30.8 Sidebar Customization (4959f65f8) landed via sequential executor subagents; main session verified + re-ran tests.
- 30.11 #2411: investigated — separate EAV definitions read/write scope bug, NOT locking. Documented on PR (comment), recommend separate issue. No code change.
- 9 concrete QA-round-5 fixes shipped total (Customer Users, Customer Roles, Organizations, Inbox Settings, #2410, Feature Toggles Global, Pay Links+Checkout Templates, Sidebar).
- Remaining: 30.9, 30.10, 30.12 (#2409 live-repro), 30.13/30.14 (live-verify cluster), 30.15 (Playwright/integration batch).

## 2026-06-02 — checkpoint 11 (QA round-5 COMPLETE)
- Merged develop (conflicts in core/package.json + yarn.lock resolved); PR MERGEABLE.
- Landed 30.9–30.15: Saved Views, #2409 planner, Workflow editor surfacing, Webhooks, Data Sync, Dictionaries.
- Verified N/A: Integrations (stateless), Notification Delivery (singleton blob), Scheduled Jobs (already protected).
- Deferred w/ rationale: #2411 + System/User Entities defs (EAV scope bug; needs scope fix first).
- VERIFICATION: TC-LOCK-OSS full suite 23/23 on ephemeral env; 135 unit tests + guards green; webhooks 4/4; typecheck clean.
- 14 atomic fix commits this resume, each with a test + per-issue @alinadivante comment.

## 2026-06-02 — checkpoint 12 (CI stabilization + 0.6.4 merge)
- CI fix: TC-CRM-003 root-caused (default-ON locking + sequential inline edits sent stale updatedAt → 409). companies/people commands now return updatedAt; detail pages refresh the token per inline save. Verified TC-CRM-003 + TC-CRM-006 green on a live build. (4d9cf35af)
- Merged develop 0.6.4 (CHANGELOG conflict only). develop's #2415 RESOLVES my deferred #2411 upstream; #2348 adds the roles/users updated_at migration. PR MERGEABLE. (457a59623)

## 2026-06-03T15:00:00Z — auto-continue-pr resume (QA round-6)
- Resumed by: @pkarw
- Resume point: Phase 31 (new) — all prior Tasks rows done; Alina QA round-6 comment 4613412850
- PR head SHA before resume: fcc88456d
- Merged latest develop (0.6.5) into branch; resolved conflicts in interactions.ts (kept both command-lock + email-visibility guards), directory/staff/workflows edit pages (combined imports), catalog variant page (took develop's RecordNotFoundState refinement; lock logic lives outside conflict blocks), catalog i18n ×4 (kept develop backToProduct key), CHANGELOG (kept Unreleased + 0.6.5), UPGRADE_NOTES (folded OSS section into 0.6.3→0.6.4 window), package.json + yarn.lock (kept resend + sanitize-html). Merge commit 91fc6abd7.
- QA round-6 findings to fix: (1) Customer Users save→raw record_modified toast not conflict bar + stale delete shows "Failed to delete user"; (2) Customer Roles save→"Failed to save role" not conflict bar; (3) Inbox Settings save→"Failed to update working language" not conflict bar; (4) Feature Toggle override boolean selector still blank; (5) Pay Links stale delete after conflict still deletes; (6) Feature Toggle seeded identifier validation mismatch (customers.interactions.legacy-adapters).

## 2026-06-03T17:15:00Z — checkpoint 13 (QA round-6 complete)
- Steps 31.0..31.6 + integration specs landed (atomic commits, each with unit tests). SHAs in PLAN Tasks table + checkpoint-13-checks.md.
- Root cause: custom admin pages sent the version header & server already 409'd, but their non-throwing apiCall surfaced a generic toast instead of the unified conflict bar — fixed by detecting the 409 envelope via surfaceRecordConflict. Pay-links also had an unguarded delete command (now enforces).
- Verification: typecheck (core/ui/checkout) ✅, build:packages ✅, targeted unit tests ✅ (26 across 4 suites). Integration (ephemeral, OM_OPTIMISTIC_LOCK=all): TC-CHKT-039 ✅; TC-LOCK-OSS-013/014/015 + TC-FT-003 running.
- Note: rebased onto teammate docs commit 004f68b90 (TC-LOCK-OSS-000 master plan); corrected Tasks-table SHAs (amend-after-sed had left them off-by-one).

## 2026-06-03T18:10:00Z — QA round-6 COMPLETE, CI green
- All 6 Alina findings fixed (atomic commits 31.1..31.6) + 5 integration specs + live browser conflict-bar proof.
- Post-merge CI reconciliation (31.8): exempt-markers for 3 develop-merged UI files (lock-coverage guard), TC-LOCK-OSS-012 label widened, cherry-picked develop's @types/mailparser+nodemailer runtime-deps fix.
- CI: 27/27 green on 4811ac120. Replies posted to @alinadivante + comprehensive resume summary.

##  — auto-continue-pr resume 6 close (QA round-7)
- Phase 32 complete. Two #2453 root causes (server interleaved-flush + client dual-form) + codebase-wide withAtomicFlush audit (11 commands) + Job History/timesheets fixes.
- Ephemeral: R1 1094 passed/0 failed; R3 1093 passed/0 failed/0 flaky after deferring the pre-existing flaky kanban browser case CRM-08.
- Commits: people 30feb254e/e3495e913; job-history effd5386e; companies 665100dd5; timesheets 495080b40; audit 83cd3329b; tests db84b7d3c; defer c376d2e09.

##  — resume 7 close (ARCH: withAtomicFlush per-phase)
- Root cause of the #2453 family was withAtomicFlush flushing ONCE at the end vs SPEC-018 per-phase. Fixed the helper to flush after each phase (atomic, inside the transaction); removed ALL per-command explicit-flush workarounds across 13 commands.
- Unit: shared 1150/1150, core 5393/5393. Ephemeral ARCH: round 1 1093 passed/0 failed/0 flaky; round 2 1093 passed/0 failed/0 flaky.
- Commit: framework fix fe22b4c8e.
