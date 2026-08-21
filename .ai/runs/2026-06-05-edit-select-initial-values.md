# Edit Select Initial Values Fix

## Goal

Fix edit forms so saved dictionary and relation select values are populated immediately when the record opens.

## Scope

- Staff team member edit form team select.
- Resources resource edit form resource type select.
- Resources resource edit form capacity unit dictionary select.
- Regression integration coverage for the affected edit screens.

## Non-goals

- No API contract changes.
- No database migrations.
- No design-system restyling beyond what is necessary for the bug fix.
- No unrelated CrudForm behavior changes unless root cause proves shared form state is responsible.

## Implementation Plan

### Phase 1: Root Cause

- Inspect the edit page data mapping, select controls, and dictionary select hydration.
- Identify why saved IDs persist correctly but labels render as empty on initial edit load.

### Phase 2: Fix

- Patch the smallest common surface that preserves saved IDs and displays their labels after option hydration.
- Keep payload shape and optimistic locking behavior unchanged.

### Phase 3: Integration Tests

- Add Playwright regression coverage for staff team member team prefill.
- Add Playwright regression coverage for resource resource type and capacity unit prefill.

### Phase 4: Validation And PR

- Run targeted tests and relevant package checks.
- Run self-review for scope, BC, tenant isolation, and UI patterns.
- Push the branch and open a PR against `develop`.

## Risks

- The same symptom appears in both local relation selects and dictionary-backed selects, so a root-cause fix may involve shared hydration or API response casing.
- Integration tests need stable fixture creation and cleanup without relying on demo data.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Root Cause

- [ ] 1.1 Diagnose edit select hydration

### Phase 2: Fix

- [ ] 2.1 Patch select initial-value hydration

### Phase 3: Integration Tests

- [ ] 3.1 Add staff edit team prefill regression
- [ ] 3.2 Add resources edit dictionary prefill regression

### Phase 4: Validation And PR

- [ ] 4.1 Run validation and self-review
- [ ] 4.2 Push branch and open PR
