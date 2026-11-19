# Plan — r5-f3-resolve-for-buyer

**Date:** 2026-11-19
**Branch:** feat/r5-f3-resolve-for-buyer (stacked on #10000 → #9988; review only commits after `b8fed30efc`)
**Source spec:** .ai/specs/SPEC-029-2026-02-17-ecommerce-storefront-module.md (§6, §6.3, §12, §16, §17 Phase 4, §18; changelog 2026-11-19, D-R5-SF1…SF5)
**Reference implementation:** closed PR #8268 at `bdb747c36a`, diff base `b7b5309ccc`
**Release plan step:** F3 of `.ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md`

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Port resolveForBuyer seam with store_misconfigured and unit tests | inline | todo | — |
| 1 | 1.2 | Add the StoreContextService upgrade note | inline | todo | — |

## Goal

Add the trusted, in-process buyer seam `storeContextService.resolveForBuyer?` (optional member, store optional) so later callers (CA2b, CA4a, CA9b, CH3, AS3) can price and scope a buyer who is not the requester.

## Scope

`packages/core/src/modules/ecommerce/`:
- `lib/storeContextService.ts` — `ResolveForBuyerInput`/`ResolveForBuyerResult`, the optional `resolveForBuyer?` with the "absent ⇒ fail closed" doc comment (D-R5-SF1) plus the caller rules (D-R5-SF2, SF5), and its implementation.
- `lib/storeContext.ts` — `store_out_of_scope` / `buyer_out_of_scope` codes, `loadStoreChannelForBuyer`.
- `lib/buyerContext.ts` — `resolveTrustedBuyerIdentity`, `composeTrustedBuyer`, and the refactor of `resolveTaxMode` / `resolveCustomerOverlayId` onto a tenant/organization scope (runs on the storefront path at once).
- `lib/__tests__/resolveForBuyer.test.ts` (new).
- `UPGRADE_NOTES.md` — only the reference's StoreContextService bullet, under its own heading.

## Non-goals

- Every caller (CA2b, CA4a, CA9b, CH3, AS3) and their error mapping (`409 cart_buyer_unresolvable`, `503 buyer_resolution_unavailable`).
- Integration tests of the seam — they ship with the callers (§16).
- The rest of the reference's UPGRADE_NOTES block (sales validators, checkout hardening, …).
- `ecommerce`'s `requires` list (audit N3).

## Implementation Plan

### Phase 1 — the seam

- **1.1 Port resolveForBuyer seam with store_misconfigured and unit tests** — port the three lib hunks from `bdb747c36a`; change `loadStoreChannelForBuyer` to join `sales_channels` (tenant/org/`deleted_at` scoped, as `resolve()` does) and the service to throw `StorefrontResolutionError(503, 'store_misconfigured')` when the store has no usable default channel binding (D-R5-SF3); port the reference unit test and add the §16 cases it lacks.
- **1.2 Add the StoreContextService upgrade note** — the reference's StoreContextService bullet only, under its own `##` heading.

## Differences from the reference / card (rule R4: spec wins)

| # | Reference (#8268) | Spec / this PR | Source |
|---|---|---|---|
| 1 | Store with no default binding returned `channel: null`; group scope only | Refused with `503 store_misconfigured`; also when the binding's sales channel is deleted or outside the tenant/org | D-R5-SF3, §6.3, §16 |
| 2 | Doc comment named only "absent ⇒ fail closed" | Also documents the refresh rule (`customerUserId` alone) and that callers map refusals to their own codes | D-R5-SF2, SF5 |
| 3 | Unit test covered 6 cases | Adds every §16 case: `buyer_out_of_scope` variants, `customerId`-only person/company, relinked buyer, `store_misconfigured`, no-override `priceKindId: null`/`taxMode: null`, marker-only recognition | §16, audit I7 |

`resolveForBuyer?` stays optional (D-R5-SF1) — the reference already had it optional. SPEC-029 §6 already shows the method as optional (v4.12), so no new spec changelog line is needed.

## Audit findings and decisions that concern F3

From `.ai/analysis/pre-implement-SPEC-029-2026-02-17-ecommerce-storefront-module-release-5.md` and its remediation (SPEC-029 changelog 2026-11-19):
- I1/B1 → D-R5-SF1: optional member, every caller fails closed when absent. Honoured (type + doc comment).
- I2 → refusal contract: `StorefrontResolutionError` with `status`, `code`, `Symbol.for` marker. The marker already exists on the base; covered by a marker-only test.
- I3/D1 → D-R5-SF2: refresh with `customerUserId` alone; relinked buyer returns the new ids. Documented on the method; unit test.
- V4/D2 → D-R5-SF3: `store_misconfigured`. Implemented (difference #1).
- N1: active, non-deleted user required; `customerId`-only buyers resolve with primary company and count as authenticated. Ported.
- I7: §16 unit cases. Covered (difference #3).
- I4, I5, I6, D3/SF4, SF5 names: caller-side; out of scope here.

## Risks

- `buyerContext.ts` refactor (`resolveTaxMode`, `resolveCustomerOverlayId` now take a scope) runs on every storefront request at once. It is a behaviour-preserving extraction; covered by the existing ecommerce unit suite.
- Inert otherwise: nothing calls `resolveForBuyer` until the first caller card lands.

## Run notes

- The release plan `.ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md` (rules R1–R14, card F3) was not in the primary checkout, in any worktree, or in git history. The user told the run to continue without it, so the binding sources are SPEC-029 on the base branch and the F3 card text given in the run brief.

## External References

None.
