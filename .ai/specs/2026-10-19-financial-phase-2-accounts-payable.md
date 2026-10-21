# Financial Phase 2 — accounts payable and withholding

**Status:** Implemented
**Created:** 2026-10-19
**Program:** [`2026-10-09-financial-module-program.md`](2026-10-09-financial-module-program.md)
**Depends on:** automatic posting (`2026-10-19-financial-sales-posting.md`)

## TLDR

Vendors, vendor invoices with lines, payments with allocations, and jurisdiction withholding tax. A vendor invoice posts once to the ledger (expense + input VAT against payable); a payment settles payables, credits the withholding liability at the country plugin's rate, and credits cash or bank with the net. AP aging reconciles the open invoices to the posted payable account.

## Problem

The ledger could record a payment but not what it was for. There was no vendor register, no invoice to approve, no way to apply Saudi withholding to a non-resident payment, and no AP aging. Every vendor payment was an operator-authored journal entry.

## Design

### Entities (`ap_*`)

| Entity | Table | Purpose |
|---|---|---|
| `ApVendor` | `ap_vendors` | Code, name, Arabic name, VAT/CR numbers, contact, country, active flag. Unique code per org/tenant. |
| `ApVendorInvoice` | `ap_vendor_invoices` | Vendor, internal number, vendor's number, issue/due dates, currency, net/tax/gross, status (`draft|posted|paid|void`), posted entry id. |
| `ApVendorInvoiceLine` | `ap_vendor_invoice_lines` | Description, expense account, quantity, unit price, net/tax/gross, tax code. |
| `ApPayment` | `ap_payments` | Payment number, date, currency, gross, withholding code/amount, net, method, reference, status (`posted|void`), posted entry id. |
| `ApPaymentAllocation` | `ap_payment_allocations` | Payment → invoice, amount. |

All rows carry tenant/organization, `updated_at` (optimistic locking), and soft delete where a record can be archived. Totals are computed server-side from the lines; a client-supplied total is never trusted.

### Posting

- **Vendor invoice** — debit each line's expense account with its net; debit input VAT with the invoice's tax total; credit payable with the gross. The entry is created `posted`, and the invoice stores `posted_entry_id`.
- **Payment** — debit payable with the gross; credit the jurisdiction withholding payable account when a category is selected; credit cash (method `cash`) or bank with the net.
- Both use the shared posting command helpers, so period gating, source idempotency and reversal behave exactly like sales posting.
- A posted invoice may only be voided: voiding reverses its entry. A draft may be edited or deleted; a draft with allocations cannot be deleted.
- A payment may be voided: the reversal restores the entry and recomputes each allocated invoice's status (`paid` → `posted`).

### Withholding

`FinancialCountryPlugin` gains an optional `withholding` capability:

```ts
type WithholdingContract = {
  countryCode: string
  listCategories(): readonly WithholdingCategory[]
  findCategory(code): WithholdingCategory | null
  compute(input: { gross: string; code: string }): WithholdingComputation
}
```

The Saudi adapter delegates to the already-pinned `computeSaudiWithholding`, so the rates and halala arithmetic have one implementation. The payment command refuses a withholding code when the jurisdiction has no capability (`withholding_not_available`) and an unknown category (`withholding_category_not_found`).

### Account resolution

`resolvePayablePostingAccounts` resolves payable by configured code or account type `payable`, and input VAT by configured code, the jurisdiction tax code's purchase account, or type `tax_receivable`. The posting-settings screen and API gained `payableAccountCode` and `inputVatAccountCode`.

### AP aging

`lib/apService.ts` reads posted/paid vendor invoices, subtracts posted allocations, buckets the outstanding amount by due date, and reports the posted payable balance as a reconciliation figure (`reconciliationDelta`). A paid invoice drops out because its outstanding is zero.

## API

| Method | Path | Feature |
|---|---|---|
| GET/POST/PUT/DELETE | `/api/financial/ap/vendors` | `financial.read` / `financial.write` |
| GET/POST/PUT/DELETE | `/api/financial/ap/invoices` | `financial.read` / `financial.write` |
| POST | `/api/financial/ap/invoices/post` | `financial.post` |
| POST | `/api/financial/ap/invoices/void` | `financial.post` |
| GET | `/api/financial/ap/invoices/lines?id=` | `financial.read` |
| GET | `/api/financial/ap/payments` | `financial.read` |
| POST | `/api/financial/ap/payments/post` | `financial.post` |
| POST | `/api/financial/ap/payments/void` | `financial.post` |
| GET | `/api/financial/ap/aging` | `financial.read` |
| GET | `/api/financial/ap/withholding-categories` | `financial.read` |

Action routes go through the shared mutation guard and the command bus. All list filters use column names (`snake_case`).

## UI

- `/backend/financial/payables` — aging buckets and open invoices.
- `/backend/financial/payables/vendors` — list, create, edit.
- `/backend/financial/payables/invoices` — list, create draft (line editor), detail with Post/Void, edit while draft.
- `/backend/financial/payables/payments` — list and a payment form with withholding and invoice allocation.

## Tests

- Unit: `lib/__tests__/apService.test.ts` — line arithmetic, stated tax, totals, withholding at 5%/15%/0%, aging buckets and delta.
- Integration: `__integration__/TC-FINANCIAL-005-ap-and-wht.spec.ts` — vendor → invoice → post (three legs asserted) → payment with 5% WHT (three legs asserted) → invoice becomes `paid` → aging reconciles to zero.

## Out of scope

- Three-way match against purchase orders / goods receipts.
- Vendor credit notes and prepayments.
- Multi-currency translation (exchange rate is 1, as elsewhere).
- Remittance advice documents and bank file export.
- WHT remittance filing (the liability account is posted; filing is an operator action).

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A client-supplied total is trusted | High | Totals are computed from lines; the schema does not accept them |
| Withholding rate drifts from the published schedule | High | The engine consumes the country contract; the Saudi adapter delegates to the pinned catalogue |
| Allocation exceeds the invoice or payment | High | Both are refused inside the transaction with pessimistic locks |
| Void leaves an invoice marked paid | High | Void recomputes every allocated invoice's status from posted allocations |
| Payable account missing | High | `posting_accounts_missing` refuses the posting; nothing partial is written |

## Changelog

- **2026-10-20** — invoice status recompute reads allocations and payments through
  the command's EntityManager instead of a raw connection query. The raw query ran
  outside the transaction, so a new payment's allocations were invisible and a
  fully settled invoice stayed `posted`; voiding a payment had the symmetric
  problem and left the invoice `paid`.
