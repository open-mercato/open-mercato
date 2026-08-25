# Execution plan — restore reliable backoffice heading structure and keyboard navigation (adopted from PR #5543)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-25 because PR #5543 carried no execution plan.
**PR:** #5543 · **Branch:** `fix/issue-5502-backoffice-heading-skip-link-isolated` · **Base:** `develop`
**Author:** @haxiorz — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Complete issue #5502 with backward-compatible, explicit heading semantics, a keyboard-accessible skip link, and regression coverage that protects representative backoffice page structures.

## Scope

- Preserve the localized app-shell skip link already implemented in the PR.
- Make reusable table and form heading levels explicit without changing their historical section-level defaults.
- Opt top-level pages into page-level headings deliberately.
- Correct the audit-log and message-detail page heading structure.
- Update affected integration assertions and add composed-page accessibility coverage.
- Run the repository validation gate, review the final diff, and push the verified branch.

## Non-goals

- A repository-wide redesign of backend page headers.
- Unrelated design-system cleanup.
- Changes to database schema, API behavior, or authorization.

## Evidence

| Source | Finding |
| --- | --- |
| Issue #5502 | Representative backoffice list/edit routes lacked a reliable page-level heading and the app shell lacked a skip link. |
| PR #5543 diff | The initial implementation added the skip link and changed reusable heading defaults globally. |
| Requested-changes review | Reusable `DataTable` and `CrudForm` consumers need explicit semantic heading levels; audit-log and message-detail pages need stable top-level headings. |
| CI run 32676665003 | Nine integration assertions failed because table headings changed globally from level 2 to level 1. |

## Assumptions

- Existing reusable-component defaults remain section-level (`h2`) for backward compatibility.
- Top-level list/edit/detail pages opt into `h1` explicitly.
- The skip link continues targeting the existing `#main-content` landmark.

## Risks

- Missing a composed or modal consumer could introduce duplicate page headings.
- Updating assertions without checking the composed page could encode an invalid hierarchy.
- Current `develop` may add overlapping UI changes that require conflict resolution before implementation.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Add localized skip link and initial backoffice heading coverage — 374c76f0

### Phase 2: Restore compatible component semantics

- [x] 2.1 Merge current `develop` without rewriting PR history and resolve conflicts — 9757da47
- [x] 2.2 Add explicit backward-compatible heading-level APIs and update page/section consumers — fa1c5a99

### Phase 3: Repair missing page headings

- [x] 3.1 Give audit-log and message-detail pages stable top-level headings — a07b945d

### Phase 4: Add regression coverage

- [ ] 4.1 Update broken integration assertions and add composed heading/skip-link coverage

### Phase 5: Verify and publish

- [ ] 5.1 Run focused and full validation, review, and push final fixes
