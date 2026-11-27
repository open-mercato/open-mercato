# Stabilize main — 2026-11-27

## Goal
Verify main and a dedicated stabilization PR with all 15 integration shards, fix proven root causes, and apply `automerge` only after green CI and independent review.

## Scope
Start from main at 086af58a119c1537f642ed63f34f6dbbb1110d6b. Its latest CI run 45902565906 passed every executed job, including all 15 shards. Existing `FORCE_FULL_SUITE` already supports same-repository stabilization heads and `ci-full`. Draft gating currently prevents this requested draft PR from executing that suite. Permit same-repository stabilization draft PRs to run CI, preserving ordinary draft and fork behavior.

## Final review scope
Main PR #10899 landed independently as 26585de7ef while the final review was being dispatched. Reconcile that already-landed baseline and retain its fixture/audit fixes and context budgets without duplicate PR deltas. The remaining seven-file diff is the same-repository stabilization draft exception, native price-input synchronization with regression coverage, saved-activity reload/locator repair, workflow regression tests, and this plan. The earlier broad repair notes below are investigation history, not additional changes in the final diff. Retain main's cancellation behavior for durability artifact upload.

## Non-goals
No release dispatch, merging into main, dependency upgrades, production changes, database migrations, unrelated cleanup, or speculative application fixes.

## Implementation Plan
### Phase 1: Establish evidence and enable draft stabilization CI
1.1 Inspect recent main workflows independently and record confirmed failures or green baseline.
1.2 Add a narrow stabilization draft exception with executable regression coverage.
### Phase 2: Validate and repair
2.1 Run configured validation in order and the PR's full 15-shard suite; fix confirmed causes and repeat as needed.
### Phase 3: Independent review and handoff
3.1 Dispatch one final read-only cezar review using om-auto-review-pr, validate its verdict, and address findings.
3.2 Publish verification, release the claim, mark ready, and add automerge after green exact-head CI.

## Delegation
One independent read-only main CI investigation; one final independent review after implementation. The draft exception and any resulting CI repair remain together in this worktree because they share validation and branch state. Maximum two subtasks.

## Risks
Full-suite CI is expensive and asynchronous. The real catalog money-entry UI change requires human QA (`needs-qa`, `risk-high`); automated browser evidence does not waive that merge gate. No application defect is established at the initial main head. Draft exception must remain restricted to same-repository stabilization heads. Local dependencies are initially absent; record any local environment blockers without treating them as passes. Main snapshot release is a separate workflow, initially still running.

## Current stabilization baseline and repairs
Merged main at 831c65eb7d via 4f35084745, then the exact main baseline used by CI (adb16f62b3) via ee818c2316, without rewriting history. The second baseline contains the newly landed ledger module; shard 9 exposed two denied-role fixtures using 10-character passwords below the current 12-character policy. Lengthen their setup/login passwords while preserving the actual permission-denial assertions (70b49a03cf). A scoped scan found no remaining 8–11-character password literals in core/enterprise integration specs. Main CI 46003897356 at 4284e78548 exposed two confirmed failures: onboarding's setup-container fixture lacked the EntityManager detachment and lease result contracts, and catalog form tests still rejected prices beyond the obsolete 12-integer/4-fraction limits. The existing arbitrary-precision spec explicitly preserves entered catalog amounts. Repair only the fixtures and assertions: prove detachment precedes provisioning, lease completion succeeds, exact amount strings reach create/update, and malformed, negative and oversized values remain rejected. The complete local unit gate additionally exposed a rotation fixture that still expected empty-envelope rejection after the documented #10849 fix. It now verifies both empty/nonempty authenticated round trips and wrong-key rejection (19b3bc4de2). Main integration artifacts confirmed additional fixture drift: the Enterprise profile test lacked `security.profile.password`, and channel/translation operator fixtures used a password below the current 12-character minimum. Correct those fixtures (1324452491), including the last identical assisted-selling fixture found by a scoped scan. The schedule-time picker trace showed a successful 15:00 save followed by an immediate click on the stale 08:00 row before the asynchronous refresh; reload before reopening to verify backend persistence without racing that refresh. Most failures are executable fixture repairs. Full PR artifacts additionally exposed a real catalog input defect: native rapid typing could drop leading digits, and a neighboring price draft could overwrite a previous input before the parent rerendered. Preserve native input synchronously using the existing variant-editor pattern and retain pending variant prices in a ref. A component regression exercises native input events and neighboring price kinds without a parent rerender; integration coverage asserts both entered amounts survive and persist. Public contracts remain unchanged.

Source doc: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
Source doc: .ai/specs/2026-09-30-encryption-key-rotation-hardening.md

The next full unit gate exposed an incomplete bootstrap-cache MikroORM mock; preserve real ORM exports alongside its RequestContext override (f97bb2f2c1). The standalone initial-context guard was 82 bytes above its unchanged 72 KiB limit. Copyedit the two matching root instruction templates, retaining pinned contract, UI routing and deployment safety rules; the complete 180-test focused harness suite passes with 73,724 bytes. The schedule locator now targets the actual activity button, whose label includes its saved duration. Staff cold-scope tests assumed a duplicate request after server-known scope settlement, which now correctly avoids a no-op scope change. Explicitly refocus a stale query using the browser clock, and retain the real second GET plus draft/persistence assertions. All 24 staff cases pass locally.

