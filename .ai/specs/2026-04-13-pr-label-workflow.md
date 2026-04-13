# SPEC: PR Label Workflow — Streamlined Review & QA Pipeline

**Date**: 2026-04-13
**Status**: Draft
**Author**: Piotr Karwatka + Claude

---

## Problem

The repository has **50+ labels**, many redundant or unused. Key issues:

| Problem | Examples |
|---------|----------|
| **Duplicate labels** | `merge-queue` vs `merge queue`, `changes-requested` vs `changes requested`, `approved` vs `PR review accepted` |
| **Unused/stale labels** | `PR review`, `discussion`, `failing-ci`, `preview-env`, `changes-resolved`, `CLA`, `bounty-hunting` |
| **No clear QA gate** | QA labels exist (`QA in progress`, `QA confirmed`, `QA: Fixes required`) but aren't wired into any automated flow |
| **No single source of truth** | A PR can have `approved` + `changes-requested` simultaneously — no state machine |
| **Skills and humans out of sync** | `review-pr` skill sets `merge-queue`/`changes-requested`, but humans use different label names |

## Design Principles

1. **Labels are a state machine** — a PR is in exactly one pipeline state at a time
2. **Minimal label set** — fewer labels = less confusion, easier to enforce
3. **Skills and humans use the same labels** — one flow for both
4. **Parallel tracks** — CI, code review, and QA run concurrently where possible
5. **GitHub-native** — use `gh` CLI and GitHub Actions; no external tools

---

## Proposed Label Set

### Pipeline State Labels (mutually exclusive — only ONE at a time)

These track where a PR is in the pipeline. The `review-pr` skill, QA humans, and merge automation all operate on these.

| Label | Color | Set by | Meaning |
|-------|-------|--------|---------|
| `review` | `#1d76db` blue | Author / automation | PR is ready for code review (human or skill) |
| `changes-requested` | `#BA6609` orange | Reviewer / skill | Code review found issues; author must fix |
| `qa` | `#12B0D1` cyan | Reviewer / skill | Code review passed → waiting for QA testing |
| `qa-failed` | `#bfb420` yellow | QA tester | QA found issues; author must fix |
| `merge-queue` | `#0E8A16` green | QA / reviewer | All gates passed → ready to merge |
| `blocked` | `#aaaaaa` grey | Anyone | Blocked on external dependency or decision |
| `do-not-merge` | `#DF0D61` red | Anyone | Explicitly held from merging (WIP, discussion, etc.) |

### Category Labels (additive — multiple allowed)

These classify what the PR is about. Applied once, never removed.

| Label | Color | Purpose |
|-------|-------|---------|
| `bug` | `#d73a4a` | Bug fix |
| `feature` | `#1a714e` | New feature |
| `refactor` | `#6442dc` | Code refactoring |
| `security` | `#D93F0B` | Security fix or hardening |
| `dependencies` | `#0366d6` | Dependency updates (Dependabot) |
| `enterprise` | `#aaaaaa` | Enterprise-only change |

### Meta Labels (additive — situational)

| Label | Color | Purpose |
|-------|-------|---------|
| `needs-qa` | `#d876e3` purple | PR requires manual QA before merge (set by author or reviewer) |
| `skip-qa` | `#c5def5` light blue | Explicitly mark that QA is not needed (docs, deps, CI-only) |

**Total: 15 labels** (down from 50+)

---

## The Flow

