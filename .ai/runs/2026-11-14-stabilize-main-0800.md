# Stabilize main — scheduled 2026-11-14 08:00

## Goal

Fix demonstrated main CI failures on one dedicated draft PR, verify its complete suite, and request automerge after independent final review and green checks.

## Scope

Base: `main` at `b4c8a32aa3dd8a680f357a853fc51f8db82a155d`.
Branch: `stabilize/main-2026-11-14-0800`.
Claim run: `aeb3eaf7-172b-4754-9f16-85c319f14ce9`.

The exact dated branch and plan belong to already-merged PR #9497; this scheduled occurrence uses the `0800` suffix to preserve those artifacts. Main CI [43561774996](https://github.com/open-mercato/open-mercato/actions/runs/43561774996) fails app TypeScript compilation: `ComboboxInput` references an undeclared `id` and rejects existing callers' `id` props. Existing CI already forces all 15 shards for trusted stabilization branches or `ci-full`; preserve that behavior and its PR concurrency group.

Non-goals: unrelated cleanup, public contract removals, production changes, migrations, merging into main, or speculative fixes.

## Implementation Plan

### Phase 1: Evidence and visibility

1.1 Commit this plan and open the draft stabilization PR.
1.2 Dispatch one independent read-only investigation of current main failures and existing full-suite safeguards.

### Phase 2: Fix and verify

2.1 Correct demonstrated build/test regressions with focused regression coverage.
2.2 Run the configured ordered validation gate and all applicable PR CI checks, including all 15 integration shards; fix further demonstrated failures on this branch.

### Phase 3: Review and handoff

3.1 Dispatch exactly one final review task using `om-auto-review-pr` and `om-code-review`; validate its report and address actionable findings.
3.2 Record evidence, promote the draft, and apply `automerge` only after current-head CI and independent review approve.

## Risks

- The build currently prevents downstream test jobs from starting; additional failures may emerge after it is repaired.
- Main can advance while CI runs; PR-ref concurrency keeps those pushes from cancelling this suite.
- A full-suite pass and review approval must refer to this PR's actual final source head. Pending or skipped prerequisite-dependent jobs do not prove success.
- Local dependency/build limitations must be recorded explicitly; GitHub evidence remains necessary before automerge.

## Validation

Configured gate: `yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`. Choose and record the local/Docker runner before execution. PR CI must additionally run all 15 shards and every applicable reported check. Existing full-suite regression tests exercise the workflow override. Independent review uses GitHub checks first per repo policy.

## Evidence

- Read-only audit task: `aed722e9-eb86-46f0-9cf8-2df9ff1ad3b1`. No child edits will be merged. Final review is reserved as the second and last subtask.
- Runner: local. No compose development override files or running app container were found; the standard development compose file fails interpolation without local secrets. Immutable installation completed with optional native-binding warnings.

## Progress

PR: #9512

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Evidence and visibility

- [x] 1.1 Commit this plan and open the draft stabilization PR — 81b76c2bd4
- [x] 1.2 Dispatch one independent read-only investigation of current main failures and existing full-suite safeguards — 81b76c2bd4

### Phase 2: Fix and verify

- [ ] 2.1 Correct demonstrated build/test regressions with focused regression coverage
- [ ] 2.2 Run the configured ordered validation gate and all applicable PR CI checks

### Phase 3: Review and handoff

- [ ] 3.1 Dispatch exactly one final review task using om-auto-review-pr and om-code-review
- [ ] 3.2 Record evidence, promote the draft, and apply automerge after current-head CI and review approve
