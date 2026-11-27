# Calendar and staff availability implementation

Issue: #4316
Source doc: .ai/specs/2026-11-22-calendar-staff-availability.md (design PR #10385)

## Goal

Show scheduling conflicts from staff availability and leave in Calendar. Show authorized CRM commitments when staff members or managers edit availability or review leave. Preserve advisory behavior throughout.

## Scope

Add bounded and scoped reads in Staff and Customers. Use existing Calendar warnings and schedule views. Keep existing permission grants, schema, mutation flows, optional-module behavior, and saved preferences.

## Implementation Plan

### Phase 1 — Scoped reads

1. Implement Staff availability windows using Planner and leave request data, including validation, ACL, time zones and unit and integration coverage.
2. Extend the Customers interactions list with owner-or-participant and interval overlap filters, including regression and integration coverage.

### Phase 2 — Calendar scheduling

1. Load availability windows in the editor and people picker, and surface advisory hints alongside event conflicts.
2. Integrate staff conflicts into Calendar view markers, labels, and scope preferences, and verify the changed Calendar paths.

### Phase 3 — Staff scheduling and verification

1. Render the scoped CRM occurrence feed in My availability and the team-member schedule.
2. Show overlapping CRM occurrences in leave review and verify approval behavior with both available and unavailable context.
3. Archive the capability requirements. Run the configured validation gate, integration checks, review, and browser verification.

## Risks

Organization is part of both joins. Reasons require an existing Staff or Planner read permission. Bounded and cancellable reads have partial-data handling. Time zone and recurrence behavior need targeted integration evidence.

## Progress

PR: #10386

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Scoped reads

- [x] 1.1 Implement and test Staff availability windows — 267697f7cf
- [x] 1.2 Add and test Customers interaction filters — 9bd148fda1

### Phase 2: Calendar scheduling

- [x] 2.1 Show advisory editor and picker hints — b54e944bb4
- [x] 2.2 Show conflict markers across Calendar views — b54e944bb4

### Phase 3: Staff scheduling and verification

- [x] 3.1 Show CRM events in Staff availability schedules — 5627d5f8b7
- [x] 3.2 Show overlapping CRM events in leave review — 5627d5f8b7
- [x] 3.3 Archive capabilities and validate implementation — 298e471e08

## Validation

- The ordered local gate passed. Workspace tests were split across the host runtime and the official Node and npm bundle for the scaffold suite.
- Five targeted Playwright scenarios passed against the isolated production app. [Browser evidence](https://github.com/open-mercato/open-mercato/pull/10386#issuecomment-7084744759).