```
┌─────────────┐
│  PR opened   │
│  label: review │
└──────┬──────┘
       │
       ├──── CI runs automatically (GitHub Actions)
       │     (no label needed — CI status is native to GitHub)
       │
       ▼
┌──────────────┐    ┌──────────────────┐
│  Code Review  │◄──│  /review-pr       │  ← skill or human
│  (parallel    │    │  sets label based │
│  with CI)     │    │  on outcome       │
└──────┬───────┘    └──────────────────┘
       │
       ├─── Findings? ──► label: changes-requested
       │                     │
       │                     ▼
       │                  Author fixes → pushes → label: review (restart)
       │
       ├─── Approved + has `needs-qa`? ──► label: qa
       │                                      │
       │                                      ▼
       │                               ┌──────────────┐
       │                               │  QA Testing   │  ← human
       │                               │  (manual)     │
       │                               └──────┬───────┘
       │                                      │
       │                          ├─── Pass ──► label: merge-queue
       │                          └─── Fail ──► label: qa-failed
       │                                           │
       │                                           ▼
       │                                    Author fixes → label: qa (restart)
       │
       └─── Approved + no `needs-qa`? ──► label: merge-queue
                                              │
                                              ▼
                                       ┌──────────────┐
                                       │  Merge        │  ← maintainer or
                                       │  (manual/auto)│    auto-merge
                                       └──────────────┘
```

### State Transitions (explicit rules)

| From | To | Trigger | Who |
|------|----|---------|-----|
| *(new PR)* | `review` | PR opened/ready for review | Author |
| `review` | `changes-requested` | Code review finds issues | `review-pr` skill or human reviewer |
| `review` | `qa` | Code review approves + `needs-qa` present | `review-pr` skill or human reviewer |
| `review` | `merge-queue` | Code review approves + no `needs-qa` | `review-pr` skill or human reviewer |
| `changes-requested` | `review` | Author pushes fixes | Author (or automation on push) |
| `qa` | `merge-queue` | QA passes | QA tester |
| `qa` | `qa-failed` | QA finds issues | QA tester |
| `qa-failed` | `qa` | Author pushes fixes | Author |
| *(any)* | `blocked` | External blocker | Anyone |
| *(any)* | `do-not-merge` | Hold from merge | Anyone |
| `blocked` | `review` | Blocker resolved | Anyone |

---

## Skill Integration Changes

### `review-pr` skill changes

Current behavior already uses `merge-queue` and `changes-requested`. Changes needed:

1. **Add `review` label awareness** — when starting a review, verify PR has `review` label (or apply it)
2. **QA gate logic** — after approving:
   - If `needs-qa` label is present → set `qa` label (not `merge-queue`)
   - If `needs-qa` absent → set `merge-queue` label (current behavior)
3. **Remove old label names** — stop referencing `approved`, `merge queue` (space), `changes requested` (space)
4. **Label transition helper** — extract a shared `setPipelineLabel(prNumber, newLabel)` function that:
   - Adds the new pipeline label
   - Removes all other pipeline labels
   - Uses GraphQL (current approach) for atomicity

### `fix-github-issue` skill changes

1. When opening a PR, apply `review` label
2. Apply `skip-qa` for small/trivial fixes (single-file, test-only, etc.)

### `check-and-commit` skill changes

No changes needed — operates before PR creation.

### New skill: `merge-buddy`

A triage skill invoked via `/merge-buddy`. Scans **all open PRs** and produces a merge-readiness report — a table of PRs that can be merged right now (zero blockers) plus a secondary table of PRs that are close but have specific remaining issues.

#### Workflow

1. **Fetch all open PRs** with metadata:
   ```bash
   gh pr list --state open --json number,title,url,author,labels,reviewDecision,mergeable,mergeStateStatus,headRefName,baseRefName,updatedAt,isDraft --limit 100
   ```

2. **For each PR, collect gate status**:
   - **CI status**: `gh pr checks <number> --json name,state` — all required checks must be `SUCCESS`
   - **Review decision**: must be `APPROVED` (from `reviewDecision`)
   - **Mergeable**: `mergeable` must be `MERGEABLE`, `mergeStateStatus` must not be `DIRTY` or `BLOCKED`
   - **Not draft**: `isDraft` must be `false`
   - **No blocking labels**: must not have `changes-requested`, `qa-failed`, `blocked`, `do-not-merge`
   - **QA gate**: if `needs-qa` is present, must also have `merge-queue` label (meaning QA passed)
   - **No merge conflicts**: `mergeable !== 'CONFLICTING'`

