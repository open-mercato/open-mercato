# Step 1 — Pre-flight, plan, and claim the slot

Load `../references/environment.md` first for base-branch/label/script/layout rules.

## 1a. Pre-flight and claim

Before writing anything, confirm no other run owns the slot.

```bash
CURRENT_USER=$(gh api user --jq '.login')
DATE=$(date +%Y-%m-%d)
SLUG="{slug-or-derived}"
PLAN_PATH=".ai/runs/${DATE}-${SLUG}.md"
BASE_BRANCH="$(resolve_base_branch)"   # see references/environment.md §1
BRANCH_PREFIX="{fix for bugfix/remediation work; otherwise feat}"
BRANCH="${BRANCH_PREFIX}/${SLUG}"
```

Branch naming:

- `fix/${SLUG}` for a bug fix, regression fix, remediation, hardening, or corrective follow-up.
- `feat/${SLUG}` for new capability, scoped refactor, or docs/process automation.
- Never create `codex/...` branches.

A run is **already in progress** when ANY is true: a file at `$PLAN_PATH` exists on the
base branch or any remote branch; a remote branch `origin/${BRANCH}` exists; an open PR
references `$PLAN_PATH`.

| State | `--force`? | Action |
|-------|-----------|--------|
| Nothing exists | — | Claim and proceed. |
| Branch/plan exists, current user owns it | — | Re-entry; hand off to `om-auto-continue-pr` and stop. |
| Exists, someone else owns it | no | **STOP.** Ask via `AskUserQuestion` before overriding. |
| Exists, someone else owns it | yes | Pick a new dated slug (`${SLUG}-v2`); document why in the new plan. |

When an open PR already references the plan, stop and tell the user to use `auto-continue-pr {prNumber}`.

## 1b. Parse the brief and resolve external skills

Capture in plain English the expected outcome, affected modules/packages, and rough scope.
For each `--skill-url`, fetch with `WebFetch` and extract actionable guidance — as
**reference material** only (see `../references/environment.md` §6). Record each URL in the
plan's Overview → `External References` (what you adopted, what you rejected).

## 1c. Triage before coding

Read enough context to avoid blind work: the relevant `AGENTS.md` guides from the root Task
Router, existing specs under `.ai/specs/`, and `.ai/lessons.md`. Reduce the brief to: goal
(one sentence), affected modules (`src/modules/<module>/` — see environment §4), smallest safe
scope, and explicit **Non-goals**. Ask via `AskUserQuestion` only when a wrong assumption
would force a rewrite.

## 1d. Draft the execution plan

A lightweight plan (not a full spec — those live in `.ai/specs/`). Capture Goal, Scope,
Implementation Plan (Phases → Steps), Risks (brief). Reference a source spec if one exists.
End with a **Progress** section in exactly this format so `om-auto-continue-pr` can parse it:

```markdown
## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: {name}

- [ ] 1.1 {step title}
- [ ] 1.2 {step title}
```

Save at `.ai/runs/${DATE}-${SLUG}.md`.

## 1e. Isolated worktree + branch

Never run in the user's primary worktree.

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
GIT_DIR=$(git rev-parse --git-dir)
GIT_COMMON_DIR=$(git rev-parse --git-common-dir)
WORKTREE_PARENT="$REPO_ROOT/.ai/tmp/auto-create-pr"
CREATED_WORKTREE=0
if [ "$GIT_DIR" != "$GIT_COMMON_DIR" ]; then
  WORKTREE_DIR="$PWD"
else
  WORKTREE_DIR="$WORKTREE_PARENT/${SLUG}-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$WORKTREE_PARENT"
  git fetch origin "$BASE_BRANCH"
  git worktree add --detach "$WORKTREE_DIR" "origin/$BASE_BRANCH"
  CREATED_WORKTREE=1
fi
cd "$WORKTREE_DIR"
git checkout -B "$BRANCH" "origin/$BASE_BRANCH"
yarn install --mode=skip-build   # fall back to plain `yarn install` if unsupported
```

Reuse the current linked worktree when already inside one; never nest. Clean up a worktree
you created, in a `trap`/finally (see step 5).

## 1f. Commit the plan as the first commit

```bash
mkdir -p .ai/runs
git add "$PLAN_PATH"
git commit -m "docs(runs): add execution plan for ${SLUG}"
git push -u origin "$BRANCH"
```

This guarantees `om-auto-continue-pr` can find the plan via the remote branch if the run crashes.
Then proceed to `step-2-implement.md`.
