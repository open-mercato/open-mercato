# Main stabilization — 2026-11-12 08:00

## Goal

Verify main through a dedicated full-suite stabilization PR, fix demonstrated root causes, and request automerge only after CI and independent review pass.

## Scope

Base: `main` at `e94b1ab34583767dd02b2d9729d3e978204b813c`.
Branch: `stabilize/main-2026-11-12-0800` (operator-requested stabilization prefix; time suffix distinguishes the earlier completed run, merged as #9310).
Main's latest CI run, [43147388830](https://github.com/open-mercato/open-mercato/actions/runs/43147388830), passed all 15 integration shards and the remaining enabled jobs. Existing `FORCE_FULL_SUITE` logic already recognizes same-repository `stabilize/` branches and `ci-full` labels. Do not duplicate that implementation or invent a code fix without a reproducible failure.

Non-goals: feature changes, relaxed checks, skipped failing tests, release changes, merging into main, and unrelated cleanup.

## Implementation Plan

### Phase 1: Audit and reproduce

1.1 Independently audit main CI and confirm existing full-suite selection. Delegate one read-only task with no source edits; parent retains branch/PR ownership.

### Phase 2: Stabilize and validate

2.1 Resolve any demonstrated failures and verify the dedicated PR runs the full suite. Keep tightly coupled fixes and CI iteration in the parent worktree. If no failures exist, record verification evidence only.

### Phase 3: Review and handoff

3.1 Dispatch exactly one final independent review task after implementation and CI; apply actionable findings and obtain approval before handoff. Total delegated tasks: at most two.
3.2 Publish verification evidence, complete the plan, and mark the PR ready with `automerge` only after all checks pass.

## Validation

For any code change, run the ordered `.ai/agentic.config.json` validation gate and focused regression tests. For a documentation-only verification run, manually review the Markdown diff and run relevant available documentation checks; the dedicated GitHub Actions run must still execute unfiltered typecheck/unit tests, all 15 integration shards, Docker builds, and infrastructure regressions. Report intentional job skips separately from passing jobs.

## Risks

CI may expose a new failure despite main's successful baseline. Never substitute baseline evidence for the PR's own run. Late commits invalidate prior head evidence; verify the final pushed head. No user is present for this scheduled run, so use existing behavior and reversible defaults.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Audit and reproduce

- [ ] 1.1 Independently audit main CI and confirm existing full-suite selection

### Phase 2: Stabilize and validate

- [ ] 2.1 Resolve any demonstrated failures and verify the dedicated PR runs the full suite

### Phase 3: Review and handoff

- [ ] 3.1 Dispatch exactly one final independent review task
- [ ] 3.2 Publish verification evidence and request automerge after all checks pass