## Validation evidence
Runner: local (no running compose app found). Immutable install completed with optional native-build warnings. Focused draft/full-scope/concurrency/merge-coverage/batch tests: 77 passed. Onboarding suite: 26 suites / 172 tests passed. Catalog form/page regression tests: 2 suites / 41 tests passed in both the default timezone and Pacific/Auckland. AES/rotation regression tests: 3 suites / 30 tests passed. All repository-wide guards passed (51 test files). Configured gate running in order against the updated baseline. Local infrastructure adjustments: pass `TURBO_ENV_MODE=loose` with a short task-local `TMPDIR` so subprocess TSX sockets stay within Unix path limits; host disk pressure requires placing this task's disposable Jest and Next cache outputs on `/dev/shm` (normal app build output remains in the worktree). No repository runner or validation command is changed. Repository-wide Playwright discovery was CPU-bound before execution. A temporary focused config uses the existing specs and shared timeouts, retries and worker count against the native ephemeral app. The 31-case batch passed 30 cases (all 24 staff cases, saved time, and five catalog cases); one catalog case timed out at navigation readiness before its assertions and is being rerun unchanged. Native price input/component coverage passes (42 focused price tests); all 180 standalone harness tests pass. The full ordered gate and final exact-head CI remain pending. Original head 433f6908a5 passed all 15 integration shards in run 45964194589; that does not substitute for CI on the updated head.

The complete local gate initially passed 50 of 51 test workspaces; create-app additionally required its exact pinned infrastructure-provider phrase. Restore that phrase without raising any budget (4afefa0a82): all 33 instruction-contract/budget checks pass on the new baseline. Other local retries hit host disk exhaustion and an obsolete task-local dependency symlink above resolver fixtures. Remove that link and isolate temporary files/npm cache in memory; all 73 affected CLI tests pass unchanged. The configured gate is restarting on the ledger baseline. CI run 46026625168 passed 13 integration shards, with shard 9 blocked only by the repaired ledger fixtures and shard 1 completing its additional auth-rate checks. Its unit failure is only the repaired provider phrase; timezone, lint, Docker and multi-instance document checks passed. These results do not substitute for the final head.

CI's separate script suite on 5d56b0864b found another concrete workflow regression: the newly landed webhook durability setup, execution and artifact-upload steps used `!cancelled()`/`always()` without checking the failed audit gate. Add the same audit outcome condition used by neighboring steps (1407f520fe). The semantic regression confirms failed-audit denial and preserves ordinary-failure/cancellation evidence; all 79 focused workflow tests pass. Shard 9 now passes, confirming the ledger fixtures.

Before the independent main merge, the complete configured local gate passed all eight commands at a3a7d8f73a, in order: build packages, generate, rebuild packages, translation sync/usage, typecheck, all 51 test workspaces, and production app build. The failed unit command was rerun under the short `/tmp` directory before the app build; no assertion or sandbox policy was weakened. The app build completed successfully in 150 seconds. A nonfatal cache compaction warning did not change its exit status. The reconciled baseline is receiving a fresh ordered gate and full CI; the already-dispatched independent reviewer will assess that exact resolved head. Final exact-head CI and independent review remain pending.

## Run identity
Claim-Run: 48d644e3-9ed1-4059-a436-23d9b0aad094
Claim-Lock-SHA: 7f1e98a080e27d83670e0539b4be50092247c6e2
Recovered stopped drivers f7e6e045 and 02bdcafd after the operator renewed autonomous continuation; recovery audit is on PR #10850.
Branch: stabilize/main-2026-11-27 (explicit operator override of skill branch prefix)
Engine: om-auto-create-pr (steps: 5, --loop: no)

## Progress
PR: #10850

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish evidence and enable draft stabilization CI

- [x] 1.1 Inspect recent main workflows independently and record confirmed failures or green baseline. — 4f35084745

The independent investigator 3baae04c never started: the cockpit rejected its restricted tool grant. The driver independently retrieved main job logs and reproduced the failures locally; no child code was accepted or merged. The reserved final review completed with approval; see Step3.1.
- [x] 1.2 Add a narrow stabilization draft exception with executable regression coverage. — f0fb11f6f3

### Phase 2: Validate and repair

- [x] 2.1 Run configured validation in order and the PR's full 15-shard suite; fix confirmed causes and repeat as needed. — 690958d38a

### Phase 3: Independent review and handoff

- [x] 3.1 Dispatch one final read-only cezar review using om-auto-review-pr, validate its verdict, and address findings. — 690958d38a
- [ ] 3.2 Publish verification, release the claim, mark ready, and add automerge after green exact-head CI.

Independent review task d9c429ed approved all seven net files at 690958d38a against main26585de7ef, with no findings. Driver verified the report, exact ancestry, diff checks and zero child source changes. [Authoritative native review](https://github.com/open-mercato/open-mercato/pull/10850#issuecomment-7223838578). GitHub rejected App self-approval with HTTP422; no host approving review exists and no credentials or gates were bypassed. [Human QA instructions](https://github.com/open-mercato/open-mercato/pull/10850#issuecomment-7223853899). The refreshed eight-command local gate passed on690958d38a, and full CI46037346639 passed all15shards plus merged coverage. All reported checks settled green before automerge was applied.

Final source verification: [CI46037346639](https://github.com/open-mercato/open-mercato/actions/runs/46037346639) passed all15integration shards, merge-coverage, unit tests, timezone, Docker, documents and lint on the independently reviewed690958d38a. Every exact-head workflow settled successfully or intentionally skipped. The automerge label was applied only after verifying that state. Any subsequent commits are execution-plan progress only; their CI is still checked before this task finishes. Human QA and a host approving review remain merge gates.
