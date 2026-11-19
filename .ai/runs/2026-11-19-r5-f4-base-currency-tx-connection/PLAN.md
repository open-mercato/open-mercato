# Execution plan — r5-f4-base-currency-tx-connection

**Date:** 2026-11-19
**Branch:** `fix/r5-f4-base-currency-tx-connection` (from `refs/remotes/pr/9999`, tip `6c596fe157`; PR base `main`)
**Binding spec:** `.ai/specs/2026-08-14-cart-module.md` (as on PR #9999) — §9a.1–§9a.2 (D-R5-37 fallback under the cart lock), §8.1 / R24 (no second pooled connection under the cart lock)
**Reference implementation:** closed PR #8268 at `bdb747c36a`, diff base `b7b5309ccc`, original fix commit `fd8452e911` — ported verbatim for `packages/core/src/modules/currencies/`
**Re-landing step:** F4

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Resolve the base currency on the caller's connection and add baseCurrencyServiceFactory | inline | done | (this commit) |

## Goal

`BaseCurrencyService.resolveBaseCurrency` runs its query through `em.execute(...)`, so it uses the caller's transaction connection when one is ambient, and a new DI key `baseCurrencyServiceFactory` (`(em) => new BaseCurrencyService(em)`) lets an optional peer bind the service to its own transactional `EntityManager` without a static value import.

## Scope

- `packages/core/src/modules/currencies/services/baseCurrencyService.ts` — `this.em.execute(...)` instead of `this.em.getConnection().execute(...)`; `EntityManager` type from `@mikro-orm/postgresql`.
- `packages/core/src/modules/currencies/di.ts` — `baseCurrencyServiceFactory`; one `EntityManager` type import (from `@mikro-orm/postgresql`), replacing the `@mikro-orm/core` + aliased postgresql pair.
- `packages/core/src/modules/currencies/services/__tests__/baseCurrencyService.test.ts` — the fake `em` exposes `execute`; new assertions that `getConnection` is never used and that the DI factory binds the given `em`.

## Non-goals

- `cart/lib/approvalGate.ts`, its pool-exhaustion suites and `TC-CART-CONC-06` (slice CA6).
- `customerCreditService.ts` (`fd8452e911` changed it as well; it belongs to the customer-groups slices, not this step).
- No `UPGRADE_NOTES.md` entry: the DI key is additive, and the `baseCurrencyService` contract is unchanged.

## Must keep

- No `getConnection().execute(...)` on the base-currency path.
- The factory is reached through DI; no optional peer gets a static value import of `BaseCurrencyService`.

## Spec / card differences (rule R4: the spec wins)

- **The binding plan `.ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md` was not available.** It is missing from the primary checkout, from PR #9999 and from every local ref. The user asked the run to proceed without it, so rules R1–R14 and the F4 card text were not read. This run follows the task brief, the spec and the reference commit.
- **The spec's §15 slice table has no "F4" row.** Its slices are CA0…CA10b, and the only "F4" in the spec is the rev 9 gift-line finding (§4.2), which is unrelated. F4 is a plan-level prerequisite of slice CA6 ("Approval gate in `cart.lock` … under the lock"). The spec text this step satisfies is §9a.1 (the `resolveTerms` D-R5-37 base-currency fallback runs inside `cart.lock`) and §8.1 / R24 (no writer under the cart lock takes a second pooled connection).
- **The D-R5-CA1…CA9 decisions** (2026-11-19 changelog) do not touch `currencies`. None constrains this step. D-R5-CA6 is about the sales snapshot, not slice CA6.

## Audit findings that concern this step

From `.ai/analysis/pre-implement-2026-08-14-cart-module-release-5.md`:
- Row 72 / I1: "Nothing under an advisory lock takes another pool connection; blocking waiters exhaust the pool". The approval gate resolves terms, and with them the base currency, under the cart lock, so this query must use the lock holder's connection.
- §9a.1 note / V12: `resolveTerms` carries `organizationId` for the D-R5-37 base-currency fallback (CG1). That fallback is what reaches `BaseCurrencyService`.

## Implementation Plan

### Phase 1

#### Step 1.1 — Resolve the base currency on the caller's connection and add baseCurrencyServiceFactory

Port the `currencies` part of `fd8452e911` and of `bdb747c36a` (the three files in Scope), plus tests. One commit.

## Risks

- `RateFetchingService` / `ExchangeRateService` constructors are typed with the `@mikro-orm/core` `EntityManager`. Passing the postgresql subtype is assignable, and `yarn typecheck` confirms it.
- Behavior outside a transaction is unchanged: `em.execute` uses the EM's own connection when no transaction is ambient.

## External References

- none (`--skill-url` not used)
