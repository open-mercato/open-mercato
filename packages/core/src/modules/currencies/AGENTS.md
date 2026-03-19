# Currencies Module — Agent Guidelines

Use the currencies module for multi-currency support, exchange rates, and currency conversion.

## MUST Rules

1. **MUST store currency amounts with 4 decimal precision** — never truncate to 2 decimals internally
2. **MUST use date-based exchange rates** — always resolve rates for the transaction date, not "current" rate
3. **MUST record both transaction currency and base currency amounts** — dual recording is mandatory for reporting
4. **MUST calculate realized gains/losses** on payment: `(payment rate - invoice rate) × foreign amount`
5. **MUST NOT hard-delete exchange rate records** — rates are historical reference data

## Key Files

| File | When to modify |
|------|---------------|
| `data/entities.ts` | When changing currency or exchange rate entity schema |
| `data/validators.ts` | When updating validation rules for currency data |
| `api/` | When adding/modifying currency or exchange rate CRUD routes |

## DB Tables

- `currency` — currency master data
- `exchange_rate` — daily exchange rates per currency pair

## When Adding a New Currency

1. Add the currency record via the admin UI or `seedDefaults` hook
2. Ensure exchange rates exist for the currency pair at required dates
3. Verify all sales/pricing logic resolves the new currency correctly

## Multi-Currency Transaction Rules

When processing multi-currency transactions (e.g., sales invoice in EUR with USD base):

1. Retrieve the exchange rate for the transaction date
2. Generate the document in the transaction currency
3. Calculate the base currency equivalent: `foreign amount × rate`
4. Store both amounts on the document
5. On payment: calculate realized gain/loss from rate difference
6. Report in both transaction and base currencies

## Database Constraints

- Index on `(account_id, period_id, posting_date)` for fast lookups
- Index on document numbers for search
- Index on `vendor_id` and `customer_id` for relationship queries
- Financial postings MUST be atomic — full transaction rollback on error
- Audit trail MUST be immutable — no deletion of posted transactions
