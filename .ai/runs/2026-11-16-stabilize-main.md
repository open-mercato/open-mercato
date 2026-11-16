# Stabilize main — 2026-11-16

## Goal

Verify main and a dedicated full-suite stabilization PR, repair demonstrated root causes, and request automerge only after green checks and independent review.

## Scope

Branch: `stabilize/main-2026-11-16`, based on main `08dada96243eeaf690d00314f18844a12382ab1c`. Target: `main`.

Initial evidence: main CI run 43754619963 and Main Snapshot Release run 43754619938 both succeeded. All 15 integration shards passed. The existing workflow already forces the full suite for trusted stabilization branches and `ci-full` labels, including unfiltered unit tests and typecheck. Preserve it unless a defect is demonstrated.

Non-goals: speculative fixes, duplicate workflow changes, public contract or dependency changes, taking over older stabilization PRs, merging into main.

## Implementation Plan

### Phase 1: Audit and scope

1.1 Independently audit main's exact-head workflow results and full-suite selection.
1.2 Record findings and implement only demonstrated root-cause repairs with regression coverage.

### Phase 2: Verify and review

2.1 Verify this draft PR's full 15-shard suite and fix any demonstrated failures.
2.2 Dispatch one final independent review task after implementation and address its findings.
2.3 Record evidence, complete the PR, and apply automerge only after exact-head checks and workflows pass.

## Execution decisions

The explicit operator branch name and requirement to wait for green CI override the skill's default branch prefix and no-wait reporting rule. Reuse this isolated linked worktree; no additional parent worktree is created. Use at most two cezar tasks: a read-only baseline audit and a final independent review. Implementation and root-cause fixes stay together in the parent because they depend on the same CI evidence. Merge no unreviewed child changes.

For this initial documentation-only diff, use manual diff review and `git diff --check`; no Markdown lint command is configured. Any code fixes require targeted regression tests and the configured full validation gate. CI is the executable evidence for the requested full-suite run. Do not treat pending workflows, intentional skips, or earlier green SHAs as current-head success.

## Verification evidence

- [Baseline CI](https://github.com/open-mercato/open-mercato/actions/runs/43754619963) and [Main Snapshot Release](https://github.com/open-mercato/open-mercato/actions/runs/43754619938) succeeded at the exact baseline SHA. All 15 integration shards, coverage merge, snapshot publication and standalone integration passed.
- The independent read-only audit confirmed those outcomes, existing full-suite selection and PR concurrency isolation. Its branch has no diff; no child changes were merged. The parent independently checked the run results and reran its cited test command.
- [First PR CI](https://github.com/open-mercato/open-mercato/actions/runs/43773317414) succeeded at `4c9d673e687ce87210fe50f958c18a9a1ed7b18d`: all 15 integration shards, coverage merge and every applicable job passed. Dependency audit was intentionally skipped by its existing scope gate. Exact-head Actions inventory shows no failed or unfinished workflows.
- Runner: local for `timeout 30 node --test scripts/__tests__/ci-full-label.test.mjs` (25 passed, zero failures/skips), manual review and `git diff --check`. Runner: GitHub CI for executable validation. This change remains documentation-only; no Markdown lint command is configured, and local package builds are unnecessary for this diff.
- Required-status-check configuration returned HTTP 404; conservatively treat every reported check as required. Pending workflows still block completion even before their checks appear.

- [Second PR CI](https://github.com/open-mercato/open-mercato/actions/runs/43779949008) succeeded on `8468cc310b857ac6cbde0bd98b8cf81140fde85e`: all 15 shards and coverage merge passed. The configured package build/generate/rebuild, i18n, unfiltered typecheck/tests and application build steps all succeeded.
- [Final independent review](https://github.com/open-mercato/open-mercato/pull/9635#pullrequestreview-5914012928) approved that exact head with no findings. GitHub rejected the author App's native approval (HTTP 422); the transparent COMMENT review records the independent verdict and does not satisfy a native approval requirement. A distinct authorized identity must provide any approval required by branch protection. The reviewer made no source edits or commits and released its owned claim; no child branch was merged.

No demonstrated root cause remains to repair. This final progress update adds only reviewed verification results and completion bookkeeping; it requires fresh exact-head CI. Record that final CI outcome and tracker promotion on the PR, avoiding another evidence-only push.

## Finalization gate

The implementation and independent review are complete. The checklist closes the recorded work, while tracker `Status: in-progress`, draft state and withholding `automerge` remain mandatory until this bookkeeping commit's exact-head workflows and checks pass. Only then mark the PR ready, set tracker status complete and apply `automerge`. The prior green SHAs do not certify a later head, and the independent COMMENT verdict never waives native approval requirements. No merge into main is performed by this run.

## Risks

Fresh CI can expose nondeterministic failures despite the green baseline. Check workflow runs and check results for the exact PR head before adding automerge. Every push invalidates prior CI evidence; final tracker evidence should avoid unnecessary bookkeeping pushes. Existing stabilization PRs remain independently owned.

## Progress

PR: #9635

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Audit and scope

- [x] 1.1 Independently audit main's exact-head workflow results and full-suite selection. — 4c9d673e68
- [x] 1.2 Record findings and implement only demonstrated root-cause repairs with regression coverage. — 4c9d673e68

### Phase 2: Verify and review

- [x] 2.1 Verify this draft PR's full 15-shard suite and fix any demonstrated failures. — 4c9d673e68
- [x] 2.2 Dispatch one final independent review task after implementation and address its findings. — 8468cc310b
- [x] 2.3 Record evidence, complete the PR, and apply automerge only after exact-head checks and workflows pass. (Tracker promotion is gated as described above.)
