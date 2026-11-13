# Readable report periods and usable deal menus

Goal: deliver #7796 and #6978, two bounded UI follow-ups authored by droalina.

Source doc: .ai/specs/2026-07-02-customers-deals-kanban-card-quick-actions.md
Source doc: .ai/specs/2026-08-12-time-tracking-consulting-suite.md

Scope: use the existing default 32px IconButton target for the deal-card menu, preserving the icon and actions. Allow report periods to wrap fully rather than inherit DataTable truncation. No data, API, permissions or interaction changes.

## Implementation Plan

1. Correct both presentation defects and add rendered regressions for menu interaction and distinct report end dates.
2. Run targeted tests, applicable design checks and the configured validation gate; record inherited blockers separately.
3. Review the final diff, publish one implementation PR closing both issues and attach browser evidence when available.

Risks: card density and report column wrapping. Keep icons and adjacent controls unchanged; verify keyboard menu use and narrow layouts.

## Progress

### Phase 1: UI fixes

- [ ] 1.1 Enlarge the existing menu trigger and cover keyboard/pointer behavior.
- [ ] 1.2 Expose full report periods and cover distinct end dates.

### Phase 2: Verification and publication

- [ ] 2.1 Validate, review and publish evidence.
