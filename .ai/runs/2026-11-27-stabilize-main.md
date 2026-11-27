# Stabilize main — 2026-11-27

## Goal
Verify main and a dedicated stabilization PR with all 15 integration shards, fix proven root causes, and apply `automerge` only after green CI and independent review.

## Scope
Start from main at 086af58a119c1537f642ed63f34f6dbbb1110d6b. Its latest CI run 45902565906 passed every executed job, including all 15 shards. Existing `FORCE_FULL_SUITE` already supports same-repository stabilization heads and `ci-full`. Draft gating currently prevents this requested draft PR from executing that suite. Permit same-repository stabilization draft PRs to run CI, preserving ordinary draft and fork behavior.

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
Full-suite CI is expensive and asynchronous. No application defect is established at the initial main head. Draft exception must remain restricted to same-repository stabilization heads. Local dependencies are initially absent; record any local environment blockers without treating them as passes. Main snapshot release is a separate workflow, initially still running.

## Current stabilization baseline and repairs
Merged current main at 831c65eb7d via 4f35084745 without rewriting history. Main CI 46003897356 at 4284e78548 exposed two confirmed failures: onboarding's setup-container fixture lacked the EntityManager detachment and lease result contracts, and catalog form tests still rejected prices beyond the obsolete 12-integer/4-fraction limits. The existing arbitrary-precision spec explicitly preserves entered catalog amounts. Repair only the fixtures and assertions: prove detachment precedes provisioning, lease completion succeeds, exact amount strings reach create/update, and malformed, negative and oversized values remain rejected. The complete local unit gate additionally exposed a rotation fixture that still expected empty-envelope rejection after the documented #10849 fix. It now verifies both empty/nonempty authenticated round trips and wrong-key rejection (19b3bc4de2). No production behavior or public contract changes are needed.

Source doc: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
Source doc: .ai/specs/2026-09-30-encryption-key-rotation-hardening.md

## Validation evidence
Runner: local (no running compose app found). Immutable install completed with optional native-build warnings. Focused draft/full-scope/concurrency/merge-coverage/batch tests: 77 passed. Onboarding suite: 26 suites / 172 tests passed. Catalog form/page regression tests: 2 suites / 41 tests passed in both the default timezone and Pacific/Auckland. AES/rotation regression tests: 3 suites / 30 tests passed. Configured gate running in order against the updated baseline. Original head 433f6908a5 passed all 15 integration shards in run 45964194589; that does not substitute for CI on the updated head.

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

The independent investigator 3baae04c never started: the cockpit rejected its restricted tool grant. The driver independently retrieved main job logs and reproduced the failures locally; no child code was accepted or merged. One final review task remains reserved.
- [x] 1.2 Add a narrow stabilization draft exception with executable regression coverage. — f0fb11f6f3

### Phase 2: Validate and repair

- [ ] 2.1 Run configured validation in order and the PR's full 15-shard suite; fix confirmed causes and repeat as needed.

### Phase 3: Independent review and handoff

- [ ] 3.1 Dispatch one final read-only cezar review using om-auto-review-pr, validate its verdict, and address findings.
- [ ] 3.2 Publish verification, release the claim, mark ready, and add automerge after green exact-head CI.
