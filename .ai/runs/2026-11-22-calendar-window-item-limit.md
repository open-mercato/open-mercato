# Configurable CRM calendar window limit

Source doc: .ai/specs/2026-11-22-calendar-window-item-limit.md
Design PR: #10382

## Goal

Allow calendar hosts to raise their candidate budget while preserving the default pagination and truncation notice.

## Scope

The Customers calendar hook, its existing recurring interaction integration scenario, and the calendar behavior documentation.

## Implementation Plan

### Phase 1: Configurable calendar interaction budget

1. Characterize the default 500-candidate cursor cutoff.
2. Implement and test the optional budget through fetch and merge.
3. Exercise the recurring overlay's continuation in Playwright.
4. Archive the requirement and validate the implementation.

## Risks

Larger opt-in budgets can increase API requests and client work. Preserve the 500 default, 100-row pages, cancellation, and recurrence ordering.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Configurable calendar interaction budget

- [x] 1.1 Characterize the default 500-candidate cursor cutoff — add12fad2f
- [ ] 1.2 Implement and test the optional budget through fetch and merge
- [ ] 1.3 Exercise the recurring overlay's continuation in Playwright
- [ ] 1.4 Archive the requirement and validate the implementation
