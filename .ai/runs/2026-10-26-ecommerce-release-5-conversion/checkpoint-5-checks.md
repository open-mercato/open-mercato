# Checkpoint 5 — Steps 2.6..2.11

**Range:** Step 2.6 (`38149dcb0a`) .. Step 2.11 (`7443c78d16`)
**Date:** 2026-10-27 (UTC)
**Runner:** local (no Docker `app` container running in this environment)

**Process note:** this checkpoint covers 6 landed Steps (2.6–2.11), not 5 — the dispatcher let one
extra Step land before checkpointing (dispatched 2.10 and 2.11 back to back without pausing at
2.10). Noted plainly rather than hidden; no quality impact, every Step was still individually
verified (clean worktree, single commit, push matched HEAD) before the next was dispatched.
Resuming strict every-5 pacing from here.

## Touched areas

- `packages/core/src/modules/customer_groups/` — approval portal+staff routes, ACL, grants (2.6);
  approval notifications with per-tenant email switch (2.7)
- `packages/core/src/modules/cart/` — idempotent lock extend + `checkoutSessionId` binding (2.8);
  D-R5-21/22 identity binding + trusted-path identity fill, a recorded behavior change (2.9);
  `markConverted` order/quote `lineMap` + first admin UI (`DataTable` list/detail/reprice) this
  module ships in this run (2.10); abandonment payload growth + code-reservation release on
  expire/abandon (2.11)

The `customer_groups` approval track (data → service → routes → notifications) and most of the
`cart` track for this wave are now complete.

## Checks run

| Check | Scope | Result |
|---|---|---|
| `yarn typecheck --force` (bypasses the cross-worktree shared turbo cache) | full monorepo (40 packages) | ✅ pass — `40 successful, 40 total`, `0 cached` |
| `jest --config packages/core/jest.config.cjs src/modules/{customer_groups,cart,promotions}` | `packages/core`, every module touched this window + promotions regression guard (cart's code-reservation release calls into it) | ✅ pass — 95/97 suites, 1087/1095 tests (2 suites / 8 tests skipped: Postgres-gated real-concurrency suites, expected — no Postgres instance in this environment). The `WARN`/`ERROR`/`DEBUG` log lines in the output are expected negative-test-case fixtures (incomplete-payload guards, a deliberate `error=boom`), not real failures. |

Step 2.9 is a recorded, owner-approved behavior change (D-R5-21/22) — its own landing report
already names the exact bypass-closure regression test and the guest/login-merge preservation
tests, both confirmed passing in that Step's own verification; re-confirmed here as part of the
full suite run (238→280→287 cart tests across 2.9/2.10/2.11, no regressions at any point).

Step 2.10 shipped the first `cart` admin UI this run (DataTable list + detail pages). No
dev-server/browser smoke pass run yet — still deferred (per Checkpoint 3's note), now planned for
whichever Step in the remainder of Phase 2 (2.12/2.13, checkout session UI) or Phase 3 first makes
spinning up the dev server unavoidable, so it's done once rather than twice.

Step review: skipped — no `engine.stepReview` configured in `.ai/agentic.config.json`.

## Outcome

Checkpoint **passes**. No regressions, no fix-forward Steps needed. One non-blocking, documented
gap from Step 2.11 (the `purge` sweeper can reach converted/merged baskets whose code reservations
Step 2.11's mechanism doesn't release — `promotions`' own TTL sweep is the existing backstop).
Proceeding to Step 2.12.
