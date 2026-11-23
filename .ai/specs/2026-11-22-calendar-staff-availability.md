# Calendar and staff availability

Extends: .ai/specs/2026-06-11-crm-calendar.md
Extends: .ai/specs/implemented/2026-05-08-staff-decouple-from-core.md

## TLDR

Calendar schedulers need to see whether the people they assign are working, unavailable, or on leave. Staff members and leave approvers need to see the CRM events already booked for that time. Show this context in both directions using scoped reads and the calendar's existing warning UI.

## Overview

[Issue #4316](https://github.com/open-mercato/open-mercato/issues/4316) covers the Calendar event editor, people picker and grid, My availability, team-member availability, and administrative leave review. Each surface offers information before a scheduling decision. Saving an event or approving leave follows the existing mutation flow.

## Problem Statement

The CRM Calendar compares interactions with one another, so an assignment during leave receives no warning. Staff schedules contain planner rules, and leave review shows request details. Neither reads an employee's existing CRM commitments. The same scheduling conflict can therefore be missed by both people making a decision.

The Calendar spec names a conflict endpoint. The current editor uses the grid's interaction candidate loader and client-side recurrence expansion. Extend the editor and grid at those call sites. The older endpoint remains available to its existing callers.

## Proposed Solution

Staff owns a read endpoint returning bounded unavailability windows for requested auth-user IDs. Calendar uses these windows for editor warnings, picker hints and grid markers. Staff views read existing CRM interactions through a new optional owner-or-participant filter and overlap mode. Both directions use the current authenticated client and depend on the other module only through HTTP.

Odoo distinguishes leave approval states and applies working schedules to time off. Frappe HR distinguishes an employee's assigned calendar from company defaults. Open Mercato already has the assignments and lifecycle it needs. Derive scheduling context from those existing records. [Odoo time off](https://www.odoo.com/documentation/master/developer/reference/standard_modules/hr/time_off.html), [Frappe HR holiday list assignment](https://docs.frappe.io/hr/hr/leave-management/holiday-list-assignment).

## Resolved assumptions (autonomous defaults)

| Question | Decision and rationale |
| --- | --- |
| Should the two directions ship together? | Keep one spec for the scheduling workflow and deliver it in independently testable phases. Both directions address the same conflict around the same leave request. |
| Who may see reason text? | Give eligible Calendar users the kind and time. Include a configured reason label only for the member with applicable self-read access or someone already allowed to read the underlying source in that organization. Leave notes and decision comments stay in Staff. |
| How should the picker handle missing data? | Show “Available” after a successful check for a recognized staff member with no overlap. Omit availability hints for unknown users, inactive members, unavailable endpoints and incomplete results. |
| What can Staff users without CRM access see? | Show calendar context only through the existing CRM read permission and visibility rules. The availability and leave forms remain usable when context is unavailable. |

## Delta

### Capability: crm-calendar

#### ADDED — Staff availability warnings and picker hints

- WHEN an active Calendar occurrence or a timed draft overlaps an owner or participant's staff window, THEN the Calendar shows the relevant warning using the existing conflict marker or editor alert.
- WHEN the people picker has a valid time range, THEN recognized staff options show available, unavailable, approved leave, or pending leave as appropriate.
- WHEN a draft has both event and staff conflicts, THEN the warning presents both and saving stays available.
- WHEN the Calendar conflict scope is “mine”, THEN a staff conflict marks only events involving the current user. Any assigned person's overlap can mark an event involving the current user. “All” applies to all visible eligible events.

### Capability: staff-scheduling

#### ADDED — Read-only CRM events in availability and leave review

- WHEN a staff member or manager opens a schedule with CRM read access, THEN visible appointments assigned to that member appear alongside rules.
- WHEN a leave approver opens a request with CRM read access, THEN they see a count and chronological list of visible appointment occurrences overlapping the date span. If the feed reaches its cap, the section says “Showing N” and indicates that more events may exist.
- WHEN the CRM read is unavailable or forbidden, THEN Staff preserves the original availability and leave flow.
- WHEN an approval is submitted with overlapping CRM events, THEN the existing approval and optimistic-locking behavior applies.

## Architecture

- Staff batches scoped active member reads by auth-user ID, then reads assigned Planner rule sets, member rules, and overlapping leave requests. Reuse the existing `plannerAvailabilityService` from DI. Staff already requires Planner.
- Move the existing HTTP candidate loader and pure CRM event projection and recurrence code into the core package's module-neutral library tree. Keep compatibility exports in Customers. Both consumers use the same paginated HTTP adapter and event projection, with no Staff imports from the Customers module.
- Compose the CRM overlay with Planner's existing availability schedule through an optional range-aware presentation slot or callback. Planner receives generic schedule items and no Customers or Staff data access. Protect `handleItemClick` with the known editable-rule map so an overlay cannot open an edit dialog.
- Keep route authentication and organization resolution in the server handlers. Use the route's dispatcher auth and one request container, batch by entity and scope, and keep queries independent of the number of matched users. Permission lookups use the existing wildcard-aware RBAC service. Run existing visibility and tenant/organization restrictions before selecting or paging CRM records.

## Data Models

The inputs are `StaffTeamMember.userId`, its scoped assigned `availabilityRuleSetId`, existing Planner rules and `StaffLeaveRequest`. The CRM side uses `CustomerInteraction.ownerUserId` and internal participant `userId` values in its JSONB array. The feature adds no persistent data.

- All intervals are half-open `[start, end)` and emitted as UTC ISO strings. Leave starts at midnight on the request's first local date and ends at midnight after its last local date, using the stored time zone. Interpret date keys the same way as the approval command and use the Planner timezone conversion for both boundaries.
- Compute outside-hours windows as the complement of assigned schedule availability within the requested range. Read manual member unavailability and rule-set exceptions. A member without a rule set has no outside-hours conflict and can still be on leave or have an explicit unavailability window.
- Combine and clip same-kind adjacent or overlapping intervals with matching reason visibility. Approved leave takes precedence over duplicate unavailability written by approval. Preserve independent partial overlaps and let the picker prioritize approved leave, general unavailability, then pending leave.
- Join a warning to an event by organization and auth-user ID. Use the organization in the response for grid joins and resolve draft and picker reads against the draft or current authorized organization. Keep rules and leave matched to the same scoped staff member. Narrow the reverse CRM lookup to the Staff record's organization as well as its user ID, including when the viewer has access to more than one organization.

## API Contracts

| Route | Contract |
| --- | --- |
| `GET /api/staff/availability/windows` | Validate comma-separated UUIDs, at most 100 unique users, and an increasing pair of zoned ISO instants `from` and `to` spanning at most 93 days. Return `items: [{ userId, organizationId, windows: [{ start, end, kind, reason? }] }]` for recognized, active, in-scope staff, including empty windows after a complete read. Omit a member with a broken rule-set reference so clients treat the result as unknown. `kind` is `unavailable\|leave\|tentative`. Return 400 on invalid input and 401/403 on unsuccessful authorization. |
| `GET /api/customers/interactions` | Add optional UUID `actorUserId` and optional `overlap=true`. Authorize any explicit organization narrowing against the resolved request scope. The actor predicate matches the owner or an internal participant in the same record and applies before count, sorting and paging. In overlap mode, require the range and use the event's scheduled or occurred start and effective end. Preserve the existing separate recurrence-master query so the client can expand older series into the range. Existing date filters and return shape apply when the new inputs are absent. |

Staff windows require an authenticated Calendar viewer with `customers.interactions.view`. Grant reason visibility separately through existing Staff leave read permissions or Planner rule read permissions in the result's organization. Return no notes, leave IDs or decision details. Keep both routes' data scoped to the request tenant and authorized organizations, including entity joins and optional organization narrowing. The CRM list keeps its existing ACL, encrypted field handling, email visibility and pagination. Staff uses calendar-eligible interaction types and reads only the event fields it displays.

## UI/UX

- Calendar editor — give the existing debounced warning the draft's owner, participants, time zone and effective start/end. Fetch the staff source independently from interaction overlaps. A source failure leaves the other warning available and does not interrupt saving.
- People picker — request availability for staff options in batches once the span is valid. Keep names and keyboard navigation intact. Show one text hint per option and refresh it on date/time changes without replacing selected values.
- Calendar grid — mark eligible day/week/month/agenda events with existing conflict affordances. Show a localized description with their warning kind and authorized reason. Combine it with event-overlap labels and make it available to keyboard and assistive-technology users.
- Staff availability — overlay authorized CRM appointments as read-only `ScheduleItem` events for the current view range. Preserve clicks and keyboard behavior for existing availability items.
- Leave review — add a compact “Scheduled events” section with count and list for the request's local date span. Show a localized empty state on a completed empty read and an unavailable state for failed reads. Keep the section outside the form's editable data and preserve its submit and cancellation shortcuts.

## Frontend Architecture Contract

Keep the Calendar server page and Staff page authorization boundaries. Extend existing client islands for calendar event state, staff overlays and leave context. Pure interval, payload and mapping code stays free of React. Add no root providers or new client packages. Cancel stale reads on date, member, draft and scope changes. Batch picker and grid lookups in groups of 100, and use bounded pages for the Staff interaction feed. Divide longer spans into adjacent time ranges and combine by stable occurrence ID before showing a hint or count. Use the existing Calendar candidate and paging limits, with an explicit partial-data state for truncated results. Compare request count and page interactivity against the current empty, busy and recurring-calendar fixtures.

## Migration & Backward Compatibility

The feature is additive. No database migration, package dependency, permission grant changes or new setting is required. Document the optional query parameters and the Staff response in OpenAPI. Keep current consumers' default behavior and the deployed conflicts endpoint stable. Rollback removes the new consumers and read endpoint, with no data repair required.

## Edge Cases & Failure Scenarios

- Resolve outside-hours gaps when no rule applies on a date and distinguish missing rules from a successful empty overlap. Ignore deleted or inactive members, rejected leave and deleted rules.
- An event that ends exactly at the start of leave remains clear. A recurring, all-day or cross-midnight event that actually enters the window counts.
- A missing Staff route disables the Calendar hints. Forbidden or failed reads never clear a confirmed event conflict or present an availability guess.
- The overlay is advisory and may become stale after a concurrent scheduling change. Refresh on range changes and use existing Calendar reload paths. Existing mutation conflicts are returned through the normal UI.

## Phasing

1. Add both scoped read contracts and verify their filtering and date behavior.
2. Integrate Staff windows into Calendar's editor, picker and rendered event views.
3. Integrate CRM context into Staff availability and leave approval and validate both directions.

## Implementation Plan

### Phase 1 — Scoped read contracts

1. Add the Staff route tests for input bounds, auth scope and reason visibility. Implement the route with batched reads and OpenAPI.
2. Implement and test window assembly for recurrence, missing assignments, explicit unavailability, all-day time-zone conversion, status and deduplication.
3. Add the Customers list filter and overlap mode. Test older recurring masters, a spanning event, half-open boundaries, owner/participant matching, and pagination under existing visibility.

### Phase 2 — Calendar scheduling

4. Add the cancellable, batched Staff client and share pure conflict matching across Calendar call sites.
5. Wire the editor warning and people picker. Verify the selected people and existing warning survive an unavailable Staff source.
6. Wire grid warnings and verify the tooltip, existing conflict scope for mixed-participant events, date navigation and disabled-module fallback.

### Phase 3 — Staff scheduling

7. Add the read-only event overlay to both Staff schedules, reusing the existing schedule host and recurrence rules.
8. Add overlapping event context to administrative leave review. Exercise both successful and failed reads while approving a request.
9. Run scoped unit tests, integration tests and browser QA. Record verification and archive the new capability requirements under `.ai/specs/capabilities/`.

## Integration Test Coverage

Use isolated API-created fixtures with cleanup. Follow the existing Calendar and Staff Playwright suites.

- Staff availability endpoint — active member, assigned and unassigned rule sets, pending/approved/rejected requests, time zone and DST, tenant and organization boundaries, permission-aware reasons.
- CRM interaction list — owner and guest, no match for author-only or external email-only, recurrence master anchored outside the range, boundary overlap, existing caller semantics, cursor and visibility. Verify a linked user in two allowed organizations only contributes to the queried organization.
- Calendar — editor and picker distinguish all three window kinds, save remains available, grid marks matching events in both conflict scopes, disabled or failed Staff reads preserve existing conflict warnings.
- Staff — My availability, team-member schedule, and leave review display only in-scope events. An event never becomes an editable availability rule. Approval stays accessible when the feed succeeds or fails. Dense leave periods show the number of displayed occurrences and a truncation message.

## Risks & Impact Review

| Severity | Failure | Mitigation and residual risk |
| --- | --- | --- |
| High | A scheduler sees another organization's absence or a sensitive leave reason. | Scope each entity and response explicitly. Check existing read permissions for the reason. Test unauthorized users and cross-organization rows. |
| Medium | Leave days shift at DST transitions, or planner-generated leave rules create duplicate warnings. | Convert both local date boundaries independently and overlay approved requests ahead of duplicate planner intervals. Test both DST directions and adjacent appointments. |
| Medium | A busy calendar produces excessive repeated reads or shows incomplete data as clear. | Bound ranges and batches, reuse visible candidates, cancel obsolete responses and surface truncation. Very dense schedules can still show partial results. |
| Low | CRM or Staff is unavailable during the advisory read. | Preserve existing form behavior and existing conflict detection. Users can continue scheduling without the additional context. |

## Final Compliance Report

The proposal uses scoped read endpoints, existing ACLs, Planner recurrence, Calendar conflict UI, and read-only schedule items. It adds no mutation, dependency, or schema surface. Run the ordered repository gate and the integration coverage above on the implementation branch.

## Changelog

- 2026-11-22 — Proposed the bidirectional Calendar and Staff scheduling context for #4316.
