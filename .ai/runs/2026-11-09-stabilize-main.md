# Stabilize main — 2026-11-09

## Goal

Verify main with the full CI suite on an isolated stabilization PR, fix demonstrated root causes, and apply `automerge` only after green CI and independent review.

## Scope

Branch: `stabilize/main-2026-11-09`, based on `main` at `3e5aadf0fb29a66a0f3b8e0d50d1c9159b378afc`. The explicit branch name and CI monitoring requirement override the skill's default branch prefix and no-wait reporting policy.

The existing workflow already supports `ci-full` and same-repository `stabilize/*` branches, including all 15 integration shards and unfiltered unit/type checks. Preserve that implementation unless verification demonstrates a defect.

Non-goals: unrelated refactors, suppressing tests, weakening gates, production changes, or merging the PR.

Source doc: `.ai/specs/implemented/2026-04-10-ci-cd-performance.md`

## Implementation Plan

### Phase 1: Diagnose and verify scope

1.1 Independently investigate recent main failures and whether fixes already landed. Dispatch one read-only investigation task; reserve the second and final subtask for final review.

1.2 Verify existing full-suite selection, record diagnosis, and implement only demonstrated remaining defects with regression coverage.

### Phase 2: Validate and review

2.1 Run the applicable validation gate and the PR's full CI suite; fix root causes until all applicable checks pass.

2.2 Dispatch one final independent review using `cez task create --kind review --review-of stabilize/main-2026-11-09`, validate its evidence, and address findings before completion.

2.3 Publish final evidence, mark ready, and apply `automerge` only after successful checks and review.

## Risks

- Main's latest full CI is already green: https://github.com/open-mercato/open-mercato/actions/runs/42633763976. The preceding run failed integration shard 10/15: https://github.com/open-mercato/open-mercato/actions/runs/42628912043. Do not invent corrective changes if investigation confirms resolution.
- Hosted checks may reveal flakes or infrastructure failures; distinguish those from product defects and preserve failure evidence.
- Adding `ci-full` does not itself schedule a run; the stabilization branch selects the full suite on the initial PR event and subsequent pushes.
- No UI changes are planned. A documentation-only outcome uses the skill's docs-only validation exemption; any code changes require the configured full ordered gate.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and verify scope

- [ ] 1.1 Independently investigate recent main failures and whether fixes already landed
- [ ] 1.2 Verify existing full-suite selection and address demonstrated remaining defects

### Phase 2: Validate and review

- [ ] 2.1 Run applicable validation and full PR CI until green
- [ ] 2.2 Complete final independent review and address findings
- [ ] 2.3 Publish evidence, mark ready, and apply automerge
