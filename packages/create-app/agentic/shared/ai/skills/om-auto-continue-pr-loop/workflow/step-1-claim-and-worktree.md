# Step 1 — Claim the PR, classify the run, locate the run folder, re-enter an isolated worktree

Load `../references/environment.md` first for base-branch/label/script/layout/claim rules.

## 1a. Claim the PR

Auto-skills MUST NOT clobber each other. Before doing anything else, decide whether you may claim
this PR.

```bash
CURRENT_USER=$(gh api user --jq '.login')
BASE_BRANCH="$(resolve_base_branch)"   # see references/environment.md §1
gh pr view {prNumber} --json assignees,labels,number,title,body,headRefName,baseRefName,isCrossRepository,comments
```

A PR is considered **already in progress** when ANY of the following is true:

- It carries the `in-progress` label.
- It has at least one assignee whose login is not `$CURRENT_USER`.
- A claim comment newer than 30 minutes exists from another actor (look for the `🤖` start marker).

Decision tree:

| State | `--force` set? | Action |
|-------|---------------|--------|
| Not in progress | — | Claim and proceed. |
| In progress, current user owns the lock | — | Treat as re-entry; proceed without re-claiming. |
| In progress, someone else owns the lock | no | **STOP.** Ask the user via `AskUserQuestion`: "PR #{prNumber} is in progress (owner: {owner}, signal: {label/assignee/comment}). Override and continue?" Only continue when the user explicitly says yes. |
| In progress, someone else owns the lock | yes | Post a force-override comment naming the previous owner, then claim and proceed. |

Stale lock recovery:

- If the `in-progress` label is older than 60 minutes and the assignee did not push or comment in that window, treat it as expired. Still ask the user before overriding unless `--force` was set.

Claim (use the opt-in label probe from `../references/environment.md` §2 and §5 — if the
`in-progress` label does not exist, claim with assignee + comment alone; never silently skip the
claim comment):

```bash
gh pr edit {prNumber} --add-assignee "$CURRENT_USER"
apply_label "in-progress" {prNumber}   # see references/environment.md §2
gh pr comment {prNumber} --body "🤖 \`auto-continue-pr-loop\` started by @${CURRENT_USER} at $(date -u +%Y-%m-%dT%H:%M:%SZ). Other auto-skills will skip this PR until the lock is released."
```

The release step happens at the end of `step-5-review-summary-cleanup.md` — the lock MUST be
released even on failure. Use a `trap`/finally so a crash still clears the label and posts a
completion comment. The main session claims the lock **once** here and releases it **once** at the
end; executors (`../subagents/executor.md`) never claim or release it.

## 1b. Classify the run before parsing the plan

Now that you hold the lock, decide which mode this resume runs in. Evaluate in order, first match
wins:

1. Is there a linked spec (`.ai/specs/...`) or an existing `.ai/runs/<date>-<slug>/` folder referenced from the PR body? → **Spec-implementation run**.
2. Did the user describe the task in terms of phases / steps / deliverables? → **Spec-implementation run**.
3. Does the remaining task clearly span >5 files or >1 module AND introduce new contract surface (new route, new entity, new event ID, new DI name, new ACL feature)? → **Spec-implementation run**.
4. Otherwise → **Simple run**.

When in doubt, default to **Simple run** — it is cheaper to promote mid-flight than to over-engineer
a typo fix. **Never demote a Spec-implementation run to a Simple run.**

- **Simple run** — skip the whole run-folder ceremony: no `PLAN.md`/`HANDOFF.md`/`NOTIFY.md`, no Tasks table, no checkpoint files, no executor dispatch. Land **one** code commit on the PR branch (tests still mandatory for code), run the script-probed gate for the touched package(s) only, still respect the three-signal lock (already claimed), label discipline, BC self-check, and the `om-auto-review-pr` pass, and post a compacted summary comment. Use an isolated worktree (§1d) and release the lock per `step-5-review-summary-cleanup.md`. Skip §1c and go straight to §1d, then to `step-4-final-gate.md` (targeted gate) and `step-5-review-summary-cleanup.md`.
- **Spec-implementation run** — continue with §1c onward and the full contract in `step-2`–`step-5`.
- **Promotion (Simple → Spec):** if the resume discovers the remaining work is larger than it looked, stop the simple flow, draft `.ai/runs/<date>-<slug>/PLAN.md` (with a `## Tasks` table), `HANDOFF.md`, and `NOTIFY.md`, write a seed commit that adds them, add `Tracking plan:` + `Status: in-progress` lines to the PR body, then continue under the full contract.

