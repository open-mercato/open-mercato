# Stabilize main — follow-up scheduled run

## Goal
Diagnose current main CI and obtain green full-suite PR evidence for minimal root-cause fixes.

## Scope
Audit current CI runs, fix demonstrated failures, and exercise all 15 shards using the existing ci-full override.

## Non-goals
No speculative changes, production changes, or merging into main. The requested branch name belongs to already-merged PR #8657, so use stabilize/main-2026-11-04-v2 without rewriting its history.

## Implementation Plan
### Phase 1: Diagnose
1.1 Independently audit main failures and verify full-suite routing.
### Phase 2: Stabilize
2.1 Fix demonstrated root causes and run full PR CI.
### Phase 3: Review
3.1 Dispatch one final independent review and apply automerge only when green.

## Risks
Hosted runner queues may delay full-suite evidence. Current latest main CI is pending; do not infer defects from incomplete runs.

## Progress
PR: #8702

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose
- [x] 1.1 Independently audit main failures and verify full-suite routing. — 03d30d4c29; audit afaad41a

### Phase 2: Stabilize
- [x] 2.1 Fix demonstrated root causes and run full PR CI. — 03d30d4c29; full CI 41863667128 passed, no current defect demonstrated.

### Phase 3: Review
- [x] 3.1 Dispatch one final independent review and apply automerge only when green. — fe7034239f approved by final review 55751e84; automerge remains conditional on green final-head checks, to be recorded in the PR outcome comment.

## Diagnosis and validation evidence

- Independent audit afaad41a made no changes; its branch adds no diff and needs no merge.
- Main CI https://github.com/open-mercato/open-mercato/actions/runs/41859661310 passed at 0822b5d5fd, the base of this branch.
- Snapshot Release https://github.com/open-mercato/open-mercato/actions/runs/41848322869 passed at 673c22ad09; the audit reported 2,826 standalone tests passed.
- PR full CI https://github.com/open-mercato/open-mercato/actions/runs/41863667128 passed at 03d30d4c29. Independently checked exactly 15 successful integration shards plus passing build, unit, lint, timezone, multi-instance and coverage jobs. Other reported PR checks passed or intentionally skipped.
- The ci-full event trigger, concurrency handling and full-shard selection already exist in .github/workflows/ci.yml; duplicating them is unnecessary.
- Historical credential reload and mobile progress overflow fixes shipped in merged PR #8657. No current failure justifies another source change. Zero-job cancelled runs are not evidence of test failures.
- Validation source: GitHub checks. This diff only records the execution plan and evidence; no configured Markdown lint command was found in the root package scripts. Manual diff review and git diff --check apply to this documentation-only run. Final independent review approved fe7034239f with no findings: https://github.com/open-mercato/open-mercato/pull/8702#issuecomment-6638220987. GitHub rejected formal self-approval; a distinct GitHub reviewer may still be required by branch protection.

## Final handoff

All implementation and independent review work is complete. This final documentation-only commit records the review; its own full CI must pass before applying automerge. The PR outcome comment will record final-head CI and label application without generating another bookkeeping commit. No branch or PR was merged by this run.
