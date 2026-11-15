# Customer detail tab actions

## TLDR

Keep one Add deal or Add person button in each customer detail tab. Retain the section toolbar next to its Link existing action and remove the duplicate tab-header action on both classic and v2 pages.

## Problem Statement

Issue #6859 reports duplicate Add buttons in company Deals/People and person Deals tabs. `DealsSection` and `CompanyPeopleSection` render local buttons and also publish the same action through `onActionChange`.

## Proposed Solution

Make these two sections own their toolbar actions. Preserve the optional callback interface while clearing header actions on mount and unmount, matching `ActivitiesSection`.

## Implementation Plan

1. Add regression coverage for header registration and local creation in both sections.
2. Stop duplicate header registration, retaining local creation/linking controls.
3. Run validation, review and UI evidence checks for company and person detail tabs.

## Overview

Source: https://github.com/open-mercato/open-mercato/issues/6859. This is one UI consistency change within the customers module. Both classic and v2 pages reuse the affected sections.

## Architecture

`DealsSection` and `CompanyPeopleSection` retain their existing section buttons, dialog state and optional `onActionChange` prop. Replace each action-registration effect with a null notification and cleanup, following the existing `ActivitiesSection` precedent. Existing page tab-change handling already clears the header. No page layout or shared tab component changes are needed.

## Data Models and API Contracts

There are no data, API, command, ACL, event, DI or injection contract changes. Existing tenant-scoped queries, guarded mutations, undo behavior and deal/person creation payloads remain in place. The callback type is retained for downstream callers.

## UI/UX

The Deals section keeps Add deal beside Link existing deal. The company People section keeps Add person beside Link existing person. Their tab bars receive no second copy. Other tabs that rely on the header for their only primary action retain that behavior. Empty-state creation affordances and nested linking-dialog actions remain available. Existing translated labels, shared Button components, keyboard interaction and responsive layouts are reused without introducing copy.

[WAI's toolbar guidance](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/) supports grouping related controls; this change only preserves the existing two-button group and does not introduce toolbar semantics or keyboard behavior.

## Acceptance Criteria

- Company classic/v2 Deals and person classic/v2 Deals show one Add deal button outside dialogs, beside Link existing deal.
- Company classic/v2 People shows one Add person button in its section, beside the linking action.
- The retained buttons still open their creation dialogs, and linking remains available.
- The sections publish no non-null header action during loading, loaded, empty, pending or rerendered states, and clear the callback on unmount.
- Notes, addresses, tasks and injected tabs keep their existing actions. Empty-state and nested-dialog creation controls are preserved.

## Edge Cases & Failure Scenarios

Loading and failed requests retain the current local controls and errors. A missing deal scope keeps the local create/link buttons disabled. Pending mutations keep existing disabled states. Mount/unmount callback cleanup cannot leave a stale header button when changing tabs. Callers that omit the optional callback continue to work.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
| --- | --- | --- | --- |
| Retained button loses its dialog handler | Medium | Click assertions against dialog mocks | Full dialog save behavior requires existing integration coverage |
| Header action persists across tabs | Low | Assert null registration and cleanup; check page tab-change reset | v2 handlers retain prior non-null values, but tab changes explicitly reset state |
| A header-only tab loses its action | Medium | Change only the two sections already rendering local controls | Smoke-check other tabs |

Rollback is a code revert; no stored state or migration is involved.

## Phasing

One phase delivers the shared-section correction and its regression tests. Validation and UI evidence follow on the implementation PR.

## Review — 2026-10-03

The approach reuses the module's existing controls, changes no public type or import path, and leaves data isolation and mutation behavior intact. Independent scope-cohesion review passed: both sections enforce one UI invariant; no actionable findings. Visual evidence is deferred to implementation QA because no shared test environment descriptor is present in this checkout.

## Final Compliance Report — 2026-10-03

Reviewed root `AGENTS.md`, `packages/core/AGENTS.md`, `packages/core/src/modules/customers/AGENTS.md`, `.ai/specs/AGENTS.md` and `BACKWARD_COMPATIBILITY.md`.

| Rule | Status | Evidence |
| --- | --- | --- |
| Minimal package/module scope | Compliant | Two customers components and their existing test suites |
| Preserve public contracts and module isolation | Compliant | Optional callback signature retained; no cross-module changes |
| Reuse shared UI and translated copy | Compliant | Existing buttons, dialogs and locale keys reused |
| Tenant scope, encryption, commands and undo | Unchanged | No data access or writes changed |
| Testable plan and reversibility | Compliant | Registration, click and cleanup assertions; code revert |

Data/API/UI descriptions are consistent; no new mutations or cache effects require implementation. Verdict: ready for implementation, with independent scope-cohesion review passed.

## Changelog

- 2026-10-03: Initial design for issue #6859; retain local section actions and remove duplicate tab-header registration.
