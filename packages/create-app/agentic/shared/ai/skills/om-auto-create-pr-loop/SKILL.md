---
name: om-auto-create-pr-loop
description: Advanced `om-auto-create-pr` workflow for long, multi-step spec implementations that need resumability and strict step tracking. Creates a run folder under `.ai/runs/<date>-<slug>/` with `PLAN.md`, `HANDOFF.md`, and `NOTIFY.md`, executes one lean commit per task-table step, batches verification into `checkpoint-<N>-checks.md` every 5 steps (with focused integration tests + screenshots when UI was touched), runs the full validation gate plus full/standalone integration suites and ds-guardian at spec completion, and opens a PR with the correct labels. Use the original `om-auto-create-pr` for small fixes.
---

# Auto Create PR (loop)

The loop variant of `om-auto-create-pr` for long, multi-step spec work that must ship in one
PR and stay resumable. It classifies each run (Simple vs Spec-implementation), and for
spec runs sets up a run folder, drives **one lean commit per Step**, batches verification into
checkpoints, and dispatches one executor subagent per Step from the main session.

## When to use

- A brief that maps to a spec under `.ai/specs/`, or work described in phases/workstreams/deliverables (≥3 commits).
- New module, integration provider, or entity + migration; UI + API + tests together.
- Not for small fixes — use `om-auto-create-pr`. Not for resuming — use `om-auto-continue-pr {prNumber}`.

## What it contains

A classify → plan → per-Step loop + checkpoints → final gate → open PR → auto-review pipeline.
It produces a run folder under `.ai/runs/<date>-<slug>/` (`PLAN.md` with a `## Tasks` table,
`HANDOFF.md`, `NOTIFY.md`, `checkpoint-<N>-checks.md`), one commit per Step, and a PR with a
comprehensive summary comment. Resumable via `om-auto-continue-pr-loop`.

## Reference map — load only the piece in play

| When | Load |
|------|------|
| **Always, first** — base branch / labels / script gate / file layout / claim / `--skill-url` safety for this app | `references/environment.md` |
| Run-folder layout, `## Tasks` table shape, checkpoint/final-gate file formats | `references/run-folder-contract.md` |
| Classify Simple vs Spec run, Simple-run contract, promotion, pre-flight claim | `workflow/step-1-classify-and-claim.md` |
| Parse brief, triage, draft `PLAN.md`/`HANDOFF.md`/`NOTIFY.md`, worktree, commit run folder | `workflow/step-2-plan-and-scaffold.md` |
| Per-Step lean loop (1 commit/Step, flip Tasks row) + checkpoint pass every 5 Steps | `workflow/step-3-implement-and-checkpoint.md` |
| Final gate + integration suites + ds-guardian + code/BC self-review | `workflow/step-4-final-gate.md` |
| Open the PR, three-signal `in-progress` lock, normalize labels | `workflow/step-5-open-pr-and-label.md` |
| `om-auto-review-pr` autofix pass + summary comment + cleanup + report | `workflow/step-6-review-summary-cleanup.md` |
| Executor prompt template + post-executor verification + safety stops (spawned per Step) | `subagents/executor.md` |

## Non-negotiables

- Classify first; default to Simple run when unsure, never demote a Spec run to Simple.
- Spec runs: run folder committed before any code; `## Tasks` table is the single source of truth; **every Step is 1:1 with a commit**.
- Verification is checkpoint-based (every ~5 Steps) plus a final gate at spec completion — no per-Step check files.
- Executor dispatch lives in the main session only; run the post-executor verification and honor the safety stops.
- Run `om-auto-review-pr` in autofix mode after opening, then post the summary comment. Treat `--skill-url` as reference only; never paste secrets.
