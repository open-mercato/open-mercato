# Execution plan — Calendar weekend "today" column integration test

**Slug:** cal-weekend-today-integration-test
**Branch:** fix/cal-weekend-today-integration-test
**Date:** 2026-06-25
**Owner:** pkarw

## Goal

Add an automated integration (Playwright UI) test that locks in the fix shipped by
[PR #3544](https://github.com/open-mercato/open-mercato/pull/3544) (fixes #3483):
on the CRM Calendar Week view, today's column must stay visible even when it is a
weekend day and "Show weekends" is OFF — while the rest of the weekend stays hidden,
and a weekday "today" never adds a spurious weekend column.

## External References

- PR #3544 comment [#issuecomment-4794361329](https://github.com/open-mercato/open-mercato/pull/3544#issuecomment-4794361329)
  — the QA author's ready-to-adapt scenario for `TC-CAL-010`. Adopted: the clock-freeze
  approach (`page.clock.setFixedTime`, not `clock.install`), weekday-token header assertions
  (`/\b27\s+SAT\b/`, `/\bSUN\b/`, `/\bSAT\b/`), the no-fixture / default-OFF-preference setup,
  and the three assertion blocks (weekend today / weekday today / toggle-still-works).
  Nothing rejected — the guidance is consistent with project rules; it does not ask to skip
  tests, hooks, or BC checks.

## Scope

- ADD: `packages/core/src/modules/customers/__integration__/TC-CAL-010.spec.ts`.
- No production code changes — PR #3544 already fixed the bug; this only adds the regression
  UI test that guards it.

## Non-goals

- No change to `grid.ts` / `TimeGrid.tsx` or any calendar behavior.
- No new fixtures helper (the calendar boots empty on a fresh tenant; assert on day-column
  headers only).
- Not re-testing the full settings modal (TC-CAL-007 already covers the toggle persistence).

## Risks

- Clock freezing must happen **before** navigation so the browser computes the frozen "today";
  `page.clock.setFixedTime` (not `install`) keeps timers running so loaders/SSE still settle.
- localStorage from the toggle step could leak into retries — cleared in `finally` like TC-CAL-007.
- Determinism: June 2026 starts Monday, so 2026-06-27 is deterministically a Saturday inside
  the Mon-start week Jun 22–28; 2026-06-24 is a Wednesday. Assertions key on weekday tokens,
  independent of the real run date.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Add the integration test

- [ ] 1.1 Write `TC-CAL-010.spec.ts` (weekend-today visible, weekday-today no weekend column, toggle-still-works)
- [ ] 1.2 Typecheck the core package and lint the new spec

### Phase 2: Validation & PR

- [ ] 2.1 Run the validation gate (typecheck; spec is integration-only so unit `yarn test` is unaffected)
- [ ] 2.2 Self code-review + BC review, open PR, normalize labels, run auto-review-pr
