# Checkpoint 2 - Steps 2.6b..2.11

**Recorded:** 2026-09-19T15:25:06Z
**Steps covered:** 2.6b, 2.7, 2.8, 2.9, 2.10, 2.11
**Commit range:** `9fd947875..c80d7ad7d`
**Runner:** local (no compose `app` container on this host)

## Touched areas

| Area | What changed |
|---|---|
| `sales` documents | the price presentation switch, the market-named tax line and its estimate note |
| `sales` quotes | `lib/quoteDisplay.ts` plus the public quote route, the public page and the sent-quote email |
| `sales` settings | tax rates wording, channel address fields |
| `catalog` | unit placeholders, the single-price caption, the tax-inclusive price kind warning |
| `wms` | warehouse dialog defaults |
| `shipping_carriers` | the shipment wizard's address hints and its pounds/inches input boundary |
| `shared` display | the neutral price-label map corrected to the keys the app actually renders |

## Checks

| Check | Scope | Result |
|---|---|---|
| `yarn generate` | repo | pass, no drift |
| `turbo run typecheck` | all 38 packages | pass |
| `yarn workspace @open-mercato/core test` | 1943 suites / 17491 tests | pass after one fix (below) |
| `yarn workspace @open-mercato/shared test` | 211 suites / 2422 tests | pass |
| `yarn workspace @open-mercato/ui test` | 254 suites / 2170 tests | pass |
| `yarn i18n:check-sync` | 62 modules, 5 locales | pass, all in sync |

### One test failed and was fixed

`sales/components/__tests__/salesComponentsRender.test.tsx > renders tax rates settings rows` asserted
`getByText(/VAT/)` after Step 2.9 reworded the page. The assertion was **never** matching a table row: the suite's
`DataTable` stub renders `row.title ?? row.label ?? …` and this component's row shape reaches it with none of those,
so the only "VAT" on the page was the section description this run deliberately changed. The test now counts the row
the table received, the way every sibling test in the file does, and also asserts the section heading. The production
change stands; the test was green for the wrong reason.

## UI verification - still deferred to the final gate

Unchanged from checkpoint 1: this slot is on the shared instance database, and demonstrating the change means writing
a US market profile row, which would alter every other slot's rendering. The browser pass runs at the final gate on
`omw up --fresh`. No `checkpoint-2-artifacts/` directory was created.

## Notes

- Steps 2.8 and 2.10 turned out smaller than the spec implies, and the commits say why: the catalog `tax_code` /
  `is_taxable` form fields already shipped with the columns in PR #5, and the WMS warehouse dialog exposes no region
  or postal-code field for an address layout to shape (it takes the market's country and time zone instead).
- Step 2.6b also corrected `NEUTRAL_PRICE_LABEL_KEYS` in the shared helper: the map shipped with PR #5 named keys
  (`sales.documents.totals.*`) that no surface renders, so it could never have collapsed a real label.
