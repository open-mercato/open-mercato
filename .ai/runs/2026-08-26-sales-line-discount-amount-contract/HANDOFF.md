# Handoff — 2026-08-26-sales-line-discount-amount-contract

**Last updated:** 2026-08-26T05:52:00Z
**Branch:** `fix/sales-line-discount-amount-contract`
**PR:** not yet opened
**Current phase/step:** Phase 0 Step 0.1
**Last commit:** — (run folder commit pending)

## What just happened
- The maintainer (@wojciechszyjka) approved the two gated decisions in `.ai/specs/2026-08-07-sales-line-discount-amount-contract.md` on 2026-08-26, unblocking an implementation that had been gated since 2026-08-07. Three further calls (D3, D4, D5) plus the mapper de-duplication (D6) were resolved as part of the same approval and are recorded in `PLAN.md`.
- The run folder was planned against the live code on `develop@97319f09f` rather than against the spec's pinned line numbers, which the spec itself flags as drifting. Both upsert coalescing sites were re-located at `commands/documents.ts:7270` (orders) and `:7764` (quotes), and the three entity→snapshot mappers at `documents.ts:2972`, `:3003` and `returns.ts:137`.

## Next concrete action
- Start Step 0.1: flip the spec header from `Status: draft — design decision requested` to `Status: approved — implementation in progress`.

## Blockers / open questions
- None. The spec's own gate ("no implementation lands until § Proposed Solution 1 and 2 are approved") is satisfied by the Decision Record that Phase 0 writes.

## Environment caveats
- Dev runtime runnable: unknown — not yet exercised this run.
- Browser / UI checks: expected to be minimal. The only UI file in scope is `SalesOrderDraftLines.tsx`, and the line in question is unreachable today, so there may be no rendered behaviour to capture.
- Database/migration state: clean. This change deliberately adds no migration and does not run `yarn db:generate`.

## Worktree
- Path: `/home/wojtek/cezar/projects/open-mercato/.ai/cezar/worktrees/fd78b62c-e960-4fbd-acb3-e655785e3269`
- Created this run: no — an existing linked worktree was reused, per the skill's worktree rule. It was switched from `cez/fd78b62c` to the task branch; dependencies were installed here from scratch because the worktree had no `node_modules`.
