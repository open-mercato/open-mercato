# Currencies Module — Standalone App Guide

Use the currencies module for multi-currency support, exchange rates, and currency conversion.

## Key Rules

1. **Store amounts with 4 decimal precision** — never truncate to 2 decimals internally
2. **Use date-based exchange rates** — always resolve rates for the transaction date, not the "current" rate
3. **Record both currencies** — dual recording (transaction currency + base currency) is mandatory for reporting
4. **Calculate realized gains/losses** on payment: `(payment rate - invoice rate) × foreign amount`
5. **Never hard-delete exchange rates** — they are historical reference data

## Multi-Currency Transaction Pattern

When processing multi-currency transactions (e.g., sales invoice in EUR with USD base):

1. Retrieve the exchange rate for the transaction date
2. Generate the document in the transaction currency
3. Calculate the base currency equivalent: `foreign amount × rate`
4. Store both amounts on the document
5. On payment: calculate realized gain/loss from rate difference
6. Report in both transaction and base currencies

## Data Model

| Entity | Table | Purpose |
|--------|-------|---------|
| **Currency** | `currency` | Currency master data (code, name, symbol) |
| **Exchange Rate** | `exchange_rate` | Daily exchange rates per currency pair |

## Adding a New Currency

1. Add the currency record via the admin UI or `seedDefaults` hook in your `setup.ts`
2. Ensure exchange rates exist for the currency pair at required dates
3. Verify all sales/pricing logic resolves the new currency correctly

## Using Currencies in Your Module

When your module deals with monetary amounts:
- Store the currency code alongside the amount
- Reference the currencies module for exchange rate lookups
- Use the transaction date for rate resolution, not the current date
- Store both foreign and base amounts for reporting
