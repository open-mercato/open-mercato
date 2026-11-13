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

## Evidence so far

- Local runner: Node.js 24.22.2 on the host; no running compose app was found at the default dev compose path.
- `node --test scripts/__tests__/ci-full-label.test.mjs scripts/__tests__/ci-concurrency.test.mjs scripts/__tests__/ci-merge-coverage.test.mjs`: 40 passed, zero failed or skipped.
- Main baseline CI: all 15 integration shards, prepare/build, test, lint, DS lint, Docker build, documents multi-instance, core-timezone, and merge-coverage passed. Dependency audit was intentionally skipped by its scope job.
- Branch-protection required-check lookup returned HTTP 404 (required status checks not enabled); use every reported PR check as a gate, accepting only documented non-applicable skips.
- CI history audit: dispatched task `d930c118-fd33-4b10-abdd-1cbc33aa5459` (read-only).

## Diagnosis and full-suite outcome

- The read-only CI-history audit made no tracked changes; its branch has no diff against the baseline main commit. No merge was necessary.
- Historical CI runs [43228227205](https://github.com/open-mercato/open-mercato/actions/runs/43228227205), [43232077194](https://github.com/open-mercato/open-mercato/actions/runs/43232077194), and [43236858055](https://github.com/open-mercato/open-mercato/actions/runs/43236858055) failed the starter encryption preflight regression assertion. Supplied encryption/Vault configuration was being supplemented with an unwanted fallback key.
- Existing fix [825240d58b](https://github.com/open-mercato/open-mercato/commit/825240d58be64077215060bbc46e6e23144cfa8e) (#9356) is an ancestor of this branch. The parent inspected its diff and historical failed log, then repeated the audit's five-case source comparison: historical source generated unwanted fallback keys in four cases; current source generated none. Supplied fallback preservation passed in both versions.
- The full local encryption-preflight test could not load missing shared-package build output in the audit environment. This is a local validation limit; the fixed assertion's repository test passed in subsequent main CI, and this PR's Test scripts gate passed.
- PR full-suite run [43401554192](https://github.com/open-mercato/open-mercato/actions/runs/43401554192) passed on `7a474e288a451800b9be5c0d6d9ee5f60aad3765`: all 15 integration shards, package/app preparation, full typecheck/unit/script tests, lint, DS lint, Docker build, documents multi-instance, core-timezone, and merge-coverage. CodeQL, contribution guard, CLA, and mutation scope checks also passed. Dependency audit and mutation execution/comment were non-applicable skips for this documentation-only diff.
- No code or workflow changes were needed. The configured local build/generate/typecheck/unit/app gate is not rerun for this documentation-only result; CI supplies the full requested runtime verification.
- Main Snapshot Release [43396497321](https://github.com/open-mercato/open-mercato/actions/runs/43396497321) remains pending at this evidence update. Snapshot publication passed; standalone integration tests are still running. This is separate from the successful main and PR CI suites; do not claim it passed or apply automerge while it remains unsettled.
- The final independent review and latest-head verification remain required. Administrative documentation pushes trigger another full PR run.

## Risks

- Historical failures can be obsolete; do not change passing code based only on old logs.
- Any push cancels this PR's preceding run; collect documentation updates before the final verification run.
- Existing CI intentionally skips non-applicable jobs; disclose skips rather than calling them executed.
- Do not add `automerge` while any required check or final independent review remains pending.

## Progress

PR: #9425

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose

- [x] 1.1 Audit current and recent main CI failures independently; verify current scope/concurrency regression checks in the parent task.

### Phase 2: Stabilize and validate

- [x] 2.1 Fix reproduced root causes if any, with regression tests; run the stabilization PR's full CI suite and record all checks, skips, and limits.

### Phase 3: Review and hand off

- [ ] 3.1 Dispatch one final independent review of this branch through `cez task create --kind review`, address findings, publish evidence, and apply `automerge` only once checks are green and review approves.
