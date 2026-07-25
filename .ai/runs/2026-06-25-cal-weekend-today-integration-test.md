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

- [x] 1.1 Write `TC-CAL-010.spec.ts` (weekend-today visible, weekday-today no weekend column, toggle-still-works) — f58fedd5c
- [x] 1.2 Validate the new spec (esbuild syntax/resolve OK; `page.clock.setFixedTime` confirmed in Playwright 1.59 types). Note: local `tsc` cannot run core's tsconfig (`ignoreDeprecations: "6.0"` needs TS6; the worktree resolves TS 5.9.3) — environment quirk, not this change; CI typechecks with TS6. — f58fedd5c

### Phase 2: Validation & PR

- [x] 2.1 Run the validation gate (esbuild syntax/resolve OK; Playwright clock API type-confirmed; tsc/jest gate blocked by TS6 env quirk — documented) — fc1a813b6
- [x] 2.2 Self code-review + BC review (test-only, no contract surface), open PR #3592, normalize labels (review/skip-qa/priority-low/risk-low), adversarial spec review — PR #3592
  - Adversarial review verdict: mechanics all correct (clock-before-nav, default Week view at 1280px, `${dd} ${EEE}` header regexes, hidden-locator `.first().toBeHidden()`, fresh-context-per-test isolation, date determinism). Only flag = the #3544 dependency, by design for a standalone guard and documented in the PR body. No code changes needed.

## Changelog

- 2026-06-25 — Opened PR #3592 (standalone, against develop). Must merge AFTER #3544 (the `keepWeekendDate` fix is not yet in develop, so the guard is intentionally red until then).
