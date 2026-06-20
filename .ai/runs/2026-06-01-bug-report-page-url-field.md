# Execution Plan: Add page-URL field to bug report template

## Goal

Add a dedicated field to `.github/ISSUE_TEMPLATE/bug_report.md` where reporters can paste the link to the subpage on which the bug occurs.

## Scope

- Edit only `.github/ISSUE_TEMPLATE/bug_report.md`.
- Add a clear "Page URL" / "Affected page link" section so reporters supply the URL of the page where the bug appears.

## Non-goals

- No changes to other issue/PR templates.
- No changes to issue automation, labels, or workflows.
- No restructuring of the existing template sections beyond adding the new field.

## Implementation Plan

### Phase 1: Add the page-URL field

- Insert a new section capturing the link to the affected subpage, placed where reporters naturally provide environment/reproduction context.
- Keep wording bilingual-friendly and consistent with the existing English template tone.

## Risks

- Trivial docs change; the only risk is malformed frontmatter. Mitigated by re-reading the diff and validating YAML frontmatter remains intact.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Add the page-URL field

- [x] 1.1 Add a "Page URL" section to bug_report.md — e66d4fc2d
