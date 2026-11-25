# CRM employment history implementation

Source doc: .ai/specs/2026-11-25-person-company-employment-history.md

Refs #10681
Closes #8390

Record a dated departure on the existing person–company association and let CRM staff find the person under Former employees on the company detail. Preserve current-link semantics for primary companies, reactivation, and existing callers.

## Implementation Plan

### Phase 1 · Store and transition employment status

1. Add the scoped migration and schema snapshot. Keep employment history through active-list lookups, relinking, and person restoration.
2. Implement and cover the scoped end command and route, including the primary mirror, legacy associations, version conflicts and replay.

### Phase 2 · Surface former employees

3. Extend the company People query and integration coverage for the active and former views.
4. Add the guarded date dialog and paged Former employees table. Cover the departure and rejoin flow in Playwright.
5. Archive the capability, document the workflow, run validation and review the PR.

## Progress

PR: #10682

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Store and transition employment status

- [x] 1.1 Add employment fields and preserve history through existing association paths — e5f701129f
- [x] 1.2 Implement the versioned end command and mutation route with replay coverage — e5f701129f

### Phase 2: Surface former employees

- [ ] 2.1 Add the company history reader and affected API integration coverage
- [ ] 2.2 Add the date dialog, former employees table and browser test
- [ ] 2.3 Archive the capability, document the workflow, and complete validation and review
