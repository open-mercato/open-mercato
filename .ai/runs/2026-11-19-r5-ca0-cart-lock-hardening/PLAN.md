# Execution Plan — r5-ca0-cart-lock-hardening

**Date:** 2026-11-19
**Slug:** r5-ca0-cart-lock-hardening
**Branch:** fix/r5-ca0-cart-lock-hardening
**Base:** stacked on #9999 (`6c596fe157`, spec fixes) on top of #9988; PR base `main`
**Source spec:** .ai/specs/2026-08-14-cart-module.md (rev 10.1) — §8.1, §9, §9.1, §15 row CA0
**Re-landing plan:** .ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md — **not available** (see Risks)
**Reference implementation:** closed PR #8268 at `bdb747c36a`, diff base `b7b5309ccc`

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Multi-key try-lock in withCartLineMutationLock | inline | done | ea930489fc |
| 1 | 1.2 | Line writes take the cart lock and re-check status under it | inline | done | 74ebfccf22 |
| 1 | 1.3 | cart.lock re-reads, recomputes and compare-and-sets under the cart lock | inline | done | f2096eac2b |
| 1 | 1.4 | Login merge and merge undo lock both carts and re-check under the locks | inline | done | 2eee8ae23a |
| 2 | 2.1 | Real-PostgreSQL status-transition races and cart in test:pg-integration | inline | done | f2f4631ba5 |
| 2 | 2.2 | TC-CART-PRICE-01-02 assertion hunks | inline | done | 733ffc83e5 |
| 3 | 1.4-review-fix | Merge reads lines and builds its outcome under the locks; undo check order | inline | done | 0cbbcf7181 |
| 3 | 1.2-review-fix | lines.update tier check and re-price under the lock | inline | done | 945021c792 |

## Goal

Serialize `cart.lock`, `cart.lines.update`/`.remove` (plus the in-lock status re-check of `.add`/`.bulkAdd`), the login merge and the merge undo on the per-cart advisory key `cart:lines:<cartId>`, and make `active → locked` a guarded compare-and-set that answers `409 cart_lock_conflict` to the loser.

## Scope

`packages/core/src/modules/cart` only:

- `lib/lineMutationLock.ts` — `withCartLineMutationLock` accepts one cart id or a list; keys deduplicated and sorted with an explicit comparator; `pg_try_advisory_xact_lock` for every key as the first atomic phase; any busy key rolls the attempt back and backs off (same 15 s budget, same `CartLineMutationLockTimeoutError` → `503 cart_busy`).
- `commands/lock.ts` — `lockCartCommand`: the forced re-price stays first; then, inside `withCartLineMutationLock`: `assertLockableUnderLock` (refresh cart, 423/404, refresh lines, `409 cart_has_unavailable_lines`), the promotions-and-totals recompute phases (with `currencyDecimalPlaces`), and a guarded `nativeUpdate … where status = 'active'`; zero rows → `409 cart_lock_conflict`, nothing emitted. Side effects via `emitCartPromotionsAndTotalsSideEffects`. `lockExpiresAt` from `resolveCartLockTimeoutMs()`.
- `commands/lines.ts` — `buildCartLineMutationGuardPhases` (update, remove) and `withCartLineMutationLock` around both; in-lock status re-check for add/bulkAdd; export `buildCartPromotionsAndTotalsPhases` and `emitCartPromotionsAndTotalsSideEffects`.
- `commands/merge.ts` — `applyCartTransitions` and lock + re-check phases for the login merge and `restoreCartMerge`.
- Tests: `{lock,lines,merge}.test.ts`, `statusTransitionRaces.integration.test.ts`, `lib/__tests__/promotionContext.integration.test.ts` fixture fix, `__integration__/TC-CART-PRICE-01-02-reprice-triggers.spec.ts` assertion hunks; `packages/core/package.json` adds `cart` to `test:pg-integration`.

## Non-goals

- `lockTtlMs`, idempotent extend, session match on unlock/markConverted, `lock_purpose`, abandoned reactivation in `cart.lock` → CA1.
- Approval gate, `purpose`, the `em` argument of `buildRecomputeCartTotalsPhase`, `#8414` → CA6.
- Real-command race harness and `*.realCommands.integration.test.ts` suites → CA6/CA9a.
- Proposal acceptance/rejection, `newLineId` → CA9a.
- Storefront `routeContext` refusal in `cart.lock` → CA3.
- `cart.unlock`/`cart.markConverted` taking the lock — named in §8.1's "Who" list, but they are rewritten by CA1 (session binding); left for that slice.
- No migration, no new event, no new route.

## Implementation Plan

### Phase 1 — Commands on the cart advisory lock

#### Step 1.1 — Multi-key try-lock in withCartLineMutationLock
Extend `withCartLineMutationLock(em, cartIds: string | string[], phases, label, waitDeadlineMs)`; single-id callers unchanged. Unit tests: sorted/deduplicated keys, one busy key rolls back and retries, deadline, ambient transaction keeps the blocking statement per key in sorted order.

#### Step 1.2 — Line writes take the cart lock and re-check status under it
`update`/`remove` run through `withCartLineMutationLock` with `buildCartLineMutationGuardPhases` (refresh cart → `423 cart_locked` / `409 cart_not_active`, refresh line → `404` when deleted). `add`/`bulkAdd` re-check status as their first in-lock phase. Export the two promotions-and-totals helpers. Tests in `lines.test.ts`.

#### Step 1.3 — cart.lock re-reads, recomputes and compare-and-sets under the cart lock
As in Scope. Tests in `lock.test.ts`: "re-reads the cart inside the advisory lock…", "re-reads the lines inside the advisory lock…", lost compare-and-set → `409 cart_lock_conflict` with no emit, recompute phases receive `currencyDecimalPlaces`.

