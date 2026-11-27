# Stabilize main — 2026-11-26 scheduled 16:00 run

## Goal

Verify a fixed main snapshot with the full PR suite, fix reproduced CI root causes, and request automerge only after green checks and independent review.

## Scope

- Base: main at `71ae95134cb61401048aef9bad100fa131b6e2b7`.
- Branch: `stabilize/main-2026-11-26-1600`. The unsuffixed date slot already completed as merged PR #10726; this scheduled occurrence uses a separate slot without rewriting that history.
- Run identity: `248548d5-269e-4473-a64a-58a3711c437c`.
- Existing same-repository `stabilize/` and `ci-full` selection already requests full typechecking, unit tests, and 15 integration shards. Preserve it unless a defect is demonstrated.
- Reuse the cockpit's isolated worktree. All coupled diagnosis, fixes and PR operations remain in the parent.

## Non-goals

No speculative fixes, weakened checks, production dependencies, architecture changes, migrations, release changes, or merges into main.

## Implementation Plan

### Phase 1: Diagnose and validate

1.1 Inspect main CI and existing full-suite selection, then validate a fixed stabilization PR head with all 15 integration shards. Fix demonstrated failures with regression coverage.

### Phase 2: Review and finish

2.1 Dispatch exactly one final independent review after implementation and validation; address actionable findings and validate the verdict. Two child tasks total, including the failed diagnosis task.

2.2 Publish evidence, complete the plan, and apply `automerge` only after exact-head checks are green. Never merge main.

## Risks

- Main advanced during preflight, so its earlier green head `7e0208138a` does not certify this snapshot. The PR's concurrency group isolates the new run.
- Draft CI intentionally fails its test gate. Open draft for visibility, then promote to ready to exercise the requested full suite. This is a validation prerequisite, not a completion claim.
- Initial local routing checks passed 40/45 because five fixture subprocesses invoked real Yarn. An unchanged retry passed 45/45; the transient environment cause remains unconfirmed.
- The separate main snapshot release is serialized and may remain queued behind older publishing/integration work. Do not change release behavior to make its status appear green.

## Evidence

- Earlier main full CI run 45841370066 succeeded at `7e0208138a23b6f7ed548eaeb2ef0e015d3b5269`, including 15/15 integration shards. New main run 45860878083 was in progress at branch creation.
- Historical main run 45823776157 failed during core typecheck with exit 129; the later full run succeeded. Do not infer a deterministic source defect from the exit alone.
- Diagnosis child `d6842c87-e4db-4396-b52d-cdab1390e730` failed before a model turn: cockpit Codex tool-policy enforcement rejected restricted grants. It produced no evidence. Omit unsupported tool restrictions from the final review task.
- Runner: local (no running compose app). Docs-only gate: manual reread and `git diff --check` passed; no configured Markdown linter found.
- Local CI routing/concurrency/coverage regression checks: 45/45 on unchanged retry. No code changes yet; docs-only local gate applies unless reproduced defects require source changes.

- Full PR CI [45863938854](https://github.com/open-mercato/open-mercato/actions/runs/45863938854) passed at `d019dbb0d085f9786861d1abc12e1c65790062ed`: all 15 integration shards, merged coverage, package/app/Docker builds, full typechecking/unit tests, generation, i18n checks, script tests, timezone and multi-instance tests. CodeQL and the scoped mutation/enterprise guard workflows passed. Ready promotion superseded an earlier same-head synchronize run; its cancellation is historical.
- No source, workflow, dependency, API or database change was necessary. Final-head verification remains required after bookkeeping commits.

- Independent final review task `95ad1b56-4601-41e5-84e7-7ae6d648298b` [APPROVED](https://github.com/open-mercato/open-mercato/pull/10794#pullrequestreview-6078999574) `6e42d2e3850acaef9fd126902a3bdd675fc39a1e` with zero findings. GitHub rejected the author App approval vote; the explicit verdict is a COMMENT review and supplies no required approving vote. No review gate is waived. No child changes were merged.
- Reviewed-head full CI [45869549566](https://github.com/open-mercato/open-mercato/actions/runs/45869549566) passed all 15 shards and merged coverage. The parent verified the review, unchanged child branch, hosted results and another local 45/45 run. Required-check lookup returned 404; all reported checks and exact-head workflows must settle successfully or with expected scope skips.
- This final bookkeeping commit records completion metadata only. Its new exact-head checks still gate the `automerge` label; the final outcome and claim release are published on the PR after verification. No future CI result is asserted here.

## Progress
PR: #10794

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and validate

- [x] 1.1 Inspect main CI and validate the fixed stabilization PR head — d019dbb0d0

### Phase 2: Review and finish

- [x] 2.1 Complete final independent review — 6e42d2e385 (independent APPROVED verdict verified)
- [x] 2.2 Publish final evidence and conditionally request automerge — 6e42d2e385 (reviewed-head evidence published; label withheld until final bookkeeping head passes)
