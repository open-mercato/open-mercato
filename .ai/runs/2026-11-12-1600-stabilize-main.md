# Main stabilization — 2026-11-12 16:00

## Goal

Fix demonstrated main CI failures on a dedicated full-suite stabilization PR and request automerge after green CI and independent final review.

## Scope

Base: `main` at `03aadbf872145b7d0527c103e108b05518d22624`.
Branch: `stabilize/main-2026-11-12-1600`, targeting `main`. The unsuffixed dated branch belongs to the already merged #9310; preserve it and distinguish this scheduled occurrence with its start time.

The existing same-repository `stabilize/` and `ci-full` overrides already select all 15 integration shards and unfiltered typecheck/unit tests. Preserve their behavior and PR concurrency isolation. Investigate the script-test failure in main run 43232077194, reproduce the cause, and make focused fixes with regression coverage.

Non-goals: unrelated features, weakened checks, skipped failing tests, migrations, dependency additions, release changes, or merging into main.

## Implementation Plan

### Phase 1: Audit and diagnosis

1.1 Delegate one independent read-only audit of main CI and full-suite selection. Parent owns reproduction and all fixes; scopes do not overlap.
1.2 Reproduce demonstrated failures and identify their root causes.

### Phase 2: Fixes and validation

2.1 Implement focused root-cause fixes with tests and run the configured ordered validation gate.
2.2 Verify this draft PR's full CI and resolve failures until every applicable check passes.

### Phase 3: Final review and handoff

3.1 Dispatch exactly one independent final review task after implementation; resolve actionable findings and wait for approval. At most two delegated tasks total; merge no unreviewed child work.
3.2 Publish evidence, complete the plan, and promote with `automerge` only after final-head CI passes.

## Validation and risks

Run the ordered commands in `.ai/agentic.config.json` and focused regression tests. Record local environment limitations honestly; the PR's own full GitHub Actions suite must pass, including all 15 integration shards. New pushes invalidate earlier exact-head evidence. Preserve intentionally skipped jobs as skips, not passes. No user is present; use reversible defaults within the requested scope.

Source doc: `.ai/specs/implemented/2026-04-10-ci-cd-performance.md` (existing CI architecture; the phased-CI draft is not being implemented).

Run identity: `199b6237-1c69-4981-b22f-20ccd77d8fc9`.

## Evidence

- Main run [43232077194](https://github.com/open-mercato/open-mercato/actions/runs/43232077194), job 131239492865: typecheck and all unit suites passed; Test scripts failed `encryption-preflight.test.mjs:258` because a fallback key was generated despite an existing explicit key or Vault configuration. The later main run 43236858055 also failed its test job.
- Independently reproduced with `ensureEnvFiles` and an isolated temporary root/app environment. The later unconditional fallback assignment overwrites the earlier configuration-aware rendering. Remove that duplicate assignment; existing fresh-environment key creation and root-to-app propagation remain responsible for new installations.
- Open prerequisite fix [#9356](https://github.com/open-mercato/open-mercato/pull/9356) independently proposes the same source correction. This stabilization run retains the requested single-branch scope and adds ambient-fallback, company-key, root-Vault, and ambient-Vault regression cases.
- Runner: local (no running compose app). Package build passed 42 tasks. All 16 focused encryption tests and the dependency-free reproduction passed after the fix. Initial full script run encountered the cockpit's long temporary socket path; rerun with a short isolated TMPDIR rather than changing project behavior.

## Progress

PR: #9361

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Audit and diagnosis

- [ ] 1.1 Independently audit main CI and full-suite selection
- [x] 1.2 Reproduce demonstrated failures and identify root causes — cec00243f5

### Phase 2: Fixes and validation

- [ ] 2.1 Implement focused fixes with tests and run validation
- [ ] 2.2 Verify the draft PR's full CI and resolve failures

### Phase 3: Final review and handoff

- [ ] 3.1 Obtain independent final review approval
- [ ] 3.2 Publish evidence and request automerge after final-head CI passes