#### Step 1.4 — Login merge and merge undo lock both carts and re-check under the locks
`applyCartTransitions` moves every cart-row write of the merge under the locks; both carts re-read; the undo re-checks survivor status and `undone_at` under the locks. Tests: the two "(#9183)" merge cases.

### Phase 2 — Proofs

#### Step 2.1 — Real-PostgreSQL status-transition races and cart in test:pg-integration
`commands/__tests__/statusTransitionRaces.integration.test.ts` driving the real `withCartLineMutationLock` against PostgreSQL (testcontainers): N concurrent guarded `active → locked`, line add vs lock both orders, two carts locked in opposite orders never deadlock, waiters hold no pooled connection (pool 2). `promotionContext.integration.test.ts` fixture fix (`catalogScopedProductService`). `cart` joins the `test:pg-integration` pattern.

#### Step 2.2 — TC-CART-PRICE-01-02 assertion hunks
Port the two `priceChanges` assertion hunks; verify against the dev app.

### Phase 3 — Review fixes (om-auto-review-pr)

#### Step 1.4-review-fix — Merge reads lines and builds its outcome under the locks; undo check order
Review major #1: the merge read both carts' lines and built the outcome before the lock. Line reads, max quantities, visibility, outcome and merge log now run inside the lock phase. Undo checks `undone_at` before the absorbed status; the generic undo also swallows `cart_locked`.

#### Step 1.2-review-fix — lines.update tier check and re-price under the lock
Review major #2: the same-tier check and re-price ran against the pre-lock line; they move into the locked phase after the guard.

## Spec vs reference vs card — differences (rule R4: the spec wins)

| # | Topic | Reference #8268 | This port (spec §8.1 / CA0) |
|---|-------|-----------------|------------------------------|
| 1 | Lock primitive | `acquireCartLineLocks` and inline `pg_advisory_xact_lock` (blocking, holds a pooled connection while waiting) in lock, update/remove, merge, undo | `withCartLineMutationLock` extended to several keys: try-lock, rollback, backoff, 15 s, `503 cart_busy`; blocking statement only when joining a caller-owned transaction (unchanged rule) |
| 2 | `cart.lock` | Also carries lockTtlMs, extend, purpose, approval gate, storefront refusal | Only the CA0 part: re-read, recompute, CAS, `409 cart_lock_conflict`, `emitCartPromotionsAndTotalsSideEffects` |
| 3 | Status re-check order for line writes | `409 cart_not_active` checked before `assertCartNotLocked`, so a cart locked meanwhile answers `409` | `assertCartNotLocked` first → `423 cart_locked`, then `409 cart_not_active` — `TC-CART-CONC-06` says "the lock wins and the add gets `423`" and §9 rejects a mutation on a locked cart with `423` |
| 4 | `buildRecomputeCartTotalsPhase` | Gains an `em` argument | Unchanged (CA6) |
| 5 | Visibility pass under the lock | Not run under the lock (the forced re-price ran it before) | Same as reference; §9.1 "Order of checks" lists the visibility pass under the lock — the flagged-line re-read under the lock is what CA0 ports; recorded as a residual for CA6 |
| 6 | `cart.unlock` / `markConverted` | No lock | No lock in CA0 (rewritten by CA1, which owns them) |
| 7 | `test:pg-integration` | Adds `cart|assisted_selling|availability|promotions|sales` and `test:pg-concurrency` | Adds `cart` only (CA0 row) |

## Audit findings and decisions that concern this step

- **I1** (audit `.ai/analysis/pre-implement-2026-08-14-cart-module-release-5.md`) — every Phase 4 writer takes `cart:lines:<id>` through `main`'s try-lock helper in sorted key order, 15 s budget, `503 cart_busy`; `cart.lock` recomputes under the lock and changes status by CAS (`409 cart_lock_conflict`). Applied for lock, update/remove, merge, undo.
- **V1** — reference uses blocking `pg_advisory_xact_lock`; resolved (b): use main's try-lock helper.
- **V2** — gate recompute under the lock + CAS; resolved (a): present here without the gate (CA6).
- Audit rule "Nothing under an advisory lock takes another pool connection; blocking waiters exhaust the pool" (`.ai/lessons/cart-contention-tests-must-prove-transaction-liveness.md`) — honoured: no blocking wait from a top-level command; the pg suite proves waiters hold no connection with pool 2.
- Audit row "`cart` must join the `test:pg-integration` regex with the first race test (I15)" — done in Step 2.1.
- Decisions D-R5-CA1…CA9 (spec changelog 2026-11-19): none is implemented by CA0. D-R5-CA2 (abandoned reactivation in `cart.lock`) stays with CA1 — CA0 keeps the current `404` for a non-active cart; D-R5-CA1/CA3 also CA1; D-R5-CA6 CA3.
- Risk R25 (spec §13) — mitigated by this step together with CA6's gate.

## Risks

- **Plan file missing.** `.ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md` was not found in the primary checkout, on `pr/9999` or in any ref. The user told the run to proceed; this plan uses the spec's CA0 row, §8.1, the D-R5-CA* decisions and the brief's card details. Rules R1–R14 could not be read.
- `em.refresh` re-reads the cart row under the lock; decryption of `email`/`note` happens in the encryption subscriber's `onLoad`.
- Merge builds its outcome before the lock (as the reference does). A busy retry rolls back; MikroORM's rollback clears only the action queue, so dirty managed lines and the explicitly persisted new lines/log are flushed on the attempt that gets the locks.
- `TC-CART-CONC-06…08` as real-command suites belong to CA6/CA9a; CA0 proves the primitive on PostgreSQL.

## External References

- None (`--skill-url` not passed).