3. **Classify each PR** into one of:
   - **Ready to merge** — all gates pass
   - **Almost ready** — only 1-2 minor blockers (e.g., CI pending, awaiting review but no changes requested)
   - **Blocked** — has hard blockers (conflicts, `do-not-merge`, failing CI, changes requested)

4. **Output a formatted report**:

   ```
   ## Merge Buddy Report — {date}

   ### Ready to Merge (X PRs)

   | # | Title | Author | Labels | Age |
   |---|-------|--------|--------|-----|
   | [#123](url) | Fix auth flow | @alice | `bug` | 2d |

   ### Almost Ready (Y PRs)

   | # | Title | Author | Blocker | Action needed |
   |---|-------|--------|---------|---------------|
   | [#456](url) | Add catalog search | @bob | CI pending | Wait ~5min or re-run |

   ### Blocked (Z PRs)

   | # | Title | Blocker(s) |
   |---|-------|------------|
   | [#789](url) | Refactor events | Merge conflicts, changes-requested |
   ```

5. **For "Ready to Merge" PRs**, offer to merge them (ask user for confirmation before each merge or offer a "merge all" option).

#### Rules

- Never merge without explicit user confirmation
- Sort "Ready to Merge" by age (oldest first — clear the backlog)
- Sort "Almost Ready" by how close they are (fewest blockers first)
- Skip draft PRs entirely from the report
- The report must be concise — no PR descriptions, just the table
- If zero PRs are ready, say so clearly and highlight the top "Almost Ready" candidates

### New skill: `review-prs`

A **day-start triage skill** invoked via `/review-prs`. Finds all open PRs that have not been reviewed yet and reviews them one by one, starting from the most recent. Designed as a morning routine — run it at the start of your day to clear the review backlog.

#### Workflow

1. **Fetch open PRs needing review**:
   ```bash
   gh pr list --state open --json number,title,url,author,labels,reviewDecision,createdAt,updatedAt,isDraft --limit 50
   ```

