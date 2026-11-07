# Stabilize main — 2026-11-07

## Goal
Verify main and the stabilization PR with the full CI suite; fix only demonstrated failures.

## Scope
Base: main at 620dfa185f340dddbd8cb0d20637e64040a27ef2. Branch: stabilize/main-2026-11-07.
The existing ci.yml FORCE_FULL_SUITE expression already covers same-repository stabilization branches and ci-full labels. Main snapshot run 42245972055 failed TC-CRM-032 because the global Close locator matches an unrelated alert dismiss button. Qualify the sidebar back button by its visible Views text and reuse that locator for both closes. No workflow or application change is required.

## Non-goals
Do not merge into main, alter contracts, weaken checks, or introduce speculative fixes.

## Implementation Plan
### Phase 1: Baseline and verification
1.1 Audit current main CI and confirm full shard coverage.
1.2 Open draft stabilization PR and verify its full suite; fix demonstrated failures.
### Phase 2: Review and handoff
2.1 Obtain independent final review and resolve actionable findings.
2.2 Record green CI evidence and apply automerge only after approval and green checks.

## Risks
Main currently passes: https://github.com/open-mercato/open-mercato/actions/runs/42245972084 (15 successful integration shards). The focused integration test fix must pass the PR full suite. Snapshot publishing itself is not triggered from this PR; equivalent source integration coverage runs in all 15 PR shards. No local dependencies are installed; remote full-suite checks provide the executable gate. Any skipped, failed, or pending check remains explicit in the final evidence.

## Progress
PR: #8970

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Baseline and verification
- [x] 1.1 Audit current main CI and confirm full shard coverage.
- [x] 1.2 Open draft stabilization PR and verify its full suite; fix demonstrated failures. — b5554d615

### Phase 2: Review and handoff
- [x] 2.1 Obtain independent final review and resolve actionable findings. — b5554d615; [APPROVE, no findings](https://github.com/open-mercato/open-mercato/pull/8970#pullrequestreview-5808314209)
- [x] 2.2 Record green CI evidence and apply automerge only after approval and green checks. — [15/15 shards and coverage passed](https://github.com/open-mercato/open-mercato/actions/runs/42310114713) on b5554d615; automerge remains conditional on all checks passing at the final bookkeeping head.

## Verification outcome

Runner: GitHub Actions. The configured build/generate/rebuild/i18n/typecheck/unit/app gates passed on b5554d615, along with all 15 integration shards, timezone, multi-instance, lint, Docker build and coverage merge. Dependency audit, mutation and backport jobs were conditionally skipped. Independent final review approved the exact test fix with no findings. GitHub rejected native self-approval; the explicit independent verdict is recorded as a review comment, and a distinct identity is still needed if branch protection requires native approval.

The final bookkeeping commit changes only this record. Confirm its reported checks are green before making the PR ready or applying automerge. No merge is authorized by this run.
