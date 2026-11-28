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

## Evidence

- Independent audit task `0d0467f3-997f-45fb-bf9f-800ee9e05db5` found no actionable defect on the stated main SHA. Baseline CI passed 24 jobs, including all 15 integration shards; the dependency audit was intentionally skipped for a documentation-only commit. [Snapshot and standalone tests](https://github.com/open-mercato/open-mercato/actions/runs/43147388697) passed 2/2 and [CodeQL](https://github.com/open-mercato/open-mercato/actions/runs/43147388631) passed 3/3.
- Runner: local. Parent independently inspected the read-only audit report and ran all 43 focused full-suite, concurrency, coverage and bootstrap regression tests successfully. Whitespace checks passed. The documentation-only local gate exception applies; no Markdown lint command is configured. Broad application validation runs in this PR's full CI.
- [Independent final review](https://github.com/open-mercato/open-mercato/pull/9320#issuecomment-6817419356), task `9aa19466-03b0-444e-acd3-fdcf4a327dce`, approved the entire diff at `d6f12084da83a9a6e918b72fb83a9607aed19098` with zero findings. The reviewer verified that every configured validation command's CI step passed. GitHub rejected native self-approval by the shared App; the attributed independent review does not replace a distinct-account approval requirement. No child branch was merged.
- Effective main ruleset requires `scope`, `guard`, `prepare`, `lint`, `ds-lint`, `test`, `audit-scope`, and `documents-multi-instance`. This run additionally gates handoff on all applicable reported checks, including every integration shard and coverage merge.
- [Initial PR full CI](https://github.com/open-mercato/open-mercato/actions/runs/43172365845) passed all 24 applicable jobs at `d6f12084da83a9a6e918b72fb83a9607aed19098`, including all 15 integration shards and coverage merge. The dependency audit was intentionally skipped by its existing scope filter. Every other applicable PR check passed. No code fix was needed.
- The `automerge` request was applied after initial exact-head CI and independent review passed, while the PR remained draft. Completion-only evidence/checklist commits require a fresh full run at the final pushed head; ready promotion and handoff remain gated on that run. The PR body and outcome comment carry the final live result without another evidence-only source commit.
- Follow-up commits only record completion evidence and checklist state; the parent checks their diff against the reviewed document. Ready promotion remains gated on all applicable checks passing at the final pushed head.

## Progress

PR: #9320

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Audit and reproduce

- [x] 1.1 Independently audit main CI and confirm existing full-suite selection — ed93c71813

### Phase 2: Stabilize and validate

- [x] 2.1 Resolve any demonstrated failures and verify the dedicated PR runs the full suite — cded001695

### Phase 3: Review and handoff

- [x] 3.1 Dispatch exactly one final independent review task — ed93c71813
- [x] 3.2 Publish verification evidence and request automerge after all checks pass — cded001695
