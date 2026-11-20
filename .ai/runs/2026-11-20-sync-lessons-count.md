# Sync the declared lesson count in .ai/lessons.md

## Goal

Make the required `test` check green again on `main` by aligning the catalog's declared lesson count with the lesson records on disk.

## Scope

- `.ai/lessons.md` line 3: `192` -> `193`.
- Cause: #8746 (741205319c) added `.ai/lessons/canonical-read-migrations-must-preserve-legacy-role-access.md` and its index row, but did not bump the declared count, so `checkLessonsCatalog` reports `.ai/lessons.md: declared lesson count must equal 193` and `scripts/__tests__/check-lessons.test.mjs` fails.
- Verified on 53310bc683: 193 files under `.ai/lessons/`, 193 index rows, no missing-row or drift errors — only the count is wrong.

## Non-goals

- No change to the checker, the test, or any lesson record.

## Implementation Plan

### Phase 1: Fix the count

- 1.1 Update the declared count and run `yarn lessons:check` plus `node --test scripts/__tests__/check-lessons.test.mjs`.

## Risks

- Other open PRs that add lessons will need to bump the count again relative to 193 when they merge main.

## Progress

PR: #10150

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix the count

- [x] 1.1 Update the declared count and run the lessons checks — bd61fac023
