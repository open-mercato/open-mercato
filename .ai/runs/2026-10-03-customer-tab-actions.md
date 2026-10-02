# Customer detail tab action deduplication

Source doc: .ai/specs/2026-10-03-customer-tab-actions.md
Spec PR: #6873
Issue: #6859

## Goal

Show one Add action in customer Deals and company People tabs, alongside their existing linking controls.

## Scope

Change `DealsSection`, `CompanyPeopleSection` and their existing tests. Keep callback types, local controls, dialogs, empty states, translations and all data paths.

## Implementation Plan

### Phase 1: Correct duplicated actions

1.1 Add regression tests proving local creation works without header registration.
1.2 Replace duplicate action registration with null notification and cleanup.

### Phase 2: Validate and publish

2.1 Run configured validation, review and UI evidence checks, documenting external blockers.

## Risks

Preserve dialog click handlers and tab cleanup. Dependencies are installed with the immutable lockfile; broad gate and live environment availability are not yet verified.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Correct duplicated actions

- [ ] 1.1 Add regression tests proving local creation works without header registration.
- [ ] 1.2 Replace duplicate action registration with null notification and cleanup.

### Phase 2: Validate and publish

- [ ] 2.1 Run configured validation, review and UI evidence checks, documenting external blockers.
