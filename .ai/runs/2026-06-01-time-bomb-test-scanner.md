# Execution Plan — Time-bomb test scanner + fixes

**Slug:** time-bomb-test-scanner
**Branch:** fix/time-bomb-test-scanner
**Date:** 2026-06-01
**Closes:** #2384

## Goal

Add a dependency-free scanner that detects "time-bomb" tests (hardcoded absolute
date literals whose pass/fail depends on the wall clock), and fix every genuine
time-bomb currently in the suite — starting with #2384.

## Background

Issue #2384: `packages/core/src/modules/workflows/data/__tests__/validators.test.ts`
hardcoded `until: '2026-06-01T12:00:00.000Z'` and asserted `.not.toThrow()`. The
validator requires `until` to be in the future, so once that timestamp elapsed the
test fails permanently and reddens CI on every PR. A "time-bomb" is any hardcoded
absolute date literal whose assertion outcome flips with the system clock.

## Scope

- New tool: `scripts/time-bomb-scanner.mjs` + npm scripts + allowlist file.
- Fix the genuine bombs: #2384 (3 lines) + near-future HIGH literals + far-future HIGH literals.

## Non-goals

- Do NOT touch past-date fixtures (createdAt/scheduledAt/expiresAt set in the past) — they stay past, not clock-dependent.
- Do NOT touch format/parse round-trip tests (`expect(fmt(x)).toBe('YYYY-MM-DD')`) — both sides hardcoded, not clock-dependent.
- No CI pipeline wiring in this PR (can follow up); the npm script + `--fail` mode are provided for opt-in use.

## Risks

- Heuristic false positives/negatives — mitigated by an assertion-context classifier and an allowlist.
- Converting fixture dates to clock-relative could change snapshot/formatted output in UI tests — fix per case and re-run the affected jest file.
- Far-future fixtures (2099 lock expiry) may be semantically "must be far ahead of now" — convert to `Date.now() + N years` to preserve intent rather than blindly allowlisting.

## Implementation Plan

### Phase 1: Scanner tool

- 1.1 Add `scripts/time-bomb-scanner.mjs` (walk test files, extract ISO literals, classify vs now, severity buckets, allowlist, CLI flags, exit codes).
- 1.2 Tune heuristic: HIGH only when literal sits in future-validity context (`not.toThrow`/`isFuture`/`until`/`future`/`deadline`/`expires`); downgrade equality/format assertions; add a separate `slow` bucket for far-future (> ~5y) literals.
- 1.3 Add `.ai/time-bomb-allowlist.json` (empty entries + `$comment`).
- 1.4 Wire `check:time-bombs` and `check:time-bombs:fail` npm scripts in root `package.json`.

### Phase 2: Fix #2384 (workflows)

- 2.1 Replace the 3 future `until: '2026-06-01T12:00:00.000Z'` literals in `workflows/data/__tests__/validators.test.ts` with `new Date(Date.now() + 60_000).toISOString()`; keep the intentional `2020-01-01` past literals. Run the jest file.

### Phase 3: Fix near-future HIGH literals

- 3.1 business_rules formHelpers.test.ts + validators.test.ts (effectiveTo future dates).
- 3.2 customers TC-CRM-026 / TC-CRM-027 (future scheduledAt), validators.test.ts (153), deals route.filters.test.ts (88), ScheduleActivityDialog.test.tsx (22).
- 3.3 planner TC-PLAN-003 (106,107).
- Run the affected jest files after each sub-step.

### Phase 4: Fix far-future HIGH literals

- 4.1 currencies exchangeRateService.test.ts (575 `futureDate`).
- 4.2 messages token route.test.ts (65).
- 4.3 enterprise record_locks recordLockService.test.ts (2099 lock-expiry fixtures) — convert to `Date.now() + N years` or allowlist with justification.
- Run the affected jest files.

### Phase 5: Verify + gate

- 5.1 Re-run `yarn check:time-bombs` — confirm clean (or only allowlisted/non-actionable).
- 5.2 Full validation gate (typecheck/test/build) + code-review + BC self-review.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Scanner tool

- [x] 1.1 Add time-bomb-scanner.mjs — fc41e8201
- [x] 1.2 Tune heuristic (context-aware HIGH + far-future bucket) — fc41e8201
- [x] 1.3 Add allowlist file — fc41e8201
- [x] 1.4 Wire npm scripts — fc41e8201

### Phase 2: Fix #2384 (workflows)

- [x] 2.1 Replace future `until` literals with clock-relative — f526a1059

### Phase 3: Fix near-future HIGH literals

- [x] 3.1 business_rules (reviewed non-clock-dependent → allowlisted) — 89c046ee4
- [x] 3.2 customers — 89c046ee4
- [x] 3.3 planner — 89c046ee4

### Phase 4: Fix far-future HIGH literals

- [x] 4.1 currencies — 526700ce5
- [x] 4.2 messages — 526700ce5
- [x] 4.3 enterprise record_locks — 526700ce5

### Phase 5: Verify + gate

- [x] 5.1 Re-run scanner clean (0 high / 0 medium)
- [x] 5.2 Gate: build:packages/generate/i18n/typecheck/build:app ✓, changed tests ✓; pre-existing unrelated cli fs-watch flake noted; code-review + BC clean

## Changelog

- Opened PR open-mercato/open-mercato#2393 (fork: adeptofvoltron:fix/time-bomb-test-scanner). Gate green except a pre-existing unrelated cli fs-watch flake. Upstream labels/reviews not permitted from fork.

### Phase 6: CI integration

- [x] 6.1 Wire `check:time-bombs:fail` into the ci.yml `test` job — 2e1d8a1ab
