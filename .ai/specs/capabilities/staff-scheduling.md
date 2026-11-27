# Capability: staff-scheduling

Staff members and managers can review availability and consult scheduled CRM commitments before making leave decisions.

## Requirement: Read-only CRM events in availability and leave review

Show CRM events within an employee's organization and schedule or leave window when the viewer can read the underlying interactions.

### Scenario: Editing availability

- WHEN the employee or manager switches to the calendar for an eligible Staff record
- THEN the schedule shows authorized CRM events for the visible range alongside availability rules. Availability edits are available while events load, and CRM events have no availability edit action.

### Scenario: Reviewing a leave request

- WHEN an approver views a leave request
- THEN the page shows the number and chronological list of authorized CRM occurrences overlapping the request's local dates. Partial results identify the displayed count and indicate that more may exist.

### Scenario: Unavailable scheduling context

- WHEN CRM scheduling records are unavailable or the viewer lacks access
- THEN the Staff view shows an advisory state and preserves its normal edit and approval controls.

Source: .ai/specs/2026-11-22-calendar-staff-availability.md
