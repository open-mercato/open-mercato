# Stabilize main — 2026-11-13

## Goal

Verify main with an isolated full-suite PR, fix any reproduced CI failures at their root cause, and request automerge only after green checks and an independent final review.

## Scope

- Base: `main` at `149839452c243586d24e6bbf122d7049d25acf8a`.
- Branch: `stabilize/main-2026-11-13` (operator-requested branch name overrides the skill default).
- Reuse the existing linked task worktree; no new worktree is created.
- Main's latest CI run, [43396497438](https://github.com/open-mercato/open-mercato/actions/runs/43396497438), already passes all 15 integration shards and all scheduled gates.
- Existing workflow rules already give trusted `stabilize/` branches and `ci-full` PRs full typecheck, unit tests, and all 15 integration shards. PR runs use `ci-refs/pull/<number>/merge`, separate from main.
- No application or workflow change is justified unless this run identifies a reproducible defect. Record a verification-only outcome if current main remains green.

Source doc: CONTRIBUTING.md (Stabilization CI)

## Non-goals

No feature work, changes to public contracts, migrations, weakened assertions, disabled checks, main merges, or release changes.

## Implementation Plan

### Phase 1: Diagnose

1.1 Audit current and recent main CI failures independently; verify current scope/concurrency regression checks in the parent task.

### Phase 2: Stabilize and validate

2.1 Fix reproduced root causes if any, with regression tests; run the stabilization PR's full CI suite and record all checks, skips, and limits.

### Phase 3: Review and hand off

3.1 Dispatch one final independent review of this branch through `cez task create --kind review`, address findings, publish evidence, and apply `automerge` only once checks are green and review approves.

## Delegation

At most two subtasks: a read-only CI-history audit, then one final review task after implementation/verification. The parent owns any fixes and validation; coupled fixes stay together. Child reports are claims to verify; no child changes are merged without review.

## Validation

For a documentation-only result, manually review the diff and run the existing CI scope/concurrency regression tests when dependencies are available. The requested full-suite evidence comes from this PR's GitHub Actions run. If code changes are needed, execute the configured ordered validation gate and relevant regression tests. Missing tools or local dependencies must be reported, never represented as passes.

## Risks

- Historical failures can be obsolete; do not change passing code based only on old logs.
- Any push cancels this PR's preceding run; collect documentation updates before the final verification run.
- Existing CI intentionally skips non-applicable jobs; disclose skips rather than calling them executed.
- Do not add `automerge` while any required check or final independent review remains pending.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose

- [ ] 1.1 Audit current and recent main CI failures independently; verify current scope/concurrency regression checks in the parent task.

### Phase 2: Stabilize and validate

- [ ] 2.1 Fix reproduced root causes if any, with regression tests; run the stabilization PR's full CI suite and record all checks, skips, and limits.

### Phase 3: Review and hand off

- [ ] 3.1 Dispatch one final independent review of this branch through `cez task create --kind review`, address findings, publish evidence, and apply `automerge` only once checks are green and review approves.
