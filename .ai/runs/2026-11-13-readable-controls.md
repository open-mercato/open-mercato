# Readable report periods and usable deal menus

Goal: deliver #7796 and #6978, two bounded UI follow-ups authored by droalina.

Source doc: .ai/specs/2026-07-02-customers-deals-kanban-card-quick-actions.md
Source doc: .ai/specs/2026-08-12-time-tracking-consulting-suite.md

Scope: remove duplicate ComboboxInput id declarations that prevent baseline builds (prerequisite; no prop contract change), then use the existing default 32px IconButton target for the deal-card menu, preserving the icon and actions. Allow report periods to wrap fully rather than inherit DataTable truncation. No data, API, permissions or interaction changes.

## Implementation Plan

1. Correct both presentation defects and add rendered regressions for menu interaction and distinct report end dates.
2. Run targeted tests, applicable design checks and the configured validation gate; record inherited blockers separately.
3. Review the final diff, publish one implementation PR closing both issues and attach browser evidence when available.

Risks: card density and report column wrapping. Keep icons and adjacent controls unchanged; verify keyboard menu use and narrow layouts.

## Progress

### Phase 1: UI fixes

- [x] 1.1 Enlarge the existing menu trigger and cover keyboard/pointer behavior.
- [x] 1.2 Expose full report periods and cover distinct end dates.

### Phase 2: Verification and publication

- [ ] 2.1 Validate, review and publish evidence.

## Validation notes

- UI fixes: 50f71b1899; prerequisite duplicate declaration correction: 7901401c84.
- Related tests: 11 suites / 61 tests pass. Existing Combobox suites: 2 suites / 44 tests pass. Core and monorepo typechecking pass; template parity and i18n sync/usage pass.
- Initial full unit run hit the macOS tsx socket path limit under Turbo strict environment filtering. Retrying with installed Node 24, TMPDIR=/tmp and Turbo loose environment mode preserves the short temp path. No test assertion or timeout changed.
- Browser scenarios use disposable API fixtures, with screenshots at desktop/mobile widths. The first run identified an omitted required project code and an overbroad pre-existing keyboard-open expectation; corrected test setup before rerunning.
