# Capability: crm-calendar

Calendar helps CRM users schedule interactions and see conflicts involving the assigned people and resources.

## Requirement: Staff availability warnings and picker hints

The calendar shows advisory availability warnings for an event's owner and internal participants. Staff with a complete availability check get a picker hint for the draft's time span.

### Scenario: Assigning someone during leave

- WHEN a draft overlaps approved or pending leave for an assigned person
- THEN the editor shows the applicable leave warning alongside any event overlaps and keeps saving available.

### Scenario: Checking an option

- WHEN a timed draft's people picker receives complete availability for a staff option
- THEN the option shows available, unavailable, on leave, or pending leave for that span.
- WHEN the availability check is incomplete or the Staff endpoint is absent
- THEN availability hints are omitted and the existing people and event controls remain usable.

### Scenario: Reviewing Calendar conflicts

- WHEN an event overlaps a staff availability window
- THEN Calendar uses the existing conflict marker and provides the kind and permitted reason through the event's description.
- WHEN conflict scope is “mine”
- THEN these markers apply to events involving the current user, including events where another assignee is unavailable.

Source: .ai/specs/2026-11-22-calendar-staff-availability.md
