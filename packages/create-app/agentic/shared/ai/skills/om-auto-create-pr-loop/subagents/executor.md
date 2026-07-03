# Subagent — per-Step executor

> Applies only to **Spec-implementation runs**. Simple runs have at most one code commit and do
> not use executor dispatch. Dispatch MUST live in the main session (subagents have no `Agent`
> tool). Dispatch is **sequential** — one executor at a time.

When a single run has a plan with **many Steps that must ship in one PR**, the main session acts
as a dispatcher and spawns one executor per Step. The executor implements exactly that Step
end-to-end (one code commit + Tasks-row flip + push). The main session waits, verifies the commit
landed and pushed, then dispatches the next Step.

Lock ownership: the main session claims the PR's three-signal `in-progress` lock **once**
(`step-5-open-pr-and-label.md`) and releases it per `step-6-review-summary-cleanup.md`. Executors
MUST NOT claim/release the lock or post PR comments. If dispatch happens before the PR exists,
the lock is simply not yet relevant.

## Executor prompt template

The main session writes this into each spawned `Agent` call (`subagent_type: "general-purpose"`):

```markdown
You are an executor for auto-create-pr-loop run {SLUG}. Implement exactly one Step.

Working directory: {absolute worktree path}
Branch: {branch} (already checked out from origin/{BASE_BRANCH}; origin tracking set up)
Run folder: {absolute run folder path}

Step to implement:
- Step id: {X.Y}
- Title: {step title from Tasks table}
- Full description: {paste the Step's bullets from PLAN.md Implementation Plan}

Spec anchors:
- PLAN.md: {plan path}
- Source spec (if any): {spec path}
- External References adopted: {list from PLAN.md Overview}

Rules:
- One Step = exactly one code commit. Nothing more, nothing less. No separate docs-flip commit.
- Run a quick scratch sanity check (typecheck + new test) to confirm the Step compiles. Do NOT record it anywhere — the checkpoint pass verifies.
- Do NOT write a `step-{X.Y}-checks.md`. Do NOT create a `step-{X.Y}-artifacts/` folder. Verification is checkpoint-based.
- Flip the `Status` cell of row `{X.Y}` in PLAN.md's Tasks table from `todo` to `done` and fill the `Commit` column with the short SHA as part of the same commit (amend if needed to capture the real SHA before push).
- Do NOT rewrite `HANDOFF.md` at the per-Step level. Do NOT append to `NOTIFY.md` unless you hit a blocker, make a scope decision worth logging, or are delegating to another subagent.
- Push after the commit so the remote always has the latest state.
- Do NOT claim or release the PR's `in-progress` lock. The main session owns it (once the PR exists).
- Do NOT post the final summary PR comment. The main session posts it.
- Do NOT rewrite or reorder prior history. Do NOT split into multiple code commits. If this Step truly needs splitting, stop and return early with a report asking the main session to split the Step in PLAN.md first.

Return format (concise report, < 300 words):
- Step id
- Code commit SHA
- Files touched
- Brief note on what changed (one line)
- Push confirmation (`origin/{branch}` now at {sha})
- Blockers or decisions worth escalating
```

## Verification the main session MUST run after each executor returns

Before dispatching the next Step:

- `git status` is clean in the worktree.
- Exactly **one** new commit exists on HEAD since the dispatch.
- Local HEAD == `origin/{branch}` (push actually landed; fetch if in doubt).
- The PLAN.md Tasks-table row for `{X.Y}` is flipped to `done` with the correct short SHA in the `Commit` column.

Every 5 successful executors (or when a Phase with ≥3 Steps closes), the main session MUST run a
**checkpoint pass** per `../workflow/step-3-implement-and-checkpoint.md` §3b before dispatching
the next Step: targeted validation for all packages touched in the window, focused integration
tests + screenshots when UI was touched, write `checkpoint-<N>-checks.md`, rewrite `HANDOFF.md`,
append the checkpoint entry to `NOTIFY.md`, and commit as
`docs(runs): checkpoint N — steps X.Y..X.Z verified`.

## Safety stops

The main session MUST halt dispatch (leave `Status: in-progress` in the PR body if the PR is
open, rewrite `HANDOFF.md`, append a NOTIFY entry naming the blocker, release the lock per
`step-6-review-summary-cleanup.md`, and report back) when any of the following is true:

- An executor returns a blocker, failing tests, or an error.
- `git status` is not clean after an executor returns.
- The Tasks-table row was not flipped to `done` with the correct SHA.
- Local HEAD ≠ `origin/{branch}` (push did not land).
- Two consecutive executors returned problematic results.
- **Safety checkpoint:** after ~20 consecutive successful Steps, stop and let the user review before plowing on.

Sibling auto-skills (`om-auto-continue-pr-loop`, `om-auto-sec-report`, `om-auto-qa-scenarios`,
`om-auto-update-changelog`) inherit this pattern when driving multiple Steps in a single
invocation.
