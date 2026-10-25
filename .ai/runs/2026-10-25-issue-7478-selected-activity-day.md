# Execution plan — selected-day activity time defaults (adopted from PR #7489)

**Origin:** adopted by `om-auto-continue-pr --adopt auto` on 2026-10-25 because PR #7489 carried no execution plan.
**PR:** #7489 · **Branch:** `fix/issue-7478-selected-activity-day` · **Base:** `main`
**Author:** @haxiorz

## Goal

Open activity creation on the selected local calendar day with a suitable type-specific time, preserving forward defaults for today and existing historical-day behavior.

## Scope

The customers scheduling helper, its unit and caller regressions, and the existing CRM detail specification.

## Non-goals

No scheduling architecture, API, database, editing, unselected creation, or QA/pipeline policy changes. Existing screenshots remain evidence for their original head only.

## Evidence

| Conclusion | Drawn from | Confidence |
| --- | --- | --- |
| Company/person/deal creation must inherit the selected local day | PR #7489 and issue #7478 | high |
| Future task defaults must not depend on the current wall clock; today must not seed an overdue activity | Review #5643631972 by @wojciechszyjka | high |
| Historical days may retain the existing clock-derived time | Review #5643631972 | high |

## Assumptions

For today after the last half-hour slot, retain the existing next-day 09:00 default to keep the start strictly in the future. Future tasks use 17:00; other future types use 09:00. Local date constructors and setters remain authoritative for timezone handling.

## Risks

The late-night today policy intentionally allows the resulting date to advance. Explicit regression tests and the spec document this exception.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append the commit SHA when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Forward the selected local day through company/person/deal activity creation and add regression coverage — 839feaf

### Phase 2: Review correction

- [x] 2.1 Correct future-day and today defaults, cover both review cases and historical dates, and document the policy — baf2937f9
- [x] 2.2 Verify the correction, review compatibility and scope, publish, and request human re-review — baf2937f9

## Verification and handoff

Runner: local; no compose app was running. The original helper failed 11 new assertions. The correction passes 4 targeted suites / 49 tests, covering helper defaults, existing edit/date seeding, form state, and the real deal scheduling hook. The same 49 tests pass east of UTC in Asia/Tokyo. Scoped ESLint, strict TypeScript compilation of the changed helper and direct unit suite, `git diff --check`, and the lessons catalog validator pass.

The source correction is published and re-review requested from @wojciechszyjka. Current-head CI is still pending, and human review plus the existing `needs-qa` approval gate remain. No live application flow or new screenshot capture was executed. Existing screenshots remain bound to head `839feaf`.
