# Sales Tax Provider Contract

Status: **proposed**. Implementation starts after this specification merges and an "Implement:" tracking issue exists (roadmap § 16).
Roadmap: [Tax Providers — Roadmap & Boundaries](./2026-10-03-tax-providers-roadmap.md) (this is Spec 1 of that roadmap; its ADR-1 … ADR-5, ADR-10 and ADR-12 are the positions this specification details).
Scope: `packages/core/src/modules/sales` (engine, commands, settings route, events, one migration) and the docs of § 18.
Related: [Sales `external` amounts mode](./2026-09-07-sales-external-amounts-mode.md) (implemented at this base by #8216; § 4.6), [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) ADR-2, [Pricing Engine](./2026-08-21-pricing-engine.md) (registry precedent), [Order payment-ledger input deprecation](./2026-08-01-sales-order-payment-ledger-input-deprecation.md) (precedent for an accepted-but-overwritten input), [SPEC-024 §10.2](./SPEC-024-2026-02-11-financial-module.md), [SPEC-045](./implemented/SPEC-045-2026-02-24-integration-marketplace.md), [Address-level contact details and tax identifiers](./2026-08-10-address-contact-and-tax-fields.md).
Verified against `main` @ `e04ffd226` (2026-10-31); paths and symbols are the identifiers, and paths are under `packages/core/src/modules/sales/` unless stated.

## TLDR

**Key Points:**
- The `sales` totals pipeline gets a document-level seam, a **tax phase**, through which the tax provider configured for the organization computes line and charge tax. `product-rate` names the default state (no provider configured), in which today's single calculation pass runs unchanged on every document without a provenance record, so an organization that never configured a provider sees no change in any line, adjustment, total or `tax_info` of such a document.
- The contract is three types and a registry (`TaxProvider`, `SalesTaxRequest`, `SalesTaxResult`; `registerTaxProvider` / `getTaxProvider` / `listTaxProviders`), one additive nullable settings column (`sales_settings.tax_provider_key`), one new settings route, two new event ids and server-written provenance on documents (`tax_strategy_key` = `tax-provider:<providerKey>` on orders, `tax_info` = the provenance record on orders and quotes). No document or line table changes; no new command.
- A remote provider is called in the command layer before the write transaction (the Resolve step) and its result is applied after a fresh read of the document's version and of the setting, still before the transaction opens (the Apply step); a moved version, a second pass that differs from the request, or inputs that changed before the write's document-row lock fail closed (409, nothing written); `stale` stays reserved for Spec 4b. The unit seam (`taxCalculationService`, `sales.tax.calculate.*`) stays unchanged as the predecessor.

**Scope:** the tax phase and its ordering; the contract and the registry; the organization-level provider setting and its route; the default state (`product-rate`); the Resolve and Apply steps and the status vocabulary; provenance; exemptions as vocabulary only; one sentence on calculation modes; docs. Out of scope and pointed at later specifications in § 19: line detail columns and the customer group set (Spec 4a), wider recalculation triggers and the stored-tax carry-over fix (Spec 4b), the built-in `sales-tax-rates` provider (Spec 2), the gateway module and credentials (Spec 3), net/gross presentation (Spec 5), cart, checkout and POS (6a, 6b), the OSS applicability rule and the rule that decides an EU reverse charge (§ 19), any UI, provenance fields in the read API.

**Acceptance tests (detailed in § 17):**
1. With no provider configured for the organization (`sales_settings.tax_provider_key` is `NULL`, or the settings row is missing), every existing fixture, command and API path produces byte-identical lines, adjustments, totals and `tax_info` for a document without a provenance record (§ 4.5).
2. The test-only `tax_stub` provider (§ 17) sets line tax, charge tax and the provenance record in `tax_info` on quote and order create and update.
3. The provider setting is organization-level: changing it changes how every later calculation of that organization's quotes and orders runs; no field on a document selects a provider or supplies an amount for that one document (a provenance record in `tax_info` only keeps the document's stored `shipping-provider:` rows on the passes without a provider call of § 4.8), and the document's `tax_strategy_key` and `tax_info` otherwise only record what produced its amounts.
4. `taxCalculationService` and the `sales.tax.calculate.*` events keep working unchanged.

