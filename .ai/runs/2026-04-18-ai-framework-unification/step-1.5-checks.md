# Step 1.5 checks — Tasks table at top of PLAN.md

**Step:** 1.5 Require a top-of-file Tasks table in PLAN.md as the single source of truth for Step status; update skills and this plan.
**Scope:** docs-only.
**Commit:** `93440ec79`.

## What changed

- `PLAN.md` in this run folder now opens with a `## Tasks` markdown table (Phase | Step | Title | Status | Commit) right after the header metadata and before Goal. All existing Steps (1.1 / 1.2 / 1.3 / 1.4 / 1.5 / 2.1) are listed with `Status: done` or `Status: todo`. The old bottom-of-file `## Progress` checkbox section was removed.
- `.ai/runs/README.md` — the `### PLAN.md` subsection now documents the Tasks table as the authoritative status source: required columns, allowed `Status` values (`todo` / `done`), and the parseable row shape.
- `.ai/skills/auto-create-pr/SKILL.md`:
  - Frontmatter `description` mentions the Tasks table.
  - Step 3 draft-plan guidance now demands a top-of-file `## Tasks` table (with the exact column set) instead of the old bottom-of-file `## Progress` checklist.
  - Step 6 post-commit update step now flips the Tasks table's `Status` cell + `Commit` column.
  - Step 11 review-fix guidance writes new `X.Y-review-fix` rows into the Tasks table.
  - PR body template references the Tasks table anchor; "complete" gate checks that every row has `Status: done`.
  - Rules section mandates the Tasks table and forbids the legacy Progress checklist for new runs.
- `.ai/skills/auto-continue-pr/SKILL.md`:
  - Frontmatter `description` + lede mention the Tasks table.
  - Step 3 rewritten: read `HANDOFF.md` first, then parse the top-of-file Tasks table, resume from the first row whose `Status` is not `done`. Legacy `## Progress` fallback retained for pre-migration PRs; the skill migrates to a Tasks table on the first resume commit.
  - Step 4 post-commit update flips the table cells instead of checkboxes.
  - Step 7 review-fix guidance mirrors auto-create-pr.
  - Step 9 "complete" gate checks that every row is `Status: done`.
  - Rules section aligned.

## Verification

- **Typecheck / unit tests / Playwright / i18n:** N/A — docs-only change to skill + plan + README files.
- **Diff re-read:** confirmed no remaining `## Progress`-as-primary references in auto-create-pr. auto-continue-pr explicitly lists `## Progress` only as a legacy fallback. Sibling skills (auto-sec-report, auto-qa-scenarios, auto-update-changelog) reference auto-create-pr step 0 by link and inherit the new contract without needing edits.
- **Table self-check:** the Tasks table in this run's PLAN.md parses: 6 rows, four `done` (1.1–1.4), two `todo` (1.5 and 2.1). First non-done row is 1.5 (this Step) — matches reality.
- **Backward compatibility:** existing PRs that used the old `## Progress` checklist still resume, because auto-continue-pr falls back to the legacy section and migrates on the first resume commit.

## Artifacts

- None. Docs-only change.
