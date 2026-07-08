---
name: om-prepare-issue
description: Capture a feature the user wants built later without building it now. Researches and writes a spec via the om-spec-writing conventions, ships it as a docs-only spec PR against `develop` (reusing om-auto-create-pr mechanics; `skip-qa`, `documentation`), then opens a tracking GitHub issue that links the spec path and the spec PR so the work can be picked up later with om-auto-fix-github or om-implement-spec. Use for "park this idea", "write a spec and an issue for later", "prepare an issue to build X eventually", "spec it out but don't implement yet".
---

# Prepare Issue (deferred work)

Turn a "we want this eventually" brief into durable, actionable backlog without implementing it. The deliverable is three linked artifacts:

1. A **spec** under `.ai/specs/` written to `om-spec-writing` standards.
2. A **docs-only spec PR** against `develop` that adds only that spec file (`documentation`, `skip-qa`).
3. A **GitHub issue** to implement the spec, linking both the spec path and the spec PR.

This skill is for **deferred** work. It does NOT implement the feature. If the user wants the feature built now, hand off to `om-auto-create-pr` (free-form task) or `om-implement-spec` (after the spec exists) instead.

This skill reuses the worktree/branch/commit/label discipline of `.agents/skills/om-auto-create-pr/SKILL.md` for the PR, the spec methodology of `.ai/skills/om-spec-writing/SKILL.md` for the spec, and the issue-claim/linking conventions of `.ai/skills/om-auto-fix-github/SKILL.md` for the tracking issue. Read those before deviating.

## Arguments

- `{brief}` (required) — free-form description of the feature to capture. One sentence or several paragraphs.
- `--slug <kebab-case>` (optional) — override the slug used in the spec filename and branch. Default: derived from the brief.
- `--enterprise` (optional) — write the spec under `.ai/specs/enterprise/` instead of `.ai/specs/` (commercial scope). Default: OSS scope (`.ai/specs/`).
- `--priority <low|medium|high|extreme>` (optional) — priority label for the tracking issue. Default: unset (treated as `priority-medium`).
- `--risk <low|medium|high>` (optional) — risk label for the tracking issue, describing the expected blast radius of the eventual change. Default: unset (treated as `risk-medium`).
- `--no-issue` (optional) — write the spec and open the spec PR, but skip issue creation. Use when the user only wants the spec on record.
- `--force` (optional) — bypass the claim-conflict check when a previous run left a branch or spec file behind.

## Workflow

### 0. Pre-flight and claim

Follow `.agents/skills/om-auto-create-pr/SKILL.md` step 0 verbatim. This is new docs work, so the branch MUST use the `feat/` prefix.

```bash
CURRENT_USER=$(gh api user --jq '.login')
DATE=$(date -u +%Y-%m-%d)
SLUG="{slug-or-derived}"
SPEC_DIR=".ai/specs"            # or .ai/specs/enterprise when --enterprise
SPEC_PATH="${SPEC_DIR}/${DATE}-${SLUG}.md"
BRANCH="feat/prepare-${SLUG}"
```

A run is **already in progress** when ANY of these is true (treat as re-entry if the current user owns it, otherwise STOP and ask via `AskUserQuestion` unless `--force`):

- A file at `$SPEC_PATH` already exists on `origin/develop` or any remote branch.
- A remote branch `origin/${BRANCH}` already exists.
- An open PR already adds `$SPEC_PATH`.
- An open issue already tracks the same feature (search before creating — see step 5).

### 1. Triage the brief before writing

Read enough context to write a credible spec, not to build it:

- Match the brief to rows in the root `AGENTS.md` Task Router and read every matching guide (module, UI, search, events, etc.).
- Check `.ai/specs/` and `.ai/specs/enterprise/` for an existing spec covering the same area. If one exists, extend or supersede it instead of duplicating — confirm the direction with the user via `AskUserQuestion`.
- Skim `.ai/lessons.md`.

Reduce the brief to: goal in one sentence, affected modules/packages, and the rough scope. If a wrong assumption would force a spec rewrite, surface it as an Open Question (see step 2) rather than guessing.

### 2. Write the spec with om-spec-writing

Follow `.ai/skills/om-spec-writing/SKILL.md` end to end. Key points for this skill:

- Create the spec at `$SPEC_PATH` (`{YYYY-MM-DD}-{kebab-title}.md`, `date` UTC). Enterprise scope goes under `.ai/specs/enterprise/`.
- Start with a **Skeleton Spec** (TLDR + 2-3 key sections). If critical unknowns exist, add a numbered **Open Questions** block right after the TLDR and **STOP** — ask the user before filling in the rest. This is a hard gate; do not invent answers to architecture-blocking questions.
- After answers land, expand the spec: Problem Statement, Proposed Solution, Phasing (stories), Implementation Plan (testable Steps), and the architectural concerns the `om-spec-writing` lens requires (singular naming, FK-only cross-module links, `organization_id` scoping, undoability, zod validation, encryption maps for sensitive columns, canonical primitives, Design System tokens, Frontend Architecture Contract when UI is touched).
- The spec MUST include an **integration coverage** section listing the affected API paths and key UI paths the implementer will need to test (root `AGENTS.md` → Documentation and Specifications requires this for every feature).
- Apply the `om-spec-writing` Spec Checklist and Final Compliance Review before finalizing.

Do NOT write any implementation code, migrations, or module files. The only file this run adds is the spec.

### 3. Isolated worktree, branch, and first commit

Follow `.agents/skills/om-auto-create-pr/SKILL.md` steps 4–5 verbatim. Base is always `develop`. Commit the spec as the first commit, then push.

