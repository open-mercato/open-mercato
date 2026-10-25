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

- [ ] 2.1 Correct future-day and today defaults, cover both review cases and historical dates, and document the policy
- [ ] 2.2 Verify the correction, review compatibility and scope, publish, and request human re-review
