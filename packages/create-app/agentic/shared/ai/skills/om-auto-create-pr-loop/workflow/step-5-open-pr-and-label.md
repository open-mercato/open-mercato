# Step 5 — Open the PR, claim the lock, normalize labels

## 5a. Open the PR

Open against `$BASE_BRANCH` (see `../references/environment.md` §1) in the current repository.
Title = conventional-commit prefix scoped to the primary area (e.g. `feat(ui): add accessible
confirmation dialog wrapper`, `refactor(catalog): extract shared pricing resolver`,
`security(auth): harden role-name spoofing guards`).

PR body — **MUST** include the `Tracking plan:` line so `om-auto-continue-pr-loop` can resume:

```markdown
Tracking plan: .ai/runs/${DATE}-${SLUG}/PLAN.md
Tracking run folder: .ai/runs/${DATE}-${SLUG}/
Status: in-progress

## Goal
- {one-line task summary from brief}

## External References
- {url — what was adopted, what was rejected}  <!-- only if --skill-url was used -->

## What Changed
- {bullet list of phase-level changes}

## Tests
- {unit tests added or updated}
- {other checks}

## Backward Compatibility
- {No contract surface changes | Describe BC handling}

## Progress
See the [Tasks table in the plan](.ai/runs/${DATE}-${SLUG}/PLAN.md#tasks) — that is the authoritative Step-status source (`todo` / `done`).

## Handoff & Notifications
- Live handoff: `.ai/runs/${DATE}-${SLUG}/HANDOFF.md`
- Notifications log: `.ai/runs/${DATE}-${SLUG}/NOTIFY.md`
```

Flip `Status:` to `complete` on the PR body once every row in the Tasks table has `Status` =
`done`. (A Simple run opens the PR here too, with a short body — no `Tracking plan:` / `Status:`
lines, no linked run folder — see `step-1-classify-and-claim.md` §1b.)

## 5b. Claim the PR with the three-signal in-progress lock

Per root `AGENTS.md`, any auto-skill that mutates a PR MUST claim it first with **all three
signals**: assignee, `in-progress` label, and a claim comment. Claim immediately after
`gh pr create` returns a PR number (use the `apply_label` probe from
`../references/environment.md` §2 for the label; if `in-progress` does not exist, claim with
assignee + claim comment alone — never silently skip the claim):

```bash
gh pr edit {prNumber} --add-assignee "$CURRENT_USER"
apply_label "in-progress" {prNumber}
gh pr comment {prNumber} --body "🤖 \`auto-create-pr-loop\` started by @${CURRENT_USER} at $(date -u +%Y-%m-%dT%H:%M:%SZ). Other auto-skills will skip this PR until the lock is released."
```

Wire the release into a `trap`/finally from this point on so the lock is released even if the run
crashes (see `step-6-review-summary-cleanup.md`). The lock is temporarily released in step 6 so
`om-auto-review-pr` can claim it cleanly. Executors never touch this lock (see `../subagents/executor.md`).

## 5c. Normalize labels (opt-in — probe first)

Apply labels per the PR workflow in root `AGENTS.md`, using the `apply_label` probe from
`../references/environment.md` §2 (skip-and-log any label this repo lacks):

- `review` — new PRs start here unless the run terminated early with an explicit blocker.
- `skip-qa` — only for clearly low-risk non-customer-facing changes (docs/deps/CI/test-only, trivial typos, single-file maintenance).
- `needs-qa` — when the run touches UI, sales/order flows, or other customer-facing behavior. Never combine with `skip-qa`.
- Additive category labels when they clearly apply: `bug`, `feature`, `refactor`, `security`, `dependencies`, `enterprise`, `documentation`.
- After each applied label, post a short PR comment explaining why. In the final summary, list any labels that were skipped because the repo lacks them (with the `gh label create` commands).

Then proceed to `step-6-review-summary-cleanup.md`.
