# Customer task count badge

## TLDR

The person profile Tasks tab already renders a badge from `counts.todos`, but compatibility-mode totals omit tasks created through the todo adapter. Align person and company profile totals with the existing task-list merge rules.

## Problem Statement

Issue #6068 shows two tasks beside a Tasks tab without a badge. Compatibility-mode task creation writes `CustomerInteraction` records, while profile totals count only `CustomerTodoLink` records.

## Proposed Solution

Reuse the task-list compatibility rules in a shared customers helper and call it from both profile overview routes. Preserve existing tab rendering, permissions, storage, and mutation flows.

## Resolved assumptions (autonomous defaults)

| Question | Decision | Reason |
| --- | --- | --- |
| Restore a Tasks tab on the redesigned company profile? | Preserve its layout; correct its existing overview total. | The request concerns the count of linked tasks, and adding a new company navigation flow would expand the scope. |
| Count only incomplete tasks? | Count all visible tasks, including completed tasks. | The Tasks section lists both, as shown in the issue screenshot. |

## Overview and Architecture

Add a narrowly scoped count helper to `customers/lib/todoCompatibility.ts`. Both person and company detail APIs call it when assembling `counts.todos`. The person V2 page already forwards that total to `PersonDetailTabs`, which uses the shared `TabsTrigger` count badge and refreshes its overview after task mutations.

In unified mode, preserve the existing count of non-deleted task interactions. In compatibility mode, count active task interactions with `source: adapter:todo` for the current entity, tenant and organization. Add a database count of legacy links whose `todoId` has no matching scoped adapter interaction, using an ORM subquery rather than materializing task identities. Deleted adapter interactions still suppress their old links, as the task-list merge already does. Native interactions with another source remain excluded in compatibility mode. Do not derive totals from bounded task previews.

Use MikroORM count filters and a scoped QueryBuilder subquery. No cross-module lookup, new dependency, tab primitive, or migration is needed. The existing optional example todo provider stays optional.

## Data Models and API Contracts

Keep the existing `CustomerTodoLink` and `CustomerInteraction` schema. `GET /api/customers/people/:id` and `GET /api/customers/companies/:id` retain their response shapes and authorization; only the value of the existing numeric `counts.todos` field is corrected. Queries retain explicit entity, tenant and organization predicates. The helper reads no task title, body or custom fields.

## UI/UX and Acceptance Criteria

- A person with two adapter-created tasks sees the existing Tasks badge showing 2 before opening the tab.
- Empty task sets retain the existing hidden-zero badge behavior; the existing 999+ formatting remains.
- Creating or deleting a task updates the total through the existing overview reload.
- Completed tasks count; bridged tasks count once; deleted bridges do not resurrect old links.
- Both overview routes report the same merged-task semantics, independently of preview limits.
- The company layout and retained legacy profile navigation stay unchanged.

The issue screenshot and current shared tab implementation provide the visual reference. A local test-environment descriptor is absent, so no current-app screenshot or speculative HTML mockup is required to choose the existing badge style.

## Edge Cases and Failure Scenarios

Missing adapter rows leave legacy counts unchanged. Deleted bridges suppress legacy links. Organization and tenant mismatches cannot influence another profile's total. Query failures follow each route's existing error response. The helper is invoked within the routes' existing parallel enrichment group.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual impact |
| --- | --- | --- | --- |
| Double counting or reviving bridged tasks | Medium | Match the task list's ID override rules, including deleted bridges; regression fixtures cover both. | None expected for the supported merge semantics. |
| Slow profiles with many adapter tasks | Low | Aggregate in the database and suppress bridges through a scoped subquery; do not fetch task histories or expand ID lists. | Database work scales with the scoped task set; application memory and parameter count stay bounded. |
| Tenant or organization leakage | High | Require and test explicit scope on every query. | Existing route scope remains authoritative. |

Rollback is a code revert; no persisted state changes. No breaking API, event, schema, permission or replacement-handle change.

## Phasing

One phase delivers a shared count calculation and its two overview consumers.

## Implementation Plan

1. Add the scoped compatibility count helper and focused regression tests for adapter-only, mixed/bridged/deleted, canonical, and more-than-preview-size task sets.
2. Wire both overview routes to the helper and test route totals and existing person badge rendering/refresh behavior.
3. Run relevant tests and the configured validation gate, review the diff, and publish the implementation PR referencing this spec PR and closing #6068.

## Final Compliance Report

The design stays within the customers module, reuses existing list semantics and tab primitives, preserves all public contracts and scoping, and changes no persisted data. One capability is delivered: an accurate linked-task total for profile badges.

## Changelog

- 2026-10-03: Specified the task total correction after tracing the missing badge to compatibility-mode storage.
- 2026-10-03: Incorporated independent review: aggregate compatibility totals in the database and suppress bridges with a scoped ORM subquery.
