# Document tax processor contract for external tax engines: brief for `om-spec-writing`

Repository: systevio/open-mercato (fork of open-mercato/open-mercato), branch `develop`, evidence verified at
commit 78df61346. The fork differs from upstream `develop` only by the `.ai/briefs/` packages, so every code
fact below is upstream Open Mercato code.

Owner: Systevio (operator). Consumer of the seam: the external package `@systevio/tax-provider`
(repository systevio/om-tax-provider, today a placeholder module `tax_provider` generated from the
official-modules template), which will hold an Avalara AvaTax adapter and, as an explicit plan B, a limited
table based provider. Core gets the contract and the persistence. Core gets no vendor code.

## TLDR for the spec author

- Core already has a unit level seam: DI token `taxCalculationService` (`TaxCalculationService.calculateUnitAmounts`,
  net and gross from a table rate) with events `sales.tax.calculate.before` and `sales.tax.calculate.after`. It answers
  "what is the gross of this one amount". It cannot answer "what is the tax of this document shipped to this address
  for this customer", which is what every real tax engine computes.
- Document totals run through `salesCalculationService` and the registry in `sales/lib/calculations.ts`. Per line tax is
  `netSubtotal * line.taxRate` unless the line carries an explicit `taxAmount`. There is no place where an engine can
  return per line tax for the whole document before totals are summed, and nothing persists a breakdown, a status or a
  provider key on invoices and credit memos.
- The change is one interface, one DI token with a default, one call site, one zod schema, two new columns on four
  document entities plus two additive columns on two of them, two events with payload contracts, tests and docs.
  No new module, no new entity, no UI screen.

## 1. Owner decisions (apply as given, do not raise as Open Questions)

- D1. Scope. One spec, phased. Phase 1 is the contract, the call site and the persistence. Phase 2 is the customer
  exemption inputs. Phase 3 is documentation and the reference adapter sketch. Phase 1 alone must be shippable and
  must leave a tenant without a processor byte for byte unchanged in totals.
- D2. Contract lives in `sales`. New interface `TaxProcessor` in `packages/core/src/modules/sales/services/`
  next to `taxCalculationService.ts`, DI token `taxProcessor` registered in `packages/core/src/modules/sales/di.ts`.
  The existing `TaxCalculationService` and its token stay as they are; the spec must say how the two relate (3.2).
- D3. Default implementation is not a stub that returns zero. The default `TableTaxProcessor` reproduces today's
  math (line `taxRate` or explicit `taxAmount`, see `sales/lib/calculations.ts:120-186`) and returns
  `taxStatus: 'calculated'` with `providerKey: 'table'`. Totals of existing tenants do not change.
- D4. Persistence reuses what exists. `sales_orders.tax_strategy_key` (`entities.ts:397`) and `sales_orders.tax_info`
  (`:403`), `sales_quotes.tax_info` (`:888`) are reused: `tax_strategy_key` stores the provider key, `tax_info` stores
  the breakdown under a zod schema with `passthrough()`. New nullable columns on `SalesQuote`, `SalesOrder`,
  `SalesInvoice`, `SalesCreditMemo`: `tax_status` (text, one of `estimated`, `calculated`, `exempt`, `failed`) and
  `tax_calculated_at` (timestamptz). Additive: `tax_info` and `tax_strategy_key` on `SalesInvoice` and
  `SalesCreditMemo`, which lack them (`:1383`, `:1550`). No parallel `tax_breakdown` or `tax_provider_key` columns.
- D5. Provider selection is the package's business. Core calls whatever is registered under `taxProcessor`. The
  external package registers its processor in its own `di.ts` and decides per organization from its own settings
  whether it is active; when it is not active for an organization it returns `{ applied: false }` and core falls back
  to the default processor. Core adds no settings screen, no `SalesSettings` column and no ACL feature for vendors.
