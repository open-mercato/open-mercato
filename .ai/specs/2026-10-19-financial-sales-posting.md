# Financial — automatic sales posting

**Status:** Implemented
**Created:** 2026-10-19
**Program:** [`2026-10-09-financial-module-program.md`](2026-10-09-financial-module-program.md)
**Module:** `financial` (consumer) + `sales` (event producer)

## TLDR

Sales invoices and payments now reach the general ledger without an operator typing a journal entry. Six persistent subscribers on the sales CRUD events invoke one financial command, which reads the document, resolves the posting accounts, and writes a balanced posted entry. Idempotency lives in a partial unique index on the entry's source columns; a deleted document reverses its entry rather than erasing history.

## Problem

The ledger was a manual book. Sales invoices — including every freight abstract invoice created through the sales bridge — produced money documents with no corresponding GL posting, so the trial balance, the statements and the Saudi VAT return described only what an operator happened to journal by hand. The VAT return's `reconciliationDelta` was therefore measuring the operator, not the business.

## Design

### Event path

| Sales event | Subscriber | Operation |
|---|---|---|
| `sales.invoice.created` | `sales-invoice-created-posting` | upsert |
| `sales.invoice.updated` | `sales-invoice-updated-posting` | upsert |
| `sales.invoice.deleted` | `sales-invoice-deleted-posting` | reverse |
| `sales.payment.created` | `sales-payment-created-posting` | upsert |
| `sales.payment.updated` | `sales-payment-updated-posting` | upsert |
| `sales.payment.deleted` | `sales-payment-deleted-posting` | reverse |

All six call `handleSalesDocumentPosting`, which builds a `CommandRuntimeContext` with `auth: null` and the event's tenant/organization, then executes `financial.sales_document.post`. A 4xx (missing chart, missing period, missing source) is logged and swallowed so a persistent subscription does not retry a configuration gap forever; a 5xx or unknown failure is rethrown and retried.

### Source read model

The financial module never imports sales entities. It reads `sales_invoices`, `sales_payments` and `sales_payment_methods` with scoped, parameterized SQL (`em.getConnection().execute`), the same tolerant-read pattern `freight_operations/lib/salesBridge.ts` uses. A missing sales module means the subscribers never fire, so the ledger simply stays manual.

### Posting rules

- Invoice: debit receivables with the invoice's gross total; credit revenue with `gross − tax`; credit output VAT with the tax total when it is non-zero.
- Payment: debit cash for a method whose code/name/kind says cash, bank otherwise; credit receivables with `captured − refunded`. A fully refunded payment produces no active posting and reverses an existing one.
- The revenue amount is derived as `gross − tax`, not copied from the invoice's stored net total. The ledger refuses an unbalanced entry, and a source whose stored totals disagree must still produce one that balances.
- The tax code travels on the revenue and VAT lines. It is the jurisdiction plugin's standard-rate code when tax is non-zero, and its out-of-scope (or zero-rated) code when it is not. The Saudi VAT return's classifier then sees the revenue line as the taxable base and the `2100` line as output VAT.

### Account resolution

Tenant config `financial` / `posting` (screen `/backend/financial/posting-settings`) may name five account codes: receivable, revenue, output VAT, cash, bank. A missing setting falls back to the first account of the matching type (`receivable`, `sales`, `tax_payable`, `cash`, `bank`); output VAT additionally prefers the jurisdiction tax code's `salesAccountCode`. If any role is still unresolved the command refuses with `posting_accounts_missing` and posts nothing — a partial posting is worse than none.

### Idempotency and corrections

`gl_journal_entries` gains `source_entity_type`, `source_entity_id` and `source_kind`, with a partial unique index:

```sql
create unique index gl_journal_entries_source_unique_idx
  on gl_journal_entries (organization_id, tenant_id, source_entity_type, source_entity_id, source_kind)
  where source_entity_id is not null and status <> 'reversed';
```

- A replayed event finds the active entry; if its lines match the desired lines it is a no-op.
- An update whose lines differ reverses the active entry in the current open period and posts a new one with the same source kind (the reversed row is excluded from the index).
- A delete reverses the active entry. Reversal entries carry `<kind>:reversal` so they are traceable and never collide with the posting they correct.

### Periods

The posting date is the invoice issue date (falling back to creation) or the payment received date. The command posts only into an open period; soft- and hard-closed periods are refused. If no period covers the date the command answers `posting_period_missing`. Seeding a fiscal year's periods is a setup concern and is not part of this change.

## API

- `GET /api/financial/posting-settings` — `financial.read`; returns the five codes, `canManage`, `updatedAt`.
- `PUT /api/financial/posting-settings` — `financial.admin`; optimistic lock via the standard extension header, mutation guard wired, tenant-scoped `module_configs` write.
- `GET /api/financial/journal-entries` now projects and filters the source columns (`sourceEntityType`, `sourceEntityId`).

## Tests

- Unit: `lib/__tests__/postingMap.test.ts` (account fallbacks, missing roles, balanced invoice lines, gross-minus-tax derivation, zero-tax omission, cash vs bank, line matching).
- Integration: `__integration__/TC-FINANCIAL-003-sales-posting.spec.ts` — create chart/period/order/invoice, wait for the posting, assert balance and the `2100` line with `SA-VAT-S`, assert an unchanged update does not double post, delete the invoice and assert a reversing entry.

## Out of scope

- Posting to closed periods or reposting an adjustment into a new period when the source date's period is closed. The command refuses rather than inventing a period.
- Credit memos and returns as their own source kinds; a sales credit memo does not yet reverse the original invoice's posting automatically.
- Payment allocation at the invoice level: sales payments are order-level, so the GL payment is order-independent cash-to-AR.
- Multi-currency translation: automatic entries post at exchange rate 1, matching the existing ledger behaviour.
- Seeding the fiscal periods themselves.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Missing posting accounts silently skip revenue | High | The command refuses with `posting_accounts_missing`; the subscriber logs it and the entry is absent rather than wrong |
| A replayed event double-posts | High | Partial unique index on source columns; line-match no-op |
| Revenue derived from gross-tax hides a stored total error | Medium | The VAT return still reconciles to the posted lines; the invoice's own totals remain the reporting source |
| Closed period blocks a correction | Medium | The reversal uses the current period; the new posting may still be refused, visibly |
| Sales schema drift breaks the read model | Medium | Reads are one module with explicit SQL; the integration spec fails first |

## Changelog

- **2026-10-20** — the `reverse` operation no longer reads the source document.
  A delete event arrives after the row is soft-deleted, so the source read
  returned null and the subscriber swallowed `posting_source_not_found`; the
  reversal now finds the existing entry by source id and entity type.