**Concerns:** the single provider totals hook rebuilds the document from its `lines` argument (`lib/providers/totals.ts`), so the phase lives inside it; stored line tax is fed back as an explicit input on every recalculation (`lib/lineSnapshots.ts`; a line upsert derives it again only when that line's own pricing inputs change), so a provider overwrites it deliberately and the carry-over fix stays a later specification; `tax_info` is client-writable on create, so it is output-only by contract and never read as authority; the external amounts mode (#8216, merged at this base) returns from the provider totals hook before its shipping and payment blocks, so the tax phase inside the hook is skipped for an order in that mode (§ 4.6); the provider path is exercised end to end by the test-only `tax_stub` provider (§ 17).

---

## 1) Overview

Who needs it: a merchant selling in the United States or on another market where the rate is computed at calculation time from the ship-to address, the product's tax code and the customer's exemption facts, per jurisdiction, with an estimate on the quote and a recorded figure on the order; and every other merchant, who must notice nothing.

> **Market Reference**: the roadmap's Market Reference paragraph (Shopware 6, Magento Open Source 2, Medusa v2, Sylius, Odoo).

---

## 2) Problem Statement (the seams this specification touches)

1. **One hook, two blocks, no step between them.** The only core totals hook (`ensureProviderTotalsCalculator`, `lib/providers/totals.ts`) rebuilds from its `lines` and runs shipping, then payment, with payment fees on the gross total, so tax can sit only inside it, between the two blocks.
2. **Line tax is explicit-or-derived, and stored tax comes back as explicit.** Stored line tax and gross come back as explicit inputs on every recalculation (`mapPersistedLine`; a line upsert derives them again only when that line's own pricing inputs change, `resolveUpsertCalculatedAmounts`), and the document tax total also counts `tax`-kind adjustments and the tax portion of rated charges and discounts.
3. **No context, no setting, no provenance reader.** The calculation context has no address, customer, channel or date, `SalesSettings` has no provider field, and `tax_strategy_key` (orders) and `tax_info` (orders and quotes) are free-form, client-writable on create and read by no calculation.
4. **Transactions and locks.** The creates calculate before the write transaction; the line, adjustment and header-update commands calculate inside it under the document-row lock (`writeLockedDocumentGraph`; the header updates in their first flush phase); the return paths calculate under row locks; conversion, public acceptance and undo hold locks without calculating.
5. **The unit seam is a converter.** The documented unit seam (`taxCalculationService`, `sales.tax.calculate.*`) converts one amount at one rate and carries no document, and the documented totals-hook example reads an undeclared `context.countryCode`.

---

## 3) Proposed Solution

A `tax` phase inside the provider totals calculator, between the shipping and payment blocks; a contract and a registry in `sales` under `lib/tax/`; an organization-level provider setting; `product-rate` as the name of the default state; the Resolve and Apply steps before the write transaction, with a fresh read of the document version before the second pass; provenance on documents.

### Design Decisions

| Decision | Rationale |
|---|---|
| The tax phase is a step of the `sales` totals pipeline | `sales` owns the arithmetic, `SalesTaxRate` and the single totals hook; SPEC-024 §10.2 sketched a per-country engine inside a planned financial module, nothing implements it at this head, and the `tax_management` specification of PR #6168 states that transaction-level tax calculation is `SalesTaxRate`'s territory in `sales`, so §10.2 is read as superseded for transaction-level tax only, with the period-level work untouched |
| The tax phase is a fixed step inside the provider totals calculator | The hook rebuilds from its `lines` argument and runs both blocks itself (`lib/providers/totals.ts`), so "after shipping, before payment" is reachable only from inside it; no public signature changes |
| Contract types in core `sales` under `lib/tax/` | The phase and the registry are `sales` code and the contract stays with its consumer, as the shipping and payment provider types do (`lib/providers/types.ts`) |
| Resolve, the version check and the Apply pass before `withAtomicFlush` opens, in all thirteen commands (§ 4.2) | The two header updates and the line and adjustment commands calculate inside a transaction under the document-row lock today and the returns paths calculate under row locks (§ 2 point 4); a network call must hold neither, and one transaction boundary is simpler than two; the transaction checks the document and its rows again under the document-row lock (§ 4.2) |
| Provider selected per organization in `sales_settings`; documents carry provenance only | A free-text, client-writable document field cannot be an authority; quotes have no `tax_strategy_key` column; one nullable column is reversible |
| `product-rate` is the name of the default state (the `NULL` setting), not a registered provider | No provider, no Resolve, and no `tax` slot on a document without a provenance record: today's single pass, so existing fixtures stay byte-identical |
| A stored status vocabulary (§ 4.7) and a document-level `taxTotalAmount` in the result | The consistency rule needs an anchor; a provider's document-level rounding can differ from the sum of line tax (§ 5.6) |
| `tax_info` content rule: provenance and results only, never addresses, names or tax ids | `tax_info` is not in the sales encryption map (`encryption.ts` encrypts the address snapshots); the record stays safe in clear |
| Fail closed (§ 4.13) | No gateway policy exists yet; a silent zero is the known failure class |
| New registry on `globalThis` | The repository lesson (`.ai/lessons/global-registries-in-publishable-packages-must-use.md`) and the pricing registry precedent (`packages/core/src/modules/catalog/lib/pricing.ts`) |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| An additive `phase` option on `registerSalesTotalsCalculator` and a split of the provider calculator into a `charges` registration and a `post-tax` registration | The fixed step changes no public signature; an explicit phase API can be added later without touching the contract |
| No phase: resolve before `calculateDocumentTotals` and feed tax through explicit `taxAmount` and `metadata.taxRate` in a second pass | The provider calculator regenerates its adjustments on every run (`lib/providers/totals.ts`), so tax placed on them through metadata is lost; no seam for a status or a provenance record |
| The documented unit seam (DI swap of `taxCalculationService`, `setResult()` in `sales.tax.calculate.before` or `sales.document.calculate.after`) | The seam carries six scalar fields (`services/taxCalculationService.ts`), the engine never calls it, `sales.document.calculate.after` fires after payment fees (`lib/calculations.ts`), and a subscriber runs inside the transaction on header updates and on the line and adjustment commands (§ 2 point 4) |
| A separate tax module, or the plugin hook SPEC-024 §10.2 sketched for the financial module (`SPEC-024-2026-02-11-financial-module.md`) | Collides with the ecommerce suite roadmap's ADR-2 (`2026-08-14-ecommerce-suite-roadmap.md`) and with the names of the parallel period-level work; needs a cross-module workflow layer that does not exist; transaction-level tax needs the document, addresses and charges only the `sales` pipeline has |
| A contract in `packages/shared`, the way `packages/shared/src/modules/integrations/types.ts` hosts the integration types together with their `globalThis` registry (`registerIntegration`) | The phase and the registry are `sales` code; the contract stays with its one consumer, as the shipping and payment provider types do |
| Per-document provider selection through a namespaced `tax_strategy_key` | Quotes have no such column (`SalesQuote` carries `tax_info` only); the update schema strips the field; conversion writes `null`; a client-writable input would become an authority |
| A jsonb settings bag instead of one column | Schemaless, no database-level validation; the two existing jsonb columns are typed status lists (`data/validators.ts`) |
| Provider results in line and adjustment `metadata` | Client-writable, overwritten by client edits, and provider adjustments are regenerated on every run |
| `estimate` only (no intent in the type) | A provider written against this contract would assume every call is an estimate, and `display` (never remote) could not be expressed for the cart |
| Fail open or fall back to `product-rate` | A figure the provider did not compute becomes an invoice amount |
| Committing an update with the stored amounts under a `stale` record after a failed version check | The update response (`api/documents/factory.ts`) and the list API expose no `tax_info`, so a client could not see that the amounts were not the provider's; `stale` stays reserved for Spec 4b |
| Module-local `Map` for the new registry | The failure class the lesson names (a provider registered in one module instance invisible to another) |
| Core-owned product tax code and exemption columns filled by owner services | Core cannot know what each provider needs; a column designed for one engine is wrong for the next; the framework lets a package extend another module's data without touching core entities |
| Keep accepting `tax`-kind adjustments and rated discounts under a provider and fold them into the total (`lib/calculations.ts`) | Double-counts tax the provider already computed (§ 4.8) |
| Carry `tax-provider:<providerKey>` onto the order on conversion when the setting names the copied record's provider | The server cannot tell a server-written quote record from a client-stored one, because `taxInfo` is accepted verbatim on create (§ 4.14) |

---

## User Stories / Use Cases

- **A merchant on a fixed-rate market** wants nothing to change, so that existing quotes and orders keep their totals, their stored tax and their `tax_info` byte for byte (acceptance test 1).
- **A merchant on a destination-tax market** wants to configure one provider for the organization, so that every later quote and order of that organization is taxed by it, with the estimate on the quote and the recorded figure on the order (acceptance tests 2 and 3).
- **A provider package author** wants one typed contract and a registry, so that an adapter for an external engine plugs into the totals pipeline without engine changes and without reading document rows itself (§ 4.3, § 4.17).
- **A back-office user** wants a clear error instead of a silently untaxed document when the provider is unavailable (§ 4.13).
- **An auditor** wants each provider-taxed document to show which provider produced its amounts, with the jurisdiction breakdown (§ 6).
- **The authors of the later specifications** (Spec 2, Spec 3, Spec 4a, Spec 4b) want the vocabulary fixed now, so that their additions stay additive (§ 4.3, § 19).

---

## 4) Architecture

Vocabulary, one name per concept: *provider key* is the registry key of a `TaxProvider` (for example `tax_stub`, § 17); *strategy key* is the string the server writes into `tax_strategy_key` as provenance (`tax-provider:<providerKey>`); a *charge* is an order-scope adjustment of kind `shipping`, `surcharge`, `custom` or any operator-defined kind (`SalesAdjustmentKind` admits any string) with `amountNet ≥ 0`; an adjustment of kind `custom` or of an operator-defined kind with `amountNet < 0` is a *credit*, not a charge (those kinds carry an operator-controlled sign); the *provenance record* is the content of `tax_info`; the *tax phase* is the step of the totals pipeline (Phases A–D of § 15 are delivery phases; a flush phase is a phase of `withAtomicFlush`); the *Resolve step* and the *Apply step* are the two steps of the command layer; `SalesTaxContext` is the `tax` slot of the calculation context.

### 4.1 The tax phase

Inside `ensureProviderTotalsCalculator`, between the shipping block and the payment block, the hook calls a new `applyTaxPhase({ documentKind, lines: working.lines, adjustments: runningAdjustments, context, current: working })` and rebuilds the result through `rebuildDocumentResult` (`lib/calculations.ts`) from the written lines and adjustments, so the header totals and the payment block's fee base carry the provider's tax whether or not a payment method runs. The phase reads `context.tax` (§ 4.3): with no `tax` slot (no provider configured, § 4.2) or with a slot that carries no `result` (the first pass under a provider, § 4.2, or a pass without a provider call on a document whose `tax_info` is a provenance record, § 4.8) it returns its input unchanged (identity); with a result it writes per-line `taxAmount`, `grossAmount = netAmount + taxAmount`, `effectiveRate` as the line's `taxRate` and `unitPriceGross` = the line's unit net before discount × (1 + `effectiveRate` / 100), for every line, including a gross-entered one (§ 4.10), and per-charge `amountGross = amountNet + taxAmount` and `metadata.taxRate` = the charge result's `effectiveRate` (required on every charge result, § 4.3), merged into a copy of the metadata that keeps every other key; it never touches `totals` directly. The phase maps results by `ref` into the existing `lines` array in place and never changes their order or count (UT-14, § 17). No public signature changes.

A charge added by a third-party totals calculator never enters the request and stays untaxed by the provider, and a `sales.shipping.adjustments.apply.after` subscriber that changes a line net fails the write with 409 `inputs_changed` (§ 4.2); the calculations docs page states this.

The phase writes the validated result verbatim (the consistency rule runs once, in Resolve, § 4.10); shipping runs in the first pass only (§ 4.8), so a gross-subtotal shipping tier is selected without the provider's tax (F22); the payment block runs on the taxed gross.

### 4.2 The Resolve step and the Apply step

- **Resolve (command layer, outside `withAtomicFlush` and `em.transactional`).**
  - The command first reads the organization's setting with `loadSalesSettings`; a missing row or a `NULL` column is the default state (`product-rate`): today's single calculation pass with no Resolve, and with no `tax` slot except on the passes of § 4.8 over an existing document whose `tax_info` is a provenance record. An order whose `totalsMode` after the write is `external` takes the default-state path whatever the setting (§ 4.6, F15).
  - Under a configured provider it resolves the provider by key (`getTaxProvider`; an unregistered key fails closed, § 4.13), refuses the write when the future adjustment set carries a `tax`-kind row, a rated discount or a rated credit (§ 4.8), and runs a first calculation pass on the future state of the document with `context.tax = { intent }` and no `result` (under which the phase returns its input unchanged, § 4.1), which yields post-discount line nets and the adjustments of the final result; a caller-supplied line `taxAmount` or `totalGrossAmount` is not an input (§ 4.4).
  - The request's charge set is the manual charges (no `calculatorKey`) of the command's own adjustment drafts — the stored rows and the write's input, which carry ids (stored, or assigned before the first pass, below) — and the charges of that result generated by the built-in shipping step (`calculatorKey` starting with `shipping-provider:`, `lib/providers/totals.ts`), identified by id or key and never by position in the pipeline; each charge's `amountNet`, and whether it is a charge or a credit, is read from the first pass's resolved adjustment, as the line nets are. Any other charge that the calculation adds, with or without an id, never enters the request and stays untaxed by the provider, as `payment-provider:` surcharges, including such a row an operator overrode, and every other keyed charge do.
  - On every create, whatever the setting, the command assigns ids to the document (`documentId`, § 4.3) and to its line and manual adjustment drafts before the first pass, so every `ref` is a row id or `<calculatorKey>@<position>` (§ 4.8); the byte-identity proofs (the golden test, CT-15, `TC-SALES-TAXPROV-001`) compare amounts, not ids.
  - It then builds `SalesTaxRequest` (§ 4.11), emits `sales.tax.document.calculate.before` (§ 4.16), calls `provider.calculate(request, ctx)` under a deadline (§ 4.13), validates the result (§ 4.10, § 9 F3), emits `sales.tax.document.calculate.after`, and keeps the result in memory.
- **Apply (before the flush).** On an update the command reads the document's `updated_at` again in a fresh read, not through the identity map that served Resolve, and compares it with the value read for Resolve; the setting is read again the same way; a moved version or a changed provider key fails closed with 409 `inputs_changed` and nothing is written; a create has no document to check, so only the setting read applies to it. On a match it passes the result through `context.tax = { intent, result }` into the second calculation pass, with the first pass's shipping drafts in place of every `shipping-provider:` row of the future adjustment set; the hook keeps those drafts without calling the shipping provider (§ 4.8), and the phase writes the amounts (§ 4.1). Before the flush the command compares the second pass with the request it sent: the same line `ref`s in the same count, and every line and charge of the request, found by its `ref` in the second pass (an absent one is a mismatch), with a net equal to its net in the request within `NET_RECONCILIATION_TOLERANCE`; charges outside the request, such as payment surcharges computed on the taxed gross, are not compared; a mismatch (a `sales.line.calculate.*` subscriber or a registered line calculator that answers differently in the second pass) fails closed with 409 `inputs_changed` and nothing is written. `withAtomicFlush(..., { transaction: true })` then checks and persists: under the document-row lock (`writeLockedDocumentGraph`, and the header updates' first flush phase) the write fails closed with 409 `inputs_changed`, nothing written, when the document, a line or adjustment row or the provider setting changed after Resolve read them (F10); the implementation pull request names the compared values. Otherwise the transaction persists only lines, adjustments, totals, `tax_strategy_key` (orders) and `tax_info` (orders and quotes); whenever a result was applied, the four adjustment commands and the two header updates also persist the line rows through `applyOrderLineResults` / `applyQuoteLineResults` and their converter (§ 4.10), not through `applyOrderLineAmountsFromCalculation`, which writes neither `tax_rate` nor `unit_price_gross`, and the five line commands also persist the charge rows, so every stored tax amount comes from one result (CT-13). The query-index and cache refresh of the rows a command rewrites under a provider follows `.ai/lessons/projection-updates-that-change-indexed-parent-fields.md`; the implementation pull request enumerates those rows. Under a configured provider every recalculating command runs Resolve and Apply before `withAtomicFlush` opens and inside it only checks and persists; under `product-rate`, and for an order on the default-state path of the external amounts mode (§ 4.6), every command calculates as today, the line, adjustment and header-update commands inside their transaction under the document-row lock of #6925, so the default state stays byte-identical and keeps that serialization; under a configured provider, on that path too, the write fails closed with 409 `inputs_changed` when an order read as `external` before the lock has, evaluated under the lock, a mode after the write that is not `external` (F10). Validation-only passes that some commands run first carry no `result`, carry `providerTaxed` when the document's `tax_info` is a provenance record (§ 4.8), and count neither as Resolve nor as Apply.
- **Mismatch.** A 409 `sales.tax.errors.inputs_changed` (`CrudHttpError`, § 7) writes nothing; the client reloads and saves again, as after `optimistic_lock_conflict`; `stale` stays reserved for Spec 4b; one provider call, two calculation passes (plus the validation-only pass where a command runs one) and one transaction per write.
- **Header updates** (`sales.quotes.update`, `sales.orders.update`). Under a configured provider the two header updates hoist their calculation before the flush: a pure `deriveDocumentUpdateState(current, parsed, lookups)`, extracted from `applyDocumentUpdate` and reused inside it, returns every header fact the request and the context read, so Resolve, Apply and the flush see one header (CT-03). Under `product-rate`, and for an order on the default-state path of the external amounts mode (§ 4.6), they calculate as today, inside the transaction under the document-row lock of #6925.
- **Returns** (`sales.returns.create`, `sales.returns.delete`, the return redo and undo helpers) and `recalculateOrderTotalsForDisplay` call no provider and write header totals only; on an order whose `tax_info` is a provenance record their context carries `providerTaxed` (§ 4.8); re-taxing returns is Spec 4b.
- **Conversion and public acceptance** run no provider call (§ 4.14). **Undo** restores snapshots that carry amounts and provenance together (`commands/documents.ts`) and never calls a provider; the existing shipped-line guard refuses an undo that would move the rate or unit gross of a line with shipped quantity (409), including the undo of a provider write that re-taxed a shipped line (§ 4.10); a restored document keeps the old provenance with the old amounts, and the next recalculating write applies the current setting. **Redo** re-executes the command and calls the provider again, which is safe because `calculate` has no provider-side effect (§ 4.7).
- **Callers.** A synchronous workflow step dispatches the command inside its execution transaction, so the provider call can run under the workflow-instance lock (§ 12); every other caller reaches Resolve outside a transaction.
- **One helper for every command.** Resolve, the version check and the second-pass comparison are implemented once, in `commands/taxResolve.ts` (working name `resolveDocumentTax(futureState, deps)` for Resolve, which returns the request, the result and the first pass's shipping drafts or throws the errors of § 7, and a comparison function that the Apply step calls after the second pass); the thirteen commands call the helper instead of repeating the sequence, and the Resolve service for callers that are not `sales` commands (Spec 1b of the roadmap) wraps the same helper. The future state the helper takes is the engine's input shape (lines, adjustments, header facts), never entities.

### 4.3 Contract types

Location: `lib/tax/` with `types.ts`, `registry.ts` and `phase.ts`, exported from the `lib/providers` barrel like the shipping and payment registries (`lib/providers/index.ts`); the request builder and the Resolve helper are command-layer files (`commands/taxRequest.ts`, `commands/taxResolve.ts`), never imported by `components/*`.

```ts
type SalesTaxIntent = 'display' | 'estimate' | 'record'
type SalesTaxStatus =
  | 'calculated' | 'estimated' | 'exempt' | 'not_applicable'
  | 'stale' | 'failed' | 'fallback' | 'overridden'   // the stored vocabulary (§ 4.7, § 6); a result carries no status
type SalesTaxJurisdictionLevel = 'country' | 'state' | 'county' | 'city' | 'special' | 'other'

type SalesTaxAddress = {
  addressLine1?: string | null; addressLine2?: string | null; city?: string | null
  region?: string | null; postalCode?: string | null; country?: string | null
  companyName?: string | null; name?: string | null
  taxId?: string | null; taxIdType?: string | null
}

type SalesTaxRequest = {
  intent: SalesTaxIntent
  documentKind: SalesDocumentKind          // existing union, data/entities.ts
  documentId?: string | null               // set on create too (ids are assigned before the first pass)
  documentNumber?: string | null
  tenantId: string; organizationId: string; channelId?: string | null
  currencyCode: string; exchangeRate?: number | null
  taxDate: string                          // ISO date, UTC; § 4.11
  pricesIncludeTax: boolean | 'mixed'
  shipTo?: SalesTaxAddress | null; shipFrom?: SalesTaxAddress | null; billTo?: SalesTaxAddress | null
  customer?: { id?: string | null } | null
  lines: Array<{
    ref: string                            // the line id (assigned before the first pass on create, § 4.2)
    kind: SalesLineKind                    // existing union, data/entities.ts
    productId?: string | null; productVariantId?: string | null
    description?: string | null
    quantity: number
    netAmount: number                      // after the line discount, before any document discount
    taxRate?: number | null                // percentage points
    priceMode?: 'net' | 'gross' | null
  }>
  charges: Array<{
    ref: string                            // adjustment id; '<calculatorKey>@<position>' for generated charges (§ 4.8)
    kind: SalesAdjustmentKind              // 'shipping' | 'surcharge' | 'custom' or an operator-defined kind; amountNet >= 0 (§ 4 vocabulary)
    code?: string | null; label?: string | null
    amountNet: number
    taxRate?: number | null                // extractAdjustmentTaxRate(adjustment), lib/calculations.ts — the only value taken from adjustment metadata
  }>
}

type SalesTaxJurisdictionAmount = {
  level: SalesTaxJurisdictionLevel; code: string; name?: string | null
  rate: number                             // percentage points
  taxableAmount: number; taxAmount: number
}

type SalesTaxLineResult = {
  ref: string
  taxableAmount: number; taxAmount: number
  effectiveRate: number                    // required, percentage points: the rate the provider applied (§ 4.10): the statutory rate of a single-rate match, the combined rate for stacked jurisdictions, 0 on a flagged line
  isExempt?: boolean; exemptReason?: string | null; isReverseCharge?: boolean
  jurisdictions?: SalesTaxJurisdictionAmount[]
}

type SalesTaxResult = {
  providerKey: string; providerReference?: string | null
  taxTotalAmount: number                   // document-level total the consistency rule compares against
  rounding?: 'line' | 'document' | null    // the provider's rounding method: per line, or per rate group on the document (§ 4.10)
  lines: SalesTaxLineResult[]
  charges: Array<{
    ref: string; taxableAmount: number; taxAmount: number
    effectiveRate: number                  // required: the rate the provider applied, as on a line; written into the charge's metadata.taxRate (§ 4.8)
    jurisdictions?: SalesTaxJurisdictionAmount[]
  }>
}

type SalesTaxProviderContext = {
  tenantId: string; organizationId: string
  signal: AbortSignal                      // the deadline of § 4.13
  resolve: <T>(name: string) => T          // the command's DI container; the shape SalesCalculationContext.resolve declares (lib/types.ts)
}

interface TaxProvider {
  key: string; label: string; description?: string
  calculate(request: SalesTaxRequest, ctx: SalesTaxProviderContext): Promise<SalesTaxResult>
  // commit, adjust and void are not declared here: Spec 3 adds them as new optional methods,
  // because typing a reserved `unknown` member later would narrow it for implementers (BACKWARD_COMPATIBILITY.md)
}

type SalesTaxProviderError = { code: 'invalid_request' | 'unavailable' | 'rate_limited' | 'unauthorized'; message: string }
// thrown by `calculate`; any other throw is read as `unavailable` (§ 4.13)

type SalesTaxContext = { intent: SalesTaxIntent; result?: SalesTaxResult | null; providerTaxed?: boolean }
// providerTaxed: a pass outside Resolve and Apply over an existing document whose tax_info is a provenance record; the hook keeps the stored shipping-provider rows (§ 4.8)
// SalesCalculationContext gains `tax?: SalesTaxContext` (additive; lib/types.ts)
```

Contract rules a provider can rely on: `calculate` is side-effect free at the provider (it must not create, save, commit or otherwise persist a transaction there; a provider that needs a stored transaction waits for the method Spec 3 adds); every request line and charge `ref` appears exactly once in the result, no unknown `ref` appears; amounts are finite numbers, non-negative in this specification (credit documents with negative amounts are later); `taxRate`, `effectiveRate` and jurisdiction `rate` are percentage points, as `SalesTaxRate.rate` and the line `tax_rate` column; an adapter whose engine reports fractions converts; `jurisdictions[].level` uses the documented set, with `other` as the catch-all. The header addresses are document defaults; a later per-line address (Spec 4a) overrides them for that line. A provider reads the facts it needs beyond the request through `resolve`, from fields or extension entities its own package declares (§ 4.15). A line the provider marks `isExempt` or `isReverseCharge` carries `taxAmount` 0 and `effectiveRate` 0 (so the stored `tax_rate` is 0 rather than the input rate) with its `taxableAmount` kept as the base it reports; at most one of the two flags is set on a line, because a reverse charge is not an exemption (the buyer accounts for the tax); `exemptReason` names the provider's reason in its own namespace and never carries a certificate or exemption number; an adapter whose engine omits the rate on such a line, or reports the rate that would have applied, sets `effectiveRate` 0 itself.

### 4.4 Provider selection, the setting and provenance

- **The setting.** One additive nullable column `sales_settings.tax_provider_key` (`text`, entity property `taxProviderKey?: string | null`; `SalesSettings`, unique per `(organization_id, tenant_id)`); `NULL` is the default state, `product-rate` (no provider); a missing settings row is the same state as `NULL`.
- **The write.** A new route `GET`/`PUT /api/sales/settings/tax-provider` (§ 7) writes through the existing `sales.settings.save`, which parses the exported `salesSettingsUpsertWithTaxProviderSchema` (optional `taxProviderKey`; `salesSettingsUpsertSchema` unchanged); the two existing settings routes cannot write or reset the key (CT-20); the key is validated against the registry at write time, an unregistered key is 422 and nothing is written; no new command.
- **Who may change it.** The route requires `sales.settings.manage` for `GET` and `PUT`, like every sales configuration route (`api/settings/order-editing/route.ts`, `api/settings/document-numbers/route.ts`, `api/tax-rates/route.ts`). Every default `employee` holds that feature (`setup.ts`), so any employee can change how every later document of the organization is taxed; this specification states it and proposes an audit entry (below); an admin-only feature id is deferred (§ 14 item 6).
- **Audit.** `sales.settings.save` writes no action-log entry today (no `buildLog`, no `undo`). The implementation adds a `buildLog` that records the old and the new provider key when it changes (following the tax-rate update command, which logs before and after, `commands/configuration.ts`); no undo for the setting in this specification: settings commands have no undo today, so this is a recorded deviation from the checklist's rule that every command is undoable (`.ai/review-checklist.md`; the write itself goes through a command, as `packages/core/AGENTS.md` requires), listed in the Final Compliance Report; documents keep their provenance, so a switch is traceable per document.
- **Organization selection.** The route resolves the organization as the sibling settings routes do (`resolveSingleOrganizationIdOrDeny`).
- **Resolution order at calculation time.** The document's own `tenantId` and `organizationId` (never the UI selection) → `loadSalesSettings` → the registered provider; `NULL` or no row is the default state, with no Resolve. The setting is read in Resolve and again, fresh, before the second pass (§ 4.2); a changed provider key between the two reads is the 409 of § 4.2. A key that no longer resolves fails closed (§ 4.13).
- **Provenance on documents.** When a configured provider ran, the server writes `tax_strategy_key` = `tax-provider:<providerKey>` on orders and the provenance record into `tax_info` on orders and quotes (§ 6); under `product-rate` the server writes neither, so those documents keep byte-identical values. The prefix is a convention for server-written values, not a guarantee: a client can store the same shape on create under `product-rate`; the fields are never read as authority (they select no provider and supply no amount; the provenance reader only decides whether a pass without a provider call keeps the document's own stored `shipping-provider:` rows, § 4.8), and a forged record can show up in the document history widget. Today's free-text values stay as they are and are never read as authority.
- **Client-supplied `taxStrategyKey` and `taxInfo` on create, and caller line amounts.** `orderCreateSchema` keeps accepting both and `quoteCreateSchema` keeps accepting `taxInfo`; the values are stored as today when no provider runs, overwritten by the server's provenance when a provider runs, and never read as authority. Under a configured provider the line inputs `taxAmount` and `totalGrossAmount` stay accepted and are not honoured: the stored tax is the provider's and the gross is net plus that tax (§ 4.10). This specification documents that overwrite rule and adds no deprecation marker and no warning: the inputs keep their effect for organizations without a provider (§ 14 item 1).
- **Not in the read API.** `GET /api/sales/orders` and `/quotes` list neither field today (`api/documents/factory.ts`); this specification exposes nothing; provenance is observable at command level and in the action-log snapshots (§ 17); API exposure is a later specification.
- **Configuration entity semantics.** Adding a column to `SalesSettings` changes no existing semantics of statuses, methods, channels, price kinds, adjustment kinds or document numbers.

### 4.5 `product-rate`

`product-rate` is the name of the default state, `sales_settings.tax_provider_key` `NULL` or no settings row (§ 4.4), not a registered provider: the registry holds no entry for it, `listTaxProviders()` does not return it, and no provider object exists for it. In that state there is no Resolve, and a document without a provenance record carries no `tax` slot, so the engine runs today's single calculation pass unchanged: no line writes, no charge writes, no `tax_info`, no tax-provider events, and every existing fixture stays byte-identical (UT-50, § 17). Under a provider the phase writes every line's tax after the line pass, so the provider result overwrites a line-level tax edit made by a `sales.line.calculate.*` subscriber.

A document that carries a provider provenance record when the organization switches back to `product-rate` keeps that record: it describes the last provider calculation, not the later calculations without that provider (the lines keep their stored tax and the hook keeps the stored `shipping-provider:` rows on the passes of § 4.8; until Spec 4b the document's shipping net is not re-quoted on a line write and a deleted `shipping-provider:` row is not regenerated); the next recalculating write under `product-rate` writes no new record; new lines, and lines whose own pricing inputs change (§ 2), get engine tax from their own rate. A line whose stored `tax_rate` is 0 from an exemption or a reverse charge keeps tax 0 on a later `product-rate` write that supplies no rate, until a caller supplies one or Spec 4b re-rates it (§ 12, § 19).

### 4.6 Calculation modes (one sentence)

The phase runs in the engine's normal calculation mode and sits after the provider totals hook's early return for an order in the external amounts mode (`SalesOrder.totalsMode` = `external`, specified in `2026-09-07-sales-external-amounts-mode.md`), so it never runs for such an order; the commands keep that order on the default-state path (no Resolve, no provider call, no provenance write), so a provider outage never blocks a write of a mirrored order; quotes have no such mode.

### 4.7 Intents and statuses

- The command layer sets `estimate` for quotes and `record` for orders; `display` is reserved for cart and UI previews and must never trigger a remote call. The intent cannot be derived from the document kind, because the cart specification calls the engine with a quote-like document (`2026-08-14-cart-module.md`).
- `record` means that the platform stores the result on an order; it never asks a provider to record a transaction for filing. `calculate` is idempotent per document reference; nothing commits in this specification.
- Status written into the record (the result carries none, § 4.3): `estimated` for intent `estimate`, `calculated` for intent `record`, `exempt` when every line is exempt and every charge carries zero tax, otherwise `calculated` for `record` and `estimated` for `estimate` with the flags visible per line (a reverse-charged line is not an exempt line, so a document of reverse-charged lines is `calculated` or `estimated`); `stale` reserved for Spec 4b and never written here (§ 4.2); `not_applicable` reserved; `failed` is never stored in this specification (the error body carries `code`, § 7); `fallback` reserved for Spec 3; `overridden` reserved for Spec 4b's manual override and never written here (the two tax events are notification-only, § 4.16).

### 4.8 Charges, adjustments and discounts

- Charges (§ 4 vocabulary, in the request's charge set, § 4.2) enter the request with `ref` = the adjustment id for manual charges (assigned before the first pass on create, § 4.2) and `<calculatorKey>@<position>` for provider-generated adjustments, which the hook regenerates, so their database id may not be stable; the `ref` is stored with that charge's result in the provenance record. A `shipping-provider:` charge an operator overrode (`metadata.manualOverride`) enters the request with its row id as `ref`; the override protects its net amount and position, not its tax, so the provider's `taxAmount` and `effectiveRate` apply to it as to any charge.
  - A credit (a negative `custom` or operator-defined adjustment) stays out of the request; under a provider it is accepted only when `extractAdjustmentTaxRate` yields no rate for it (with one it is refused like a rated discount, below), so it carries no tax portion; a supplied gross that differs from its net reduces the gross total by that difference without touching the tax total, the § 5.4 limitation that allocation (Spec 4a) removes; under `product-rate` nothing changes.
  - **Kept charge rows.** Provider adjustments other than an overridden one are regenerated on every calculation, except that the hook keeps the `shipping-provider:` rows it receives and skips the shipping block on two kinds of pass: the second pass under a provider, which receives the first pass's shipping drafts (§ 4.2), and any pass whose slot carries `providerTaxed`, which the command sets, with the document kind's intent (§ 4.7), outside Resolve and Apply on an existing document whose stored `tax_info` is a provenance record — in the return paths and in the line and adjustment commands, whatever the setting (under a provider only on the validation-only pass of § 4.2), never on a create (a create with a client-supplied `taxInfo` that looks like a provenance record calculates as today) and never in the two header updates, which regenerate and persist their charges as today. A kept row carries its stored `amount_gross` and `metadata.taxRate`, so the header tax total equals the stored line and charge tax (§ 5.5). A document without a provenance record carries no slot and is regenerated as today; the limitation after a switch back to `product-rate` is stated in § 4.5 and F14.
- Payment surcharges created after the tax phase stay untaxed, never enter the request (§ 4.2) and are regenerated on every pass as today.
- **Charge tax and invoices.** Charge tax lands in the adjustment's `amountGross` and `metadata.taxRate`, the fields `product-rate` reads; nothing is written on invoices or credit memos (§ 6).
- **Adjustment kinds under a provider.** While the organization's setting names a provider, Resolve refuses the write before the provider call (400 `sales.tax.errors.unsupported_adjustment`, § 7, naming the row to remove or the rate to clear) when its stored-plus-input adjustments carry a `tax`-kind row, or an order-scope `discount` or a credit for which `extractAdjustmentTaxRate` yields a rate, because the engine folds both into the total on every rebuild and the payment block rebuilds after the phase, so no arithmetic neutralization could hold. The check is one, in the shared Resolve helper (§ 4.2), so every command refuses alike whichever caller dispatches it; the phase rewrites or removes no adjustment row, and undo or redo restores such rows like any snapshot; under `product-rate` it works exactly as today; a manual tax override is a later feature (`overridden` reserved).
- **Document-level discounts.** `discount` adjustments of order scope reduce the tax total only through `metadata.taxRate` today (`lib/calculations.ts`). Under a configured provider a discount is accepted only when `extractAdjustmentTaxRate` yields no rate for it (a rated discount is refused, above), so it carries no tax portion and the tax total equals the provider's `taxTotalAmount`; the request does not allocate them to lines, so the provider taxes amounts before the document discount. That is a known limitation stated here with numbers (§ 5.4); allocating a document discount to lines before the request is Spec 4a. Under `product-rate` nothing changes.

### 4.9 Exemptions (vocabulary only)

Result lines carry `isExempt?`, `exemptReason?` and `isReverseCharge?` (at most one flag per line; `exemptReason` accompanies a flag and is absent otherwise; their amounts follow the rule of § 4.3: tax 0, the base kept, `effectiveRate` 0); the document status `exempt` applies when every line is exempt and every charge carries zero tax, and a reverse-charged document keeps `calculated` or `estimated` (§ 4.7). Tax identifiers travel on the address snapshots (`taxId`, `taxIdType`, the keys the address specification defined, `2026-08-10-address-contact-and-tax-fields.md`); exemption facts are the provider package's own fields (§ 4.15); no exemption storage in core, no certificate reference in the record, no checker (`customers/data/entities.ts` has no exemption field). The tax phase never skips a configured provider because of a customer fact: a tax-exempt flag is a provider-owned field (§ 4.15) that the provider reads and applies itself. The result's `exemptReason`, `isReverseCharge` and `jurisdictions` are stored in the provenance record (§ 6); their persistence as queryable line fields is Spec 4a (§ 19).

### 4.10 Units, rounding and the consistency rule

- `taxRate` is in percentage points; the engine keeps 4 decimals (`round`, `lib/calculations.ts`); the engine writes the provider's amounts verbatim and never re-derives tax from a rate when amounts are given.
- Consistency rule, applied after a structural parse of the result through the exported Zod schema `salesTaxResultSchema` (`data/validators.ts`, additive; `SalesTaxResult` of § 4.3 derives from it with `z.infer`; strict on the result, line, charge and jurisdiction objects and with `effectiveRate` required on every line and charge result, so that an unknown or misplaced key or a line or charge without a rate is a shape error, never a dropped flag; a provider package therefore emits only the keys of the installed core's schema and declares its `@open-mercato/core` peer range accordingly, a later additive result field being emitted only against a core that parses it), checked once, in Resolve on the raw result (a violation is the provider's: 502 `provider_invalid_result`, F3): (a) every request line and charge `ref` appears exactly once; (b) every amount is a finite, non-negative number; (c) per line and per charge, `0 ≤ taxableAmount ≤ netAmount` (or `amountNet`), the upper bound within `NET_RECONCILIATION_TOLERANCE` (0.005, `lib/calculations.ts`), so a result that taxes a larger base fails; (d) the sum of line tax plus charge tax equals the result's `taxTotalAmount` within the same tolerance; (e) every amount and every rate is representable at the storage scale (amounts at 4 decimals, `data/entities.ts`; `effectiveRate` at 4 decimals and below 1000, as `tax_rate` is numeric(7,4); a result with more precision fails rather than being rounded silently) and a line or charge with a zero base carries zero tax; (f) a line flagged `isExempt` or `isReverseCharge` carries zero tax and an `effectiveRate` of 0, and at most one of the two flags (§ 4.3). A violation fails the command: nothing is written and the error body carries the `code` of § 7. `grossAmount = netAmount + taxAmount` is the write rule the phase enforces by construction, not a validation.
- Under an applied result every line, touched or not, is persisted through `convertLineCalculationToEntityInput` (`commands/documents.ts`), which reads the rate and the unit gross from `lineResult.line`; the phase writes `effectiveRate` into `result.line.taxRate` (taking precedence over the rate the caller supplies) and the unit gross into `result.line.unitPriceGross`, so the converter needs no new branch; `tax_amount` always comes from the provider. A line with shipped quantity is included: the phase's change to its rate and amounts is not a caller price change, so the shipped-line guard, which checks the caller's input for the edited line, does not run on it (tax freezes at an issued invoice or a committed provider transaction, roadmap ADR-8, not at shipment); the guard's restore check refuses the undo of such a write (§ 4.2, F11, CT-26). On a caller's write to a shipped line under a configured provider, the guard compares only the price inputs the provider path honours, never a caller's `taxAmount`, `totalGrossAmount` or `unitPriceGross` (§ 4.4), and a unit net that the line editor derives from the stored unit gross at the stored rate counts as unchanged within the 4-decimal storage rounding; quantity, unit, discount and `taxRate` stay locked as today (CT-27).
- On every line, whatever its `priceMode`, `unit_price_gross` = the unit net before discount × (1 + `effectiveRate` / 100) at the engine's 4 decimals, so an unchanged line-editor save applies the line discount once and keeps the line's amounts within the 4-decimal storage rounding (CT-22); the unit net is the line's `unitPriceNet`, or, when only a unit gross was supplied, that gross divided by one plus the line's own rate, as the engine derives it (`buildBaseLineResult`, `lib/calculations.ts`); a stored unit net is discounted today for a line created with only a unit gross and a line discount (#8232, § 11). A gross-entered line is taxed on the net the first pass derived from its gross, and under a provider the entered gross is not preserved; the request carries `priceMode` and `pricesIncludeTax` for the provider's information only (gross-preserving split: Spec 4a).
- Currency precision stays at the engine's 4 decimals; a currency-aware precision is a question for a later specification.
- **Rounding method.** A result may declare `rounding`: `line` when every line and charge amount is rounded on its own, `document` when the provider rounded per rate group on the document and distributed the remainder over the lines (§ 5.6). The field is informational and optional in `salesTaxResultSchema`: the engine writes the amounts verbatim either way and the consistency rule is unchanged; the value is stored in the provenance record (§ 6) so that a reader knows which method produced the stored amounts. A provider that declares `document` distributes the remainder within each rate group, so that the stored line amounts that carry one rate sum to the tax it computed for that rate; the consistency rule does not verify it (rule (d) above compares the document total). The built-in `sales-tax-rates` provider of Spec 2 rounds per line, as the engine does today, and declares `line`.

### 4.11 Inputs

- **Addresses.** `shipTo` and `billTo` come from the header address snapshots (never `SalesDocumentAddress` rows) through a tolerant mapper that keeps the well-known keys of `SalesTaxAddress`, and `shipFrom` from the channel address read with `findOneWithDecryption` scoped in `where`, all of the document's future state (on the two header updates, the header `deriveDocumentUpdateState` returns, § 4.2), in memory only.
- **Dates and money.** `taxDate` is the document's `placedAt` when set (orders and quotes), otherwise the time of Resolve, as an ISO date in UTC; a seller time zone is a later specification. `currencyCode` from the document; `exchangeRate` from orders only (`data/entities.ts`; quotes have none).
- **Lines.** `ref`, `kind`, ids, `quantity`, post-discount `netAmount` (from the first pass), `taxRate` from the snapshot (it carries no rate id; a `taxRateId` on the request line is Spec 4a's additive field), `priceMode` as the snapshot carries it (`metadata.priceMode`), `description` from the line. `pricesIncludeTax` is `true` when every line is `gross`, `false` when every line is `net` or unset, `'mixed'` otherwise.
- **Product and customer facts.** `customer.id` is `customerEntityId`; product and variant ids are on the lines. Every other product or customer fact a provider needs is provider-owned and read through `resolve` (§ 4.15); the customer group set is Spec 4a's additive request field, resolved through `customerGroupsService.resolveGroups`. This specification adds no cross-module ORM read (issue #6733, the cross-module data ownership audit).
- **`context.tax` never carries the request.** The engine passes the whole context to every totals hook and to `sales.document.calculate.before/after` (`lib/calculations.ts`); the `SalesTaxRequest` never enters the context.

### 4.12 DI and credentials

`resolve` on the provider context is the command's DI container, passed by the Resolve step; `tax_stub` ignores it; Spec 3 registers credential services reachable through it. Credentials are out of scope; no credential, endpoint or account field is added to `sales_settings`. A third-party replacement of the DI service `salesCalculationService` (`di.ts`) that does not delegate to `salesCalculations` will not run the tax phase; the interface is unchanged, so this is stated, not a break.

### 4.13 Failure policy

**Fail closed.** A provider throw, a timeout, an invalid or inconsistent result, or a configured key that no longer resolves fails the command with a clear error; the transaction never opens or rolls back; nothing is written. `fallback` is the status of Spec 3's `fallback-sales-tax-rates` policy and `failed` stays reserved in the vocabulary; the default state makes no provider call and cannot fail. Trade-off: fail closed blocks document edits of that organization during a provider outage. The write-time validation of the key and the error that names the setting are the mitigation for an uninstalled package.

Deadline: core races each `calculate` against a 10-second deadline that aborts `signal` and rejects with `provider_timeout`, ignores a late settlement of the abandoned call (UT-75), retries nothing, and reads any throw other than `SalesTaxProviderError` as `unavailable`; adapters honour `signal` and fit any transport retry inside the deadline; the `SalesTaxProviderError` codes select the status, key and message of § 7; per-organization configuration of the timeout and the policy is Spec 3.

### 4.14 Conversion and public acceptance

`sales.quotes.convert_to_order` keeps today's copy semantics unchanged (line amounts, totals and `taxInfo` copied; `tax_strategy_key` stays `null`; no calculation; `commands/documents.ts`); the copied record keeps status `estimated`, and the order's first recalculating write under the provider writes the server key and a `record` result. The key is not carried on conversion because the server cannot tell a server-written quote record from one a client stored on create under `product-rate` (`taxInfo` is accepted verbatim, `data/validators.ts`, `commands/documents.ts`), so carrying it would let a forged record become a server-written key once the organization selects that provider. The public accept route (`api/quotes/accept/route.ts`, `requireAuth: false`) changes nothing: no provider call runs under its locks or on the unauthenticated path. Honour-versus-re-quote policy is Spec 4b.

### 4.15 Provider-owned facts

The request carries references and the facts the document already holds (§ 4.11). A fact that only a given provider needs — a tax code in the provider's own namespace, an exemption certificate or entity use code, a tax-exempt flag — is declared and owned by the provider package as a custom field (`ce.ts`) or an extension entity (`data/extensions.ts`) on the catalog or customer entity, and read by the provider through the `resolve` of its context (§ 4.3) for the document's `tenantId` and `organizationId`. Core defines no provider-specific field on products or customers and adds no cross-module ORM read (issue #6733); a provider reading its own extension data adds none. The built-in `sales-tax-rates` provider (Spec 2) is part of core `sales` and owns its fields the same way. A change to a provider-owned field does not trigger a recalculation; the next recalculating write (§ 4.2) or the explicit recalculate command of Spec 4b re-taxes the document.

### 4.16 Events

Two additive ids in `events.ts`, declared with `createModuleEvents` next to the calculation lifecycle events, `category: 'lifecycle'`, `excludeFromTriggers: true`, no `clientBroadcast`, no `portalBroadcast`:

- `sales.tax.document.calculate.before` — emitted by the Resolve step before `provider.calculate`, outside the write transaction; payload `{ documentKind, documentId, organizationId, tenantId, providerKey, intent, lines: [{ ref, netAmount }], charges: [{ ref, amountNet }] }`; never addresses, tax ids, the customer snapshot or the raw request.
- `sales.tax.document.calculate.after` — emitted after validation, still outside the write transaction; payload adds the status of § 4.7, `taxTotalAmount` and per-`ref` amounts.

Both are notification-only: the payload carries no setter, so a subscriber cannot change the result or the document.

Both carry the document's `tenantId` and `organizationId` in the emission options and never fire without a configured provider. Under a configured provider the existing calculation lifecycle events fire once per calculation pass, twice per write (once more on the validation-only pass of § 4.2 where a command runs one), with unchanged payloads; the shipping provider and the shipping adjustment events run in the first pass only, and whatever the setting they do not run on a pass that keeps the stored `shipping-provider:` rows (§ 4.8). Subscribers may see writes that roll back.

### 4.17 The registry (globalThis)

State lives on `globalThis` under a stable key, lazily initialized (the pricing-registry pattern); `registerTaxProvider(provider)` trims the key, ignores a blank one, replaces an existing entry with the same key and returns an identity-checked disposer; `getTaxProvider(key)`, `listTaxProviders()` and a test-only `resetTaxProviders()` complete it; the shipping and payment registries are untouched.

### Commands & Events

- Commands: none added. `sales.settings.save` gains an optional input field. Under a configured provider Resolve and Apply run inside the existing recalculating commands: `sales.quotes.create`, `sales.orders.create`, `sales.quotes.update`, `sales.orders.update`, `sales.orders.lines.upsert`, `sales.orders.lines.upsert_many`, `sales.orders.lines.delete`, `sales.quotes.lines.upsert`, `sales.quotes.lines.delete`, `sales.orders.adjustments.upsert`, `sales.orders.adjustments.delete`, `sales.quotes.adjustments.upsert`, `sales.quotes.adjustments.delete`. No provider call in conversion, public acceptance, `sales.returns.create`, `sales.returns.delete`, `recalculateOrderTotalsForDisplay`, undo, returns, invoices, credit memos, document deletes or the seed.
- Events: `sales.tax.document.calculate.before`, `sales.tax.document.calculate.after` (new, § 4.16); `sales.tax.calculate.before/after` (`events.ts`), `sales.document.calculate.before/after`, `sales.document.totals.calculated` untouched.

---

## 5) Worked examples

Rates, jurisdictions and dates are illustrative. Engine figures follow the formulas of `lib/calculations.ts` at head (4-decimal rounding); provider figures round half-up from the third decimal. Illustrative jurisdiction set for ship-to "State A": state `ST-A` 6.000, county `CO-A1` 1.000, city `CI-A1` 1.500, special `SP-A1` 0.375, combined 8.875 (percentage points).

### 5.1 `product-rate` pass-through (acceptance test 1)

The golden test (UT-50, § 17) is the proof: under `product-rate` every existing fixture gives today's result (§ 4.5).

### 5.2 Destination result with a jurisdiction breakdown

Order, intent `record`, ship-to State A, consumer with no tax ids. L1: 1 × 249.99. L2: 3 × 19.99. Provider rounds per line to cents.

| ref | net | state 6.000 | county 1.000 | city 1.500 | special 0.375 | tax | gross | effectiveRate |
|---|---|---|---|---|---|---|---|---|
| L1 | 249.99 | 15.00 | 2.50 | 3.75 | 0.94 | 22.19 | 272.18 | 8.875 |
| L2 | 59.97 | 3.60 | 0.60 | 0.90 | 0.22 | 5.32 | 65.29 | 8.875 |
| document | 309.96 | 18.60 | 3.10 | 4.65 | 1.16 | 27.51 | 337.47 | — |

After Apply: `subtotalNetAmount` 309.9600, `taxTotalAmount` 27.5100, `grandTotalGrossAmount` 337.4700, status `calculated`, line `tax_rate` 8.875 on both lines, the combined rate the provider applied (§ 4.3). Re-deriving tax from the combined rate would store 22.1866 and 5.3223 instead of 22.19 and 5.32: the engine writes the provider's amounts verbatim.

### 5.3 Exempt customer

Order, intent `record`; reseller with a certificate held at the provider. Variant (a): L1 10 × 30.00 and L2 4 × 30.00, both exempt (`isExempt` and `exemptReason` per line, `taxableAmount` 300.00 and 120.00, `taxAmount` 0, `effectiveRate` 0, gross = net; the stored `tax_rate` is 0): document net 420.00, tax 0.00, status `exempt`. Variant (b): L3 1 × 40.00 forced taxable: L3 tax 3.55 (2.40 + 0.40 + 0.60 + 0.15), document net 460.00, tax 3.55, gross 463.55, status `calculated` with the exemption visible per line. An exempt line written with `taxAmount: 0` and gross = net stays at zero: the gross-minus-net derivation runs only when tax was not explicit (`lib/calculations.ts`).

### 5.4 Discounts (the limitation of § 4.8)

L1: 2 × 100.00 with a 10 % line discount → net 180.00; L2: 4 × 30.00 → net 120.00; a seller coupon of 30.00 as an order-scope `discount` adjustment; combined rate 8.875 on both lines.

| Case | What the provider sees | tax | gross | note |
|---|---|---|---|---|
| This specification (no allocation) | lines 180.00 and 120.00 | 15.98 + 10.65 = 26.63 | 296.63 | tax on 300.00, before the coupon |
| Allocation by share (Spec 4a target) | 162.00 and 108.00 | 14.38 + 9.59 = 23.97 | 293.97 | 108 × 0.08875 is 9.5849… in binary floating point, one more reason to take the provider's amounts verbatim |
| Stated limitation: a percentage discount | the same, with the discount entered as 10 % (no rate on the row): the engine resolves it before the hooks to net 30.00 and gross 32.6625 (`lib/calculations.ts`) | 15.98 + 10.65 = 26.63 | 293.9675 | the tax total stays the provider's; the gross is 2.6625 below net plus tax (296.63) because the discount's gross carries its own tax share; allocation (Spec 4a) removes it |

### 5.5 A shipping charge taxed in one state and not in another

L1 1 × 100.00; shipping through the built-in `flat-rate` provider, net 15.00.

| Case | charge tax | `amountGross` | `metadata.taxRate` | document tax | gross |
|---|---|---|---|---|---|
| State A, single rate 6.000, freight taxable | 0.90 | 15.90 | 6 | 6.90 | 121.90 |
| State B, single rate 7.000, separately stated freight not taxable | 0.00 | 15.00 | 0 | 7.00 | 122.00 |

The charge enters the request with `ref` `shipping-provider:flat-rate@10000`; the phase merges `taxRate` by copy into a new metadata object that keeps the existing keys (§ 4.1). Today a method whose base gross exceeds its net without `metadata.taxRate` puts the difference into the grand gross but not into `taxTotalAmount`; the rule above makes charge tax visible to the total. A cash-on-delivery fee of 2 % computed after the phase sees 121.90, not 121.00. On a return on this order, or a line write after switching back to `product-rate`, the hook keeps the stored `flat-rate` row with `amount_gross` 15.90 and `metadata.taxRate` 6, so the charge tax of 0.90 stays in the order's tax total; after the return the header tax total is 6.90, the stored line and charge tax (§ 4.8, F14).

### 5.6 Line-level versus document-level rounding

Three lines of 10.10 at 8.875. Line-level rounding: 0.90 + 0.90 + 0.90 = 2.70, gross 33.00. Document-level rounding: 30.30 × 8.875 % = 2.689125 → 2.69, with one line carrying 0.89 (which line is the provider's choice), gross 32.99. Today's engine stores 0.8964 per line and 2.6892 in total. The result's `taxTotalAmount` decides: a result whose lines sum to 2.70 while it declares 2.69 fails the consistency rule; a result with lines 0.90, 0.90, 0.89 and total 2.69 is stored exactly. A provider that rounds per rate group declares `rounding: 'document'`; one that rounds each line declares `rounding: 'line'` (§ 4.10). Under either method every line stores `tax_rate` 8.875, the rate the provider applied, so the stored rate identifies the rate group (§ 6).

### 5.7 Returns and credit memos (this specification's position)

Returns and credit memos call no provider in this specification; the contract already carries the `documentKind` `credit_memo`, a `taxDate` that can differ from the document date, and `documentNumber`, so Spec 4b and Spec 3 can add them.

### 5.8 A stale result after an address change

An address change through `sales.orders.update` does not recalculate until Spec 4b (silent staleness, `stale` reserved), while a writer that commits between Resolve and Apply makes the later write fail with 409 `inputs_changed`.

---

## 6) Data Models

No new entity. Changes:

- **`SalesSettings`**: one nullable `text` column `tax_provider_key` (`taxProviderKey`), a reversible migration with the snapshot in the same commit, no backfill (`NULL` is `product-rate`), not sensitive.
- **Adjustment rows** (`SalesOrderAdjustment`, `SalesQuoteAdjustment`): no schema change; existing `tax`-kind, discount and credit rows are never rewritten or removed (a `tax`-kind row, a rated discount or a rated credit makes the write fail closed under a provider, § 4.8); charge rows that enter the request receive the provider's gross and `metadata.taxRate` on Apply.
- **`SalesOrder.tax_strategy_key`** (`data/entities.ts`), **`SalesOrder.tax_info`**, **`SalesQuote.tax_info`**: no schema change; the content of `tax_info` under a provider is the provenance record below, versioned, additive only (later keys are added, never removed); the provider key is limited to 100 characters (§ 7), so the written `tax-provider:<key>` stays within the 120 characters the create validator enforces on client input (`data/validators.ts`).
- **Provenance record** (`tax_info` when a provider ran):

```json
{
  "version": 1,
  "providerKey": "example-provider",
  "intent": "record",
  "status": "calculated",
  "rounding": "line",
  "providerReference": "<provider document id or null>",
  "taxTotalAmount": 27.51,
  "calculatedAt": "2026-10-01T12:00:00.000Z",
  "lines": [ { "ref": "<line id>", "taxableAmount": 249.99, "taxAmount": 22.19, "effectiveRate": 8.875, "jurisdictions": [ { "level": "state", "code": "ST-A", "name": "State A", "rate": 6.0, "taxableAmount": 249.99, "taxAmount": 15.00 }, "…" ] } ],
  "charges": []
}
```

Each `lines` and `charges` entry carries every field of the corresponding result type of § 4.3 (for a line: `ref`, `taxableAmount`, `taxAmount`, `effectiveRate`, `isExempt`, `exemptReason`, `isReverseCharge`, `jurisdictions`), the optional ones only when the provider returned them; the example shows a taxed line without the exemption keys. The record also carries the result's `taxTotalAmount`, the anchor of consistency rule (d) (§ 4.10). The record never carries addresses, names, e-mail addresses, tax ids, the request, the raw provider response or credentials, nor a certificate or exemption number (the contract rule of § 4.3 on `exemptReason`, which core does not check), and its jurisdiction codes name tax areas, not a person, so `tax_info` stays outside the sales encryption map (the entry is deferred, § 14).
- **Storage contract** (binding on every child specification of the roadmap and on every provider package). A provider result lands only through the tax phase and only here: (a) the existing line columns `tax_rate`, `tax_amount`, `total_gross_amount` and `unit_price_gross` of order and quote lines; (b) the existing adjustment fields `amount_gross` and `metadata.taxRate` of charge rows; (c) `tax_info` on the order and quote header and `tax_strategy_key` on the order header; (d) the provider package's own fields or extension entities for the facts it reads (§ 4.15; the built-in `sales-tax-rates` provider's own fields are `sales`-owned, roadmap § 9), never a column or metadata key of the existing document, line and adjustment tables; (e) the additive line detail columns of Spec 4a, each holding what the provider returned. The header totals (`tax_total_amount`, the gross totals, `totals_snapshot`) are not a landing place: the existing engine derives them from the written lines and charges, as under `product-rate` today. Nothing else: no provider key in line `metadata`, no new key in adjustment `metadata`, and no write to invoice or credit-memo lines by any specification of the roadmap (Spec 3 adds one additive provenance reference column on `sales_invoices` and `sales_credit_memos`, no amounts); a provider's own transaction identifiers live in `providerReference` of the provenance record and in the tables of the gateway module of Spec 3 only. `tax_rate` is the provider's `effectiveRate` for that line (§ 4.3; the `sales-tax-rates` provider of Spec 2 reports the statutory rate of a single-rate match); the stored `tax_amount` is authoritative, and the stored `tax_rate` identifies the rate group for readers. Under `product-rate` the phase writes nothing in this list, so every existing reader of `sales` sees the same fields with the same meaning.
- **Types.** The exported types of § 4.3 are new names; `SalesCalculationContext` gains `tax?`. No data-model graph is generated (no entity added).

---

## 7) API Contracts

### `GET` / `PUT /api/sales/settings/tax-provider` (new; file `api/settings/tax-provider/route.ts`)

- `metadata`: `GET: { requireAuth: true, requireFeatures: ['sales.settings.manage'] }`, `PUT: { requireAuth: true, requireFeatures: ['sales.settings.manage'] }` (the shape of `api/settings/order-editing/route.ts`); `openApi` exported.
- Organization: as the sibling settings routes (§ 4.4); 400 when no organization resolves and 403 on an explicitly empty scope.
- `GET` response: `{ taxProviderKey: string | null, providers: Array<{ key: string; label: string; description?: string }> }` from `loadSalesSettings` and `listTaxProviders()` (registered providers only; server-side registry, so a provider registered only on the server is listed).
- `PUT` request: `{ taxProviderKey: string | null }` (new exported schema `salesTaxProviderSettingsSchema`, `z.string().trim().max(100).nullable()`).
  - `null` selects the default state; an unregistered key → 422 `sales.tax.errors.provider_not_registered`; `withScopedPayload`.
  - The route runs the mutation guard registry through `runRouteMutationGuards`, not the deprecated `validateCrudMutationGuard` pair the sibling settings routes still use.
  - It executes `sales.settings.save` with the stored number formats and status lists unchanged and `taxProviderKey`, and never sends `orderNextNumber` or `quoteNextNumber`, so the number-edit guard never runs on a provider change (CT-17); response as `GET`.
- Errors: 401 unauthenticated; 403 with `requiredFeatures` containing `sales.settings.manage`; 400 no organization; 422 as above. All messages through i18n keys `sales.tax.errors.*` (illustrative values below).

### Document routes

`POST`/`PUT /api/sales/orders`, `/quotes`, the line and adjustment routes: no URL, method, request or response change. Create still accepts `taxStrategyKey` (orders) and `taxInfo` (orders, quotes); under a configured provider the line inputs `taxAmount` and `totalGrossAmount` stay accepted and are not honoured (§ 4.4). Error bodies that a provider failure adds:

| Reason | Status | Key | Message (illustrative) |
|---|---|---|---|
| provider `unavailable`, `rate_limited`, timeout | 503 | `sales.tax.errors.provider_unavailable`, `provider_timeout` | "Tax could not be calculated: the tax provider is not available. Try again later." |
| provider `unauthorized` (credentials rejected) | 503 | `sales.tax.errors.provider_unavailable` | same message; the log line and the error report carry the code |
| provider `invalid_request` | 422 | `sales.tax.errors.provider_rejected` | "The tax provider rejected the document: `<code>`." |
| inconsistent or malformed result (F3) | 502 | `sales.tax.errors.provider_invalid_result` | "The tax provider returned an inconsistent result." |
| configured key not registered (F8) | 422 | `sales.tax.errors.provider_not_registered` | "Tax provider `<key>` is not available. Ask an administrator to check the sales tax settings." |
| the document's version or the setting's provider key moved between Resolve and the fresh read, the second pass's line `ref`s or nets differ from the request (F9), the document, one of its line or adjustment rows or the provider setting changed between Resolve and the document-row lock, or an order read as `external` before the lock has, evaluated under the lock, a mode after the write that is not `external` (F10) | 409 | `sales.tax.errors.inputs_changed` | "The document changed while tax was being calculated. Reload and save again." |
| `tax`-kind adjustment, rated discount or rated credit, new in the write or stored on the document, under a provider (§ 4.8, F6) | 400 | `sales.tax.errors.unsupported_adjustment` | "Remove the manual tax adjustment or clear the tax rate on the discount before saving under a tax provider." |

Error shape: the commands throw `CrudHttpError(status, body)`; the body is `{ error: <translated message>, code: 'sales.tax.errors.<reason>', providerKey }` with `reason` one of `provider_unavailable`, `provider_timeout`, `provider_rejected`, `provider_invalid_result`, `provider_not_registered`, `inputs_changed`, `unsupported_adjustment`, so clients branch on `code` as they do on `optimistic_lock_conflict` (`inputs_changed` is a distinct code, not an optimistic-lock conflict). Every affected document, line, bulk-line and adjustment route declares these responses in its `openApi` (§ 10).

### Events

Payloads of § 4.16. The existing `sales.document.totals.calculated` (`events.ts`) keeps its payload; provenance is not added to it in this specification.

---

## Configuration

- `sales_settings.tax_provider_key` per organization, written through the route of § 7; `NULL` (or a missing row) means `product-rate`. No new environment variable (the existing test-mode switch `OM_TEST_MODE=1` registers the `tax_stub` provider of § 17 and nothing else here), no per-channel or per-destination scope, no provider settings and no credentials in this specification (Spec 3 adds them through `integrations`).
- The 10-second deadline of § 4.13 is a code constant in this specification; Spec 3 decides whether it becomes configurable.

## Internationalization (i18n)

- Error keys: `sales.tax.errors.provider_unavailable`, `sales.tax.errors.provider_timeout`, `sales.tax.errors.provider_rejected`, `sales.tax.errors.provider_invalid_result`, `sales.tax.errors.provider_not_registered`, `sales.tax.errors.inputs_changed`, `sales.tax.errors.unsupported_adjustment`.
- Audit label `sales.audit.settings.taxProviderChanged`; no other settings labels (no UI in this specification, § 19).
- All keys in the five locales (`de`, `en`, `es`, `ko`, `pl`); `yarn i18n:check-sync` and `yarn i18n:check-usage` run in the gate; the existing key `sales.documents.history.fields.taxInfo` stays.

---

## 8) Security model

- **ACL.** The setting reuses `sales.settings.manage` for `GET` and `PUT`; no feature id is added; the provider key is not a secret.
- **Scoping.** The setting is read for the document's own `tenantId` and `organizationId` (§ 4.4); the command checks `ensureTenantScope` and `ensureOrganizationScope` (`commands/settings.ts`); the request carries the document's scope; the registry holds code, never tenant data.
- **Who can trigger a provider call.** Any principal who can write quotes or orders can trigger a provider call — directly, through warranty replacement orders, inbox actions, the workflow safe command, Code Mode, API keys or redo — and no unauthenticated route reaches a recalculating command (acceptance copies; public cart routes carry no `tax` slot).
- **PII.** The request carries addresses and tax ids from encrypted snapshots in memory only; `tax_info` stores none of them (§ 6); `context.tax` never carries the request (§ 4.11); event payloads carry ids, refs and amounts only (§ 4.16). The public quote view (`api/quotes/public/[token]/route.ts`) returns `taxTotalAmount` and line amounts and gains no `tax_info`. A provider resolves services with the rights of in-process module code and reads only data scoped to the request's tenant and organization.
- **Logging rule (contract sentence).** Core and adapters never log the request, raw provider traffic, addresses, tax ids or credentials at a default-enabled level; on failure they log ids, status and codes only and call `reportError` once with the `sales.tax.errors.*` code; an adapter that wraps an SDK error strips request data before rethrowing; raw request and response retention is Spec 3.
- **Secrets.** None stored by this specification; credentials live in `integrations` from Spec 3 on.

---

## 9) Edge Cases & Failure Scenarios

| # | Trigger | Where detected | Persisted state | User-visible effect | Recovery |
|---|---|---|---|---|---|
| F1 | Provider throws (`SalesTaxProviderError` or any other error), including a failure of a service the provider resolves | Resolve, around `calculate` | unchanged; no document on create (the claimed number is lost) | 503 / 422 per § 7 | retry; switch the setting to `product-rate` |
| F2 | Provider times out (10 s) | Resolve deadline | unchanged | 503 `provider_timeout` | retry; no automatic retry |
| F3 | Result breaks the consistency rule of § 4.10 (taxable base, total, a missing, unknown or duplicated `ref`, a negative or non-finite amount) | result validation in Resolve | unchanged | 502 `provider_invalid_result` | adapter fix |
| F4 | merged into F3 | — | — | — | — |
| F5 | merged into F3 | — | — | — | — |
| F6 | The document carries a `tax`-kind adjustment, a rated discount or a rated credit, new in the write or stored, while a provider is configured | Resolve, before the provider call (§ 4.8) | unchanged | 400 `unsupported_adjustment` | remove the row or clear the rate |
| F7 | Admin saves an unregistered key | settings route (write time) | setting unchanged | 422 `provider_not_registered` | install the package or choose another key |
| F8 | Setting names a key that no longer resolves (deploy without the package) | Resolve, provider lookup | unchanged; every recalculating write of that organization fails until fixed (workflow steps, inbox actions and warranty replacement orders too) | 422 `provider_not_registered` (which callers receive the `code`: § 12) | restore the package or clear the setting |
| F9 | The document's `updated_at` or the setting's provider key moved between Resolve and the fresh read before the second pass, or the second pass's line `ref`s or line or charge nets differ from the request (§ 4.2) | Apply, before the flush opens (nothing flushed) | unchanged (a create has no document version; the setting read and the second-pass comparison apply to it) | 409 `inputs_changed`; the client reloads and saves again | the next attempt when another writer or a hook that answered differently once caused it; a hook or subscriber that answers differently on every pass fails every attempt until it is changed (§ 4.1); a manual recalculate command is Spec 4b |
| F10 | Concurrent writes on the same document | the document-row lock of #6925 and, under a provider, the check under it (§ 4.2) | writers serialize on the document-row lock; under a provider the check under that lock fails the later writer and nothing is written | under a provider, 409 `inputs_changed` for the later writer; without a provider, today's behaviour | the client reloads and saves again; recommend the optimistic-lock header to API clients |
| F11 | Undo of a write that carried provenance | undo handler; staleness guard (`commands/documents.ts`) | snapshot restored: amounts and provenance together; an undo that would move a shipped line's rate or unit gross is refused by the shipped-line guard | existing undo messages (409 for a shipped line) | next recalculating write applies the current setting |
| F12 | Redo of a document command | the bus re-runs `execute` | as a normal write | as F1–F9 | as the original command |
| F13 | Document created before any setting existed | the setting read: default state, no Resolve | no record from the phase | none | the first recalculating write after a provider is configured calls the provider for that document too |
| F14 | Setting switched back to `product-rate` | the setting read: default state, no Resolve; `providerTaxed` from the document's record (§ 4.8) | stored line tax kept by the line carry-over and the stored `shipping-provider:` rows kept (§ 4.8, § 5.5); the old record stays (§ 4.5) | none on the stored amounts; until Spec 4b the shipping net is not re-quoted on a line write and a deleted `shipping-provider:` row is not regenerated | the next provider write or Spec 4b's recalculation |
| F15 | An order in the external amounts mode (`totals_mode` = `external`) | the default-state path of the external amounts mode (§ 4.6) | the caller's amounts; no provider call; `tax_strategy_key` and `tax_info` unchanged | none; a failing provider does not block the write | none needed |
| F16 | Transaction aborts after a successful Resolve for another reason (custom fields, guard, database) | any later flush phase | unchanged | the other failure's message | retry; the provider is called again (safe: `calculate` has no provider-side effect) |
| F17 | Provider rate-limits | adapter maps to `rate_limited` | unchanged | 503 | retry later |
| F18 | Settings read fails | as today | unchanged | today's error | as today |
| F19 | Provider down while a customer accepts a quote | no provider call on the accept route | order created from the copied quote amounts | none | none needed |
| F20 | No `sales_settings` row | as `NULL` (§ 4.4) | `product-rate` | none | none needed |
| F21 | Provider result applies to a gross-entered line | Apply | net kept (the first pass derived it from the gross), gross = net + provider tax, and on any line the unit gross is the unit net before discount at the provider's rate (§ 4.10) | the line's gross can differ from the entered gross | a gross-preserving split is a later specification |
| F22 | A shipping rate keyed on the gross subtotal under a provider | the first calculation pass (§ 4.1) | the shipping charge selected on a gross without the provider's tax | near a tier boundary the charge can differ from one selected on the provider's gross and can change on a later write | a later specification (§ 12, § 14) |

A failure inside the flush, after Apply (F16), rolls back every phase; events already emitted in Resolve are not rolled back.

---

## 10) Migration & Backward Compatibility

Every surface changes additively, checked against the 14 categories of `BACKWARD_COMPATIBILITY.md`; nothing follows the Deprecation Protocol (`BACKWARD_COMPATIBILITY.md`).

| Surface | Change | Classification |
|---|---|---|
| §1 `data/validators.ts` | every existing schema unchanged, `salesSettingsUpsertSchema` included; `taxStrategyKey` and `taxInfo` stay accepted; three new exported schemas, `salesSettingsUpsertWithTaxProviderSchema` (§ 4.4), `salesTaxProviderSettingsSchema` (§ 7) and `salesTaxResultSchema` (§ 4.10) | ✓ ADDITIVE |
| §1 `events.ts`, `acl.ts`, `di.ts`, `index.ts` | two new event entries; `di.ts` registers the test-only `tax_stub` provider only under `OM_TEST_MODE=1` (no DI key); no ACL or module metadata change | ✓ ADDITIVE |
| §2 Type Definitions (`BACKWARD_COMPATIBILITY.md`) | optional `tax?: SalesTaxContext` on `SalesCalculationContext`; optional nullable `taxProviderKey` on `SalesSettings`; new exported types, `SalesTaxProviderError` among them (§ 4.3); nothing removed or narrowed; `TaxProvider` declares no reserved members, so later optional methods are additive | ✓ ADDITIVE |
| §3 Function Signatures (`BACKWARD_COMPATIBILITY.md`) | unchanged; `registerTaxProvider`, `getTaxProvider`, `listTaxProviders`, `resetTaxProviders` are new; `extractAdjustmentTaxRate` and `NET_RECONCILIATION_TOLERANCE` gain exports from `lib/calculations.ts` (private today; additive); `ensureProviderTotalsCalculator` keeps its name, idempotency, events and manual-override handling | ✓ ADDITIVE |
| §4 Import Paths (`BACKWARD_COMPATIBILITY.md`) | nothing moves; the `lib/providers` barrel gains the tax exports (§ 4.3); the request builder and the Resolve helper are command-layer files; the documented spellings of `lib/calculations` keep resolving | ✓ ADDITIVE |
| §5 Event IDs (`BACKWARD_COMPATIBILITY.md`, FROZEN) | `sales.tax.document.calculate.before` / `.after` added (notification-only); `sales.tax.calculate.*`, `sales.document.calculate.*`, `sales.line.calculate.*`, the shipping and payment adjustment events and `sales.document.totals.calculated` keep ids, emit points and payloads; under a configured provider they fire once per calculation pass (two passes per write, plus the validation-only pass of § 4.2 where a command runs one), the shipping adjustment events in the first pass only; whatever the setting, the shipping adjustment events do not fire on a pass that keeps the stored shipping rows (§ 4.16) | ✓ ADDITIVE |
| §6 Widget Injection Spot IDs | unchanged; no UI | — |
| §7 API Route URLs (`BACKWARD_COMPATIBILITY.md`) | one new route; existing routes and response schemas unchanged; the list and detail field set (`api/documents/factory.ts`) gains nothing; the document, line and adjustment routes declare the error responses of § 7 in `openApi`, and the OpenAPI descriptions of `taxStrategyKey` / `taxInfo` and of the line inputs `taxAmount` / `totalGrossAmount` state the overwrite rule | ✓ ADDITIVE |
| §8 Database Schema (`BACKWARD_COMPATIBILITY.md`, ADDITIVE-ONLY) | one nullable column on `sales_settings` with `down()`; no backfill; no document or line table change; snapshot updated in the same commit | ✓ ADDITIVE (NULL default; existing rows read as `product-rate`) |
| §9 DI Service Names (`BACKWARD_COMPATIBILITY.md`) | no key added, renamed or changed; `salesCalculationService` and `taxCalculationService` keep their interfaces | — |
| §10 ACL Feature IDs (`BACKWARD_COMPATIBILITY.md`, FROZEN) | `sales.settings.manage` reused; no new id | — |
| §11–§13 | no notification type, AI identifier or CLI command change | — |
| §14 Generated File Contracts (`BACKWARD_COMPATIBILITY.md`) | the generated module registry gains one API route (`modules.generated.ts`, `packages/core/AGENTS.md`), the OpenAPI document and the events registry gain entries; no ACL entry; no generator or export name change | ✓ ADDITIVE |

**Migration path for existing tenants and modules:** run the migration; no data changes; an organization that does nothing keeps `NULL` and calculates every document without a provenance record exactly as today, with the existing engine fixtures as the proof; a module that replaces `salesCalculationService` without delegating to `salesCalculations` skips the phase (stated, not a break). Under a configured provider a document with a `tax`-kind row, a rated discount or a rated credit is refused until the row is fixed (§ 4.8); other adjustment rows stay as entered; charge rows receive the provider's gross and tax metadata.

**Client-supplied `taxStrategyKey`, `taxInfo` and line amounts.** No request is rejected and no schema is narrowed; the overwrite rule is § 4.4. Migration for clients: stop sending `taxStrategyKey` and `taxInfo`, configure the provider in sales settings and read provenance from the stored document; rollback needs no data migration.

**`UPGRADE_NOTES.md`.** Nothing for this spec-only PR. The implementation PR adds an `UPGRADE_NOTES.md` entry and a dated `BACKWARD_COMPATIBILITY.md` entry for the changed value semantics: server-written `tax_strategy_key`/`tax_info`, caller line `taxAmount`/`totalGrossAmount` not honoured under a provider, and the server-written fields of the storage contract (§ 6).

---

## 11) Parallel work

States read on 2026-10-31; none is a base or a dependency. Open work on these paths: #5853 (caller-supplied `totalGrossAmount` reconciliation) and #8232 (a line created with only a unit gross and a discount stores a discounted unit net), both inherited by `product-rate` and § 4.10; #6146 (`lineNumber` as a target position on the single line upsert); #6733 (the cross-module data ownership audit, the reason for § 4.11 and § 4.15); #5192 (shares the sales migration snapshot). Period-level and posting work: roadmap § 11.

---

## 12) Risks & Impact Review

**Tenant isolation.** The setting, the provenance and the request are organization-scoped and the registry holds code only. **Migration.** One reversible nullable column, no backfill, no downtime.

### Risk Register

#### Double taxation through `tax`-kind adjustments, `taxPortion` or explicit line `taxAmount`
- **Scenario**: a provider writes line tax while a `tax`-kind adjustment or a `metadata.taxRate` on a document discount is still folded into the total; the document shows tax twice or subtracts it twice (§ 5.4 hazard).
- **Severity**: High
- **Affected area**: `sales` totals, invoices copied from orders
- **Mitigation**: the consistency rule; `tax`-kind adjustments, rated discounts and rated credits are refused under a provider, new or pre-existing (400, § 4.8), so no arithmetic neutralization exists for the payment block's rebuild to undo.
- **Residual risk**: a `sales.document.calculate.after` subscriber can still rewrite totals after the phase, as today (`lib/calculations.ts`), and a `sales.payment.adjustments.apply.after` subscriber can rewrite line and charge tax through `setDocument` (`lib/providers/totals.ts`) after the phase in both passes, while the Apply comparison checks nets only; the record then describes the provider's result, not the persisted amounts.

#### A provider call inside a transaction or under a row lock
- **Scenario**: a provider is called while rows are locked; a slow provider holds locks for seconds.
- **Severity**: High
- **Affected area**: `sales` commands, public quote acceptance
- **Mitigation**: Resolve, the comparison and the Apply pass before the transaction opens (§ 4.2); conversion, acceptance, undo and returns make no provider call; a 10-second deadline.
- **Residual risk**: the returns question goes to Spec 4b.

#### A provider call under a workflow's instance-row lock
- **Scenario**: a synchronous workflow step dispatches a recalculating command inside the workflow's execution transaction, which holds a `PESSIMISTIC_WRITE` lock on the workflow-instance row (§ 4.2); a slow provider keeps that lock for up to the deadline.
- **Severity**: Medium
- **Affected area**: workflow instances whose steps run recalculating `sales` commands
- **Mitigation**: asynchronous activities for provider-taxed commands.
- **Residual risk**: a synchronous step holds the lock for the duration of the provider call.

#### Forged provenance
- **Scenario**: a client stores a provenance-shaped `taxInfo` or a `tax-provider:` key on create under `product-rate`, and a reader trusts it.
- **Severity**: Medium
- **Affected area**: document history, later consumers of `tax_info`
- **Mitigation**: the fields are never read as authority; conversion never promotes a copied record into a server-written key (§ 4.14); API exposure is deferred (§ 4.4).
- **Residual risk**: a forged record can appear in the history widget until a later specification exposes provenance through a server-validated read; on a pass without a provider call it makes the hook keep the document's own stored `shipping-provider:` rows (§ 4.8), never tax from outside the document.

#### Silent zero or silent fallback
- **Scenario**: a provider outage returns no tax and the document is written with zero tax and no status.
- **Severity**: High
- **Affected area**: every touchpoint
- **Mitigation**: fail closed; `display` never remote; `fallback` reserved for a labelled policy in Spec 3.
- **Residual risk**: fail closed blocks edits of that organization during an outage, by design; a line whose stored `tax_rate` is 0 from an exemption or a reverse charge stays at zero tax on a later write without a provider that supplies no rate, until a caller supplies one or Spec 4b re-rates it (§ 4.5).

#### Stale tax after an address or customer change until Spec 4b
- **Scenario**: a provider-taxed order gets a new ship-to; nothing recalculates (§ 5.8); an invoice copies the old tax.
- **Severity**: High
- **Affected area**: orders, invoices
- **Mitigation**: by the roadmap, neither a remote nor a `sales-tax-rates` provider is production-safe before Spec 4b for documents whose ship-to changes (roadmap § 12); every recalculating write calls the provider on the current inputs, so the next one re-taxes; `stale` is reserved in the vocabulary from this specification on.
- **Residual risk**: between this specification and Spec 4b an organization that selects a provider can hold stale tax after an address change.

#### Shipping tiers on a gross before the provider's tax
- **Scenario**: under a provider the shipping block runs before the provider's tax is applied (§ 4.1), so a rate keyed on the gross subtotal, such as a `flat-rate` `subtotal` tier, is selected on a gross without the provider's tax (F22).
- **Severity**: Medium
- **Affected area**: orders and quotes whose shipping method has gross-subtotal tiers
- **Mitigation**: the behaviour is stated (§ 4.1, F22).
- **Residual risk**: a tier selected on the provider's gross is a later specification (§ 14).

#### Every default employee can switch the provider
- **Scenario**: `sales.settings.manage` is held by the default `employee` role (`setup.ts`); a settings change re-taxes every later document of the organization.
- **Severity**: Medium
- **Affected area**: `sales` settings
- **Mitigation**: audit entry on every change (§ 4.4); provenance per document; a narrower feature id is deferred (§ 14).
- **Residual risk**: stands in this specification; revisited with Spec 3's gateway UI.

#### Provider-call amplification and quota
- **Scenario**: many line edits, inbox actions, workflow steps, Code Mode calls or redos cause one provider call each; a provider billed per call or limited per account is exhausted.
- **Severity**: Medium
- **Affected area**: the organization's provider account; `sales` writes
- **Mitigation**: one call per write, zero automatic retries, `display` never remote; the risk is named and throttling is Spec 3.
- **Residual risk**: unbounded in this specification.

#### Fail-closed outage radius
- **Scenario**: the provider is down; every recalculating write of that organization fails, including inbox actions, the workflow safe command `sales.orders.update`, warranty replacement orders and redo; the workflow and warranty callers cannot choose `product-rate` per call, so the radius is the organization's whole back-office automation.
- **Severity**: High
- **Affected area**: back-office automation of the organization
- **Mitigation**: fail closed is the rule of § 4.13 and Spec 3 adds per-provider policies; `product-rate` organizations are unaffected.
- **Residual risk**: stands until Spec 3's policies; HTTP clients, the warranty route and redo receive the error `code`, while inbox actions and workflow activities receive only its message.

#### An abandoned provider call after the deadline
- **Scenario**: the 10-second timer wins the race of § 4.13 and the abandoned `provider.calculate` promise rejects or resolves later; without a handler the late rejection surfaces as an unhandled rejection.
- **Severity**: Medium
- **Affected area**: the Resolve helper; process health of the application server
- **Mitigation**: core ignores a late settlement of the abandoned call (§ 4.13); UT-75.
- **Residual risk**: an adapter that ignores `signal` holds its connection until its own timeout.

---

## 13) Review

Decisions taken after review are recorded in the Changelog (Review entries) and in the sections they change.

---

## 14) Deferred items

1. A deprecation marker for the client-supplied `taxStrategyKey` and `taxInfo` inputs (the payment-ledger precedent, `2026-08-01-sales-order-payment-ledger-input-deprecation.md`): not added; the text of § 10 is ready for that case.
2. Returns under a configured provider: no provider call in this specification; Spec 4b decides.
3. Adding `tax_info` to the sales encryption map as defence in depth (§ 6): a later specification.
4. Exposing `tax_info` and `tax_strategy_key` in the document read API: a later specification.
5. Clearing a provider's provenance record on the first recalculating write after the organization switches back to `product-rate`: not done; the record describes the last provider calculation (§ 4.5).
6. A narrower, admin-only feature id for the provider setting (the `sales.documents.number.edit` precedent, `acl.ts`, `setup.ts`): a later specification; this specification reuses `sales.settings.manage` (§ 4.4).
7. A per-rate-group split of a charge's tax (ancillary costs follow the rates of the goods they accompany in some markets) and a per-rate-group rounding method for the built-in `sales-tax-rates` provider of Spec 2: a later revision of this contract, as additive optional fields and a setting; until then a provider returns one taxable amount, one tax amount and one effective rate per charge, the `sales-tax-rates` provider rounds per line, and a provider that declares `rounding: 'document'` keeps the per-rate sums itself (§ 4.10).
8. Taxing the charges a third-party totals calculator adds during the calculation (§ 4.1, § 4.2): a later specification.
9. Selecting a gross-subtotal shipping tier on the provider's gross under a provider (§ 4.1, F22, § 12): a later specification.

---

## 15) Phasing

Four implementation phases, each shippable alone and each leaving the application working; no implementation phase starts before this specification merges (roadmap § 16).

- **Phase A — contract and registry.** Types, the registry and the record shape; no behaviour change. Gate: the new exports exist, the registry survives a second module instance, no migration and no removed export.
- **Phase B — the tax phase.** The step inside the provider calculator, the identity without a `tax` slot, the kept shipping rows (§ 4.8), the test double `tax_stub` (§ 17). Gate: the golden and the default-path totals recorded on the baseline commit equal the output with the phase in place, and every existing test is unmodified and green.
- **Phase C — Resolve and Apply, the setting, the route, provenance.** The migration, the route, the extended command, the audit entry, Resolve and Apply in the thirteen commands, the `providerTaxed` slot (§ 4.8), the two events. Gate: under `tax_stub` every affected route persists the provider's line and charge tax and the provenance record, a write whose inputs changed fails closed and writes nothing, the settings write requires `sales.settings.manage`, an unregistered key is rejected, and `product-rate` through the API gives today's totals.
- **Phase D — docs.** The user guide and the overrides guide gain a chapter on document-level providers with a table of what the unit seam cannot carry (addresses, customer, document, charges, status, lifecycle); the totals-hook example is corrected; the appended-calculator rule is stated; the events page lists the two ids; the sales settings page documents the setting. Gate: the docs build passes and `sales.tax.calculate` is still documented.

---

## 16) Implementation Plan

### Phase A — contract and registry
1. Add `lib/tax/types.ts` with the types of § 4.3 and the `tax?` slot on `SalesCalculationContext`, and `salesTaxResultSchema` in `data/validators.ts`, from which `SalesTaxResult` derives (§ 4.10); typecheck passes; no runtime change.
2. Add `lib/tax/registry.ts` (`globalThis` state, `registerTaxProvider`, `getTaxProvider`, `listTaxProviders`, `resetTaxProviders`) with `lib/__tests__/taxProviderRegistry.test.ts` (UT-01 to UT-05).
3. Add the provenance record builder and its reader, which tells a provenance record (the `version` and `providerKey` keys of § 6) from any other `tax_info` value and supplies `providerTaxed` (§ 4.8), with `lib/__tests__/taxProvenanceRecord.test.ts` (UT-40, UT-41; the record contains no address, name or tax id).
4. Export the types and the registry from the `lib/providers` barrel next to the shipping and payment registries (`lib/providers/index.ts`); the phase joins the barrel in step 6.

### Phase B — the tax phase
5. Record the tax-path golden (`lib/__tests__/fixtures/taxPassThrough.golden.json`) on the baseline commit; the commit changes no non-test file under `lib/`.
6. Add `lib/tax/phase.ts` and `lib/tax/stubProvider.ts` (key `tax_stub`, § 17); call the phase inside `ensureProviderTotalsCalculator` between the shipping and payment blocks; `lib/__tests__/taxPassThrough.golden.test.ts` (UT-50, UT-52, UT-54) and `lib/__tests__/taxPhase.test.ts` (UT-10, UT-11, UT-14 to UT-18, UT-62, UT-76, UT-77) pass; every existing test file is unmodified and green.
7. Add `TC-SALES-TAXPROV-001-tax-default-path-totals.spec.ts` with literal constants recorded on the baseline.

### Phase C — Resolve and Apply, the setting, the route, provenance
8. Add the migration (`up()` and `down()`), the entity property and the snapshot through `yarn db:generate` under the root coding-agent exception.
9. Extend `sales.settings.save` with the optional field written only when present, `?? null` on create, write-time validation against the registry, the exported `salesSettingsUpsertWithTaxProviderSchema` the command parses (§ 4.4) and a `buildLog` entry on change; `commands/__tests__/settings.tax-provider.test.ts` (CT-09, CT-12, CT-17, CT-20, CT-21).
10. Add `api/settings/tax-provider/route.ts` with `metadata`, `openApi`, the mutation guard and the i18n keys; `TC-SALES-TAXPROV-002`, `003`, `004`.
11. Add the request builder (`commands/taxRequest.ts`: tolerant address mapper, `taxDate`, `pricesIncludeTax`, charges with `ref`) with `commands/__tests__/taxRequest.test.ts` (UT-60, UT-61).
12. Add the shared helper of § 4.2 (`commands/taxResolve.ts`, UT-70 to UT-75), assign ids on create, wire it into the thirteen commands (creates → line and adjustment commands → header updates, whose calculation is hoisted before the flush only under a configured provider, § 4.2, with `deriveDocumentUpdateState` in its own commit), and register `tax_stub` under `OM_TEST_MODE=1`; `commands/__tests__/documents.tax-provider.resolve-apply.test.ts` (CT-01 to CT-08, CT-13, CT-14, CT-15, CT-16, CT-18, CT-19, CT-22 to CT-27) and `documents.tax-provider.provenance.test.ts` (CT-11), then `TC-SALES-TAXPROV-005` and `006` (§ 17).
13. Conversion keeps today's copy semantics (§ 4.14); `documents.convert-to-order` coverage extended (CT-10: `tax_strategy_key` stays `null` and `taxInfo` is copied verbatim under a configured provider).
14. Run the gate of `.ai/agentic.config.json` and the integration suite.

### Phase D — docs
15. Update the docs pages of § 18; `yarn workspace open-mercato-docs build` passes; the documented provider example is the body of `tax_stub`.
16. `UPGRADE_NOTES.md` entry (§ 10); `.ai/specs/README.md` row already present from the spec PR; roadmap Changelog line.

---

## 17) Testing Strategy

- **Unit (`lib/__tests__/`; the request and Resolve-helper tests under `commands/__tests__/`):**
  - UT-01 to UT-05 the registry: lookup, replace-by-key, the identity-checked disposer, survival across two module instances, key hygiene.
  - UT-10 the identity without a `tax` slot, with the baseline event sequence.
  - UT-11 a `tax_stub` result sets line and charge tax consistently for `order` and `quote`.
  - UT-14 the `ref` rule (ids and `<calculatorKey>@<position>`; a shipping and a payment charge at the same position stay distinct through the key prefix) and the in-place mapping (§ 4.1).
  - UT-15 payment fees see the tax-inclusive gross.
  - UT-16 `sales.document.calculate.after` runs after the phase and the totals hooks, and the new events are absent under `product-rate`.
  - UT-17 payment totals survive.
  - UT-18 the documented gift-line hook keeps its effect.
  - UT-40 the record shape with `taxTotalAmount`, the status vocabulary and a JSON round trip.
  - UT-41 no personal data, and no adjustment `metadata` object copied into the request, the events or the record.
  - UT-50 golden equality under four configurations (nothing configured, a settings row with `NULL`, `tax_stub` registered but not selected, the provider hook loaded), on the result and on the logged warnings.
  - UT-52 non-vacuity: a selected `tax_stub` changes the output.
  - UT-54 deep-frozen inputs.
  - UT-60 post-discount nets and charges in the request.
  - UT-61 the request stays in memory.
  - UT-62 document discounts carry no tax portion under a provider.
  - UT-70 the consistency rule: 0.004 accepted and 0.006 rejected for the base and the total, flagged lines, a result without `effectiveRate`.
  - UT-71 reference integrity.
  - UT-72 the `tax`-kind, rated-discount and rated-credit refusal over stored rows plus the write's inputs (a negative `custom` adjustment with `metadata.taxRate` among them).
  - UT-73 the version check: a moved `updated_at` or provider key is 409, the read is fresh, a create skips the document check.
  - UT-74 a create with two new manual charges: every `ref` is the assigned id.
  - UT-75 the deadline race: a late settlement of the abandoned call is handled and ignored.
  - UT-76 with `providerTaxed` and no result the hook keeps a stored `shipping-provider:` row and calls no shipping provider; without a slot it regenerates as today (§ 4.8).
  - UT-77 under a provider the shipping provider is called once per write, the second pass reusing the first pass's drafts (§ 4.2).
- **Command level (`commands/__tests__/`, the real `DefaultSalesCalculationService`, `tax_stub` registered per test):**
  - CT-01 no settings row: `product-rate`, persisted values equal the baseline.
  - CT-02 a `null` key behaves the same.
  - CT-03 Resolve and the second pass run before the transaction on create and on both header updates, with intent `estimate` for quotes and `record` for orders; a header update that changes the address and the shipping method sends the new destination.
  - CT-04 an unchanged version applies once and writes server provenance.
  - CT-05 a moved `updated_at` between Resolve and the fresh read fails closed with 409.
  - CT-06 a changed provider key fails closed with 409 on create and on update.
  - CT-07 a throw or an invalid result fails closed; nothing persisted.
  - CT-08 an unregistered key at calculation time fails closed.
  - CT-09 the setting round trip and the write-time rejection.
  - CT-10 conversion calls no provider, copies the record and keeps `tax_strategy_key` `null`, a forged record included.
  - CT-11 undo restores provenance.
  - CT-12 scope enforcement.
  - CT-13 the `{ quote, order } × { create, update }` matrix, the line rows after an adjustment write and the charge rows after a line upsert and a line delete.
  - CT-14 client `taxInfo` is output-only.
  - CT-15 persisted rows under `product-rate` equal a baseline golden.
  - CT-16 the setting is read for the document's own scope.
  - CT-17 other settings values untouched; a provider change sends no next-number field and runs no number-edit guard.
  - CT-18 a client `taxStrategyKey` never selects a provider.
  - CT-19 a setting change affects later calculations only.
  - CT-20 the two existing settings routes keep the key.
  - CT-21 the route and command path.
  - CT-22 gross-entered order and quote lines with a percentage and with an amount discount, saved twice unchanged, keep net, tax, gross, `unit_price_gross` and `tax_rate`, and the discount applies once (§ 4.10; a line affected by #8232 is outside this case).
  - CT-23 a `sales.line.calculate.after` subscriber that answers differently in the second pass, and a `sales.shipping.adjustments.apply.after` subscriber that changes a line net in the first pass, fail an update and a create with 409 and nothing is persisted; the shipping provider is called once.
  - CT-24 two overlapping line upserts under `tax_stub`: the later fails with 409 `inputs_changed` and the header totals equal the stored lines; under `product-rate` a header update that races a line upsert succeeds without 409 and the header totals equal the stored lines (§ 4.2, F10).
  - CT-25 an order in the external amounts mode under a `tax_stub` that throws: a create and a line upsert succeed without a provider call and leave provenance unchanged, and a line upsert that read the order as `external` fails with 409 when a concurrent update switched it to `computed` (§ 4.2, § 4.6, F10, F15).
  - CT-26 an adjustment upsert under `tax_stub` on an order with a shipped line whose stored `tax_rate` differs from the stub's rate persists the stub's tax on that line without a 409, and the undo of that write is refused with 409 (§ 4.10, F11).
  - CT-27 under `tax_stub` at a combined rate of 8.875 with tax rounded to cents: the line editor's payload for a shipped net-entered and a shipped gross-entered line, unchanged and with a raised quantity, saves without a 409, while a changed unit price is still refused (§ 4.10).
- **Integration (`__integration__/`, fixtures created and deleted per test, settings restored in `finally`):**
  - `TC-SALES-TAXPROV-001` default-path totals against literal constants recorded on the baseline.
  - `TC-SALES-TAXPROV-002` the settings write is gated: 403 for a `sales.settings.view`-only role, 401 unauthenticated.
  - `TC-SALES-TAXPROV-003` an unregistered key is rejected and the stored setting unchanged.
  - `TC-SALES-TAXPROV-004` parity of a settings row with `NULL`, and the settings round trip.
  - `TC-SALES-TAXPROV-005` under `tax_stub`, an order and a quote created and updated through every affected route — document create and update, line upsert and delete (`lib/makeSalesLineRoute.ts`), the bulk order line upsert (`api/order-lines/batch/route.ts`), adjustment POST, PUT and DELETE (`api/order-adjustments/route.ts` and the quote equivalent) and a return (`api/returns/route.ts`) — asserting line tax and gross on touched and untouched lines, the tax total, the charge read-back, and the provenance record and strategy key from the action-log snapshots.
  - `TC-SALES-TAXPROV-006` under `tax_stub`, the `tax`-kind, rated-discount and rated-credit refusal (400), scope isolation and the switch back to `product-rate` (§ 4.5, § 4.8, F14).
  - `TC-SALES-TAXPROV-005` and `006` run on an organization the test creates, never the admin's organization.
  - `tax_stub` (fixed rates, an exempt-line marker, no network) is registered from `sales/di.ts` only under `OM_TEST_MODE=1`, which the integration harness sets — a recorded deviation.
  - The mismatch refusal is proven at command level (CT-05, CT-06, CT-23, CT-24).

---

## 18) Documentation changes

Docs: the taxes user guide and the overrides guide gain a document-level provider chapter, the totals-hook example is corrected, and the calculations, sales-providers, events and sales-settings pages are updated.

---

## 19) Out of scope (with the specification that owns each item)

- Provider-side lifecycle (commit, adjust, void, refunds, retries and the commit point) is not declared in the `TaxProvider` type and has no behaviour here; Spec 3 adds the optional methods, and the link from an invoice or credit memo to the order's provider result (additive provenance columns) is Spec 3's as well. In this specification `record` means that the platform stores the result on an order; it never asks a provider to record a transaction for filing.
- Deterministic provider document codes, idempotency keys and retry semantics: Spec 3; this specification stores the provider's reference as returned and carries `documentNumber`.
- Per-line tax detail columns (the provider's tax code as returned through an additive line result field, the exemption reason, the reverse-charge flag, the per-jurisdiction breakdown as queryable data), additional line kinds (`handling`, `refund`), per-line addresses, the customer group set, and the allocation of document discounts to lines: Spec 4a. Provider-specific product and customer facts are the provider package's own fields (§ 4.15; roadmap ADR-10). Exemption appears only as result vocabulary and status, with the amounts rule of § 4.3; the OSS applicability rule and the EU reverse-charge rule stay outside the listed specifications (roadmap ADR-5); the destination country's rate row and the exemption or reverse-charge outcome a matched row expresses are Spec 2's (roadmap ADR-6, § 7.1 row 2).
- Recalculation triggers beyond today's (address, customer, date, elapsed time), the explicit recalculate command, the stored-tax carry-over fix, return reversal at the original tax date, honour-versus-re-quote on conversion, the line dialog change, and the re-rating of a line whose stored `tax_rate` is 0 from an exemption or a reverse charge once no provider applies (§ 4.5): Spec 4b. The stop of every trigger after an issued invoice or a committed provider transaction, whichever comes first, with later changes through `adjust` and a correcting document: Spec 4b with Spec 3 (roadmap ADR-8).
- Configurable failure policies, timeouts per organization, fallback to another provider, credentials, the admin log and raw request retention: Spec 3 and provider packages.
- Selection by destination, by sales channel or by any other scope: a later specification; the provider is selected once per organization.
- Matching `SalesTaxRate` rows by address, customer group, channel or date, CSV import and export, and the sourcing option: Spec 2 (working name `sales-tax-rates`).
- Net/gross presentation, the selling country, cache keys: Spec 5. Cart, checkout and POS behaviour: 6a and 6b.
- Exposing provenance in the read API; any UI; period-level reporting and the ledger.

---

## Final Compliance Report — 2026-10-03

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/sales/AGENTS.md`
- `packages/events/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`
- `apps/docs/docs/framework/runtime/error-reporting.mdx`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules; no new cross-module ORM reads | Compliant | § 4.11, § 4.15 |
| root AGENTS.md | Filter by `organization_id`; never expose cross-tenant data | Compliant | § 4.4, § 8 |
| root AGENTS.md | Validate inputs with zod in `data/validators.ts`; derive types with `z.infer` | Compliant | § 4.4, § 4.10, § 7 |
| root AGENTS.md | `findWithDecryption` / `findOneWithDecryption` for encrypted reads | Compliant | § 4.11 |
| root AGENTS.md | Default migration workflow (`yarn db:generate`, review SQL and snapshot; ask before `db:migrate`) | Compliant | § 6, § 16 step 8 |
| root AGENTS.md | RBAC: feature-based guards in route `metadata` | Compliant | § 7 |
| root AGENTS.md | Never hard-code user-facing strings; i18n keys | Compliant | § 7; Internationalization |
| root AGENTS.md | Event IDs `module.entity.action` (`AGENTS.md`) | Deviation proposed | § 4.16; Non-Compliant Items |
| root AGENTS.md | Ask before introducing provider-specific preconfiguration outside the provider package (`AGENTS.md`) | Deviation proposed | § 17; Non-Compliant Items |
| root AGENTS.md | Run `yarn generate` after changing auto-discovered files | Compliant | § 16 step 14 |
| root AGENTS.md | Optimistic locking on every new user-editable entity | N/A | § 6 (no new entity) |
| root AGENTS.md | No `any`; functional, data-first utilities | Compliant | § 4.3, § 4.17 |
| packages/core/AGENTS.md | API routes export `metadata` per method and `openApi`; custom write routes run the mutation guard registry (`packages/core/AGENTS.md`) | Compliant | § 7 |
| root AGENTS.md | Integration coverage for all affected API paths ships in the same change (`AGENTS.md`) | Compliant | § 17 |
| root AGENTS.md (`AGENTS.md`), error-reporting.mdx | A catch that records an error MUST also `reportError` | Compliant | § 8 |
| packages/core/AGENTS.md | Encryption maps for PII / GDPR-relevant columns | Compliant with a stated choice | § 6, § 14 item 3 |
| packages/core/AGENTS.md | Cross-Module Coupling: optional consumer owns the glue, `try/catch` resolve, no hard `requires` (`packages/core/AGENTS.md`) | Compliant | § 4.11, § 4.15 |
| packages/core/AGENTS.md | Migrations: snapshot updated in the same commit (`packages/core/AGENTS.md`) | Compliant | § 6 |
| packages/core/AGENTS.md, .ai/review-checklist.md | Domain writes through commands (`packages/core/AGENTS.md`); every command undoable (`.ai/review-checklist.md`) | Compliant; deviation recorded | § 4.4; Non-Compliant Items |
| packages/core/src/modules/sales/AGENTS.md | MUST use `salesCalculationService` for document math; never reimplement inline | Compliant | § 4.1, § 4.2 |
| packages/core/src/modules/sales/AGENTS.md | Ask First: Quote → Order → Invoice flow (`packages/core/src/modules/sales/AGENTS.md`); adjustment kinds and configuration entity semantics | Compliant | § 4.4, § 4.8, § 4.13, § 4.14, § 17 |
| packages/core/src/modules/sales/AGENTS.md | Validation commands (`yarn db:generate`, `yarn generate`, `yarn workspace @open-mercato/core build`) | Compliant | § 16 steps 8 and 14 |
| packages/events/AGENTS.md | Declare events in the emitting module's `events.ts` with `createModuleEvents`; run `yarn generate`; Ask First on renaming | Compliant | § 4.16 |
| .ai/specs/AGENTS.md | `{date}-{title}.md`, no `SPEC-*` prefix; required sections; README row | Compliant | this file |
| .ai/qa/AGENTS.md | Integration tests in module `__integration__` folders, self-contained, no seeded data; new API behaviour covered by route-level tests | Compliant | § 17 |
| BACKWARD_COMPATIBILITY.md | Validators never narrowed (§1); types additive (§2); event ids FROZEN (§5); schema ADDITIVE-ONLY (§8); DI names STABLE (§9); ACL ids FROZEN (§10); section titled "Migration & Backward Compatibility" (Deprecation Protocol step 5) | Compliant | § 10 |
| packages/ui/AGENTS.md, DS rules, packages/cache/AGENTS.md | CrudForm / DataTable / design tokens; cache strategy | N/A | § 7 (no UI, no cached read) |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | § 6, § 7 |
| API contracts match UI/UX section | N/A | no UI |
| Risks cover all write operations | Pass | § 9, § 12 |
| Commands defined for all mutations | Pass | § 4 (Commands & Events) |
| Cache strategy covers all read APIs | N/A | no cache |
| Worked examples agree with the rules | Pass | § 5 |
| One name per concept | Pass | § 4 |
| External platforms are named in the Market Reference paragraph only; no external document is cited | Pass | § 1 |
| Design decisions and the alternatives considered are in § 3; § 14 lists the deferred items | Pass | § 3, § 14 |

### Non-Compliant Items

- Root `AGENTS.md` (event ids `module.entity.action`, singular entity and past tense): `sales.tax.document.calculate.before` / `.after` follow the `.before/.after` lifecycle shape of `sales.document.calculate.*` (`events.ts`) and the other calculation lifecycle pairs; proposed deviation.
- `.ai/review-checklist.md` (every command undoable): `sales.settings.save` writes an audit entry and no undo, as every existing settings command; recorded deviation (§ 4.4).
- Root `AGENTS.md` (ask before introducing provider-specific preconfiguration outside the provider package): `sales/di.ts` registers the test-only `tax_stub` provider under `OM_TEST_MODE=1` (§ 17), because a Playwright spec cannot register a provider in the detached application process; recorded deviation.

### Verdict

- **Compliant with three recorded deviations** (the lifecycle event-id shape, the non-undoable settings command and the test-only provider registered from core, above) — additive on every contract surface; no behaviour change without a configured provider for a document without a provenance record; route-level coverage of the settings route, the default path and the provider path.

---

## Changelog

### 2026-10-03
- Initial proposal; status proposed; submitted in one PR with the roadmap `2026-10-03-tax-providers-roadmap.md`.

### Review — 2026-10-04
- **Reviewer**: Agent (spec review and readiness audit against `develop` @ `4fc4b65c8`)
- **Security**: Passed — mutation guards on the settings route; no request data in error reports
- **Performance**: Passed — one provider call per write
- **Cache**: N/A — no read API
- **Commands**: Passed — no new command
- **Risks**: Passed — the provider path runs end to end under `tax_stub`
- **Verdict**: Approved

### 2026-10-05
- Pull request review (#6918): `rounding` on the result and in the record, charge tax and invoices, and the persisted exemption facts and the stop after an issued invoice routed to Spec 4a, Spec 4b and Spec 3.

### Review — 2026-10-05
- **Reviewer**: Human (pull request review #6918 by the financial module contributors)
- **Security**: Passed — the record gains only `rounding`
- **Performance**: Passed — unchanged
- **Cache**: N/A — no read API
- **Commands**: Passed — no new command
- **Risks**: Passed — `rounding` is informational
- **Verdict**: Approved — findings resolved or routed to the owning specification

### 2026-10-06
- Readiness audit against `2c7a42b20`: line rows persisted by the adjustment and header-update commands, the header-state derive step, decrypted reads scoped in `where`, and the abandoned-call handler.

### Review — 2026-10-06
- **Reviewer**: Agent (readiness audit against `2c7a42b20`)
- **Security**: Passed — the decrypted channel-address read is scoped in `where`
- **Performance**: Passed — unchanged
- **Cache**: N/A
- **Commands**: Passed — line rows persisted under an applied result
- **Risks**: Passed — the outage radius registered as High
- **Verdict**: Approved

### 2026-10-07
- Second review round (#6918) and a readiness audit against `7e34001dc`: the storage contract (§ 6), charge rows persisted by the line commands, one definition of `effectiveRate`, and the per-rate-group split of a charge's tax deferred (§ 14 item 7).

### Review — 2026-10-07
- **Reviewer**: Human (second round of #6918) and Agent (readiness audit against `7e34001dc`)
- **Security**: Passed — no personal data in the record
- **Performance**: Passed — unchanged
- **Cache**: N/A
- **Commands**: Passed — charge rows persisted by the line commands under an applied result
- **Risks**: Passed — the storage contract names every place a result lands
- **Verdict**: Approved

### 2026-10-12
- Re-pinned to `develop` @ `7ea720142`; the built-in provider of Spec 2 is named `sales-tax-rates` and Spec 3's policy value `fallback-sales-tax-rates`.

### 2026-10-13
- The amounts and flags of an exempt or reverse-charged line fixed (tax 0, the base kept, `effectiveRate` 0, at most one flag; § 4.3, § 4.10), with the OSS applicability rule named as what stays outside (§ 19); re-pinned to `develop` @ `de5b22888`.

### Review — 2026-10-13
- **Reviewer**: Agent (spec review and readiness audit against `19d2b801f`)
- **Security**: Passed — no certificate or exemption number in the record
- **Performance**: Passed — unchanged
- **Cache**: N/A
- **Commands**: Passed — no command added
- **Risks**: Passed — a flagged line's zero tax is the provider's checked outcome
- **Verdict**: Approved

### 2026-10-14
- Re-pinned to `develop` @ `3346415f9`.

### 2026-10-22
- Re-pinned to `main` @ `9dfdaf8bd`, the trunk every pull request targets.

### Review — 2026-10-22
- **Reviewer**: Agent (pull request review of `5e8952360` and readiness audits against `main` @ `9dfdaf8bd`)
- **Security**: Passed — the provenance reader selects no provider
- **Performance**: Passed — the shipping provider runs in the first pass only
- **Cache**: N/A — the index refresh follows the repository lesson
- **Commands**: Passed — the return paths write header totals only
- **Risks**: Passed — kept shipping rows keep the header tax equal to the stored rows
- **Verdict**: Approved

### Review — 2026-10-29
- **Reviewer**: Agent (pull request re-review of `150b30226`)
- **Security**: Passed — unchanged
- **Performance**: Passed — unchanged
- **Cache**: N/A
- **Commands**: Passed — the Apply step compares the second pass with the request
- **Risks**: Passed — a second pass that differs from the request fails closed
- **Verdict**: Needs revision — the unit gross and the second-pass comparison, both addressed (§ 4.10, § 4.2)

### 2026-10-31
- Re-pinned to `main` @ `e04ffd226`, with line numbers dropped from every citation; the facts of #8216 (the external amounts mode on the default-state path), #6925 (the document-row lock and the check under it, under which the default state keeps calculating as today), #8050 (the bulk line command, the thirteenth recalculating command) and #7592 (cart routes without a `tax` slot) applied. The text is cut to the design's unique content, with one home section per rule. A provider write re-taxes a line with shipped quantity outside the shipped-line guard, whose restore check refuses the undo of such a write (§ 4.10, CT-26). On a caller's write to a shipped line under a provider the guard skips the inputs the provider overwrites (§ 4.10, CT-27), and the refusal under a provider covers rated credits as § 4.8 states (§ 4.2, § 7, F6, § 17).