## 1c. Locate the run folder (Spec-implementation runs)

Prefer the explicit `Tracking plan:` line in the PR body (written by `om-auto-create-pr-loop`):

```bash
gh pr view {prNumber} --json body --jq '.body' | grep -E '^Tracking (plan|run folder):' | head -n1
```

Expected value: `Tracking plan: .ai/runs/<date>-<slug>/PLAN.md`. Fallbacks, in order:

1. `Tracking run folder: .ai/runs/<date>-<slug>/` — derive `PLAN_PATH` as `${folder}/PLAN.md`.
2. Legacy flat-file format `Tracking plan: .ai/runs/<date>-<slug>.md` — create a run folder at `.ai/runs/<date>-<slug>/`, move the flat plan into it as `PLAN.md`, and initialize `HANDOFF.md` + `NOTIFY.md` as part of this resume's first commit.
3. Legacy `Tracking spec:` line — treat the same way as the legacy flat-file format.
4. Diff the PR against `origin/$BASE_BRANCH` and look for a new path under `.ai/runs/` authored by this branch. If exactly one new plan exists (folder or flat file), use it.
5. If nothing under `.ai/runs/` is found, look for a new file under `.ai/specs/` or `.ai/specs/enterprise/` and migrate it into a new run folder as above.
6. If multiple candidates were found, stop and ask the user via `AskUserQuestion` which one to resume.
7. If no tracking plan can be resolved, stop with a clear error. Do NOT invent a plan path.

Record the resolved paths:

```bash
RUN_DIR=".ai/runs/<date>-<slug>"
PLAN_PATH="${RUN_DIR}/PLAN.md"
HANDOFF_PATH="${RUN_DIR}/HANDOFF.md"
NOTIFY_PATH="${RUN_DIR}/NOTIFY.md"
# Verification is checkpoint-based: ${RUN_DIR}/checkpoint-<N>-checks.md every ~5 Steps.
# Final gate log lives at ${RUN_DIR}/final-gate-checks.md at spec completion.
```

See `../references/run-folder-contract.md` for the full layout and file formats.

## 1d. Re-enter an isolated worktree from the PR head

Never resume in the user's primary worktree.

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
GIT_DIR=$(git rev-parse --git-dir)
GIT_COMMON_DIR=$(git rev-parse --git-common-dir)
WORKTREE_PARENT="$REPO_ROOT/.ai/tmp/auto-continue-pr"
CREATED_WORKTREE=0

HEAD_REF=$(gh pr view {prNumber} --json headRefName --jq '.headRefName')
IS_CROSS=$(gh pr view {prNumber} --json isCrossRepository --jq '.isCrossRepository')

if [ "$GIT_DIR" != "$GIT_COMMON_DIR" ]; then
  WORKTREE_DIR="$PWD"
else
  WORKTREE_DIR="$WORKTREE_PARENT/pr-{prNumber}-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$WORKTREE_PARENT"
  if [ "$IS_CROSS" = "true" ]; then
    gh pr checkout {prNumber} --recurse-submodules=no
    git worktree add --detach "$WORKTREE_DIR" "HEAD"
  else
    git fetch origin "$HEAD_REF"
    git worktree add "$WORKTREE_DIR" "origin/$HEAD_REF"
  fi
  CREATED_WORKTREE=1
fi

cd "$WORKTREE_DIR"
yarn install --mode=skip-build   # fall back to plain `yarn install` if unsupported
```

Rules:

- Reuse the current linked worktree when already inside one. Never nest worktrees.
- The main worktree must stay untouched.
- Always clean up the temporary worktree at the end, but only if you created it this run (see `step-5-review-summary-cleanup.md`).

Then proceed to `step-2-parse-and-resume.md` (Spec-implementation runs) or straight to
`step-4-final-gate.md` (Simple runs).
