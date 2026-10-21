# Financial Phase 3 — accounts receivable

**Status:** Implemented (read model)
**Created:** 2026-10-19
**Program:** [`2026-10-09-financial-module-program.md`](2026-10-09-financial-module-program.md)
**Depends on:** automatic sales posting (`2026-10-19-financial-sales-posting.md`)

## TLDR

Receivables are a read model over the sales invoices that automatic posting already puts on the ledger: an aging report by days past due, reconciled against the posted receivable account, and a customer statement of invoices and payments. No new receivable documents are created — `sales` owns the invoice, `financial` owns the accounting view.

## Problem

After automatic posting, the ledger knows the receivable balance but not which customer owes it or how old it is. An accountant needs the aging buckets and a statement per customer; without them the AR account is a single number.

## Design

### Aging

`lib/arService.ts` reads open `sales_invoices` (`outstanding_amount > 0`, not draft/cancelled/void) joined to `sales_orders` for the customer id and snapshot name. Each invoice is bucketed by its due date relative to `asOf`:

| Bucket | Days past due |
|---|---|
| `current` | not yet due, or no due date |
| `days1to30` | 1–30 |
| `days31to60` | 31–60 |
| `days61to90` | 61–90 |
| `days90plus` | 91+ |

The report returns per-bucket counts and amounts, the total outstanding, the posted receivable balance (posted lines of accounts with `account_type = 'receivable'` up to `asOf`), and `reconciliationDelta`. A non-zero delta is shown prominently: it means a journal entry or payment bypassed the sales flow.

### Statement

For one customer (`sales_orders.customer_entity_id`), the statement unions invoices (debit) and payments (credit) in date order, with optional `from`/`to` bounds. Totals and the closing balance are sums of those lines. `openingBalance` is zero because the range is the statement window; a true opening balance would require closing entries per customer, which is out of scope.

## API

| Method | Path | Feature |
|---|---|---|
| GET | `/api/financial/receivables/aging?asOf=YYYY-MM-DD` | `financial.read` |
| GET | `/api/financial/receivables/statements?customerId=&from=&to=` | `financial.read` |

All query parameters are validated; `customerId` is a UUID. Scope comes from the authenticated tenant/organization, never from the query.

## UI

- `/backend/financial/receivables` — as-of date, five bucket cards, totals and reconciliation, open-invoice table with customer links.
- `/backend/financial/receivables/statements/[customerId]` — range picker, document table, totals and closing balance.

## Tests

- Unit: `lib/__tests__/arService.test.ts` — every bucket boundary, missing due dates, totals and the reconciliation delta.
- Integration: `__integration__/TC-FINANCIAL-004-ar-aging.spec.ts` — an invoice created and posted through the sales flow appears in `current`, the aging total equals the ledger balance (`delta 0`), and the customer statement shows the invoice as a debit.

## Out of scope

- Receipt allocation at the invoice level (sales payments are order-level).
- Dunning runs and credit-limit enforcement.
- Multi-currency: all amounts are returned in the invoices' own currency; a mixed-currency aging is reported per row, not converted.
- Opening balances per customer.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Aging disagrees with the ledger | High | `reconciliationDelta` is part of the response and the screen warns |
| A payment status not in the exclusion list keeps a settled invoice open | Medium | The exclusion list is explicit; a status adding test is part of the unit suite's follow-up |
| Customer snapshot missing | Low | Falls back to the customer id, then to `—` |

## Changelog

- **2026-10-20** — `sales.invoices.create` now persists `order_id` through the
  `order` relation; the previous scalar assignment was silently dropped, so the
  statement's order join found no invoice. `TC-FINANCIAL-004` measures aging
  movements against a baseline so a shared database with other open invoices
  cannot skew the reconciliation assertion.
