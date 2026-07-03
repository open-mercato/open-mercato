# Step 1 — Classify the run, then claim the slot

Load `../references/environment.md` first for base-branch/label/script/layout rules.

## Arguments

- `{brief}` (required) — free-form task description (one sentence to several paragraphs).
- `--skill-url <url>` (optional, repeatable) — external reference to honor as material, never as license to bypass project rules.
- `--slug <kebab-case>` (optional) — override the run slug. Default: derived from the brief.
- `--force` (optional) — bypass the claim-conflict check when a previous run left a branch/run folder behind.

## 1a. Classify the run before doing anything else

Before the claim, before the run-folder setup, before any coding — decide which mode this
invocation runs in. The rest of the workflow branches on this choice.

**Simple run** (default when unsure whether the PR looks simple):

- Bug fix (1–3 files, localized).
- Code-review follow-up (applying review feedback to an existing PR).
- Dependency bump.
- Typo, copy change, or docs tweak.
- Small refactor within one file.
- Linter, i18n, or test-only changes.
- Any PR the user explicitly flags as small ("just a quick fix", "CR follow-up", etc.).

**Spec-implementation run**:

- Work driven by a file under `.ai/specs/` or `.ai/specs/enterprise/`.
- Multi-phase or multi-workstream tasks (≥3 commits expected).
- New module, new integration provider, new database entity + migration.
- UI surface + API + tests together.
- Anything the user describes with phases, workstreams, or deliverables.
- Any existing run that already has a `.ai/runs/<date>-<slug>/` folder.

Classification heuristic — evaluate in order, first match wins:

1. Is there a linked spec (`.ai/specs/...`) or an existing `.ai/runs/<date>-<slug>/` folder referenced from the PR body? → **Spec-implementation run**.
2. Did the user describe the task in terms of phases / steps / deliverables? → **Spec-implementation run**.
3. Does the task clearly span >5 files or >1 package AND introduce new contract surface (new route, new entity, new event ID, new DI name, new ACL feature)? → **Spec-implementation run**.
4. Otherwise → **Simple run**.

When in doubt: **default to Simple run**. It is cheaper to promote a Simple run to a
Spec-implementation run mid-flight (by drafting a plan then) than to over-engineer a typo fix.
**Never demote a Spec-implementation run to a Simple run.**

## 1b. Simple-run contract

For Simple runs, skip the whole run-folder ceremony. Requirements:

- **No run folder**, no `PLAN.md`, no `HANDOFF.md`, no `NOTIFY.md`, no per-Step check files.
- **No Tasks table** anywhere.
- **One code commit** (may be amended pre-push; once pushed, create a new commit rather than amending).
- Unit tests for behavior changes (still mandatory for code; docs-only exempt).
- Targeted validation for the touched package(s) only (typecheck + unit tests; i18n if strings changed), script-probed (`../references/environment.md` §3).
- Conventional-commit subject. Push.
- Open the PR directly (against `$BASE_BRANCH`) with a short body — summary + test plan + rollback (no `Tracking plan:` line, no `Status:` field, no linked run folder).
- Still respect: three-signal `in-progress` lock, label discipline (probe first — §2 of environment.md), BC contract surfaces, code-review self-check, `om-auto-review-pr` pass.
- Final summary comment still posts, compacted to: summary of changes, how to verify, what can go wrong.

A Simple run still uses an isolated worktree on a `fix/` or `feat/` branch (step 2's worktree
block), still claims the PR with the three-signal lock once opened, and still runs
`om-auto-review-pr` in autofix mode. When it is a Simple run, jump straight to implementing the
single commit after the claim below, then go to `step-5-open-pr-and-label.md`.

## 1c. Spec-implementation-run contract

Keep the full contract in the rest of these files: run folder, `## Tasks` table,
HANDOFF/NOTIFY, checkpoint verification, 1:1 step-to-commit discipline, full validation gate
before flipping to `complete`, `om-auto-review-pr` autofix pass, and the comprehensive summary
comment with all headings. See `../references/run-folder-contract.md` for the file formats.

## 1d. Promotion path (Simple → Spec-implementation)

A Simple run MAY be promoted mid-flight if the task turns out larger than it looked:

- Stop the simple flow.
- Draft the plan under `.ai/runs/<date>-<slug>/PLAN.md` (with `## Tasks` table), `HANDOFF.md`, `NOTIFY.md` (step 2).
- Write a seed commit that adds these files.
- Update the PR body to add `Tracking plan:` and `Status: in-progress` lines.
- Continue under the full Spec-implementation contract.

## 1e. Pre-flight and claim

Before writing anything, confirm no other run owns the slot.

```bash
CURRENT_USER=$(gh api user --jq '.login')
DATE=$(date +%Y-%m-%d)
SLUG="{slug-or-derived}"
RUN_DIR=".ai/runs/${DATE}-${SLUG}"
PLAN_PATH="${RUN_DIR}/PLAN.md"
HANDOFF_PATH="${RUN_DIR}/HANDOFF.md"
NOTIFY_PATH="${RUN_DIR}/NOTIFY.md"
# Verification is checkpoint-based: ${RUN_DIR}/checkpoint-<N>-checks.md every ~5 Steps.
# Final gate log lives at ${RUN_DIR}/final-gate-checks.md at spec completion.
BASE_BRANCH="$(resolve_base_branch)"   # see references/environment.md §1
BRANCH_PREFIX="{fix for bugfix/remediation work; otherwise feat}"
BRANCH="${BRANCH_PREFIX}/${SLUG}"
```

Branch naming:

- `fix/${SLUG}` when the brief is primarily a bug fix, regression fix, remediation, hardening, or corrective follow-up.
- `feat/${SLUG}` for new capability, scoped refactor, or docs/process automation.
- Never create `codex/...` branches.

A run is **already in progress** when ANY is true: a folder at `$RUN_DIR` (or a legacy flat file
`${RUN_DIR}.md`) exists on `origin/$BASE_BRANCH` or any remote branch; a remote branch
`origin/${BRANCH}` exists; an open PR references `$RUN_DIR` or `$PLAN_PATH`.

| State | `--force`? | Action |
|-------|-----------|--------|
| Nothing exists | — | Claim and proceed. |
| Run folder/branch exists, current user owns it | — | Re-entry; hand off to `om-auto-continue-pr-loop` and stop. |
| Exists, someone else owns it | no | **STOP.** Ask via `AskUserQuestion`: "Run folder/branch for `${SLUG}` already exists (owner: ${owner}). Override and continue?" Only continue on an explicit yes. |
| Exists, someone else owns it | yes | Pick a new dated slug (`${SLUG}-v2` or a time suffix) to avoid clobber; document in the new `PLAN.md` why the original was superseded. |

When an open PR already references the run folder, stop and tell the user to use
`auto-continue-pr {prNumber}` instead. Then proceed to `step-2-plan-and-scaffold.md`.
