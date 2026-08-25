# PR #5543 continuation plan

Origin: adopted from PR #5543

## Goal

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

- [x] 1.1 Add localized skip link and initial backoffice heading coverage — 374c76f0
- [ ] 2.1 Merge current `develop` without rewriting PR history and resolve conflicts
- [ ] 2.2 Add explicit backward-compatible heading-level APIs and update page/section consumers
- [ ] 3.1 Give audit-log and message-detail pages stable top-level headings
- [ ] 4.1 Update broken integration assertions and add composed heading/skip-link coverage
- [ ] 5.1 Run focused and full validation, review, and push final fixes