- D6. Fallback is explicit, never a silent zero. When the processor throws, times out or returns `applied: false`,
  core computes totals with the default processor and stores `tax_status: 'estimated'` (or `'failed'` when the
  processor threw and the document is an invoice or credit memo) plus the error class in `tax_info.error` without
  the vendor payload. Amounts are never zeroed by an error. A document with `tax_status` `estimated` is not a tax
  document; the spec must say this in the user facing wording it proposes for `tax_note_key`.
- D7. No UI in core in this spec, with one exception: the existing document detail surfaces that already render
  `tax_total_amount` may show `tax_status` as a badge and the note key, through i18n keys added to the existing
  `en.json`, `pl.json`, `de.json`, `es.json` of `sales`. No new page, no new settings tab. Display profiles, price
  presentation and address layouts are out of scope and must not be referenced as prerequisites.
- D8. Commit and void lifecycle is out of core. The external package subscribes to the existing events
  `sales.order.confirmed`, `sales.order.cancelled` (`events.ts:31-32`, emitted from `commands/documents.ts:963-972`)
  and `sales.invoice.created` (`events.ts:41`). Core adds only what those payloads lack for a tax commit
  (document id, kind, organization, tenant, `tax_strategy_key`, `tax_calculated_at`); the spec lists the payload
  contract. No new `commit()` method on the interface in this spec.
