# Execution plan — R5 SA1: null snapshot line fields and external references on quotes

**Date:** 2026-11-19
**Slug:** r5-sa1-quote-external-reference
**Branch:** feat/r5-sa1-quote-external-reference (from `refs/remotes/pr/9998`, tip `2025d4a181`)
**PR base:** main (stacked on #9998 and #9988)
**Binding spec:** .ai/specs/2026-03-19-checkout-simple-checkout.md (as on #9998) — §3.3, §7.2 step 5a and field mapping, §8.4, §8.6, §14a rows 3–5, §16 "Cross-module requirements" (`sales` row), D-R5-30, D-R5-CH1
**Re-landing plan card:** "SA1" of `.ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md` (see Assumptions: not readable during this run)
**Reference implementation:** closed PR #8268 at `bdb747c36a` (diff base `b7b5309ccc`)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Accept explicit null on the shared order and quote line fields | inline | done | 00acacf3de |
| 1 | 1.2 | Accept and persist externalReference and customerReference on sales.quotes.create | inline | done | 96328c4a0f |
| 1 | 1.3 | Index sales_quotes and sales_orders by tenant and external reference | inline | done | 26515f137e |
| 1 | 1.4 | Document the sales line validator widening in UPGRADE_NOTES | inline | done | (this commit) |

## Goal

Let checkout (CH4 / CH6a) create its document idempotently: the shared line schemas take the `null`s a `SalesLineSnapshot` carries, `sales.quotes.create` takes `externalReference` / `customerReference`, and both `sales_quotes` and `sales_orders` get a `(tenant_id, external_reference)` lookup index.

## Scope (packages/core/src/modules/sales/)

- `data/validators.ts`: the three reference hunks — `linePricingSchema` and `lineSharedSchema` fields become `.nullable().optional()`; `quoteCreateSchema` gains `externalReference` / `customerReference` (`max(191)`, as `orderCreateSchema`).
- `commands/documents.ts`: reference hunk 9 only — `externalReference` / `customerReference` passed to `em.create(SalesQuote, …)`.
- `data/entities.ts`: `@Index sales_quotes_tenant_external_reference_idx` on `SalesQuote`, `@Index sales_orders_tenant_external_reference_idx` on `SalesOrder`.
- Migrations: `Migration20261119120000_sales_quotes_external_reference_idx.ts` (as the reference: non-transactional, `drop … if exists` then `create index concurrently`) and `Migration20261119120100_sales_orders_external_reference_idx.ts` (same shape); snapshot: the two index entries only.
- Tests: `data/__tests__/validators.order-lines.test.ts`, `commands/__tests__/documents.quote-external-reference.test.ts`.
- `UPGRADE_NOTES.md`: the "Sales line validators" bullet under its own heading.

## Non-goals

- SA3: quote approval hunks and the `approval_requirement` column.
- SA2a: order lifecycle hunks (undo re-emit, `sales.order.deleted`).
- CH4: `salesDocumentLookupService`, `suppressStaffNotification`, the checkout lookup and every checkout caller.
- `sales.orders.create` input changes: on the base branch `orderCreateSchema` already accepts `externalReference` / `customerReference` and `createOrderCommand` already persists them (`documents.ts` `em.create(SalesOrder, …)`); nothing to add.

## Implementation Plan

### Phase 1 — sales contract for checkout's document creation

#### Step 1.1 — Accept explicit null on the shared order and quote line fields
Reference hunks 1–2 of `validators.ts`, plus `amountsMode` (see difference 2). Every consumer already treats `null` like an omitted value (`??`, `!= null`). `validators.order-lines.test.ts` gains the reference's two null-snapshot cases (order line, quote line) and an `amountsMode: null` case.

#### Step 1.2 — Accept and persist externalReference and customerReference on sales.quotes.create
Reference hunk 3 of `validators.ts` and hunk 9 of `documents.ts`. `documents.quote-external-reference.test.ts` drives the real `sales.quotes.create` handler: the references land on the created quote row, they default to `null`, and a checkout-shaped line with explicit `null`s passes the real `quoteCreateSchema.parse()`.

#### Step 1.3 — Index sales_quotes and sales_orders by tenant and external reference
Entity decorators, two non-transactional concurrent-build migrations, the two snapshot index entries. Gate: `yarn db:generate` shows no further diff for `sales`.

#### Step 1.4 — Document the sales line validator widening in UPGRADE_NOTES
The reference's "Sales line validators" bullet under its own heading, covering order and quote lines, plus the `quoteCreateSchema` fields and the two indexes.

## Spec vs card differences (rule R4: the spec wins)

1. **`sales_orders (tenant_id, external_reference)` index and order-line widening** (D-R5-CH1, §14a row 5). The card names only the quote index; the order outcome is now created by `sales.orders.create`, so the order gets the same index. The line widening already covers order lines (shared schemas). Owner-approved additive index.
2. **`amountsMode` accepts `null`.** §14a row 3: the shared line schemas accept `null` "wherever `SalesLineSnapshot` declares `| null`". `SalesLineSnapshot.amountsMode` is `SalesAmountsMode | null`; the reference left it non-nullable. Added; `assertUniformAmountsMode` and `assertAmountsModeUnsupportedOnQuote` already test `!= null`, so a `null` behaves as omitted (a quote line with `amountsMode: null` is still accepted).
3. **Index columns.** The audit's Important #2 proposes `(tenant_id, organization_id, external_reference)` for orders; the spec (§14a row 5, §16) and the brief say `(tenant_id, external_reference)`. Following the spec; the lookup still filters by `organization_id` in `sales` (CH4).
4. **No SA1 step row in the checkout spec.** §17 on #9998 cuts only CH0a–CH6b; the `sales` work is the §16 cross-module requirement "needed by CH4, CH5a". SA1's content was taken from that row, §14a rows 3–5 and the brief.
5. **Migration file names** use this run's date (`20261119…`) rather than the reference's `20261028010000`, so they sort after the base branch's latest `sales` migration (`Migration20261014082520_sales.ts`).

## Audit findings and decisions that concern SA1

From `.ai/analysis/pre-implement-2026-03-19-checkout-simple-checkout-release-5.md` and the spec's 2026-11-19 changelog:

- **Blocker 1 / G1, D1 → D-R5-CH1** — idempotency keys on the order's own `external_reference`; additive `sales_orders` index. → Step 1.3.
- **R6 (3)** — `quoteCreateSchema` lacked `externalReference` / `customerReference`. → Step 1.2.
- **BC 1 (Warning)** — line validators widened to `null`; needs an exact UPGRADE_NOTES entry (review Major R4 #9); with D1 the order path needs the same widening. → Steps 1.1, 1.4.
- **BC 2 (Warning)** — `sales_orders` index needs its own Ask First (approved, D-R5-CH1). → Step 1.3.
- **D-R5-30** — `sales_quotes (tenant_id, external_reference)` approved. → Step 1.3.
- **D-R5-CH8** (`suppressStaffNotification`) and **D-R5-CH5** (`salesDocumentLookupService`) — not in SA1 (CH4).

## Assumptions

- The re-landing plan (`.ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md`) was absent from the primary checkout during this run (removed after the W1 run read it; not in git). The user told the run to continue without it, so rules R1–R14 and the SA1 card were taken from the brief that quotes them; nothing beyond the brief was assumed from the plan.
- No caller sends the new fields until CH4; `POST /api/sales/quotes` persists the references immediately (the route parses `quoteCreateSchema`).

## Risks

- Widening the validators changes inferred types to `| null` for module authors (UPGRADE_NOTES). Typecheck guards in-repo consumers.
- `create index concurrently` cannot run in a transaction; the migrations opt out with `isTransactional(): false`, like the module's earlier concurrent builds.
