# Handoff — 2026-08-26-sales-line-discount-amount-contract

**Last updated:** 2026-08-26T07:10:00Z
**Branch:** `fix/sales-line-discount-amount-contract`
**PR:** https://github.com/open-mercato/open-mercato/pull/5640
**Current phase/step:** all 25 Steps done — final gate green, handing to `om-auto-review-pr`
**Last commit:** `97ca8214f` — docs(runs): close out the follow-up steps for the line discount contract

## What just happened
- Checkpoint 1 passed: `@open-mercato/core` typechecks clean and all 97 sales suites (722 tests) pass, including the 15 new engine tests. Details in `checkpoint-1-checks.md`.
- 15 of 24 Steps are done — Phases 0 through 3. The contract itself is implemented end to end: the engine reads percentage-first and never re-multiplies a stored line total, one shared mapper tags every rebuilt snapshot, and both upsert sites decide the discount's origin per operand.
- The new tests were negative-controlled against the unfixed engine: 10 of 15 fail there, so they lock in real behaviour rather than passing vacuously.

## Next concrete action
- Start Step 4.1: command-level tests for the order and quote upsert paths, asserting a percentage-only line at `quantity > 1` keeps both its stored `discount_amount` and its `total_net_amount` across create → upsert.

## Blockers / open questions
- None blocking. One decision is still owed inside Step 5.1: whether `SalesOrderDraftLines.tsx`'s `* quantity` is correct under the shipped contract. Under D1 plus the `'unit'` default it looks correct as written, but the reasoning has to be recorded in the PR body rather than left implicit.

## Environment caveats
- Dev runtime runnable: not yet attempted. Bootstrap is complete (`yarn install`, `yarn build:packages`, `yarn generate` all green in that order), so the integration spec in Phase 6 has a working tree to build on.
- Browser / UI checks: expected to be minimal-to-none. The one UI file in scope holds an expression that is unreachable today, so there may be no rendered behaviour to capture.
- Database/migration state: clean, and deliberately so — no migration, no snapshot change, `yarn db:generate` not run.
- Watch out: a compound `yarn X > log 2>&1; echo $?` reports the exit code of `echo`, not of yarn. One `yarn generate` failure was briefly misread that way; capture real exit codes.

## Worktree
- Path: `/home/wojtek/cezar/projects/open-mercato/.ai/cezar/worktrees/fd78b62c-e960-4fbd-acb3-e655785e3269`
- Created this run: no — an existing linked worktree was reused and switched from `cez/fd78b62c` to the task branch. Dependencies were installed here from scratch; nothing was symlinked in.