- D9. Independence. This spec does not depend on the halted spec `2026-09-18-market-display-profile` (branch
  `spec/market-display-profile`, PR #1 of the fork, label `do-not-merge`). The `TaxCalculator` interface proposed there
  does not exist in code. The spec names it in "Migration & Backward Compatibility" as a proposal that must merge into
  `TaxProcessor` if that branch is ever revived, and nowhere else.
- D10. Product tax code reuses `catalog_products.tax_classification_code` (`catalog/data/entities.ts:177`,
  24 usages in `packages/core/src`). No new product column. Variants inherit it; the spec says how the line snapshot
  carries it to the processor.

## 2. Problem statement (evidence, verified at 78df61346)

1. Unit seam only. `packages/core/src/modules/sales/services/taxCalculationService.ts:24-26` defines
   `calculateUnitAmounts(input: CalculateTaxInput)` with `amount`, `mode`, `taxRateId`, `taxRate`. Callers:
   `catalog/commands/prices.ts:350` and `:619` (price rows), `sales/commands/documents.ts:7176` and `:7675`
   (line unit price when one side is missing). Events `sales.tax.calculate.before` and `.after`
   (`taxCalculationService.ts:36-58`, catalog `events.ts:90-91`) can short circuit one amount. None of these calls
   knows the ship to address, the customer or the other lines.
2. Totals cannot be overridden per line by an engine. `sales/lib/calculations.ts:120-186` derives line tax from
   `line.taxRate` or an explicit `line.taxAmount`; `:221` sums `taxTotal`. Hooks `registerSalesLineCalculator`
   (`:491`) and `registerSalesTotalsCalculator` (`:498`) run per line or after totals, with a
   `SalesCalculationContext` (`sales/lib/types.ts:160-166`) that carries only `tenantId`, `organizationId`,
   `currencyCode`, `metadata`, `resolve`. Addresses and customer are not in the context.
3. Eleven call sites recompute totals: `sales/commands/documents.ts:4932, 5351, 5617, 6006, 7360, 7542, 7858, 8012,
   8243, 8292, 8458`. Each has the document entity in hand, with `billing_address_snapshot`,
   `shipping_address_snapshot` and `customer_snapshot` (`entities.ts:358-370` for orders, `:858-870` for quotes).
   A processor must be called once per recalculation, before totals are summed, with those snapshots.
4. Persistence is partial. `tax_info` and `tax_strategy_key` exist on orders (`entities.ts:397, 403`) and `tax_info`
   on quotes (`:888`); both travel through command snapshots and undo (`commands/documents.ts:247, 352, 1701, 1990,
   3952, 4013, 4100, 4415, 4780, 5844`). Invoices (`:1383`) and credit memos (`:1550`) have only `tax_total_amount`.
   Nothing records whether a tax amount is an estimate, a vendor calculation or an exemption, or when it was computed.
5. Documentation already promises the seam. `apps/docs/docs/user-guide/taxes.mdx` ("Swapping DI services entirely",
   Avalara named as the example) and `apps/docs/docs/framework/pricing-tax-overrides.mdx` describe replacing
   `taxCalculationService`. That replacement still only sees one amount.

## 3. Proposed solution

### 3.1 `TaxProcessor` interface (module `sales`)

```ts
export type TaxProcessorLine = {
  lineId: string
  kind: SalesLineKind
  productId: string | null
  variantId: string | null
  taxClassificationCode: string | null   // from catalog_products.tax_classification_code via the line snapshot
  quantity: number
  netAmount: number                       // line net after discounts, in document currency
  taxRate: number | null                  // table rate the line carries today, for the default processor
  taxAmount: number | null                // explicit amount the line carries today
}

export type TaxProcessorInput = {
  documentKind: SalesDocumentKind
  documentId: string | null               // null before first persist
  tenantId: string
  organizationId: string
  currencyCode: string
  documentDate: string                    // ISO date used for rate effectivity
  shipFrom: AddressSnapshot | null        // spec decides the source (organization address or null in phase 1)
  shipTo: AddressSnapshot | null          // shipping_address_snapshot
  billTo: AddressSnapshot | null          // billing_address_snapshot
  customer: { id: string | null; kind: 'person' | 'company' | null; isTaxExempt: boolean | null;
              exemptionCertificateNumber: string | null; entityUseCode: string | null } | null
  lines: TaxProcessorLine[]
  shippingNetAmount: number
}

export type TaxProcessorLineResult = { lineId: string; taxAmount: number; taxRate: number | null;
  breakdown: TaxBreakdownEntry[] }

export type TaxBreakdownEntry = { jurisdictionName: string; jurisdictionType: string; rate: number;
  taxableAmount: number; taxAmount: number }

export type TaxProcessorResult =
  | { applied: false }
  | { applied: true; providerKey: string; taxStatus: 'estimated' | 'calculated' | 'exempt';
      lines: TaxProcessorLineResult[]; shippingTaxAmount: number; taxTotalAmount: number;
      breakdown: TaxBreakdownEntry[]; providerReference: string | null; calculatedAt: string }

export interface TaxProcessor {
  readonly key: string
  calculateDocument(input: TaxProcessorInput): Promise<TaxProcessorResult>
}
```

The spec fixes field names, nullability and rounding (4 decimals, matching `round()` in `calculations.ts`), and
states that `AddressSnapshot` is the existing document address snapshot shape (nine postal fields plus the optional
`phone`, `taxId`, `taxIdType` from the pending spec in section 7), not a new type.

### 3.2 DI token, default and resolution order

Token `taxProcessor` in `sales/di.ts` beside `taxCalculationService` (`di.ts:139`), default `TableTaxProcessor`.
An external module registers its own `taxProcessor` in its `di.ts`; the last registration wins, as for any awilix
token. `taxCalculationService` keeps its role for unit amounts (price rows, single line net or gross) and is not
called by `TaxProcessor`. The spec documents the order: unit amounts from `taxCalculationService` when a line is
entered, document tax from `taxProcessor` when totals are recalculated, totals registry hooks after that.

### 3.3 One call site

A shared helper in `sales/commands/shared.ts` (or `sales/lib/`) builds `TaxProcessorInput` from the document entity
and its line snapshots, calls the processor with a timeout the spec chooses, and maps the result back onto the line
snapshots as explicit `taxAmount` and `taxRate` before `calculateDocumentTotals` runs. All eleven call sites in
`commands/documents.ts` go through this helper. Quote to order conversion and invoice creation from an order recompute
through the same path. The spec states the transactional boundary: the processor call happens before the flush that
persists totals, so a processor failure never leaves a document half updated.

### 3.4 Persistence

- Reuse `tax_strategy_key` for `providerKey` and `tax_info` for `{ providerKey, taxStatus, calculatedAt,
  providerReference, breakdown, lines: [{ lineId, taxAmount, taxRate, breakdown }], shippingTaxAmount, error? }`
  under a zod schema `taxInfoSchema` with `passthrough()`.
- New columns, all nullable: `tax_status` text and `tax_calculated_at` timestamptz on the four document entities;
  `tax_info` jsonb and `tax_strategy_key` text on `SalesInvoice` and `SalesCreditMemo`. One migration in
  `sales/migrations/` named by the existing convention (`Migration<timestamp>_<slug>.ts`), plus snapshot update.
- Command snapshots and undo payloads carry the new fields the same way `taxInfo` is carried today
  (`commands/documents.ts:247, 352`). Validators in `sales/data/validators.ts` accept them as optional.
- API responses of the four document routes expose `taxStatus`, `taxCalculatedAt`, `taxStrategyKey` and `taxInfo`.

### 3.5 Fallback and status rules

- No processor registered, or `applied: false`: default processor, `tax_status: 'calculated'`, `providerKey: 'table'`.
- Processor throws or times out: default processor for amounts, `tax_status: 'estimated'` on quotes and orders,
  `'failed'` on invoices and credit memos, `tax_info.error = { class, message, at }` without vendor payload, one
  warning log line, no exception to the user. Amounts are never zeroed.
- `taxStatus: 'exempt'` from the processor: `tax_total_amount` 0 and the breakdown explains why.
- The spec proposes i18n note keys for the three statuses (`estimated`, `failed`, `exempt`).

### 3.6 Lifecycle events for the external package

`sales.order.confirmed`, `sales.order.cancelled`, `sales.invoice.created` payloads gain (additively) the fields the
package needs to commit or void a vendor transaction: `documentId`, `documentKind`, `organizationId`, `tenantId`,
`taxStrategyKey`, `taxCalculatedAt`, `providerReference`. Core does not add a commit method or a commit state in
this spec. The spec records the sequence diagram: quote (estimate) -> order (estimate or calculated) -> confirm
(package commits) -> invoice (calculated, package reconciles) -> cancel (package voids).

### 3.7 Inputs the processor needs from other modules

- Product: `tax_classification_code` (D10), passed on the line. The spec says where the line snapshot gets it
  (catalog snapshot on the line, `entities.ts:586`) and what happens when a line is not a product.
- Customer (phase 2): `is_tax_exempt` boolean, `exemption_certificate_number` text (encrypted like other PII in
  `customers/encryption.ts`), `entity_use_code` text, on `customer_entities` for both kinds; carried into
  `customer_snapshot` on documents. Phase 1 passes `null` for the three fields.

### 3.8 Reference external package

The spec includes a ten to twenty line sketch of a `di.ts` in an external module that registers a `TaxProcessor`,
reads its own settings, returns `{ applied: false }` when inactive, and a note on how the package checks the core
contract version (peer dependency on `@open-mercato/core` and a runtime check that the `taxProcessor` token resolves
to an object with `calculateDocument`). No vendor SDK, no HTTP code, no credentials in core.

## 4. Rules and invariants

- A tenant with no processor registered gets identical totals before and after this spec (integration test with a
  fixture document, asserting every amount field).
- `tax_total_amount` stays the displayed and summed amount on all four entities; the breakdown is informative.
- `tax_status` null means "pre spec document"; the spec must not backfill it in the migration.
- Money is 4 decimal `numeric` as today; the processor returns numbers rounded by core, never trusted as strings.
- Vendor payloads, credentials and request bodies never enter `tax_info`.
- Deprecation protocol of `BACKWARD_COMPATIBILITY.md`: `TaxCalculationService` is unchanged; `TaxProcessor` is a
  new public contract surface and must be listed as such with its stability promise.

## 5. Phase manifest (the spec turns this into file manifest tables)

### 5.1 Phase 1: contract, call site, persistence (must ship first, target under 15 files)

`sales/services/taxProcessor.ts` (types, interface, `TableTaxProcessor`), `sales/di.ts`, one helper in
`sales/commands/shared.ts` or `sales/lib/`, the eleven call sites in `sales/commands/documents.ts` routed through the
helper (one file), `sales/data/entities.ts`, `sales/data/validators.ts`, one migration plus snapshot, `sales/events.ts`
(payload additions), i18n note keys in four `sales` dictionaries, unit tests for `TableTaxProcessor` and the helper,
one integration test for the unchanged tenant, `apps/docs/docs/user-guide/taxes.mdx` update.

### 5.2 Phase 2: customer exemption inputs

`customers/data/entities.ts`, `customers/encryption.ts`, migration, customer form fields (existing form, three
fields), `customer_snapshot` mapping, validators, tests.

### 5.3 Phase 3: docs and reference adapter

`apps/docs/docs/framework/pricing-tax-overrides.mdx` section "Document tax processor", the reference `di.ts` sketch,
`UPGRADE_NOTES.md` entry, `BACKWARD_COMPATIBILITY.md` surface entry.

## 6. Acceptance for the hackathon

1. On a clean instance with no external module, create a quote with two product lines carrying table rates, add
   shipping, convert to order, create invoice: every amount equals the pre spec value; `tax_status` is `calculated`,
   `tax_strategy_key` is `table`, `tax_info.breakdown` has one entry per line.
2. Register a test processor in a test module that returns `applied: true`, `providerKey: 'test'`, fixed per line
   amounts and a two jurisdiction breakdown: totals use those amounts, `tax_status` is `calculated`, the invoice
   created from the order carries the same breakdown, and the `sales.order.confirmed` payload carries
   `taxStrategyKey: 'test'` and `providerReference`.
3. Make the test processor throw: amounts equal case 1, `tax_status` is `estimated` on the order, `tax_info.error`
   is set, no error reaches the API caller.
4. A processor returning `applied: false` for organization B while organization A is active on the same instance:
   B behaves as case 1, A as case 2.

## 7. Related pending specs (extend, do not duplicate)

- `.ai/specs/2026-08-10-address-contact-and-tax-fields.md`: adds `phone`, `taxId`, `taxIdType` to `AddressValue` and
  the document address snapshot. `TaxProcessorInput.billTo` reuses that snapshot; the customer tax id reaches the
  processor through it. State whether this spec depends on it (it should not; the fields are optional).
- `.ai/specs/2026-09-18-market-display-profile.md` on branch `spec/market-display-profile` (halted, D9): its
  `TaxCalculator` proposal is superseded by `TaxProcessor`; its display fields are out of scope here.

## 8. Open questions the spec author must answer (not the owner)

1. Where exactly the shared helper lives and how the eleven call sites share the document entity to snapshot mapping
   without a second source of truth for line snapshots.
2. Whether `shipFrom` in phase 1 is the organization's address (which entity holds it today) or null with a stated
   consequence for engines that require it.
3. The processor timeout value and whether it is a constant or a `SalesSettings` field (owner leans to a constant in
   phase 1, D5).
4. How a non product line (service, shipping surcharge, adjustment) is represented in `TaxProcessorLine`.
5. Whether `sales.document.totals.calculated` (`events.ts:81`) should carry `taxStatus` and `taxStrategyKey`.
6. Rounding reconciliation when the sum of per line tax from the processor differs from `taxTotalAmount` it returns.
7. Undo of a document command after a processor call: replay the stored result or call the processor again.
8. Which of the four document API responses already serialize `taxInfo` and which need the field added.
