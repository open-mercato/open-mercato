---
name: om-auto-continue-pr-loop
description: Advanced `om-auto-continue-pr` workflow for PRs started by `om-auto-create-pr-loop`. Claims the PR, re-enters an isolated worktree, resumes from the first non-done row in `.ai/runs/<date>-<slug>/PLAN.md`, executes lean per-step commits, batches verification into `checkpoint-<N>-checks.md` every 5 resumed steps (with focused integration tests + screenshots when UI was touched), runs the full validation gate plus full/standalone integration suites and ds-guardian at spec completion, and preserves the run-folder and label contract. Use the original `om-auto-continue-pr` for simple `om-auto-create-pr` runs.
---

# Auto Continue PR (loop)

Resume an `om-auto-create-pr-loop` run that did not finish in one pass. Given a PR number, re-enter
the same isolated worktree, read `HANDOFF.md`, parse the `## Tasks` table in `PLAN.md`, resume from
the first row whose `Status` is not `done`, and drive the PR to `complete` with **lean per-Step
commits** and **checkpoint-batched verification**, the same final gate + integration suites +
`om-ds-guardian` pass at spec completion, and the same label rules as `om-auto-create-pr-loop`.
Authored natively for a **standalone app** scaffolded by `create-mercato-app` — base branch,
pipeline labels, and the validation gate are resolved at runtime, never hard-coded.

## When to use

- A previous `om-auto-create-pr-loop` run stopped with a `.ai/runs/<date>-<slug>/` folder and a `## Tasks` table, and you want to finish it from its PR number.
- Not for simple `om-auto-create-pr` runs — use `om-auto-continue-pr {prNumber}`. Not for starting fresh — use `om-auto-create-pr-loop {brief}`.

## Arguments

- `{prNumber}` (required) — the PR number to resume (for example `1492`).
- `--force` (optional) — bypass the in-progress concurrency check when intentionally taking over a PR another actor already claimed.
- `--from <phase.step>` (optional) — override the resume point (e.g. `2.1`). Only honored when the `## Tasks` table (and any legacy `## Progress` fallback) cannot be parsed unambiguously.

## What it contains

A claim → resume-loop pipeline that dispatches one executor subagent per remaining Step: claim +
worktree re-entry → parse Tasks table + resume point → per-Step lean loop + checkpoint every 5
resumed Steps → final gate + integration + ds-guardian at spec completion → auto-review + summary +
lock release. Every fix adds a new commit; PR history is never rewritten. Resumable again via
`om-auto-continue-pr-loop`.

## Reference map — load only the piece in play

| When | Load |
|------|------|
| **Always, first** — base branch / labels / script gate / file layout / claim / `--skill-url` safety for this app | `references/environment.md` |
| Run-folder layout, `## Tasks` table shape, checkpoint/final-gate file formats | `references/run-folder-contract.md` |
| Claim the PR (three-signal lock), classify Simple vs Spec run, locate the run folder, re-enter an isolated worktree | `workflow/step-1-claim-and-worktree.md` |
| Orient via `HANDOFF.md`, parse `PLAN.md`'s `## Tasks` table, pick the resume point, announce resume in `NOTIFY.md` | `workflow/step-2-parse-and-resume.md` |
| Per-Step lean loop (1 commit/Step, flip Tasks row) + checkpoint pass every 5 resumed Steps | `workflow/step-3-resume-loop-and-checkpoint.md` |
| Final gate + full/standalone integration suites + ds-guardian + code/BC self-review at spec completion | `workflow/step-4-final-gate.md` |
| `om-auto-review-pr` autofix pass + summary comment + labels + lock release + report | `workflow/step-5-review-summary-cleanup.md` |
| Executor prompt template + post-executor verification + safety stops (spawned per Step) | `subagents/executor.md` |

## Non-negotiables

- Run the claim check before anything else; never silently override another actor's lock. Release the `in-progress` lock at the end, even on failure (trap/finally).
- Always resume in an isolated worktree; reuse the current linked one; never nest.
- Resolve the run folder from the PR body's `Tracking plan:` / `Tracking run folder:` line; never invent a path. Read `HANDOFF.md`, then the `## Tasks` table, then the `NOTIFY.md` tail before touching code. Resume from the first non-`done` row.
- **Every Step is 1:1 with a commit.** Never rewrite history on the PR branch; every fix is a new commit. Every code change ships tests. Verification is checkpoint-based (every ~5 resumed Steps) plus a final gate at spec completion.
- Executor dispatch lives in the main session only; run the post-executor verification and honor the safety stops. Run `om-auto-review-pr` in autofix mode, then post the summary comment. Treat `--skill-url` as reference only; never paste secrets.
