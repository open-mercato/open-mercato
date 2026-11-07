# Currencies Module — Agent Guidelines

Use the currencies module for multi-currency support, exchange rates, and currency conversion.

## Always

1. **MUST keep currency amounts exact** - money and FX columns are unconstrained `numeric`; do money math with `@open-mercato/shared/lib/decimal` (never JS `number`), round only division results: amounts to `max(4, currency.decimalPlaces)` (`resolveCurrencyAmountDecimalPlaces`), FX math to `FX_DECIMAL_PLACES` (50). Never truncate internally to 2 decimals
2. **MUST use date-based exchange rates** — always resolve rates for the transaction date, not "current" rate
3. **MUST record both transaction currency and base currency amounts** — dual recording is mandatory for reporting
4. **MUST calculate realized gains/losses** on payment: `(payment rate - invoice rate) × foreign amount`
5. **MUST keep financial postings atomic** — full transaction rollback on error
6. **MUST NOT filter rate fetching by `isActive`** — that flag decides whether a currency can be
   picked for something new, not whether it still needs a live rate. Rates are fetched for every
   currency in scope that is not soft-deleted. See `services/README.md` → "Which Currencies Get Rates"

## Ask First

- Ask before changing precision, exchange-rate lookup semantics, realized gain/loss formulas, or financial reporting fields.
- Ask before changing historical exchange-rate retention behavior.

## Never

- Never truncate internal currency amounts to 2 decimals, and never round an exchange rate to a fixed scale.
- Never hard-delete exchange rate records — rates are historical reference data.
- Never delete posted transactions or audit-trail entries.

## Validation Commands

```bash
yarn db:generate
yarn generate
yarn workspace @open-mercato/core build
```

## Key Files

| File | When to modify |
|------|---------------|
| `data/entities.ts` | When changing currency or exchange rate entity schema |
| `data/validators.ts` | When updating validation rules for currency data |
| `api/` | When adding/modifying currency or exchange rate CRUD routes |

## DB Tables

- `currencies` - currency master data (`decimal_places` up to 50 drives amount rounding)
- `exchange_rates` - exchange rates per currency pair, date and source; `rate` is unconstrained `numeric`, `metadata` is free-form `jsonb` (providers store context such as the NBP table number)

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