2. **Filter to unreviewed PRs**:
   - `reviewDecision` is `null` or empty (no review submitted yet)
   - Not a draft (`isDraft === false`)
   - Does not have `do-not-merge` or `blocked` labels (skip held PRs)
   - Author is not the current user (don't self-review)

3. **Sort by recency** — most recently created first (clear fresh PRs before stale ones).

4. **Present the queue**:
   ```
   ## Review Queue — {date}

   Found {N} unreviewed PRs (newest first):

   | # | Title | Author | Created | Labels |
   |---|-------|--------|---------|--------|
   | [#456](url) | Add catalog search | @bob | 2h ago | `feature` |
   | [#445](url) | Fix auth redirect | @alice | 1d ago | `bug` |
   ```

5. **Sequential review loop** — for each PR in the queue:
   a. Show: `Reviewing PR #{number}: {title} ({N} of {total})`
   b. Invoke the full `review-pr` skill (including autofix flow)
   c. After review completes, show the verdict and move to the next PR
   d. Between reviews, briefly report progress: `Reviewed {done}/{total}. Next: #{number}`

6. **Final summary** after all reviews:
   ```
   ## Review Session Complete

   | # | Title | Verdict | Label |
   |---|-------|---------|-------|
   | #456 | Add catalog search | APPROVED | merge-queue |
   | #445 | Fix auth redirect | CHANGES REQUESTED (auto-fixed → APPROVED) | merge-queue |

   Reviewed: {N} PRs
   Approved: {X}
   Changes requested: {Y} ({Z} auto-fixed)
   ```

#### Rules

- Always start from the most recent unreviewed PR
- Never skip a PR silently — if a PR can't be reviewed (e.g., CI not finished), note it and move on
- Use the full `review-pr` skill for each PR (with autofix)
- After the review session, optionally invoke `merge-buddy` to show what's now ready to merge
- If there are zero unreviewed PRs, say so and suggest running `/merge-buddy` instead

### QA helper commands

Add convenience commands to `AGENTS.md` or a lightweight skill:

```bash
# QA approves a PR
gh pr edit <number> --remove-label "qa" --add-label "merge-queue"

# QA rejects a PR
gh pr edit <number> --remove-label "qa" --add-label "qa-failed"

# Author requests re-QA after fix
gh pr edit <number> --remove-label "qa-failed" --add-label "qa"
```

---

## Implementation Plan

### Phase 1: Label Cleanup (gh CLI)

Delete redundant/unused labels and normalize names.

**Labels to DELETE** (27 labels):

```
# Duplicates (keeping the hyphenated versions)
merge queue
changes requested
PR review accepted
approved
PR review

# Unused / stale
good first issue
help wanted
invalid
wontfix
duplicate
question
in-progress
resolved
needs-info
needs-response
stale
discussion
failing-ci
changes-resolved
CLA
bounty-hunting
preview-env
codex
framework
domain
integration
quality improvement
for-core-contributors
```

**Labels to RENAME**:

| Old name | New name |
|----------|----------|
| `QA in progress` | *(delete — replaced by `qa`)* |
| `QA confirmed` | *(delete — replaced by `merge-queue`)* |
| `QA: Fixes required` | *(delete — replaced by `qa-failed`)* |
| `do not merge` | `do-not-merge` *(normalize)* |
| `javascript` | *(delete — not useful)* |
| `github_actions` | *(delete — not useful)* |
| `released` | *(delete — use GitHub releases instead)* |
| `ui` | *(delete — not used consistently)* |
| `missing-integration-tests` | *(delete — code review covers this)* |
| `rejected` | *(delete — use `changes-requested` or close PR)* |

**Labels to CREATE**:

| Name | Color | Description |
|------|-------|-------------|
| `review` | `#1d76db` | Ready for code review |
| `qa` | `#12B0D1` | Waiting for QA testing |
| `qa-failed` | `#bfb420` | QA found issues |
| `needs-qa` | `#d876e3` | Requires manual QA before merge |
| `skip-qa` | `#c5def5` | QA not required |

**Labels to KEEP** (already correct):

| Name | Notes |
|------|-------|
| `merge-queue` | Already used by `review-pr` skill |
| `changes-requested` | Already used by `review-pr` skill |
| `blocked` | Keep as-is |
| `do-not-merge` | Rename from `do not merge` |
| `bug` | Category |
| `feature` | Category |
| `refactor` | Category |
| `security` | Category |
| `dependencies` | Category (Dependabot) |
| `enterprise` | Category |
| `documentation` | Category |
| `enhancement` | *(merge into `feature`? or keep for minor improvements)* |

### Phase 2: Skill Updates

1. Update `review-pr` SKILL.md — add QA gate logic and `review` label handling
2. Update `fix-github-issue` SKILL.md — apply `review` + optional `skip-qa` on PR creation
3. Extract `setPipelineLabel` helper into a shared skill utility or inline in both skills
4. Create `merge-buddy` skill — `.ai/skills/merge-buddy/SKILL.md` — scan all open PRs, classify merge-readiness, output actionable table
5. Create `review-prs` skill — `.ai/skills/review-prs/SKILL.md` — day-start triage that reviews all unreviewed PRs (newest first) using the `review-pr` skill, then optionally runs `merge-buddy`

### Phase 3: AGENTS.md Updates

1. Add **PR Workflow** section to root `AGENTS.md` documenting the label state machine
2. Add QA quick-reference commands
3. Document when to apply `needs-qa` vs `skip-qa`:
   - `needs-qa`: UI changes, new features, sales/order flows, anything customer-facing
   - `skip-qa`: dependency bumps, docs, CI config, refactors with full test coverage, typo fixes

### Phase 4: Automation (optional, GitHub Actions)

A lightweight workflow that enforces the state machine:

```yaml
# .github/workflows/pr-labels.yml
# On PR labeled/unlabeled:
#   - Ensure only one pipeline label exists
#   - On push to PR with changes-requested → auto-switch to review
#   - On push to PR with qa-failed → auto-switch to qa
```

---

## Migration

1. Run Phase 1 label cleanup script (single `gh` session)
2. Re-label open PRs with new labels based on their current state
3. Update skills (Phase 2)
4. Update AGENTS.md (Phase 3)
5. Announce to team

### Migration Script (Phase 1)

```bash
#!/bin/bash
# Run from repo root with gh authenticated

# --- Create new labels ---
gh label create "review" --color "1d76db" --description "Ready for code review" --force
gh label create "qa" --color "12B0D1" --description "Waiting for QA testing" --force
gh label create "qa-failed" --color "bfb420" --description "QA found issues" --force
gh label create "needs-qa" --color "d876e3" --description "Requires manual QA before merge" --force
gh label create "skip-qa" --color "c5def5" --description "QA not required" --force

# --- Update existing labels ---
gh label edit "do not merge" --name "do-not-merge" --description "Held from merging" 2>/dev/null
gh label edit "merge-queue" --description "All gates passed — ready to merge" --force
gh label edit "changes-requested" --description "Code review found issues" --force
gh label edit "blocked" --description "Blocked on external dependency" --force

# --- Delete redundant labels ---
for label in \
  "merge queue" "changes requested" "PR review accepted" "approved" "PR review" \
  "good first issue" "help wanted" "invalid" "wontfix" "duplicate" "question" \
  "in-progress" "resolved" "needs-info" "needs-response" "stale" "discussion" \
  "failing-ci" "changes-resolved" "CLA" "bounty-hunting" "preview-env" \
  "codex" "framework" "domain" "integration" "quality improvement" \
  "for-core-contributors" "QA in progress" "QA confirmed" "QA: Fixes required" \
  "javascript" "github_actions" "released" "ui" "missing-integration-tests" \
  "rejected" "qa:qa1" "enhancement"
do
  gh label delete "$label" --yes 2>/dev/null
done

echo "Done. Labels cleaned up."
```

---

## Final Label Inventory (15 labels)

| # | Label | Type | Color |
|---|-------|------|-------|
| 1 | `review` | Pipeline | 🔵 blue |
| 2 | `changes-requested` | Pipeline | 🟠 orange |
| 3 | `qa` | Pipeline | 🔵 cyan |
| 4 | `qa-failed` | Pipeline | 🟡 yellow |
| 5 | `merge-queue` | Pipeline | 🟢 green |
| 6 | `blocked` | Pipeline | ⚪ grey |
| 7 | `do-not-merge` | Pipeline | 🔴 red |
| 8 | `bug` | Category | 🔴 red |
| 9 | `feature` | Category | 🟢 green |
| 10 | `refactor` | Category | 🟣 purple |
| 11 | `security` | Category | 🟠 orange |
| 12 | `dependencies` | Category | 🔵 blue |
| 13 | `enterprise` | Category | ⚪ grey |
| 14 | `needs-qa` | Meta | 🟣 purple |
| 15 | `skip-qa` | Meta | 🔵 light blue |

---

## Open Questions

1. **Auto-merge on `merge-queue`?** — Should we add a GitHub Action that auto-merges when `merge-queue` is applied and CI is green?
2. **`documentation` label** — Keep as a category label (#16) or drop it?
3. **Who decides `needs-qa`?** — Author on PR creation, or reviewer during code review? (Spec assumes: either, but reviewer has final say)
4. **Dependabot PRs** — Auto-apply `skip-qa` + `review` on Dependabot PRs?
