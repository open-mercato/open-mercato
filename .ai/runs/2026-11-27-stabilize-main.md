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

## Run identity
Claim-Run: f7e6e045-1806-46ec-a606-995a29704b04
Branch: stabilize/main-2026-11-27 (explicit operator override of skill branch prefix)
Engine: om-auto-create-pr (steps: 5, --loop: no)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish evidence and enable draft stabilization CI

- [ ] 1.1 Inspect recent main workflows independently and record confirmed failures or green baseline.
- [ ] 1.2 Add a narrow stabilization draft exception with executable regression coverage.

### Phase 2: Validate and repair

- [ ] 2.1 Run configured validation in order and the PR's full 15-shard suite; fix confirmed causes and repeat as needed.

### Phase 3: Independent review and handoff

- [ ] 3.1 Dispatch one final read-only cezar review using om-auto-review-pr, validate its verdict, and address findings.
- [ ] 3.2 Publish verification, release the claim, mark ready, and add automerge after green exact-head CI.
