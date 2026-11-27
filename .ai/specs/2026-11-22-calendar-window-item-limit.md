# Configurable CRM calendar window limit

Extends: .ai/specs/2026-06-11-crm-calendar.md

## TLDR

CRM calendar hosts can opt into a larger interaction budget per visible window. The calendar hook defaults to 500 and reports when a fetch leaves candidates out.

## Problem Statement

A host with a busy calendar window cannot retrieve later interactions through the upstream hook after it gathers 500 candidates. The reporter uses a fork with a 2,000-item cap. See [issue #8644](https://github.com/open-mercato/open-mercato/issues/8644).

## Proposed Solution

Accept `useCalendarItems(range, { maxItems })` and use that budget through both candidate queries and the final merge.

The 100-row API page size remains independent of the client budget. [Google Calendar pagination](https://developers.google.com/workspace/calendar/api/guides/pagination) uses the same distinction between a page size and a continuation token. The host can increase its budget without managing two cursors and their overlapping candidates.

## Resolved assumptions (autonomous defaults)

| Decision | Default | Rationale |
| --- | --- | --- |
| How does a host request more items? | Supply a positive safe integer as `maxItems`. | The reported host can migrate from a fixed fork cap to `maxItems: 2000`. |
| What happens when `maxItems` is omitted or invalid? | Use 500. | A finite default bounds the work and preserves existing calls. |
| What does the budget count? | Unique interaction candidates before recurrence expansion. | One recurring candidate may produce several visible occurrences. |

## 📝 Delta

### Capability: crm-calendar-window

#### ADDED Requirement: Configurable interaction budget

The calendar hook SHALL use a host-provided interaction budget and indicate when it leaves candidates out.

##### Scenario: Existing host

- WHEN the host uses `useCalendarItems(range)` or supplies an invalid limit
- THEN the hook returns candidates using the 500-item budget and reports whether that budget left candidates out

##### Scenario: Dense calendar window

- WHEN the host requests `maxItems: 2000` and 501 candidates are available
- THEN the hook can return all 501 candidates with `truncated: false` after both cursor streams are exhausted

##### Scenario: Omitted candidates

- WHEN more candidates are available than the effective budget
- THEN the hook returns up to the effective budget and sets `truncated: true`

##### Scenario: Exact budget

- WHEN the result reaches the budget exactly
- THEN `truncated` is true if either stream has an outstanding cursor and false if both streams finish and every merged candidate fits

## Architecture

`useCalendarItems` normalizes the option to a number and keys its interaction fetch effect by that value. A limit change aborts the prior request and reloads the current window. The options object's identity has no effect on requests. Refetch uses the current budget.

The existing regular-window and recurring-master reads run in parallel. Each follows its cursor until exhaustion or the budget, using `apiCall` with a page size of 100. A fetched page can cross the budget even when it has no next cursor. The helper reports truncation in either that case or when it stops with a cursor outstanding. The merge orders recurring candidates first, keeps the regular result for IDs collected by both streams, and applies the same budget to the deduplicated candidates. Its own truncation is combined with the two fetch results.

## Data Models

The design uses the existing interaction records and response shape. The host option is transient client input.

## API Contracts and compatibility

`useCalendarItems(range, options?)` accepts `options.maxItems?: number`. A valid value is a positive safe integer. The existing `MAX_WINDOW_ITEMS` export remains 500. The result shape stays compatible, including the meaning of `truncated` and the `refetch` callback. Existing calendar screen and editor conflict calls continue to use 500. `GET /api/customers/interactions` keeps its date range, recurrence overlay, page size, and authenticated scoping contracts.

## Risks & Impact Review

- Medium, calendar latency and memory. Opting into a higher limit can issue more requests and expand more occurrences. Default calls retain their current work budget. Hosts select a limit appropriate for their use, and an obsolete fetch is cancelled on range or limit change.
- Medium, incomplete rendering. A final page can overrun the budget or the merge can overflow even after both streams end. Report truncation when either happens and preserve recurring-candidate ordering so a dense regular window does not hide the recurring overlay.

## Implementation Plan

### Phase 1: Configurable calendar interaction budget

1. **Step 1** Pin the default 500-candidate behavior with a cursor-driven React hook test.
2. **Step 2** Thread the normalized limit through the hook, both fetch streams, and the merge. Cover higher and invalid limits, final-page overflow, recurrence deduplication, and option changes.
3. **Step 3** Extend the calendar integration scenario to exercise cursor pagination of the recurring overlay and confirm an out-of-window master from the second page renders in the built-in calendar.
4. **Step 4** Archive the requirement in `.ai/specs/capabilities/crm-calendar-window.md`.

## Integration Test Coverage

- `GET /api/customers/interactions` regular and recurring reads and the existing calendar rendering path use fixtures created and removed by `TC-CAL-012.spec.ts`.
- Hook integration tests use mocked cursor responses to exercise the configurable host path with more than 500 candidates, without introducing a separate application page.

## Final Compliance Report

The design was checked against the root, core, Customers, spec, and integration-test agent guides and the backward compatibility contract. It uses the existing authenticated API client, preserves cursor and recurrence handling, and adds an optional parameter. Regression coverage exercises both query modes and the calendar host.

## Changelog

- 2026-11-22 — Propose the configurable calendar window interaction limit for issue #8644.