```bash
git add "$SPEC_PATH"
git commit -m "docs(spec): add ${SLUG} spec for deferred implementation"
git push -u origin "$BRANCH"
```

If the Open Questions gate in step 2 is still unresolved, do not create the worktree or push — resolve the questions with the user first.

### 4. Open the spec PR

This is a docs-only / spec-only PR. The minimum validation gate is the docs-only gate from `.agents/skills/om-auto-create-pr/SKILL.md` step 7:

- `yarn lint` if it catches markdown/YAML issues.
- `git diff --check` — no trailing whitespace, no merge markers.
- A manual re-read of the spec.

Never run the full code gate (`yarn test` / `yarn typecheck` / `yarn build:app`) for a spec-only run.

Open the PR against `develop`:

```bash
gh pr create --base develop \
  --title "docs(spec): ${SLUG} — deferred implementation spec" \
  --body-file <(cat <<'EOF'
## Goal
- {one-line feature summary from the brief}

## What this PR adds
- Spec only: `{SPEC_PATH}`. No implementation, no code, no migrations.

## Why now
- Captures deferred work as a reviewable spec so it can be implemented later via `om-implement-spec` / `om-auto-fix-github`.

## Tracking issue
- {issue URL — filled in after step 5, or "see follow-up comment"}

## Backward Compatibility
- No contract surface changes (spec document only).
EOF
)
```

Apply labels per root `AGENTS.md` PR workflow, each followed by a short explanatory comment (per the `om-auto-create-pr` label-comment rule):

- `review` — "PR is ready for code review."
- `documentation` — "spec-only deliverable under `.ai/specs/`."
- `skip-qa` — "spec/docs-only; no customer-facing runtime behavior."

Never add `needs-qa` to a prepare-issue PR — it adds no runtime behavior to exercise.

### 5. Create the tracking issue

Skip this step only when `--no-issue` was passed.

First, avoid duplicates — search for an existing tracking issue:

```bash
gh issue list --state open --search "${SLUG} in:title,body" --json number,title,url
```

If a credible duplicate exists, link the spec/PR in a comment on that issue instead of opening a new one, and report which issue you reused.

Otherwise create the issue. It MUST link the spec path and the spec PR, and name the recommended implementer skill so a future run can pick it up:

```bash
gh issue create \
  --title "Implement: {feature title}" \
  --label "feature" \
  --body-file <(cat <<'EOF'
## Summary
- {one-line feature summary from the brief}

## Spec
- Implementation spec: `{SPEC_PATH}`
- Spec PR: {spec PR URL}

## How to implement
- Once the spec PR merges, run `/om-implement-spec {SPEC_PATH}` (multi-phase) or `/om-auto-fix-github {thisIssueNumber}` (smaller scope).
- Do not start implementation until the spec PR is merged into `develop`.

## Scope notes
- {affected modules/packages}
- {non-goals captured in the spec}
EOF
)
```

Label rules for the issue:

- Always add the `feature` category label (or `refactor` / `bug` when the brief is clearly one of those).
- Add `enterprise` when `--enterprise` was passed.
- Add a priority label only when `--priority` was passed (`priority-low` / `priority-medium` / `priority-high` / `priority-extreme`); otherwise leave priority unset (treated as `priority-medium`).
- Add a risk label only when `--risk` was passed (`risk-low` / `risk-medium` / `risk-high`); otherwise leave risk unset (treated as `risk-medium`). The PR that fixes the issue inherits this risk label when present (see `om-auto-fix-github` / `om-auto-verify-and-fix-github`).
- Do NOT add pipeline labels (`review`, `qa`, `merge-queue`, …) to the issue — those are PR-only.

### 6. Cross-link the artifacts

Make the three artifacts point at each other so the trail is navigable:

- Edit the spec PR body (or post a comment) so the `Tracking issue` line resolves to the real issue URL.
- The issue already links the spec path and spec PR from step 5.
- Optionally add a one-line reference to the issue at the top of the spec (e.g. `Tracking issue: #{n}`), committed and pushed to the PR branch.

### 7. Cleanup and report back

Clean up any worktree you created (per `.agents/skills/om-auto-create-pr/SKILL.md` step 13). Then report:

```text
prepare-issue: {brief}
Spec: {SPEC_PATH}
Spec PR: {url}
Tracking issue: {url | skipped (--no-issue) | reused #{n}}
Branch: {branch}
Status: {spec-and-issue ready | open-questions pending — answer to continue}
```

If the Open Questions gate is still pending, say so explicitly and list the unanswered questions — do not claim the spec is complete.

## Rules

- This skill captures deferred work only. NEVER implement the feature, write module code, or run migrations. The only file added is the spec.
- Always write the spec with `om-spec-writing` standards, including the Open Questions hard gate and the integration-coverage section.
- The spec PR is docs-only: run only the docs-only validation gate, never the full code gate.
- Spec PR labels are `review`, `documentation`, `skip-qa` — never `needs-qa`. Post a short comment after each label.
- Base branch is always `develop`. Branch uses the `feat/prepare-<slug>` prefix; never `codex/`.
- The tracking issue MUST link the spec path and the spec PR, and name the recommended implementer skill (`om-implement-spec` / `om-auto-fix-github`).
- Search for an existing tracking issue before creating a new one; reuse via comment if a credible duplicate exists.
- Respect existing claims/locks per `om-auto-create-pr` step 0 and `om-auto-fix-github` step 0; never silently clobber another actor's branch, spec file, or issue.
- Never paste secrets, tokens, or `.env` content into the spec, PR, or issue.
