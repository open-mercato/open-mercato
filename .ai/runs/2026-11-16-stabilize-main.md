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

No demonstrated root cause remains to repair. Subsequent bookkeeping commits require fresh exact-head CI. Record final workflow and independent-review evidence on the PR to avoid another evidence-only push.

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
- [ ] 2.2 Dispatch one final independent review task after implementation and address its findings.
- [ ] 2.3 Record evidence, complete the PR, and apply automerge only after exact-head checks and workflows pass.
