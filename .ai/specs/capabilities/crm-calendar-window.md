# Capability: crm-calendar-window

Calendar hosts can set the candidate budget for an interaction window.

## Requirement: Configurable interaction budget

The calendar hook SHALL use a host-provided interaction budget and indicate when it leaves candidates out.

### Scenario: Existing host

- WHEN the host uses `useCalendarItems(range)` or supplies an invalid limit
- THEN the hook returns candidates using the 500-item budget and reports whether that budget left candidates out

### Scenario: Dense calendar window

- WHEN the host requests `maxItems: 2000` and 501 candidates are available
- THEN the hook can return all 501 candidates with `truncated: false` after both cursor streams are exhausted

### Scenario: Omitted candidates

- WHEN more candidates are available than the effective budget
- THEN the hook returns up to the effective budget and sets `truncated: true`

### Scenario: Exact budget

- WHEN the result reaches the budget exactly
- THEN `truncated` is true if either stream has an outstanding cursor and false if both streams finish and every merged candidate fits

Source: .ai/specs/2026-11-22-calendar-window-item-limit.md
