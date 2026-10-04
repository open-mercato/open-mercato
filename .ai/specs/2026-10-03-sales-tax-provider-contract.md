# Sales Tax Provider Contract

Status: **proposed — decision requested**. No implementation lands until § Decision Requested is answered.
Roadmap: [Tax Providers — Roadmap & Boundaries](./2026-10-03-tax-providers-roadmap.md) (this is Spec 1 of that roadmap; its ADR-1 … ADR-4, ADR-10 and ADR-12 are the positions this specification details).
Scope: `packages/core/src/modules/sales/{lib/calculations.ts, lib/types.ts, lib/providers/{totals,index}.ts, lib/tax/* (new), commands/documents.ts, commands/settings.ts, api/settings/tax-provider/route.ts (new), data/entities.ts (SalesSettings only), data/validators.ts (one additive export), di.ts (flag-gated `tax_stub` registration), events.ts, migrations/*, i18n/*}`; docs `apps/docs/docs/user-guide/taxes.mdx`, `apps/docs/docs/framework/pricing-tax-overrides.mdx`, `apps/docs/docs/framework/modules/sales/calculations.mdx`, `apps/docs/docs/framework/modules/sales-providers.mdx`, `apps/docs/docs/framework/modules/sales/events.mdx`, `apps/docs/docs/user-guide/sales/sales-settings.mdx`.
Related: [Sales `external` amounts mode](./2026-09-07-sales-external-amounts-mode.md) (precedent for this status line; parallel work), [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) ADR-2, [Pricing Engine](./2026-08-21-pricing-engine.md) (registry precedent), [Order payment-ledger input deprecation](./2026-08-01-sales-order-payment-ledger-input-deprecation.md) (precedent for an accepted-but-overwritten input), [SPEC-024 §10.2](./SPEC-024-2026-02-11-financial-module.md), [SPEC-045](./implemented/SPEC-045-2026-02-24-integration-marketplace.md), [Address-level contact details and tax identifiers](./2026-08-10-address-contact-and-tax-fields.md).
Verified against: `develop` @ `7f0ebf653` (2026-10-02). Line numbers are pinned to that commit and drift; the symbol or command id beside each is the durable identifier. Paths are under `packages/core/src/modules/sales/` unless stated.

## TLDR

**Key Points:**
- The `sales` totals pipeline gets a document-level seam, a **tax phase**, through which the tax provider configured for the organization computes line and charge tax (proposed). A built-in `product-rate` strategy reproduces today's behaviour exactly, so an organization without a configured provider sees no change in any line, adjustment, total or `tax_info`.
- The contract is three types and a registry (`TaxProvider`, `SalesTaxRequest`, `SalesTaxResult`; `registerTaxProvider` / `getTaxProvider` / `listTaxProviders`), one additive nullable settings column (`sales_settings.tax_provider_key`), one new settings route, two new event ids and server-written provenance on documents (`tax_strategy_key` = `tax-provider:<providerKey>` on orders, `tax_info` = the provenance record on orders and quotes). No document or line table changes; no new command.
- A remote provider is called in the command layer outside the write transaction (the Resolve step) and its result is applied inside the transaction after a server-side fingerprint comparison (the Apply step); one retry, then fail-closed (409, nothing written) on a create and on an update alike; `stale` stays reserved for Spec 4b. The unit seam (`taxCalculationService`, `sales.tax.calculate.*`) stays unchanged as the predecessor.

**Scope:** the tax phase and its ordering (Option B, Option A as the fallback); the contract and the registry; the organization-level provider setting and its route; `product-rate`; the Resolve and Apply steps, the fingerprint and the status vocabulary; provenance; exemptions as vocabulary only; one sentence on calculation modes; docs. Out of scope and pointed at later specifications in § 19: line detail columns and owner-resolved facts (Spec 4a), wider recalculation triggers and the stored-tax carry-over fix (Spec 4b), the built-in table provider (Spec 2), the gateway module and credentials (Spec 3), net/gross presentation (Spec 5), cart, checkout and POS (6a, 6b), OSS and reverse-charge logic, any UI, provenance fields in the read API.

**Acceptance tests (detailed in § 17):**
1. With no provider configured for the organization (`sales_settings.tax_provider_key` is `NULL`, or the settings row is missing), every existing fixture, command and API path produces byte-identical lines, adjustments, totals and `tax_info`.
2. A test-only fake provider declared inside the test file sets line tax, charge tax and the provenance record in `tax_info` on quote and order create and update.
3. The provider setting is organization-level: changing it changes how every later calculation of that organization's quotes and orders runs; no field on a document changes how that one document is calculated, and the document's `tax_strategy_key` and `tax_info` only record what produced its amounts.
4. `taxCalculationService` and the `sales.tax.calculate.*` events keep working unchanged.

**Concerns:** the single provider totals hook rebuilds the document from its `lines` argument (`lib/providers/totals.ts:191-197`), so the phase lives inside it (Option B) or the hook is split (Option A); stored line tax is fed back as an explicit input on every recalculation (`lib/lineSnapshots.ts:59-67`), so a provider overwrites it deliberately and the carry-over fix stays a later specification; `tax_info` is client-writable on create, so it is output-only by contract and never read as authority; the open externally taxed amounts mode touches the same files and is parallel work only; the provider path cannot be exercised by an integration test without a provider in the running application, so its integration coverage arrives with Spec 2.

---

## 1) Overview

Give the `sales` totals pipeline a document-level seam through which the tax provider configured for the organization computes line and charge tax, with a built-in `product-rate` strategy that reproduces today's behaviour exactly, so that an external provider package (for example an adapter for one of the engines the sales user guide already names, `apps/docs/docs/user-guide/taxes.mdx:52`) and a later built-in table provider (Spec 2, working name `tax-destination-table-rate`) can plug in without further engine changes. This PR is the first contact on the topic: the specification is additive, changes no behaviour unless a provider is configured, and shows every contested point as a proposal with alternatives and exactly four Decision Requested items.

Who needs it: a merchant selling in the United States or on another market where the rate is computed at calculation time from the ship-to address, the product's tax code and the customer's exemption facts, per jurisdiction, with an estimate on the quote and a recorded figure on the order; and every other merchant, who must notice nothing.

> **Market Reference**: this specification names no other platform, framework or library. The reference is the business need stated in the roadmap's Overview, and the two external tax engines the repository already names as the thing to plug in (`apps/docs/docs/user-guide/taxes.mdx:52`, `apps/docs/docs/framework/pricing-tax-overrides.mdx:157`: Avalara, TaxJar). What the design adopts, as the author's reasoning: a default strategy plus a replaceable provider; tax as a late phase of the totals pipeline, after the charges it must tax and before the fees computed on the gross total; one provider call per document write, never one per line; per-line results that carry the provider's identity, the effective rate and the jurisdiction breakdown; an explicit tax-inclusive flag per line; an explicit result status; amounts written verbatim and never re-derived from a rate. What it rejects: a separate tax module, a rates-only contract, and a silent zero or silent fallback on failure.

---

## 2) Problem Statement (the seams this specification touches)

1. **One hook, two blocks, no step between them.** `ensureProviderTotalsCalculator` registers the only core totals hook (`lib/providers/totals.ts:179`, `:183`); the hook drops non-manual provider adjustments (`:188-190`), rebuilds `working` from its `lines` argument (`:191-197`), runs shipping (`:199`) and then payment (`:282`), and payment providers compute fees on `document.totals.grandTotalGrossAmount` (`lib/providers/defaultProviders.ts:128`, `:194`). The only ordering primitive is registration order with `prepend` (`lib/calculations.ts:351-352`, `:498-503`). A separately registered hook therefore runs either before shipping exists or after payment fees were computed on an untaxed gross.
2. **Line tax is explicit-or-derived, and stored tax comes back as explicit.** `buildBaseLineResult` (`lib/calculations.ts:118`) uses an explicit `taxAmount` verbatim (`:164-167`), honours a supplied `totalGrossAmount` verbatim (`:168-171`) and derives tax from gross minus net only when tax was not explicit (`:177-180`); `mapPersistedLine` feeds stored `taxAmount` and `totalGrossAmount` back with `totalsFromStoredRow: true` (`lib/lineSnapshots.ts:59-67`); both line upserts keep `parsed.taxAmount ?? existingSnapshot?.taxAmount` (`commands/documents.ts:7575`, `:8067`). The document tax total is line tax plus `tax`-kind adjustments plus the tax portion of adjustments with `metadata.taxRate` (`lib/calculations.ts:213-222`, `:245-246`, `:256-259`); `round` keeps 4 decimals (`:25`) and `NET_RECONCILIATION_TOLERANCE` is 0.005 (`:33`).
3. **No context, no setting, no provenance reader.** `SalesCalculationContext` is `{ tenantId, organizationId, currencyCode, metadata?, resolve? }` (`lib/types.ts:160-166`); `buildCalculationContext` sets no address, customer, channel or date (`commands/documents.ts:2967`); `resolve?` is declared and never populated. `SalesSettings` holds number formats and two status lists only (`data/entities.ts:755`). `tax_strategy_key` and `tax_info` on orders (`:397`, `:403`) and `tax_info` on quotes (`:896`) are accepted on create (`data/validators.ts:703`, `:705`, `:756`), stripped on update by `documentUpdateSchema` (`commands/documents.ts:603`), written as `null` and copied by conversion (`:6773`, `:6775-6777`), restored by undo, and read by nothing. The document list routes return neither field (`api/documents/factory.ts:387-424`).
4. **Transactions and locks.** Creates and the line and adjustment commands calculate before `withAtomicFlush` (`commands/documents.ts:5191` before `:5207`; `:6259` before `:6276`; `:7639` before `:7654`; `:8131` before `:8145`); the two header updates calculate inside it (`:5610`, `:5873`, under `withAtomicFlush(..., { transaction: true })`); conversion (`:6673`), public acceptance (`api/quotes/accept/route.ts:99`) and undo (`commands/documents.ts:4100`, `:4557`, `:4564`, `:5352`) hold `PESSIMISTIC_WRITE` locks and never calculate; the returns paths lock the order lines (`commands/returns.ts:604`, `:439`) and calculate under the lock (`:724`, `:538`).
5. **The unit seam is a converter.** `CalculateTaxInput` carries an amount, a mode, the tenant scope and a rate id or raw rate (`services/taxCalculationService.ts:8-15`); `resolveRate` finds a `SalesTaxRate` by id (`:92`); the line upserts call it only to fill a missing price side (`commands/documents.ts:7458`, `:7951`). The docs point external engines at it (`apps/docs/docs/user-guide/taxes.mdx:52`, `apps/docs/docs/framework/pricing-tax-overrides.mdx:157`), and the documented totals-hook example reads `context.countryCode`, which the type does not declare (`apps/docs/docs/framework/pricing-tax-overrides.mdx:75`).

---

## 3) Proposed Solution

A `tax` phase inside the provider totals calculator, between the shipping and payment blocks; a contract and a registry in `sales` under `lib/tax/`; an organization-level provider setting; `product-rate` as the built-in default; the Resolve and Apply steps around the write transaction with a server-side fingerprint; provenance on documents; four Decision Requested items.

### Design Decisions (proposed defaults)

| Decision | Rationale |
|---|---|
| The tax phase is a fixed step inside the provider totals calculator (Option B; the default of DR-2) | The hook rebuilds from its `lines` argument and runs both blocks itself (`lib/providers/totals.ts:191-197`, `:199`, `:282`), so "after shipping, before payment" is reachable only from inside it; no public signature changes |
| Resolve outside the transaction, Apply inside after a fingerprint comparison | Two header updates calculate inside a transaction and the returns paths calculate under row locks (§ 2 point 4); a network call must hold neither |
| Provider selected per organization in `sales_settings`; documents carry provenance only | A free-text, client-writable document field cannot be an authority; quotes have no `tax_strategy_key` column; one nullable column is reversible |
| `product-rate` registered but short-circuited | `listTaxProviders()` shows the default; the phase writes nothing under it, so existing fixtures stay byte-identical |
| Explicit status vocabulary and a document-level `taxTotalAmount` in the result | The consistency rule needs an anchor; a provider's document-level rounding can differ from the sum of line tax (§ 5.6) |
| `tax_info` content rule: provenance and results only, never addresses, names or tax ids | `tax_info` is not in the sales encryption map (`encryption.ts` encrypts the address snapshots, `:8-9`, `:25-26`); the record stays safe in clear |
| Fail closed in this specification (the default of the Ask First paragraph, § 4.13) | No gateway policy exists yet; a silent zero is the known failure class |
| New registry on `globalThis` (the default of DR-4) | The repository lesson (`.ai/lessons/global-registries-in-publishable-packages-must-use.md:14`) and the pricing registry precedent (`packages/core/src/modules/catalog/lib/pricing.ts:193`, `:215`) |

### Alternatives Considered (not proposed)

| Alternative | Why Rejected |
|---|---|
| Option C: no phase; resolve before `calculateDocumentTotals` and feed tax through explicit `taxAmount` and `metadata.taxRate` in a second pass | The provider calculator regenerates its adjustments on every run (`lib/providers/totals.ts:188-190`), so tax placed on them through metadata is lost; shipping charges created by the first pass cannot be taxed consistently; no seam for a status or a provenance record |
| The documented unit seam (DI swap of `taxCalculationService`, `setResult()` in `sales.tax.calculate.before` or `sales.document.calculate.after`) | The seam carries six scalar fields (`services/taxCalculationService.ts:8-15`), the engine never calls it, `sales.document.calculate.after` fires after payment fees (`lib/calculations.ts:437-448`), and a subscriber runs inside the transaction on header updates |
| A separate tax module (the alternative named in DR-1) | Collides with the ecommerce suite roadmap's ADR-2 (`2026-08-14-ecommerce-suite-roadmap.md:175-179`) and with the names of the parallel period-level work; needs a cross-module workflow layer that does not exist |
| Per-document provider selection through a namespaced `tax_strategy_key` | Quotes have no such column (`data/entities.ts:896` is `tax_info` only); the update schema strips the field; conversion writes `null`; a client-writable input would become an authority |
| A jsonb settings bag instead of one column | Schemaless, no database-level validation; the two existing jsonb columns are typed status lists (`data/validators.ts:82-86`) |
| Provider results in line and adjustment `metadata` | Client-writable, overwritten by client edits, and provider adjustments are regenerated on every run |
| `estimate` only (no intent in the type) | A provider written against this contract would assume every call is an estimate, and `display` (never remote) could not be expressed for the cart |
| Fail open or fall back to `product-rate` | A figure the provider did not compute becomes an invoice amount; recorded as the alternative in the Ask First paragraph of § 4.13 |
| Module-local `Map` for the new registry (the fallback of DR-4) | The failure class the lesson names (a provider registered in one module instance invisible to another) |

---

## User Stories / Use Cases

- **A merchant on a fixed-rate market** wants nothing to change, so that existing quotes and orders keep their totals, their stored tax and their `tax_info` byte for byte (acceptance test 1).
- **A merchant on a destination-tax market** wants to configure one provider for the organization, so that every later quote and order of that organization is taxed by it, with the estimate on the quote and the recorded figure on the order (acceptance tests 2 and 3).
- **A provider package author** wants one typed contract and a registry, so that an adapter for an external engine plugs into the totals pipeline without engine changes and without reading document rows itself (§ 4.3, § 4.17).
- **A back-office user** wants a clear error instead of a silently untaxed document when the provider is unavailable (§ 4.13).
- **An auditor** wants each provider-taxed document to show which provider produced its amounts, with the jurisdiction breakdown and the inputs fingerprint (§ 6).
- **The authors of the later specifications** (Spec 2, Spec 3, Spec 4a, Spec 4b) want the vocabulary and the optional fields reserved now, so that their additions stay additive (§ 4.3, § 19).

---

## 4) Architecture

Vocabulary, one name per concept: *provider key* is the registry key of a `TaxProvider` (for example `product-rate`); *strategy key* is the string the server writes into `tax_strategy_key` as provenance (`tax-provider:<providerKey>`); a *charge* is an order-scope adjustment of kind `shipping`, `surcharge`, `custom` or any operator-defined kind (`SalesAdjustmentKind` admits any string, `data/entities.ts:10`) with `amountNet ≥ 0`; an adjustment of kind `custom` or of an operator-defined kind with `amountNet < 0` is a *credit*, not a charge (those kinds carry an operator-controlled sign, `data/validators.ts:465-482`, `lib/calculations.ts:277-293`); the *provenance record* is the content of `tax_info`; the *tax phase* is the step of the totals pipeline (an implementation phase is a delivery phase; a flush phase is a phase of `withAtomicFlush`); the *Resolve step* and the *Apply step* are the two steps of the command layer (prose names, never identifiers); `SalesTaxContext` is the `tax` slot of the calculation context and is not the `TaxContext` of SPEC-024 (`SPEC-024-2026-02-11-financial-module.md:774`, which is closer to this specification's `SalesTaxRequest`); the intent `display` is not the catalog `displayMode`.

### 4.1 The tax phase (Decision Requested DR-2)

**Option B (default).** Inside `ensureProviderTotalsCalculator`, between the shipping block (`lib/providers/totals.ts:199`) and the payment block (`:282`), the hook calls a new `applyTaxPhase({ documentKind, lines: working.lines, adjustments: runningAdjustments, context, current: working })` and rebuilds through `rebuildDocumentResult` (`lib/calculations.ts:505`). The phase reads `context.tax` (§ 4.3): with no `tax` slot (the case under `product-rate`, which skips the Resolve step) it returns its input unchanged (identity) apart from the charge carry-over of § 4.8; with a slot that carries no `result` (the first pass under a provider, § 4.2) it does the same and records the lines and charges it sees at its position on `context.tax.captured` (§ 4.3), which is how the command learns the request's line and charge set without a third pass; with a result it writes per-line `taxAmount` and `grossAmount = netAmount + taxAmount` for every line, including a gross-entered one (§ 4.10), per-charge `amountGross = amountNet + taxAmount`, `metadata.taxRate` and the marker `metadata.taxProviderKey` (merged into the existing provider metadata, never replacing other keys), and never touches `totals` directly, with one explicit exception: the neutralized rebuild of § 4.8 for `tax`-kind and discount adjustments. No public signature changes.

Rules for third-party totals calculators under Option B, stated in the docs page that shows appended calculators (`apps/docs/docs/framework/modules/sales/calculations.mdx:39-45`), which does not mention tax today: a calculator registered with `prepend: true` runs before the provider hook, so a charge it adds to `current.adjustments` enters the tax request, while its edits to `current.totals` or a replaced `current.lines` array are rebuilt away by the provider hook, as today (`lib/providers/totals.ts:191-197`; the documented fee example, `apps/docs/docs/framework/pricing-tax-overrides.mdx:66-90`, edits totals only and prepends at `:89`, so its fee is discarded today); a calculator appended after the provider hook runs after tax, sees taxed totals, and charges it adds stay untaxed by the provider. Payment fees computed by the payment block see the tax-inclusive gross (`lib/providers/defaultProviders.ts:128`, `:194`).

**Option A (fallback, if the maintainers want an explicit phase API now).** `registerSalesTotalsCalculator(hook, opts)` gains optional `{ id?: string; phase?: 'charges' | 'tax' | 'post-tax' }` (additive on the existing `{ prepend?: boolean }`, `lib/calculations.ts:351`, `:498`); the provider calculator splits into a `charges` registration (shipping) and a `post-tax` registration (payment); hooks without `phase` keep today's position (appended after the payment step; `prepend: true` before the shipping step); the instance method `salesCalculations.registerTotalsCalculator` (`:351`, reachable through the exported singleton `:477`) changes in step.

**Option C (rejected).** See Alternatives Considered.

Under either option the phase holds the consistency rule of § 4.10 and never adjusts a provider amount silently.

### 4.2 The Resolve step and the Apply step

- **Resolve (command layer, outside `withAtomicFlush` and `em.transactional`).** The command runs a first calculation pass on the future state of the document (today's pass, with `context.tax = { strategyKey, intent }` and no `result`, which the phase treats as identity plus capture, § 4.1), which yields post-discount line nets and the order-scope charges present at the tax phase's position (after the shipping block, before the payment block, `lib/providers/totals.ts:199`, `:282`); that set is the request's charge set, so `payment-provider:` surcharges, added after the phase's position (`:282-331`), and charges from appended calculators never enter the request or the fingerprint; it reads the organization's setting with `loadSalesSettings` (`commands/settings.ts:28-31`; a missing row or a `NULL` column means `product-rate`); for `product-rate` it stops here and the single pass is the final one. Otherwise it resolves the provider by key (`getTaxProvider`; an unregistered key fails closed, § 4.13), builds `SalesTaxRequest` (§ 4.11), computes the fingerprint (§ 4.15), emits `sales.tax.document.calculate.before` (§ 4.16), calls `provider.calculate(request, ctx)` under a deadline (§ 4.13), validates the result (§ 4.10, § 9 F3–F6), emits `sales.tax.document.calculate.after`, and keeps the result in memory.
- **Apply (inside the write transaction).** The command recomputes the fingerprint from the header inputs of the state being written (addresses, customer facts, date, currency, intent) plus the lines and charges the phase captured on `context.tax.captured` during the second pass (§ 4.1, § 4.3), after that pass and before the first flush of `withAtomicFlush`; hashing stays in the command layer and the phase never hashes; it compares that fingerprint, and on a match passes the result through `context.tax = { strategyKey, intent, result }` to the second calculation pass, where the tax phase writes the amounts (§ 4.1); the command then persists lines, adjustments, totals, `tax_strategy_key` (orders) and `tax_info` (orders and quotes).
- **Mismatch and retry.** On a mismatch the Apply step throws an internal signal (working name `SalesTaxInputsChanged`); `withAtomicFlush` rolls back every phase of the attempt (`packages/shared/src/lib/commands/flush.ts:172-183`); the command catches the signal outside the transaction, re-reads the document on a fresh `EntityManager` fork, rebuilds the future state, runs Resolve once more outside any transaction, and opens a second transaction for Apply. On a create the retry reuses the document id and number claimed before the first pass (`commands/documents.ts:5014`, `:6063`; number at `:4983-4993`, `:6031`) and never claims a second number. A second mismatch, on an **update** as on a **create**, fails closed: the command errors with 409 `sales.tax.errors.inputs_changed` and nothing is written. The alternative, committing the update with the stored amounts under a `stale` record, was dropped: the update response (`api/documents/factory.ts:210-250`) and the list API (`:387-424`) expose no `tax_info` field, so a client could not see that the amounts were not the provider's; `stale` stays in the vocabulary for Spec 4b's trigger-based staleness. Normal case: one provider call, two calculation passes, one transaction; worst case: two calls, four passes, two transactions; the existing calculation lifecycle events fire once per pass (§ 4.16).
- **Header updates** (`sales.quotes.update`, `sales.orders.update`) calculate inside the flush today and only when `shouldRecalculateTotals` is true (`commands/documents.ts:5522`, `:5797`: shipping method, payment method or currency); under a configured provider the command runs Resolve before entering `withAtomicFlush`, on the future state, and Apply in the existing in-transaction pass.
- **Returns** (`sales.returns.create`, the return undo and redo helpers) recalculate order totals under `PESSIMISTIC_WRITE` locks with stored line tax (`commands/returns.ts:604` then `:724`; `:439` then `:538`) and build their own context (`:156`): in this specification they run no provider call; the tax phase runs without `context.tax` and only carries the stored charge tax over (§ 4.8), so a return on a provider-taxed order keeps the order's charge tax; re-taxing returns is Spec 4b.
- **Conversion and public acceptance** run no provider call (§ 4.14). **Undo** restores snapshots that carry amounts and provenance together (`commands/documents.ts:1716`, `:2003-2005`, `:4157-4159`, `:4667-4671`) and never calls a provider; a restored document keeps the old provenance with the old amounts, and the next recalculating write applies the current setting. **Redo** re-executes the command and calls the provider again, which is safe because `calculate` has no provider-side effect (§ 4.7).
- **Every recalculating command forks its own `EntityManager`** at its start (for example `commands/documents.ts:5000`, `:6043`, `:7419`), and `withAtomicFlush` joins an active transaction only when one exists (`packages/shared/src/lib/commands/flush.ts:158-171`), so Resolve runs outside any transaction even when an inbox action, a workflow step or the warranty module dispatches the command. Conversion is the exception that uses the caller's `transactionalEm` (`commands/documents.ts:6657-6660`), and it has no Resolve.

### 4.3 Contract types

Location (proposed): `lib/tax/` with `types.ts`, `registry.ts`, `phase.ts`, `productRate.ts`, `fingerprint.ts`; values exported from a new entry `lib/tax/index.ts`, types re-exported from `lib/providers/index.ts`. Reason for the split: the `lib/providers` barrel is imported by two `"use client"` components (`components/PaymentMethodsSettings.tsx:1`, `components/ShippingMethodsSettings.tsx:1`) and by `data/validators.ts:6`, so value exports from it reach the browser bundle; server-only code (fingerprint hashing with `node:crypto`) must not be reachable from the barrel. Alternative: everything inside `lib/providers/` with the same server-only rule.

```ts
type SalesTaxIntent = 'display' | 'estimate' | 'record'
type SalesTaxStatus =
  | 'calculated' | 'estimated' | 'exempt' | 'not_applicable'
  | 'stale' | 'failed' | 'fallback' | 'overridden'
type SalesTaxJurisdictionLevel = 'country' | 'state' | 'county' | 'city' | 'special' | 'other'

type SalesTaxAddress = {
  addressLine1?: string | null; addressLine2?: string | null; city?: string | null
  region?: string | null; postalCode?: string | null; country?: string | null
  companyName?: string | null; name?: string | null
  taxId?: string | null; taxIdType?: string | null
}

type SalesTaxRequest = {
  strategyKey: string                      // 'tax-provider:<providerKey>'
  intent: SalesTaxIntent
  documentKind: SalesDocumentKind          // existing union, data/entities.ts:7
  documentId?: string | null               // set on create too (ids are assigned before the first pass)
  documentNumber?: string | null
  tenantId: string; organizationId: string; channelId?: string | null
  currencyCode: string; exchangeRate?: number | null
  taxDate: string                          // ISO date, UTC; § 4.11
  pricesIncludeTax: boolean | 'mixed'
  shipTo?: SalesTaxAddress | null; shipFrom?: SalesTaxAddress | null; billTo?: SalesTaxAddress | null
  customer?: {
    id?: string | null
    taxIds: Array<{ value: string; type?: string | null }>
    groupIds?: string[] | null             // reserved: no source at head (Spec 4a)
  } | null
  lines: Array<{
    ref: string                            // line id, or 'n:<lineNumber>' on create
    kind: SalesLineKind                    // existing union, data/entities.ts:8
    productId?: string | null; productVariantId?: string | null
    description?: string | null
    quantity: number
    netAmount: number                      // after the line discount, before any document discount
    taxRateId?: string | null; taxRate?: number | null   // percentage points
    taxClassificationCode?: string | null  // unfilled in this specification (Spec 4a)
    priceMode?: 'net' | 'gross' | null
  }>
  charges: Array<{
    ref: string                            // adjustment id, or '<calculatorKey>@<position>'
    kind: SalesAdjustmentKind              // 'shipping' | 'surcharge' | 'custom'
    code?: string | null; label?: string | null
    amountNet: number
    taxRate?: number | null
    providerTaxCode?: string | null        // null in this specification (Spec 3)
  }>
  inputsFingerprint: string                // server-computed, § 4.15
}

type SalesTaxJurisdictionAmount = {
  level: SalesTaxJurisdictionLevel; code: string; name?: string | null
  rate: number                             // percentage points
  taxableAmount: number; taxAmount: number
  exemptAmount?: number | null; nonTaxableAmount?: number | null
}

type SalesTaxLineResult = {
  ref: string
  taxableAmount: number; taxAmount: number
  effectiveRate?: number | null            // percentage points
  isExempt?: boolean; exemptReason?: string | null; isReverseCharge?: boolean
  exemptAmount?: number | null; nonTaxableAmount?: number | null
  exemption?: { mechanism?: string | null; certificateId?: string | null; exemptionNumber?: string | null } | null
  jurisdictions?: SalesTaxJurisdictionAmount[]
}

type SalesTaxResult = {
  status: SalesTaxStatus
  providerKey: string; providerReference?: string | null
  taxTotalAmount: number                   // document-level total the consistency rule compares against
  lines: SalesTaxLineResult[]
  charges: Array<{ ref: string; taxableAmount: number; taxAmount: number; effectiveRate?: number | null; jurisdictions?: SalesTaxJurisdictionAmount[] }>
  jurisdictions?: SalesTaxJurisdictionAmount[]   // document roll-up, informational
  rounding: { level: 'line' | 'document'; decimals: number }
  messages?: Array<{ code: string; message: string; severity: 'info' | 'warning' | 'error' }>
  inputsFingerprint: string                // must echo the request's
}

type SalesTaxProviderContext = {
  tenantId: string; organizationId: string
  settings: Record<string, unknown>       // {} in this specification
  signal: AbortSignal                      // the deadline of § 4.13
  resolve?: <T>(name: string) => T         // typed now, wired by Spec 3
}

interface TaxProvider {
  key: string; label: string; description?: string
  settings?: ProviderSettingsDefinition    // reused from lib/providers/types.ts:29-33
  calculate(request: SalesTaxRequest, ctx: SalesTaxProviderContext): Promise<SalesTaxResult>
  // commit, adjust and void are not declared here: Spec 3 adds them as new optional methods,
  // because typing a reserved `unknown` member later would narrow it for implementers (BACKWARD_COMPATIBILITY.md:71)
}

type SalesTaxCapturedInputs = {
  lines: Array<{ ref: string; kind: string; quantity: number; netAmount: number; taxRateId: string | null; taxRate: number | null; priceMode: 'net' | 'gross' }>
  charges: Array<{ ref: string; kind: string; amountNet: number; taxRate: number | null }>
}
type SalesTaxContext = { strategyKey: string; intent: SalesTaxIntent; result?: SalesTaxResult | null; captured?: SalesTaxCapturedInputs }
// SalesCalculationContext gains `tax?: SalesTaxContext` (additive; lib/types.ts:160-166)
```

Contract rules a provider can rely on: `calculate` is side-effect free at the provider (it must not create, save, commit or otherwise persist a transaction there; a provider that needs a stored transaction waits for the method Spec 3 adds); every request line and charge `ref` appears exactly once in the result, no unknown `ref` appears; amounts are finite numbers, non-negative in this specification (credit documents with negative amounts are later); `taxRate`, `effectiveRate` and jurisdiction `rate` are percentage points, as `SalesTaxRate.rate` and the line `tax_rate` column (numeric 7,4; `data/entities.ts:640`, `:643`); an adapter whose engine reports fractions converts; consumers treat an unknown status value as `failed`, so a later added member does not break exhaustive switches; `jurisdictions[].level` uses the documented set, with `other` as the catch-all. The header addresses are document defaults; a later per-line address (Spec 4a) overrides them for that line. Line `netAmount` is after the line discount and before any document-level discount (§ 4.8).

### 4.4 Provider selection, the setting and provenance

- **The setting.** One additive nullable column `sales_settings.tax_provider_key` (`text`, entity property `taxProviderKey?: string | null`; `SalesSettings`, `data/entities.ts:755`, unique per `(organization_id, tenant_id)`); `NULL` means `product-rate`; a missing settings row means `product-rate` too, because the row is created at tenant setup for the initial organization only (`setup.ts:72-85`) and lazily by `sales.settings.save` for every other organization (`commands/settings.ts:75-84`). An explicit `product-rate` is stored as `NULL` (one representation).
- **The write.** A new route `GET`/`PUT /api/sales/settings/tax-provider` (§ 7) runs the existing command `sales.settings.save` (`commands/settings.ts:50`) extended with an optional `taxProviderKey`. Precision: the command parses `salesSettingsUpsertSchema` itself (`:52`), which requires both number formats (`data/validators.ts:89-90`) and strips unknown keys, and on update rewrites both formats (`commands/settings.ts:86-87`); so the optional field goes into the command's own input schema (a local `salesSettingsUpsertSchema.extend({ taxProviderKey })`, not the shared schema the document-numbers route exposes at `api/settings/document-numbers/route.ts:108`), the new route loads the current row and passes both number formats unchanged (the schema defaults when no row exists, as `api/settings/order-editing/route.ts:145-149` does), and the command writes the field only when it is present (`!== undefined`) on update and with `?? null` on create, following the two editing fields (`commands/settings.ts:81-82`, `:88-93`); otherwise every `PUT` of the two existing settings routes, which never send the field (`api/settings/order-editing/route.ts:128` parses a schema that strips it), would reset the provider to `NULL`. The key is validated against the registry at write time (`getTaxProvider`); an unknown key is rejected with 422 and nothing is written. No new command, so `commands/__tests__/registration.test.ts:125-129` stays unchanged.
- **Who may change it.** The route requires `sales.settings.manage` for `GET` and `PUT`, like every sales configuration route (`api/settings/order-editing/route.ts:28-29`, `api/settings/document-numbers/route.ts:27-28`, `api/tax-rates/route.ts:31-35`). Every default `employee` holds that feature (`setup.ts:54`), so any employee can change how every later document of the organization is taxed; this specification states it and proposes an audit entry (below); a narrower feature id (illustrative `sales.tax_providers.manage`, granted to `admin` only, following `sales.documents.number.edit`, `acl.ts:56-60`, `setup.ts:49`) is the alternative.
- **Audit.** `sales.settings.save` writes no action-log entry today (no `buildLog`, no `undo`). The implementation adds a `buildLog` that records the old and the new provider key when it changes (following the tax-rate commands, `commands/configuration.ts:1893-1898`); no undo for the setting in this specification (settings have no undo today); documents keep their provenance, so a switch is traceable per document.
- **Organization selection.** The settings routes take `scope?.selectedId ?? auth.orgId` (`api/settings/order-editing/route.ts:49`); the "all organizations" choice resolves to `selectedId: null` (`packages/core/src/modules/directory/utils/organizationScope.ts:290-295`) and a stale selection sets `selectionRejected` (`:396-410`), which these custom routes ignore, so today's settings writes fall back silently to the caller's home organization. The new route rejects both cases with 422 (`isAllOrganizationsSelection`, `packages/core/src/modules/directory/constants.ts:3-5`; precedent `rejectInvalidOrgSelection`, `packages/shared/src/lib/crud/factory.ts:1554-1587`). Alternative: today's fallback.
- **Resolution order at calculation time.** The document's own `tenantId` and `organizationId` (never the UI selection) → `loadSalesSettings` → the registered provider; otherwise `product-rate`. The setting is read in Resolve and again inside the Apply transaction, and the provider key is part of the fingerprint, so a change between the two reads is a mismatch (§ 4.2). A key that no longer resolves fails closed (§ 4.13).
- **Provenance on documents.** When a configured provider ran, the server writes `tax_strategy_key` = `tax-provider:<providerKey>` on orders and the provenance record into `tax_info` on orders and quotes (§ 6); under `product-rate` the server writes neither, so those documents keep byte-identical values. The prefix is a convention for server-written values, not a guarantee: a client can store the same shape on create under `product-rate`; the fields are never read as authority or as a fingerprint source, a record is trustworthy only together with the server-computed fingerprint of the same write, and a forged record can show up in the document history widget, which labels the field "Tax details" (`widgets/injection/document-history/widget.client.tsx:108`, `i18n/en.json:983`). Today's free-text values stay as they are and are never read. The prefix marks a document field, unlike `shipping-provider:` and `payment-provider:`, which mark an adjustment `calculatorKey` (`lib/providers/totals.ts:16-17`).
- **Client-supplied `taxStrategyKey` and `taxInfo` on create.** `orderCreateSchema` keeps accepting both (`data/validators.ts:703`, `:705`) and `quoteCreateSchema` keeps accepting `taxInfo` (`:756`); `data/validators.ts` is a convention file that must not be narrowed (`BACKWARD_COMPATIBILITY.md:53`). The values are stored as today when no provider runs (`commands/documents.ts:5039`, `:6095-6097`), overwritten by the server's provenance when a provider runs, and never read as authority or as a fingerprint source. This specification documents that overwrite rule and adds no deprecation marker and no warning: the inputs keep their effect for organizations without a provider. A maintainer may ask for the marker of the payment-ledger precedent (`2026-08-01-sales-order-payment-ledger-input-deprecation.md:128-136`) in review; § 14 lists it as an open point.
- **Not in the read API.** `GET /api/sales/orders` and `/quotes` list neither field today (`api/documents/factory.ts:387-424`); this specification exposes nothing; provenance is observable at command level and through the document history widget; API exposure is a later specification.
- **Ask First (configuration entity semantics, `packages/core/src/modules/sales/AGENTS.md:14`).** Adding a column to `SalesSettings` changes no existing semantics of statuses, methods, channels, price kinds, adjustment kinds or document numbers; the paragraph is here so a maintainer can object.

### 4.5 `product-rate`

Registered like any provider so `listTaxProviders()` shows it; its `calculate` reproduces the engine's line tax from `taxRate` (for tests); the phase short-circuits for it: no line writes, no charge writes except the marked carry-over of § 4.8 (which touches nothing for an organization that never had a provider), no `tax_info`, no events, one calculation pass. It is a protected built-in: `registerTaxProvider` with the key `product-rate` is ignored and no disposer removes it, so the byte-identical claim holds while the application runs. Proof: every existing `lib/__tests__/calculations.test.ts` case passes unchanged; a golden test replays the same fixtures with the phase enabled and asserts deep equality and string equality of the serialized result; the documented gift-line hook (`sales.line.calculate.after` setting `taxAmount: 0`, `apps/docs/docs/framework/pricing-tax-overrides.mdx:104-118`) keeps its effect (§ 17).

A document that carries a provider provenance record when the organization switches back to `product-rate` keeps that record (it still describes the stored amounts: the line carry-over keeps line tax and the phase carries the charge tax over, § 4.8); the next recalculating write under `product-rate` writes no new record; new lines get engine tax from their own rate. Alternative: clear `tax_info` on the first recalculating write under `product-rate`.

### 4.6 Calculation modes (one sentence)

The phase runs in the engine's normal calculation mode; a future mode that stores externally taxed amounts verbatim must skip the phase at the point where the shipping and payment provider steps would also be skipped, inside the provider totals calculator in `lib/providers/totals.ts` (no such guard exists at head: the calculator skips only per adjustment through `isManualOverride`, `:34`, `:203-206`, `:286-289`). No such mode exists at head; the merged specification `2026-09-07-sales-external-amounts-mode.md` is `proposed — decision requested` (`:3`) and its implementation is parallel work (§ 11). This specification designs on none of its field names.

### 4.7 Intents and statuses

- The command layer sets `estimate` for quotes and `record` for orders; `display` is reserved for cart and UI previews and must never trigger a remote call. The intent cannot be derived from the document kind, because the cart specification calls the engine with a quote-like document (`2026-08-14-cart-module.md:106`).
- `record` means that the platform stores the result on an order; it never asks a provider to record a transaction for filing. `calculate` is idempotent per document reference; nothing commits in this specification.
- Status written by the phase: `estimated` for intent `estimate`, `calculated` for intent `record`, `exempt` when every line is exempt (when at least one line is taxed the status is `calculated` or `estimated` and the exemption shows per line); `stale` reserved for Spec 4b and never written here (§ 4.2); `not_applicable` reserved; `failed` is reported in the error body and reserved as a stored status for the gateway specification's policies; `fallback` reserved for Spec 3; `overridden` written when a subscriber of `sales.tax.document.calculate.before` supplies the result or a subscriber of `sales.tax.document.calculate.after` or `sales.document.calculate.after` replaces it (§ 4.16).

### 4.8 Charges, adjustments and discounts

- Charges (§ 4 vocabulary: order-scope `shipping`, `surcharge`, `custom` or operator-defined adjustments with `amountNet ≥ 0`, present at the tax phase's position, § 4.2) enter the request with `ref` = the adjustment id, or `<calculatorKey>@<position>` for provider-generated adjustments (regenerated on every run, `lib/providers/totals.ts:188-190`, so their database id may not be stable; `position` is `10_000 + index`, `:105-129`). The Apply step writes `amountGross = amountNet + taxAmount` and `metadata.taxRate` (merged), which `buildBaseDocumentResult` already folds into `taxTotalAmount` (`lib/calculations.ts:245-246`, `:260-293`); the rate's value does not change the arithmetic, and a written `0` records "untaxed". A credit (a negative `custom` or operator-defined adjustment) stays out of the request and, like a document discount, carries no tax portion under a provider: its `metadata.taxRate` is ignored in the neutralized rebuild and its gross is taken as its net (the § 5.4 limitation applies to it too), so rules (b) and (c) of § 4.10 hold; under `product-rate` nothing changes. **Charge carry-over.** Provider adjustments are dropped and regenerated on every calculation (`lib/providers/totals.ts:188-190`), so a pass without a provider result (a return, a pass after switching back to `product-rate`, the first pass under a provider) would regenerate them untaxed while the lines keep their stored tax and the record still lists the charge tax. The phase therefore carries charge tax over from the existing provider adjustment rows it receives (`existingAdjustments`, `lib/calculations.ts:429`; matched by `calculatorKey` and position) onto the regenerated charges in every pass without a provider result, but only from rows that carry the Apply step's marker `metadata.taxProviderKey`: it carries the stored tax (`amountGross − amountNet`) and `taxRate` and sets `amountGross = regenerated amountNet + carried tax`, so a charge whose net changed (a flat-rate tier chosen by the new metrics, `lib/providers/defaultProviders.ts:252-256`) keeps a consistent gross. Unmarked rows are never touched: an organization whose shipping or payment methods are provider-backed has `shipping-provider:` and `payment-provider:` rows stored on every write (`commands/documents.ts:3585-3615`) without the marker, so nothing is carried for it and the pass-through stays byte-identical (UT-50 includes a fixture with an existing flat-rate row whose tier changes). This is the charge counterpart of the line carry-over, with the same limits, fixed together with it in Spec 4b.
- Payment surcharges created after the tax step stay untaxed in Option B and never enter the request or the fingerprint (§ 4.2); Option A would let a later specification tax them.
- **Ask First (adjustment kinds, `packages/core/src/modules/sales/AGENTS.md:14`).** Default: while the organization's setting names a provider, writing a `tax`-kind adjustment is rejected with a clear error; under `product-rate` it works exactly as today; a manual tax override is a later feature (`overridden` reserved). For `tax`-kind adjustments that already exist on a document when a provider is configured, the phase returns the adjustments unchanged and sets `totals` from a rebuild over a neutralized copy (the `tax`-kind amounts counted as 0; a document discount's or a credit's gross taken as its net), an explicit exception to "never touches `totals`" (§ 4.1), and records a `warning` message in the provenance record, so the provider's figure stands; no adjustment row is rewritten or removed, because the commands persist `calculation.adjustments` and remove every row missing from it (`commands/documents.ts:3585-3646`, `:3510-3512`), so dropping or zeroing a row would delete or rewrite user-entered data (stated again in § 6 and § 10). Alternative: keep accepting and folding them (`lib/calculations.ts:256-259`), which double-counts tax the provider already computed.
- **Document-level discounts.** `discount` adjustments of order scope reduce the tax total only through `metadata.taxRate` today (`lib/calculations.ts:248-255`). Under a configured provider they carry no tax portion in the neutralized rebuild of § 4.8 (their `metadata.taxRate` is ignored and their gross is taken as their net; the stored row is unchanged), so the tax total equals the provider's `taxTotalAmount`; the request does not allocate them to lines, so the provider taxes amounts before the document discount. That is a known limitation stated here with numbers (§ 5.4); allocating a document discount to lines before the request is Spec 4a. Under `product-rate` nothing changes.
- Negative `tax` adjustments stay rejected as today (`data/validators.ts:454-457`, `:479-480`).

### 4.9 Exemptions (vocabulary only)

Result lines carry `isExempt?`, `exemptReason?`, `isReverseCharge?` and the optional `exemption` reference; the document status `exempt` applies when every line is exempt. The request carries `customer.taxIds` from the address snapshots (`taxId`, `taxIdType`, the keys the address specification defined, `2026-08-10-address-contact-and-tax-fields.md:11`); no exemption storage, no checker, no owner decision (`customers/data/entities.ts` has no exemption field). The tax phase never skips a configured provider because of a customer state: a "tax-free" state, once it exists, is an input to the provider. The owner of exemption facts is a question for Spec 4a.

### 4.10 Units, rounding and the consistency rule

- `taxRate` is in percentage points; the engine keeps 4 decimals (`round`, `lib/calculations.ts:25-27`); the provider declares `rounding: { level, decimals }`; the engine writes the provider's amounts verbatim and never re-derives tax from a rate when amounts are given.
- Consistency rule, checked in Resolve on the raw result and again by the phase: (a) every request line and charge `ref` appears exactly once; (b) every amount is a finite, non-negative number; (c) per line and per charge, `taxableAmount + exemptAmount + nonTaxableAmount` equals the request's `netAmount` (or `amountNet`) within `NET_RECONCILIATION_TOLERANCE` (0.005, `lib/calculations.ts:33`), absent parts read as 0, so a result that taxes the wrong base fails; (d) the sum of line tax plus charge tax equals the result's `taxTotalAmount` within the same tolerance. A violation fails the command: nothing is written, `failed` is reported in the error body. `grossAmount = netAmount + taxAmount` is the write rule the phase enforces by construction, not a validation. The jurisdiction roll-up is informational and may differ from the line sum by a cent (§ 5.6).
- The Apply step writes the provider's `effectiveRate` into the line `tax_rate` column when returned, otherwise leaves the stored rate; `tax_amount` always comes from the provider. The stored rate matters for conversion, which re-derives a missing net from the stored gross and `taxRate` (`commands/documents.ts:6863-6865`; `commands/shared.ts:88-101`).
- A gross-entered line (`priceMode: 'gross'`) is taxed on the net the first pass derived from its gross (`lib/calculations.ts:121-125`); the Apply step writes `grossAmount = netAmount + taxAmount`, so under a provider the entered gross is not preserved. The request carries `priceMode` and `pricesIncludeTax` for the provider's information only; a gross-preserving split is a later specification (Spec 5 with Spec 4a).
- Currency precision stays at the engine's 4 decimals; a currency-aware precision is a question for a later specification, not a Decision Requested item.

### 4.11 Inputs

- **Addresses.** `shipTo` and `billTo` come from the header snapshots `shipping_address_snapshot` and `billing_address_snapshot` (orders `data/entities.ts:367`, `:370`; both encrypted, `encryption.ts:8-9`, `:25-26`) through a tolerant mapper that keeps the well-known keys of `SalesTaxAddress` and drops the rest; `SalesDocumentAddress` rows (`data/entities.ts:1855`) are not read, because the address commands never update the header snapshots and never calculate (`commands/documentAddresses.ts`, zero references). `shipFrom` comes from the document's channel address (`SalesChannel`, `data/entities.ts:16`, `:50`, encrypted `encryption.ts:59`), nullable; reads go through the decryption-aware loaders. The request lives in memory only.
- **Dates and money.** `taxDate` is the document's `placedAt` when set (`data/entities.ts:415` orders, `:890` quotes), otherwise the calculation time, as an ISO date in UTC; a seller time zone is a later specification. `currencyCode` from the document; `exchangeRate` from orders only (`data/entities.ts:376`; quotes have none).
- **Lines.** `ref`, `kind`, ids, `quantity`, post-discount `netAmount` (from the first pass), `taxRateId` and `taxRate` from the snapshot (`taxRateId` is accepted by `linePricingSchema`, `data/validators.ts:341`, but not persisted), `priceMode` from `metadata.priceMode` (`:340`), `description` from the line. `pricesIncludeTax` is `true` when every line is `gross`, `false` when every line is `net` or unset, `'mixed'` otherwise; create paths never store `priceMode` today, so most API-created documents read as net or unset.
- **Product and customer facts.** `customer.id` is `customerEntityId`; `customer.taxIds` from the snapshots; `taxClassificationCode`, `groupIds` and exemption facts are optional fields filled only from data already on the document or from an owner-module DI service resolved with a local `tryResolve` (service names chosen in Spec 4a with the `catalog` and `customers` owners); when no such service is registered the fields are `null` and the request still validates. This specification adds no cross-module ORM read (issue #6733, the cross-module data ownership audit, lists `sales` reading `customers` and `catalog` entities for remediation); `taxClassificationCode` has no reader in `sales` at head and stays unfilled.
- **`context.tax` carries the result only.** The engine passes the whole context to every totals hook and to `sales.document.calculate.before/after` (`lib/calculations.ts:412-435`, `:437-448`); the `SalesTaxRequest` never enters the context.

### 4.12 DI and credentials

`SalesTaxProviderContext.resolve` is typed now and wired by Spec 3 through the one context builder; `SalesCalculationContext.resolve` is declared (`lib/types.ts:165`) and never populated at head (`commands/documents.ts:2967`; `commands/returns.ts:156`). `product-rate` and the test fake need no DI. Credentials are out of scope; no credential, endpoint or account field is added to `sales_settings`. A third-party replacement of the DI service `salesCalculationService` (`di.ts:134-138`) that does not delegate to `salesCalculations` will not run the tax phase; the interface is unchanged, so this is stated, not a break.

### 4.13 Failure policy (Ask First paragraph)

Default: **fail closed**. A provider throw, a timeout, an invalid or inconsistent result, a foreign fingerprint echoed by the provider, or a configured key that no longer resolves fails the command with a clear error; the transaction never opens or rolls back; nothing is written. `failed` and `fallback` stay in the status vocabulary for the gateway specification's per-provider policies; `product-rate` cannot fail. Trade-off: fail closed blocks document edits of that organization during a provider outage. Alternatives: fail open (write the document with status `failed` and no tax) or fall back to `product-rate` with status `fallback` recorded in `tax_info`, which keeps editing possible but stores tax the provider did not compute. The write-time validation of the key and the error that names the setting are the mitigation for an uninstalled package.

Deadline (proposal, no external source recommends a value): 10 seconds per `calculate` call, enforced by core by racing `provider.calculate` against a 10-second timer that aborts the `signal` passed on the provider context and rejects with `provider_timeout` (the shared `withTimeout` helper alone aborts the signal and awaits the task, `packages/shared/src/lib/http/fetchWithTimeout.ts:62-83`, so by itself it bounds only a provider that honours `signal`; its own default is 15 seconds, `:16`); adapters must honour `signal` and abandon the call; the value equals two in-repository outbound timeouts (`packages/gateway-stripe/src/modules/gateway_stripe/lib/client.ts:17`, `packages/core/src/modules/communication_channels/lib/oauth-token.ts:30`); upper bound per command: two calls. Zero automatic retries of `calculate`; adapter-internal transport retries must fit inside the deadline. A provider may throw a typed error with a reason code (`invalid_request`, `unavailable`, `rate_limited`, `unauthorized`); any other throw is `unavailable`; the codes select the status, key and message of § 7. Per-organization configuration of the timeout and the policy is Spec 3.

### 4.14 Conversion and public acceptance (Ask First paragraph, Quote → Order flow, `packages/core/src/modules/sales/AGENTS.md:13`; the default changes nothing in the flow, the alternative would)

Default: `sales.quotes.convert_to_order` keeps today's copy semantics unchanged (line amounts, totals and `taxInfo` copied; `tax_strategy_key` stays `null`; no calculation; `commands/documents.ts:6773`, `:6775-6777`, `:6807-6818`, `:6861-6862`); the copied record keeps status `estimated`, and the order's first recalculating write under the provider writes the server key and a `record` result. The key is not carried on conversion because the server cannot tell a server-written quote record from one a client stored on create under `product-rate` (`taxInfo` is accepted verbatim, `data/validators.ts:756`, `commands/documents.ts:5039`; the fingerprint is an unkeyed hash of inputs a client knows, § 4.15), so carrying it would let a forged record become a server-written key once the organization selects that provider. Alternative (needs a server-only marker: a keyed fingerprint through `hashForLookup(canonicalJson, 'sales:tax_info')`, the peppered HMAC-SHA-256 of `packages/shared/src/lib/encryption/aes.ts:216-224`, keyed only when the lookup pepper is configured; out of scope here): carry `tax-provider:<providerKey>` when the current setting names the copied record's `providerKey`. The public accept route (`api/quotes/accept/route.ts:33-35`, `requireAuth: false`; lock at `:99`) changes nothing: no provider call runs under those locks or on the unauthenticated path. Honour-versus-re-quote policy is Spec 4b.

### 4.15 The fingerprint

Server-side only: canonical JSON with keys sorted at every depth, lines and charges sorted by `ref`, numbers rounded to 4 decimals before hashing, `null` and `undefined` omitted, hashed with SHA-256 and stored as lower-case hex. Inputs: the provider key, intent, `currencyCode`, `exchangeRate`, `taxDate`, `pricesIncludeTax`, the three mapped addresses, customer facts (id, tax ids, group ids), every line (`ref`, `kind`, `quantity`, `netAmount`, `taxRateId`, `taxRate`, `taxClassificationCode`, `priceMode`) and every charge (`ref`, `kind`, `amountNet`, `taxRate`). Never hashed: stored tax amounts (engine output read back from rows), client-supplied `tax_info`, names, comments, notes. The fingerprint proves that a result belongs to the inputs this write persists; it does not serialize two writers (§ 9 F11). A provider-declared sensitivity list is a Spec 4b refinement and never a way to omit lines. The hash covers addresses and tax ids and sits in clear in `tax_info`; a reader who knows every other input could test a guess of a tax id against it, which the other inputs make impractical; a keyed hash through `hashForLookup` (`packages/shared/src/lib/encryption/aes.ts:216-224`, peppered HMAC-SHA-256 when the lookup pepper is configured) is the alternative.

### 4.16 Events

Two additive ids in `events.ts`, declared with `createModuleEvents` next to the calculation lifecycle events (`events.ts:82-99`), `category: 'lifecycle'`, `excludeFromTriggers: true`, no `clientBroadcast`, no `portalBroadcast`:

- `sales.tax.document.calculate.before` — emitted by the Resolve step before `provider.calculate`, outside any transaction; payload `{ documentKind, documentId, organizationId, tenantId, providerKey, strategyKey, intent, inputsFingerprint, lines: [{ ref, netAmount }], charges: [{ ref, amountNet }] }` with `setResult(result)` to short-circuit the provider call (the same shape as the unit seam's `setResult`); a result supplied this way is validated like a provider result (§ 4.10) and recorded with status `overridden` under the configured provider key, never as that provider's `calculated` or `estimated` result; never addresses, tax ids, the customer snapshot or the raw request.
- `sales.tax.document.calculate.after` — emitted after validation, still outside the transaction; payload adds `status`, `taxTotalAmount` and per-`ref` amounts, with `setResult(next)` to replace the result; a replaced result is validated again and recorded with status `overridden`.

Neither fires under `product-rate`. Under a configured provider the existing calculation lifecycle events (`sales.line.calculate.*`, `sales.document.calculate.*`, the shipping and payment adjustment events) fire once per calculation pass, so twice per write and four times on a retry, the first pass outside the transaction on header updates; their payloads are unchanged and persistent subscribers must stay idempotent (`packages/events/AGENTS.md`). Both follow the `.before` / `.after` shape of the existing calculation lifecycle events rather than the past-tense rule of the root `AGENTS.md:206`, as `sales.document.calculate.before/after` do (`events.ts:82-83`); the alternative candidates `sales.document.tax.calculate.*` (extends the `sales.document.*` family) and the plural `sales.tax.adjustments.apply.*` (rejected: the phase writes line and charge tax, not adjustments) are recorded for the maintainers. `sales.document.calculate.after` still runs last inside the engine and can rewrite totals, as the overrides guide documents; a change of tax there marks the record `overridden`. Subscribers may see results of writes that later roll back, as with the existing calculation events.

### 4.17 The registry (Decision Requested DR-4)

State on `globalThis` under a stable key (working name `__openMercatoSalesTaxProviderRegistry__`), lazily initialized, following `getPricingRegistryState` (`packages/core/src/modules/catalog/lib/pricing.ts:199-205`) and the lesson for publishable registries; `registerTaxProvider(provider)` trims the key, ignores a blank key, replaces an existing entry with the same key (the documented semantics of the sibling registries, `apps/docs/docs/framework/modules/sales-providers.mdx:107`) except `product-rate`, and returns an identity-checked disposer keyed by the normalized key (today's shipping and payment disposers delete the untrimmed `provider.key`, `lib/providers/registry.ts:17`, `:27`); `getTaxProvider(key)`, `listTaxProviders()`, and a test-only `resetTaxProviders()` following `resetCatalogPricingResolvers` (`packages/core/src/modules/catalog/lib/pricing.ts:229-231`). The shipping and payment registries (`lib/providers/registry.ts:6-7`, module-local `Map`s) are untouched; moving all three is offered as a follow-up. Fallback: a module-local `Map` with the duplicated-instance limitation stated.

### Commands & Events

- Commands: none added. `sales.settings.save` gains an optional input field. Resolve and Apply run inside the existing recalculating commands: `sales.quotes.create`, `sales.orders.create`, `sales.quotes.update`, `sales.orders.update`, `sales.orders.lines.upsert`, `sales.orders.lines.delete`, `sales.quotes.lines.upsert`, `sales.quotes.lines.delete`, `sales.orders.adjustments.upsert`, `sales.orders.adjustments.delete`, `sales.quotes.adjustments.upsert`, `sales.quotes.adjustments.delete` (call sites `commands/documents.ts:5191`, `:6259`, `:5610`, `:5873`, `:7639`, `:7818`, `:8131`, `:8282`, `:8510`, `:8559`, `:8722`, `:8963`, `:9011`, `:9173`). No provider call in conversion, public acceptance, undo, returns, invoices, credit memos, deletes or the seed (`seed/examples.ts:1344`, `:1562` keep today's totals under `product-rate`).
- Events: `sales.tax.document.calculate.before`, `sales.tax.document.calculate.after` (new, § 4.16); `sales.tax.calculate.before/after` (`events.ts:90-91`), `sales.document.calculate.before/after` (`:82-83`), `sales.document.totals.calculated` (`:81`) untouched.

---

## 5) Worked examples

Rates, jurisdictions and dates are illustrative. Engine figures follow the formulas of `lib/calculations.ts` at head (4-decimal rounding); provider figures round half-up from the third decimal. Illustrative jurisdiction set for ship-to "State A": state `ST-A` 6.000, county `CO-A1` 1.000, city `CI-A1` 1.500, special `SP-A1` 0.375, combined 8.875 (percentage points).

### 5.1 `product-rate` pass-through (acceptance test 1)

Order, USD, no provider configured. L1: quantity 3 × 19.99, `taxRate` 23. L2: quantity 2 × 8.1235, `taxRate` 8.

| ref | net | tax (raw → engine) | gross |
|---|---|---|---|
| n:1 | 59.9700 | 13.7931 → 13.7931 | 73.7631 |
| n:2 | 16.2470 | 1.29976 → 1.2998 | 17.5468 |
| document | 76.2170 | 15.0929 | 91.3099 |

Nothing changes: no `tax_info`, no events, one pass; `tax_strategy_key` and `tax_info` keep what the create path stored. A gross-priced line (quantity 3, `unitPriceGross` 24.99, rate 23) gives net 60.9512, tax 14.0188, gross 74.9700 through the engine's gross path (`lib/calculations.ts:121-125`); the byte-for-byte fixtures include such a line.

### 5.2 Destination result with a jurisdiction breakdown

Order, intent `record`, ship-to State A, consumer with no tax ids. L1: 1 × 249.99. L2: 3 × 19.99. Provider rounds per line to cents.

| ref | net | state 6.000 | county 1.000 | city 1.500 | special 0.375 | tax | gross | effectiveRate |
|---|---|---|---|---|---|---|---|---|
| L1 | 249.99 | 15.00 | 2.50 | 3.75 | 0.94 | 22.19 | 272.18 | 8.8764 |
| L2 | 59.97 | 3.60 | 0.60 | 0.90 | 0.22 | 5.32 | 65.29 | 8.8711 |
| document | 309.96 | 18.60 | 3.10 | 4.65 | 1.16 | 27.51 | 337.47 | — |

After Apply: `subtotalNetAmount` 309.9600, `taxTotalAmount` 27.5100, `grandTotalGrossAmount` 337.4700, status `calculated`, line `tax_rate` 8.8764 and 8.8711. Re-deriving tax from the combined rate would store 22.1866 and 5.3223 instead of 22.19 and 5.32: the engine writes the provider's amounts verbatim. A gross-entered line (quantity 3 × 24.99 gross at rate 23) reaches the provider as net 60.9512 after the first pass; the provider taxes that net and the line's gross becomes 60.9512 plus the provider's tax, not the entered 74.97 (§ 4.10).

### 5.3 Exempt customer

Reseller with a certificate held at the provider. Variant (a): L1 10 × 30.00 and L2 4 × 30.00, both exempt (`exemptReason` per line, `taxAmount` 0, gross = net): document net 420.00, tax 0.00, status `exempt`. Variant (b): L3 1 × 40.00 forced taxable: L3 tax 3.55 (2.40 + 0.40 + 0.60 + 0.15), document net 460.00, tax 3.55, gross 463.55, status `calculated` with the exemption visible per line. An exempt line written with `taxAmount: 0` and gross = net stays at zero: the gross-minus-net derivation runs only when tax was not explicit (`lib/calculations.ts:177-180`).

### 5.4 Discounts (the limitation of § 4.8)

L1: 2 × 100.00 with a 10 % line discount → net 180.00; L2: 4 × 30.00 → net 120.00; a seller coupon of 30.00 as an order-scope `discount` adjustment; combined rate 8.875 on both lines.

| Case | What the provider sees | tax | gross | note |
|---|---|---|---|---|
| This specification (no allocation) | lines 180.00 and 120.00 | 15.98 + 10.65 = 26.63 | 296.63 | tax on 300.00, before the coupon |
| Allocation by share (Spec 4a target) | 162.00 and 108.00 | 14.38 + 9.59 = 23.97 | 293.97 | 108 × 0.08875 is 9.5849… in binary floating point, one more reason to take the provider's amounts verbatim |
| Hazard without the § 4.8 rule (a) | the same, with the `discount` adjustment carrying `metadata.taxRate` 8.875 | 21.3075 | 291.3075 | the discount's tax portion 2.6625 is subtracted a second time from the provider's 23.97 |
| Hazard without the § 4.8 rule (b) | the same, with the discount entered as 10 % taken off the document gross | 23.97 | 291.573 | gross 2.397 below net plus tax: the discount's gross subtracts tax the provider already removed |

Mixed rates make the point sharper: L1 100.00 at 8.875 and L2 100.00 at 2.000 with a 20.00 coupon; provider amounts 7.99 and 1.80 (total 9.79). With the rule of § 4.8 the engine gives tax 9.7900 and gross 189.7900; a discount carrying `metadata.taxRate` 8.875 would give 8.0150, and a percentage discount would give a gross of 188.811.

### 5.5 A shipping charge taxed in one state and not in another

L1 1 × 100.00; shipping through the built-in `flat-rate` provider, net 15.00 (its adjustments carry `metadata: { providerKey, rate }` and no `taxRate`, `lib/providers/defaultProviders.ts:270`, `:281`, `:291`).

| Case | charge tax | `amountGross` | `metadata.taxRate` | document tax | gross |
|---|---|---|---|---|---|
| State A, single rate 6.000, freight taxable | 0.90 | 15.90 | 6 | 6.90 | 121.90 |
| State B, single rate 7.000, separately stated freight not taxable | 0.00 | 15.00 | 0 | 7.00 | 122.00 |

The charge enters the request with `ref` `shipping-provider:flat-rate@10000`; the Apply step merges `taxRate` into the existing metadata. Today a method whose base gross exceeds its net without `metadata.taxRate` puts the difference into the grand gross but not into `taxTotalAmount`; the rule above makes charge tax visible to the total. A cash-on-delivery fee of 2 % computed after the phase sees 121.90, not 121.00. On a pass without `context.tax` (a return on this order, or a pass after switching back to `product-rate`) the regenerated `flat-rate` charge takes 0.90 and `taxRate` 6 from the stored adjustment row through the carry-over of § 4.8, so the document tax stays 6.90; without it the tax would drop to 6.00 silently.

### 5.6 Line-level versus document-level rounding

Three lines of 10.10 at 8.875. Line-level rounding: 0.90 + 0.90 + 0.90 = 2.70, gross 33.00. Document-level rounding: 30.30 × 8.875 % = 2.689125 → 2.69, with one line carrying 0.89 (which line is the provider's choice), gross 32.99. Today's engine stores 0.8964 per line and 2.6892 in total. The result's `taxTotalAmount` and `rounding.level` decide: a result whose lines sum to 2.70 while it declares 2.69 fails the consistency rule; a result declaring `document` rounding with lines 0.90, 0.90, 0.89 and total 2.69 is stored exactly. The jurisdiction roll-up rounded on the document total would give 2.68, which is why the roll-up is informational.

### 5.7 Returns and credit memos (this specification's position)

Order placed 2026-06-15, L1 2 × 50.00, tax 8.88 at the original 8.875; a city rate change on 2026-07-01 raises the combined rate to 9.125; one unit returned on 2026-08-10. Today `sales.returns.create` derives the return line's unit gross from the stored line totals (`commands/returns.ts:673-677`) and writes a `return` adjustment (`:697-713`), so the tax goes back implicitly at 4.44 (half of 8.88), and the return loop moves only the subtotals, never `taxTotalAmount` (`lib/calculations.ts:300-308`). Credit memos store the caller's amounts (`commands/documents.ts:9931`, `:9971-9972`) and have no `tax_info` column. This specification changes none of that and calls no provider on these paths; a provider-side return at the original tax date, with negative amounts and a reference to the original document, is Spec 4b (platform rules) and Spec 3 (provider lifecycle). The contract only avoids blocking it: `documentKind` already has `credit_memo`; `taxDate` can differ from the document date; `documentNumber` is carried.

### 5.8 A stale result after an address change

Order under a provider, ship-to State A: L1 2 × 100.00 tax 17.75, L2 1 × 100.00 tax 8.88, total 26.63, record `calculated` with fingerprint F0. The ship-to changes to State B (single rate 6.000) through `sales.orders.update` or the document-address commands: nothing recalculates (`shouldRecalculateTotals`, `commands/documents.ts:5797-5804`; `commands/documentAddresses.ts` makes no calculation call), so the amounts stay at 26.63 and the record still says `calculated` with F0 although its inputs no longer describe the document. The user then changes L2's quantity to 2 through `sales.orders.lines.upsert`: Resolve builds the request from the future state (State B, quantity 2) and the provider returns 12.00 + 12.00; Apply compares the fingerprint recomputed inside the transaction with the one of the request; on a match the document becomes net 400.00, tax 24.00, gross 424.00, `calculated` with a new fingerprint. If a concurrent writer changes an input between Resolve and Apply twice, the update fails closed with 409 `inputs_changed` and nothing is written (had it committed with the stored amounts, L2 at net 200.00 would keep tax 8.88 and a stored gross of 108.88, document gross 326.63 below the net of 400.00: the carry-over defect that Spec 4b fixes, and the reason the `stale` write was dropped); the user reloads and saves again. Two distinct things are therefore named: (i) the silent case after the address change, where nothing recalculates until Spec 4b and the record's status does not change (Spec 4b's trigger-based staleness, for which `stale` is reserved); (ii) the racing-inputs case, which this specification refuses with 409 instead of committing amounts the provider did not compute for the written inputs.

---

## 6) Data Models

No new entity. Changes:

- **`SalesSettings`** (`data/entities.ts:755`): one new property `taxProviderKey?: string | null` on the column `tax_provider_key` (`text`, nullable, no default). Migration `sales/migrations/Migration<YYYYMMDDHHMMSS>_sales_settings_tax_provider_key.ts` with `up()`: `alter table "sales_settings" add column "tax_provider_key" text null;` and `down()`: `alter table "sales_settings" drop column "tax_provider_key";`, the pair of the precedent `migrations/Migration20251126125305.ts:5-11`; no backfill (`NULL` is `product-rate`); `migrations/.snapshot-open-mercato.json` updated in the same commit (`packages/core/AGENTS.md:188`). Not sensitive: `sales_settings` is absent from `encryption.ts`.
- **Adjustment rows** (`SalesOrderAdjustment`, `SalesQuoteAdjustment`): no schema change; the phase never rewrites or removes a stored row; provider-generated charge rows receive `metadata.taxRate` and the marker `metadata.taxProviderKey` on Apply, and only marked rows take part in the carry-over (§ 4.8).
- **`SalesOrder.tax_strategy_key`** (`data/entities.ts:397`), **`SalesOrder.tax_info`** (`:403`), **`SalesQuote.tax_info`** (`:896`): no schema change; the content of `tax_info` under a provider is the provenance record below, versioned, additive only (later keys are added, never removed); the provider key is limited to 100 characters (§ 7), so the written `tax-provider:<key>` stays within the 120 characters the create validator enforces on client input (`data/validators.ts:703`).
- **Provenance record** (`tax_info` when a provider ran):

```json
{
  "version": 1,
  "providerKey": "example-provider",
  "intent": "record",
  "status": "calculated",
  "inputsFingerprint": "<64 hex characters>",
  "providerReference": "<provider document id or null>",
  "calculatedAt": "2026-10-01T12:00:00.000Z",
  "rounding": { "level": "line", "decimals": 2 },
  "jurisdictions": [ { "level": "state", "code": "ST-A", "name": "State A", "rate": 6.0, "taxableAmount": 309.96, "taxAmount": 18.60 } ],
  "lines": [ { "ref": "n:1", "taxableAmount": 249.99, "taxAmount": 22.19, "effectiveRate": 8.8764, "jurisdictions": [ "…" ] } ],
  "charges": [],
  "messages": []
}
```

The record never carries addresses, names, e-mail addresses, tax ids, the request, the raw provider response or credentials; `messages[]` store a code, a severity and a core message, never provider free text that could echo request data. The jurisdiction list names tax jurisdictions (the code and name of a state, county, city or district), not a person: it says where tax is due, carries no street, name or identifier, and the same codes apply to every buyer in that area, so `tax_info` stays outside the sales encryption map; adding `{ field: 'tax_info' }` to the order and quote entries of `encryption.ts` is the recorded alternative (§ 14) for a maintainer who reads the codes as personal data (it would apply only when tenant encryption is enabled, and it cannot replace the content rule). The record travels inside the encrypted action-log snapshots of document commands (`packages/core/src/modules/audit_logs/encryption.ts:4-15`).
- **Line columns.** `tax_rate` and `tax_amount` on order and quote lines (`data/entities.ts:640`, `:643`, `:1085`, `:1088`) receive the provider's amounts; nothing else changes; per-line detail columns are Spec 4a.
- **Types.** The exported types of § 4.3 are new names (zero hits at head for `TaxProvider`, `registerTaxProvider`, `SalesTaxRequest`, `SalesTaxResult`, `SalesTaxContext`, `product-rate`, `tax-provider:`); `SalesCalculationContext` gains `tax?`. No data-model graph is generated (no entity added).

---

## 7) API Contracts

### `GET` / `PUT /api/sales/settings/tax-provider` (new; file `api/settings/tax-provider/route.ts`)

- `metadata`: `GET: { requireAuth: true, requireFeatures: ['sales.settings.manage'] }`, `PUT: { requireAuth: true, requireFeatures: ['sales.settings.manage'] }` (the shape of `api/settings/order-editing/route.ts:27-30`); `openApi` exported.
- Organization: `resolveOrganizationScopeForRequest`, then `scope?.selectedId ?? auth.orgId`; 400 when no organization resolves (as the sibling routes, `api/settings/order-editing/route.ts:48-54`); 422 `organization_selection_invalid` for the all-organizations selection or a rejected selection (§ 4.4).
- `GET` response: `{ taxProviderKey: string | null, providers: Array<{ key: string; label: string; description?: string }> }` from `loadSalesSettings` and `listTaxProviders()` (server-side registry, so a provider registered only on the server is listed).
- `PUT` request: `{ taxProviderKey: string | null }` (new exported schema `salesTaxProviderSettingsSchema`, `z.string().trim().max(100).nullable()`); `product-rate` normalized to `null`; an unregistered key → 422 `sales.tax.errors.provider_not_registered`; `withScopedPayload`; mutation guards through `runRouteMutationGuards({ container, req, auth, input: { resourceKind: 'sales.settings', resourceId: organizationId, operation: 'update', mutationPayload } })` from `@open-mercato/shared/lib/crud/route-mutation-guard` (`packages/shared/src/lib/crud/route-mutation-guard.ts:119`), which runs every registry guard plus the bridged legacy guard (`:12-24`): return its `errorBody` and `errorStatus` when blocked, merge `modifiedPayload` into the validated input, and call its `runAfterSuccess()` after the command; the sibling settings routes still use the deprecated pair `validateCrudMutationGuard` / `runCrudMutationGuardAfterSuccess` (`api/settings/order-editing/route.ts:130`, `:159`), which resolves only the DI-registered guard service and skips the registry guards (`packages/shared/src/lib/crud/mutation-guard.ts:48-49`, `:67`), so that pair is not copied; executes `sales.settings.save` with the current number formats and editable-status lists passed unchanged (defaults when no row exists) and `taxProviderKey`; response as `GET`.
- Errors: 401 unauthenticated; 403 with `requiredFeatures` containing `sales.settings.manage`; 400 no organization; 422 as above. All messages through i18n keys `sales.tax.errors.*` (illustrative values below).

### Document routes

`POST`/`PUT /api/sales/orders`, `/quotes`, the line and adjustment routes: no URL, method, request or response change. Create still accepts `taxStrategyKey` (orders) and `taxInfo` (orders, quotes). Error bodies that a provider failure adds (proposal, with in-repository status precedents: 422 for an unregistered adapter at use time, `packages/core/src/modules/payment_gateways/lib/gateway-service.ts:187-197`; 502 for an upstream provider error, `packages/checkout/src/modules/checkout/api/pay/[slug]/submit/route.ts:521`; 409 for optimistic-lock conflicts, `packages/shared/src/lib/crud/optimistic-lock-command.ts:14-24`):

| Reason | Status | Key (proposed) | Message (illustrative) |
|---|---|---|---|
| provider `unavailable`, `rate_limited`, timeout | 503 (alternative 502 / 504) | `sales.tax.errors.provider_unavailable`, `provider_timeout` | "Tax could not be calculated: the tax provider is not available. Try again later." |
| provider `unauthorized` (credentials rejected) | 503 (alternative 502) | `sales.tax.errors.provider_unavailable` | same message; the log line and the error report carry the code |
| provider `invalid_request`, provider-reported `failed` | 422 (alternative 502) | `sales.tax.errors.provider_rejected` | "The tax provider rejected the document: `<code>`." |
| inconsistent or malformed result (F3–F6) | 502 (alternative 422) | `sales.tax.errors.provider_invalid_result` | "The tax provider returned an inconsistent result." |
| configured key not registered (F8) | 422 (alternative 503) | `sales.tax.errors.provider_not_registered` | "Tax provider `<key>` is not available. Ask an administrator to check the sales tax settings." |
| inputs changed twice on a create or an update (F10) | 409 | `sales.tax.errors.inputs_changed` | "The document changed while tax was being calculated. Reload and save again." |
| `tax`-kind adjustment under a provider (§ 4.8) | 400 | `sales.tax.errors.tax_adjustment_not_allowed` | "Manual tax adjustments are not allowed while a tax provider is configured." |

### Events

Payloads of § 4.16. The existing `sales.document.totals.calculated` (`events.ts:81`; emitted at `commands/documents.ts:3034-3048`) keeps its payload; provenance is not added to it in this specification.

---

## Configuration

- `sales_settings.tax_provider_key` per organization, written through the route of § 7; `NULL` (or a missing row) means `product-rate`. No environment variable, no per-channel or per-destination scope, no provider settings and no credentials in this specification (`SalesTaxProviderContext.settings` is `{}`; Spec 3 adds provider settings and credentials through `integrations`).
- The 10-second deadline of § 4.13 is a code constant in this specification; Spec 3 decides whether it becomes configurable.

## Internationalization (i18n)

- Error keys (proposed): `sales.tax.errors.provider_unavailable`, `sales.tax.errors.provider_timeout`, `sales.tax.errors.provider_rejected`, `sales.tax.errors.provider_invalid_result`, `sales.tax.errors.provider_not_registered`, `sales.tax.errors.inputs_changed`, `sales.tax.errors.tax_adjustment_not_allowed`; the settings route reuses the existing organization-selection error key where one exists.
- Settings labels (proposed): `sales.settings.taxProvider.title`, `sales.settings.taxProvider.description`, `sales.settings.taxProvider.none` ("Product rates (default)"), `sales.settings.taxProvider.provider`; audit label `sales.audit.settings.taxProviderChanged`.
- All keys in the five locales (`de`, `en`, `es`, `ko`, `pl`); `yarn i18n:check-sync` and `yarn i18n:check-usage` run in the gate; the existing key `sales.documents.history.fields.taxInfo` stays.

---

## 8) Security model

- **ACL.** Feature ids are FROZEN and additive (`BACKWARD_COMPATIBILITY.md:216-222`); the setting reuses `sales.settings.manage` (`acl.ts:112`, `dependsOn` `sales.settings.view` `:115`). `dependsOn` (`acl.ts:8`, `:44`, `:115`) is role-editor metadata applied when a role is edited (`packages/shared/src/security/aclDependencies.ts:60`, `:78`; `packages/core/src/modules/auth/api/features.ts:39-45`), not a runtime grant, so nothing here assumes which roles hold `sales.settings.view`; no settings route accepts it alone; the provider key itself is not a secret (it appears in `tax_info` and the document history), so a read-only exposure of the active key to `sales.settings.view` is the alternative to the default (`manage` for `GET`).
- **Scoping.** The setting is read for the document's own `tenantId` and `organizationId` (§ 4.4); the command checks `ensureTenantScope` and `ensureOrganizationScope` (`commands/settings.ts:53-54`); the request carries the document's scope; the registry holds code, never tenant data.
- **Who can trigger a provider call.** Any principal holding `sales.quotes.manage` or `sales.orders.manage`, directly or through the warranty replacement order (`packages/core/src/modules/warranty_claims/api/replacement-order/route.ts:57-58`), inbox actions (`inbox-actions.ts:297`, `:312`, `:320`), the workflow safe command `sales.orders.update` (`workflows.ts:10-22`), the AI assistant's Code Mode tools and API-key clients (they call the same routes over HTTP, `packages/ai-assistant/src/modules/ai_assistant/lib/codemode-tools.ts:808`, `:834-839`), and any holder of `audit_logs.redo_self` who redoes a document command. No unauthenticated route reaches a command that calculates totals: the accept route converts by copy (§ 4.14) and the checkout package writes no sales document.
- **Provider-call amplification.** One provider call per recalculating write (two on a mismatch); inbox actions, workflow steps, Code Mode and redo add calls on behalf of the principal; this specification sets no throttle and names the quota and cost risk; the per-endpoint rate limiter the accept route uses (`api/quotes/accept/route.ts:37-42`; `packages/shared/src/lib/ratelimit/config.ts:39-49`) is the in-repository option for Spec 3.
- **PII.** The request carries addresses and tax ids from encrypted snapshots in memory only; `tax_info` stores none of them (§ 6); `context.tax` carries the result only (§ 4.11); event payloads carry ids, refs and amounts only (§ 4.16). The public quote view (`api/quotes/public/[token]/route.ts:26-28`) returns `taxTotalAmount` and line amounts and gains no `tax_info`.
- **Logging rule (contract sentence).** Core and provider adapters must not log the `SalesTaxRequest`, the provider's raw request or response, addresses, tax ids or credentials at any level enabled by default; on failure they log the provider key, document kind and id, organization id, status, reason code and the provider's error code only, and report the failure once through `getTelemetryRuntime()?.reportError(error, { module: 'sales', code })` (`packages/shared/src/lib/telemetry/runtime.ts:47`, `:101`) with an enumerated `code` (`sales.tax_provider_unavailable`, `sales.tax_provider_timeout`, `sales.tax_provider_rejected`, `sales.tax_provider_invalid_result`, `sales.tax_provider_not_registered`), the ids as attributes and never request data, because a catch that records an error must also report it (`apps/docs/docs/framework/runtime/error-reporting.mdx:14`, `:16`); an adapter that wraps an SDK error strips request data before rethrowing. Reason: the shared logger has no redaction and forwards every line to a registered logger extension (`packages/shared/src/lib/logger/index.ts:52-62`). Raw request and response retention with its own retention period and access rights is Spec 3.
- **Secrets.** None stored by this specification; credentials live in `integrations` from Spec 3 on.

---

## 9) Edge Cases & Failure Scenarios

| # | Trigger | Where detected | Persisted state | User-visible effect | Recovery |
|---|---|---|---|---|---|
| F1 | Provider throws (any error, including auth) | Resolve, around `calculate` | unchanged; no document on create (a claimed number may be lost: `nextval`, `services/salesDocumentNumberGenerator.ts:243`, not re-checked) | 503 / 422 per § 7 | retry; switch the setting to `product-rate` |
| F2 | Provider times out (10 s) | Resolve deadline | unchanged | 503 `provider_timeout` | retry; no automatic retry |
| F3 | Result breaks the consistency rule of § 4.10 (taxable base, total, or a missing or duplicated `ref`) | result validation in Resolve and again in the phase | unchanged | 502 `provider_invalid_result` | adapter fix |
| F4 | Result names an unknown `ref`, misses one, or duplicates one | result validation | unchanged | as F3 | as F3 |
| F5 | Negative tax on a document without negative lines, or non-finite numbers | result validation | unchanged | as F3 | as F3 |
| F6 | Result echoes a different `inputsFingerprint` | result validation | unchanged | as F3 | adapter bug; not retried |
| F7 | Admin saves an unregistered key | settings route (write time) | setting unchanged | 422 `provider_not_registered` | install the package or choose another key |
| F8 | Setting names a key that no longer resolves (deploy without the package) | Resolve, provider lookup | unchanged; every recalculating write of that organization fails until fixed (workflow steps, inbox actions and warranty replacement orders too) | 422 `provider_not_registered` | restore the package or clear the setting |
| F9 | Fingerprint mismatch once (inputs or setting changed between Resolve and Apply) | Apply, inside the transaction | attempt rolled back | none when the retry succeeds | automatic: rollback, fresh fork, second Resolve, second transaction (§ 4.2) |
| F10 | Fingerprint mismatch twice | Apply, second transaction | nothing (create and update alike) | 409 `inputs_changed`; the client reloads and saves again | the next attempt; a manual recalculate command is Spec 4b |
| F11 | Concurrent writes on the same document | optimistic check only when the client sends the header (`packages/shared/src/lib/crud/optimistic-lock-command.ts:14-24`; `OM_OPTIMISTIC_LOCK` default on) | last header flush wins (issue #6463, parallel line writes, reproduces header and line drift) | with the header 409 for the loser; without, no error | inherit issue #6463; recommend the header to API clients; a `PESSIMISTIC_WRITE` on the document row at the start of Apply is the alternative |
| F12 | Setting changes between Resolve and Apply | the key is in the fingerprint; the setting is re-read in Apply | as F9 | none when the retry succeeds | as F9 / F10 |
| F13 | Undo of a write that carried provenance | undo handler; staleness guard (`commands/documents.ts:4072-4085`, `:4517-4545`) | snapshot restored: amounts and provenance together | existing undo messages | next recalculating write applies the current setting |
| F14 | Redo of a document command | the bus re-runs `execute` | as a normal write | as F1–F10 | as the original command |
| F15 | Document created before any setting existed | Resolve: `product-rate` | no record from the phase | none | the first recalculating write after a provider is configured calls the provider for that document too |
| F16 | Setting switched back to `product-rate` | Resolve: `product-rate` | stored line tax carried back by the line carry-over, stored charge tax by the marked carry-over (§ 4.8); the old record stays (§ 4.5) | none | none needed |
| F17 | Externally taxed amounts document | not at head (§ 4.6) | — | — | coordinate with the author of the open implementation |
| F18 | Transaction aborts after a successful Resolve for another reason (custom fields, guard, database) | any later flush phase | unchanged | the other failure's message | retry; the provider is called again (safe: `calculate` has no provider-side effect) |
| F19 | Provider rate-limits | adapter maps to `rate_limited` | unchanged | 503 | retry later |
| F20 | Provider returns `status: 'failed'` or an `error` message | result validation | unchanged | 422 `provider_rejected` | as F1 |
| F21 | Settings read fails | Resolve or Apply | unchanged | today's generic command error | as today |
| F22 | Provider down while a customer accepts a quote | no provider call on the accept route | order created from the copied quote amounts | none | none needed |
| F23 | Organization has no `sales_settings` row | `loadSalesSettings` returns `null` | `product-rate` | none | none needed |
| F24 | Provider result applies to a gross-entered line | Apply | net kept (the first pass derived it from the gross), gross = net + provider tax (§ 4.10) | the line's gross can differ from the entered gross | a gross-preserving split is a later specification |

Partial failure between Resolve and Apply persists nothing (`withAtomicFlush` rolls back every phase, `packages/shared/src/lib/commands/flush.ts:119-156`, `:172-183`); the events already emitted in Resolve are not rolled back.

---

## 10) Migration & Backward Compatibility

Every surface changes additively, checked against the 14 categories of `BACKWARD_COMPATIBILITY.md`; nothing follows the Deprecation Protocol (`:7-11`).

| Surface | Change | Classification |
|---|---|---|
| §1 `data/validators.ts` (`:53`: "MUST NOT remove or narrow existing schemas") | every existing schema unchanged; `taxStrategyKey` and `taxInfo` stay accepted; one new exported schema `salesTaxProviderSettingsSchema` | ✓ ADDITIVE |
| §1 `events.ts`, `acl.ts`, `di.ts`, `index.ts` | two new event entries; `di.ts` registers the test-only `tax_stub` provider only under its env flag (no DI key); no ACL or module metadata change | ✓ ADDITIVE |
| §2 Type Definitions (`:71`) | optional `tax?: SalesTaxContext` on `SalesCalculationContext`; optional nullable `taxProviderKey` on `SalesSettings`; new exported types; nothing removed or narrowed; `TaxProvider` declares no reserved members, so later optional methods are additive | ✓ ADDITIVE |
| §3 Function Signatures (`:115`) | unchanged under Option B; under the fallback Option A `registerSalesTotalsCalculator` gains optional `{ id?, phase? }` and un-phased hooks keep their position; `registerTaxProvider`, `getTaxProvider`, `listTaxProviders`, `resetTaxProviders` are new; `ensureProviderTotalsCalculator` keeps its name, idempotency, events and manual-override handling | ✓ ADDITIVE |
| §4 Import Paths (`:157`) | nothing moves; new entry `lib/tax` for values, type re-exports from the `lib/providers` barrel (client-bundle rule of § 4.3); the documented spellings of `lib/calculations` keep resolving | ✓ ADDITIVE |
| §5 Event IDs (`:159-167`, FROZEN) | `sales.tax.document.calculate.before` / `.after` added; `sales.tax.calculate.*`, `sales.document.calculate.*`, `sales.line.calculate.*`, the shipping and payment adjustment events and `sales.document.totals.calculated` keep ids, emit points and payloads; under a configured provider they fire once per calculation pass (two passes per write, four on a retry, § 4.2) | ✓ ADDITIVE |
| §6 Widget Injection Spot IDs | unchanged; no UI | — |
| §7 API Route URLs (`:187-189`) | one new route; existing routes and response schemas unchanged; the list and detail field set (`api/documents/factory.ts:387-424`) gains nothing | ✓ ADDITIVE |
| §8 Database Schema (`:197`, `:201`, ADDITIVE-ONLY) | one nullable column on `sales_settings` with `down()`; no backfill; no document or line table change; snapshot updated in the same commit | ✓ ADDITIVE (NULL default; existing rows read as `product-rate`) |
| §9 DI Service Names (`:212-213`) | no key added, renamed or changed; `salesCalculationService` and `taxCalculationService` keep their interfaces | — |
| §10 ACL Feature IDs (`:220-222`, FROZEN) | `sales.settings.manage` reused; no new id (the narrower id is the alternative) | — |
| §11–§13 | no notification type, AI identifier or CLI command change | — |
| §14 Generated File Contracts (`:274`, `:278`) | the generated module registry gains one API route (`modules.generated.ts`, `packages/core/AGENTS.md:646`), the OpenAPI document and the events registry gain entries; no ACL entry; no generator or export name change | ✓ ADDITIVE |

**Migration path for existing tenants and modules:** run the migration; no data changes; an organization that does nothing keeps `NULL` and calculates exactly as today, with the existing engine fixtures as the proof; a module that replaces `salesCalculationService` without delegating to `salesCalculations` skips the phase (stated, not a break). Under a configured provider the phase never rewrites or removes an adjustment row: `tax`-kind, discount and credit rows stay as entered and are only neutralized in the rebuild (§ 4.8).

**Client-supplied `taxStrategyKey` and `taxInfo`.** No request is rejected and no schema is narrowed. Today these values are stored verbatim on create and nothing reads them. After this change they are provenance written by the server: when the organization's sales settings name a tax provider and that provider calculates the document, the server writes `tax_strategy_key` (orders) and `tax_info` (orders and quotes) from the result and overwrites any value the caller sent; the server never reads a caller-supplied value to choose or compute tax; when no provider is configured the server writes neither field, so a caller-supplied value is stored exactly as before. No deprecation marker and no warning are added in this specification (§ 4.4); the payment-ledger precedent's marker is the alternative a maintainer may ask for. **Migration:** stop sending `taxStrategyKey` and `taxInfo`; configure the provider in the organization's sales settings; read provenance from the stored document. Rollback needs no data migration.

**`UPGRADE_NOTES.md`.** Nothing for this spec-only PR. The implementation PR adds one entry under the then-open window, in the file's existing shape (a level-3 heading ending with the PR number, prose, then `**Action for operators:**` and `**Action for module authors:**` lines): the new nullable setting, the byte-identical default, the provenance semantics of `tax_strategy_key` and `tax_info`, and the rule for totals calculators under the chosen option. The entry also states that under a configured provider the calculation lifecycle events fire once per pass (two passes per write, four on a retry) and that adjustment rows are never rewritten or removed by the phase.

---

## 11) Parallel work

States read on 2026-10-03 with read-only tracker queries; none is a base or a dependency.

| Ref | Relationship to this specification |
|---|---|
| #6092 feat(sales): the opt-in external amounts mode for mirrored orders (open; base `develop`) | Edits `lib/calculations.ts`, `lib/providers/totals.ts`, `commands/documents.ts`, `lib/types.ts`, entities, validators and the migration snapshot; § 4.6 names one guard point; question to the author: where the one guard for externally taxed documents should live so that the tax phase and the provider calculator share it, and which change rebases on the other. Its specification on `develop` (`2026-09-07-sales-external-amounts-mode.md`) is the precedent for this status line. |
| #6184 perf(sales): write a whole order line set in one aggregate load (open; base `main`) | Rewrites the single line upsert and adds a bulk path; the stored-tax rule (`commands/documents.ts:7575`, `:8067`) is cited from `develop`; Spec 4b owns the carry-over fix; coordinate about the same rule in the bulk path and the merge order with #6146 (sales, `lineNumber` as a target position on upsert). |
| #6255 fix(sales): refresh the query index after customFields update (open); #6833 fix(sales): stale undo (merged at this head) | Same functions as the update commands; undo behaviour is cited from this head only. |
| Issues #6461 (sales: line editor resets an API-created line's tax rate; fix #6815 open), #6075 (sales: quote line dialog sole variant; fix #6637 open), #5853 (sales: caller-supplied `totalGrossAmount` reconciliation), #6459 (sales: quantity change leaves gross stale), #6463 (sales: parallel line writes) | Defects on the write paths this specification uses; `product-rate` reproduces today's results including these; F11 inherits #6463; question to the author of #6815: whether the editor keeps sending `taxRate` as an input when a provider owns tax. |
| Issue #6733 Fix: cross-module data ownership violations (open; priority-high) | Reason for § 4.11: no new read of `customers` or `catalog` entities; question to the author: whether an owner-provided read contract for product tax codes and exemption facts is planned. |
| #6168 docs(tax-management): core framework `tax_management` + `financial_pl` (open; base `main`); official-modules #55 (`financial_pl`, open) | Period-level work; names reserved (the roadmap's § 9: `TaxCode`, `ITaxEngine`, `taxEngineRegistry`, `TaxLiabilityRecord`, `tax_management`); question: whether the period engine will read the per-rate and per-jurisdiction breakdown this record stores. |
| #6709 feat: ecomm Release 2 — availability contract + customer groups (open; no file under `sales/`); issue #6414 (sales: tax-rate CrudForm `entityId`) | `customer.groupIds` stays reserved with source `UNKNOWN`; question: whether `sales_tax_rates.customer_group_id` keeps its meaning (plain nullable UUID, no foreign key). |
| #6346 docs(specs): assisted selling and the cart proposal seam (open) | `display` never calls a remote provider; the cart integration is 6a; coordinate about whether a proposal cart asks `sales` for a tax figure or copies the target's tax mode. |
| #6743 (sales, split-payment balances), #6255 and #5615 (sales, order-detail feature-gated affordances) each add a `TC-SALES-042-*` spec file although 042 is taken on `develop` | Numbering race for the integration ids of § 17; the implementation PR re-runs the id check and renumbers if needed. |

---

## 12) Risks & Impact Review

**Data integrity.** The provider result is applied inside the same transaction as the document write; a failed consistency check or a provider failure writes nothing; the fingerprint guards one write against moving inputs, not against two writers (F11). **Cascading effects.** The engine stays deterministic (no provider call inside it), so cart, back office and POS cannot diverge; subscribers of the calculation events can still rewrite totals and are marked `overridden`; the two new events are in-process and may observe rolled-back writes. **Tenant isolation.** The setting, the rate rows and the provenance are organization-scoped; the registry holds code; the request carries the document's scope. **Migration and deployment.** One nullable column with a reversible migration, no downtime, no backfill; the snapshot is also edited by two open PRs, so whichever lands second regenerates it. **Operations.** Provider calls are bounded by a deadline; failures are logged with codes only; no throttle in this specification.

### Risk Register

#### Double taxation through `tax`-kind adjustments, `taxPortion` or explicit line `taxAmount`
- **Scenario**: a provider writes line tax while a `tax`-kind adjustment or a `metadata.taxRate` on a document discount is still folded into the total; the document shows tax twice or subtracts it twice (§ 5.4 hazard).
- **Severity**: High
- **Affected area**: `sales` totals, invoices copied from orders
- **Mitigation**: the consistency rule; `tax`-kind adjustments rejected on write under a provider and excluded from the total when pre-existing; document discounts carry no tax portion under a provider (§ 4.8).
- **Residual risk**: a `sales.document.calculate.after` subscriber can still add tax; marked `overridden`, not prevented.

#### A provider call inside a transaction or under a row lock
- **Scenario**: a provider is called while rows are locked; a slow provider holds locks for seconds.
- **Severity**: High
- **Affected area**: `sales` commands, public quote acceptance
- **Mitigation**: Resolve outside every transaction (§ 4.2); the retry runs outside too; conversion, acceptance, undo and returns make no provider call; a 10-second deadline.
- **Residual risk**: a mismatch doubles provider traffic for that write; the returns question goes to Spec 4b.

#### Fingerprint spoofing and forged provenance
- **Scenario**: a client stores a provenance-shaped `taxInfo` or a `tax-provider:` key on create under `product-rate`, and a reader trusts it.
- **Severity**: Medium
- **Affected area**: document history, later consumers of `tax_info`
- **Mitigation**: the fingerprint is computed server-side only and never read from client input; the fields are never read as authority; conversion never promotes a copied record into a server-written key (§ 4.14); the convention is stated with its limit.
- **Residual risk**: a forged record can appear in the history widget until a later specification exposes provenance through a server-validated read.

#### Silent zero or silent fallback
- **Scenario**: a provider outage returns no tax and the document is written with zero tax and no status.
- **Severity**: High
- **Affected area**: every touchpoint
- **Mitigation**: fail closed; `display` never remote; `fallback` reserved for a labelled policy in Spec 3.
- **Residual risk**: fail closed blocks edits of that organization during an outage, by design.

#### Stale tax after an address or customer change until Spec 4b
- **Scenario**: a provider-taxed order gets a new ship-to; nothing recalculates (§ 5.8); an invoice copies the old tax.
- **Severity**: High
- **Affected area**: orders, invoices
- **Mitigation**: the roadmap gates production use of a remote provider on Spec 4b; the fingerprint covers the addresses, so the next recalculating write re-taxes; `stale` is reserved in the vocabulary from this specification on.
- **Residual risk**: between this specification and Spec 4b a test deployment can hold stale tax after an address change; proposed for acceptance as a gated phase.

#### Every default employee can switch the provider
- **Scenario**: `sales.settings.manage` is held by the default `employee` role (`setup.ts:54`); a settings change re-taxes every later document of the organization.
- **Severity**: Medium
- **Affected area**: `sales` settings
- **Mitigation**: audit entry on every change (§ 4.4); provenance per document; the narrower feature id is the recorded alternative.
- **Residual risk**: proposed for acceptance in the first PR; revisited with Spec 3's gateway UI.

#### Provider-call amplification and quota
- **Scenario**: many line edits, inbox actions, workflow steps, Code Mode calls or redos cause one provider call each; a provider billed per call or limited per account is exhausted.
- **Severity**: Medium
- **Affected area**: the organization's provider account; `sales` writes
- **Mitigation**: one call per write, zero automatic retries, `display` never remote; the risk is named and throttling is Spec 3.
- **Residual risk**: unbounded in this specification.

#### Barrel export reaching the client bundle
- **Scenario**: a value export from `lib/providers/index.ts` pulls server-only tax code (hashing) into the two `"use client"` components that import the barrel.
- **Severity**: Low
- **Affected area**: admin bundle
- **Mitigation**: values live in `lib/tax/index.ts` and the barrel re-exports types only (§ 4.3); `phase.ts` and `productRate.ts` are reachable from the client bundle anyway, through `lib/providers/index.ts:1` → `totals.ts` → `applyTaxPhase` (the barrel is imported by `components/PaymentMethodsSettings.tsx:28` and `components/ShippingMethodsSettings.tsx:37`), so they must import neither `fingerprint.ts` nor `node:crypto`; the Phase A build check covers the import graph of `totals.ts`.
- **Residual risk**: none once the rule is kept; the build is the check.

---

## 13) Decision Requested

Four questions need a maintainer answer before an implementation PR exists. Each has a recommended default and an "if rejected" fallback.

| # | decision | if rejected |
|---|---|---|
| DR-1 | **Should the document-level tax phase live inside the `sales` totals pipeline** (where line arithmetic, `SalesTaxRate` and the shipping and payment provider steps already live), or behind a separate module, or behind the plugin hook that SPEC-024 §10.2 sketched for the financial module (`SPEC-024-2026-02-11-financial-module.md:2432`, `:2437`)? Default: inside `sales`, as a step of the provider totals calculator (§ 4.1); §10.2 is read as superseded for transaction-level tax only | `sales` adds only the named phase slot of Option A, and a separate module (the gateway module of Spec 3) registers the tax step and owns the registry and the provider lifecycle; that bundles the gateway module into this delivery, a scope change § 19 excludes today and which is then asked explicitly; the §10.2 hook is not used for transaction-level tax |
| DR-2 | **How is the tax step ordered?** Default Option B: a fixed step inside the provider totals calculator between the shipping and payment blocks, no public API change, with the documented rule for third-party hooks (§ 4.1). Option C is rejected (§ 3) | Option A: an additive `{ id?, phase?: 'charges' \| 'tax' \| 'post-tax' }` option on `registerSalesTotalsCalculator` with the provider calculator split into a `charges` and a `post-tax` registration; hooks without `phase` keep today's order |
| DR-3 | **Where do the contract types live** (`TaxProvider`, `SalesTaxRequest`, `SalesTaxResult`): in core `sales`, so that every caller of `salesCalculationService` (back office today; cart and checkout per the ecommerce suite roadmap's ADR-2) inherits provider tax, in `packages/shared`, or only in vendor packages? Default: core `sales` under `lib/tax/`; vendor adapters outside the core modules | a type-only contract in `packages/shared` (precedent: `packages/shared/src/modules/integrations/types.ts` holds the integration types), with the phase and the registry where DR-1 puts them |
| DR-4 | **Should the new tax provider registry be `globalThis`-backed** like the catalog pricing resolver registry (survives duplicated module instances in publishable packages), while the shipping and payment registries stay module-local `Map`s, or should all three move together, or should the new one follow the module-local precedent? Default: `globalThis` for the new registry only; the "all three" move offered as a follow-up | a module-local `Map` for symmetry with `lib/providers/registry.ts`, with the duplicated-instance limitation stated |

## Decision Record

*Empty pending maintainer sign-off. Record each answer here with the date and the login of the maintainer who gave it, and mirror it into the roadmap's Decision Record.*

---

## 14) Open points (not Decision Requested)

1. A deprecation marker for the client-supplied `taxStrategyKey` and `taxInfo` inputs (the payment-ledger precedent): not added; a maintainer may ask for it in review; the text of § 10 is ready for that case.
2. Returns under a configured provider: no provider call in this specification; Spec 4b decides.
3. Adding `tax_info` to the sales encryption map as defence in depth: recorded as the alternative in § 6.
4. Exposing `tax_info` and `tax_strategy_key` in the document read API: a later specification.
5. Clearing a provider's provenance record when the organization switches back to `product-rate`: the alternative in § 4.5.
6. The test-only `tax_stub` provider (§ 17): registered from `sales/di.ts` only under `OM_ENABLE_SALES_TAX_STUB_PROVIDER`, the pattern of the push stub adapter; a maintainer may prefer another flag name or the `OM_PUSH_FAKE_PROVIDERS`-style client fake.
7. The event-id alternatives of § 4.16 and the `SalesTaxContext` name (alternative `SalesTaxPhaseContext`).
8. A platform-level deadline value other than 10 seconds (candidates 5, 15 and 30 seconds; § 4.13).
9. The ACL guard of the setting: reuse of `sales.settings.manage` (default) or an admin-only feature id (§ 4.4).

---

## 15) Phasing

Four implementation phases, each shippable alone and each leaving the application working; no implementation phase starts before § Decision Requested is answered.

- **Phase A — contract and registry.** Types, the registry, the fingerprint and the record shape; no behaviour change. Gate: the new exports exist, `listTaxProviders()` includes `product-rate`, the registry survives a second module instance (UT-01 to UT-06, UT-30 to UT-35, UT-40 to UT-42); no migration; no removed export.
- **Phase B — the tax phase and `product-rate`.** The step inside the provider calculator, the consistency rule, the no-op under `product-rate`. Gate: the golden test and `TC-SALES-043` pass on the baseline commit before any engine change and after it (UT-50, UT-52, UT-54, UT-10 to UT-19, UT-62, UT-63); every existing test unmodified and green.
- **Phase C — Resolve and Apply, the setting, the route, provenance.** The migration, the route, the extended command, the audit entry, Resolve and Apply in the twelve commands, the two events. Gate: CT-01 to CT-22, `TC-SALES-044` to `046`, and `047` and `048` under `tax_stub`; the settings write requires `sales.settings.manage`; an unregistered key is rejected; `product-rate` through the API gives today's totals.
- **Phase D — docs.** The user guide and the overrides guide gain a chapter on document-level providers with a table of what the unit seam cannot carry (addresses, customer, document, charges, status, lifecycle); the totals-hook example is corrected (`context.countryCode` is not declared; `SalesTotalsCalculationHook` is not exported from `lib/calculations`); the appended-calculator rule is stated; the events page lists the two ids; the sales settings page documents the setting. Gate: the docs build passes; `grep` finds `sales.tax.calculate` still documented.

---

## 16) Implementation Plan

### Phase A — contract and registry
1. Add `lib/tax/types.ts` with the types of § 4.3 and the `tax?` slot on `SalesCalculationContext`; typecheck passes; no runtime change.
2. Add `lib/tax/registry.ts` (`globalThis` state, `registerTaxProvider`, `getTaxProvider`, `listTaxProviders`, `resetTaxProviders`, the protected `product-rate` entry) with `lib/__tests__/taxProviderRegistry.test.ts` (UT-01 to UT-06).
3. Add `lib/tax/fingerprint.ts` (canonicalization and SHA-256, server-only) with `lib/__tests__/taxFingerprint.test.ts` (UT-30 to UT-35); add the record builder with `lib/__tests__/taxEnvelope.test.ts` (UT-40 to UT-42; the record contains no address, name or tax id).
4. Add `lib/tax/index.ts` (values) and type-only re-exports from `lib/providers/index.ts`; verify by build that no server-only module is reachable from the barrel or from `totals.ts` (which the barrel imports by value, `lib/providers/index.ts:1`, and which calls the phase).

### Phase B — the tax phase and `product-rate`
5. Record the golden: copy the inputs of every `lib/__tests__/calculations.test.ts` case plus the added tax-path fixtures (explicit `taxAmount`, explicit zero, supplied gross with and without a rate, `totalsFromStoredRow` with stored tax, a shipping adjustment with and without `metadata.taxRate`, a `tax`-kind adjustment, mixed line kinds, order and quote variants, `existingTotals`, the gift-line hook, a gross-priced line) into `lib/__tests__/fixtures/taxPassThrough.golden.json`, generated on the baseline commit; the commit changes no non-test file under `lib/`.
6. Add `lib/tax/productRate.ts` and `lib/tax/phase.ts`; call the phase inside `ensureProviderTotalsCalculator` between the shipping and payment blocks (Option B; or the Option A split if chosen); `lib/__tests__/taxPassThrough.golden.test.ts` (UT-50, UT-52, UT-54) and `lib/__tests__/taxPhase.test.ts` (UT-10 to UT-19, UT-62, UT-63) pass; every existing test file is unmodified (UT-51).
7. Add `TC-SALES-043-tax-default-path-totals.spec.ts` with literal constants recorded on the baseline.

### Phase C — Resolve and Apply, the setting, the route, provenance
8. Migration `Migration<ts>_sales_settings_tax_provider_key.ts` with `up()` and `down()`; entity property; snapshot update; `yarn db:generate` shows no other diff.
9. Extend `sales.settings.save` with the optional field written only when present, `?? null` on create, write-time validation against the registry, and a `buildLog` entry on change; `commands/__tests__/settings.tax-provider.test.ts` (CT-09, CT-12, CT-17, CT-20, CT-21).
10. Add `api/settings/tax-provider/route.ts` with `metadata`, `openApi`, the organization-selection rule, the mutation guard and the i18n keys; `TC-SALES-044`, `045`, `046`.
11. Add the request builder (`lib/tax/request.ts`: tolerant address mapper, `taxDate`, `pricesIncludeTax`, charges with `ref`) with `lib/__tests__/taxRequest.test.ts` (UT-60, UT-61).
12. Implement Resolve and Apply in the twelve recalculating commands (hoist the header-update pass out of the flush for Resolve; the retry sequence of § 4.2; the fail-closed rule for a second mismatch on create and on update), the two events, the `tax`-kind adjustment rule and the discount rule; `commands/__tests__/documents.tax-provider.resolve-apply.test.ts` (CT-01 to CT-08, CT-13, CT-14, CT-15, CT-16, CT-18, CT-19, CT-22) and `documents.tax-provider.provenance.test.ts` (CT-10, CT-11); add `lib/tax/stubProvider.ts` with its flag-gated registration in `sales/di.ts` and the harness flag in `packages/cli/src/lib/testing/integration.ts`, then `TC-SALES-047` and `048` (§ 17).
13. Conversion keeps today's copy semantics (§ 4.14); `documents.convert-to-order` coverage extended (CT-10: `tax_strategy_key` stays `null` and `taxInfo` is copied verbatim under a configured provider).
14. Validation: `yarn generate`, `yarn workspace @open-mercato/core build`, `yarn workspace @open-mercato/core test`, `yarn typecheck`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, then the full gate (`yarn build:packages`, `yarn test`, `yarn build:app`) before review; integration `yarn test:integration:ephemeral` with the new ids and the existing tax-adjacent ones (`TC-SALES-006`, `-016`, `-030`, `-034`, `-037`).

### Phase D — docs
15. Update the six docs pages of the Scope line; `yarn workspace open-mercato-docs build` passes; the documented provider example is the body of the tested fake.
16. `UPGRADE_NOTES.md` entry (§ 10); `.ai/specs/README.md` row already present from the spec PR; roadmap Changelog line.

---

## 17) Testing Strategy

- **Unit (`lib/__tests__/`):** registry (UT-01 to UT-06: lookup, replace-by-key, identity-checked disposer, cross-instance survival through two `jest.isolateModules` evaluations as `packages/core/src/modules/catalog/lib/__tests__/pricing.test.ts:214-241` does, key hygiene, `product-rate` protection); phase (UT-10 no-op under `product-rate` with the baseline event sequence `sales.line.calculate.before/after`, `sales.document.calculate.before/after` of `services/__tests__/salesCalculationService.test.ts:165-170`; UT-11 a fake result sets line and charge tax consistently for `order` and `quote`; UT-12 consistency failure at 0.004 accepted and 0.006 rejected for the taxable base and for the total, nothing changed; UT-13 reference integrity; UT-14 `ref` rule on create; UT-15 payment fees see the tax-inclusive gross with `lib/providers` loaded; UT-16 `sales.document.calculate.after` still runs last and the new events are absent under `product-rate`; UT-17 payment totals survive; UT-18 the gift-line hook keeps its effect; UT-19 `display` never calls the fake; UT-62 document discounts carry no tax portion under a provider; UT-63 the consistency rule anchors on `taxTotalAmount`); fingerprint (UT-30 key order, UT-31 sorted `ref` order, UT-32 sensitivity table over every covered input and insensitivity to names and notes, UT-33 client `taxInfo` ignored, UT-34 a literal golden fingerprint, UT-35 number canonicalization); record (UT-40 shape and JSON round trip, UT-41 no personal data, UT-42 status vocabulary); request (UT-60 post-discount nets and charges, UT-61 in-memory only); pass-through (UT-50 golden equality under four configurations: nothing configured, `product-rate` explicit, a fake registered but not selected, the provider hook loaded, each also with an existing unmarked flat-rate shipping row whose tier changes; `toStrictEqual` plus `JSON.stringify` equality, logger warnings included; UT-51 existing test files unmodified, checked by `git diff --name-only` on `**/__tests__/**`; UT-52 non-vacuity: a selected fake changes the output; UT-54 deep-frozen inputs).
- **Command level (`commands/__tests__/`, pattern of `documents.create-payment-totals.test.ts`: awilix container, fake `em`, the real `DefaultSalesCalculationService`, a fake provider declared in the test file, registered in `beforeEach` and removed in `afterEach`):** CT-01 no settings row → `product-rate`, persisted values equal the baseline; CT-02 `null` key behaves the same; CT-03 `calculate` runs before `em.begin` (create) and before the flush phase (update), with intent `estimate` for quotes and `record` for orders; CT-04 matching fingerprint applies once and writes server provenance; CT-05 one retry after a deterministic contender; CT-06 and CT-22 fail closed with 409 after two mismatches on update and on create, nothing persisted; CT-07 fail closed on throw and on an invalid result, no persist, no flush; CT-08 unregistered key at calculation time fails closed; CT-09 the setting round trip through `sales.settings.save` and the write-time rejection; CT-10 conversion calls no provider, copies the record verbatim and leaves `tax_strategy_key` `null` under a configured provider, a forged client record included; CT-11 undo restores provenance; CT-12 scope enforcement; CT-13 the `{ quote, order } × { create, update }` matrix with recalculation triggers; CT-14 client `taxInfo` is output-only; CT-15 persisted rows under `product-rate` deep-equal a baseline golden; CT-16 settings read for the document's own scope; CT-17 other settings values untouched; CT-18 a client `taxStrategyKey` never selects a provider; CT-19 a setting change affects later calculations only; CT-20 other settings saves keep the key; CT-21 the route and command path.
- **Integration (`__integration__/`, helpers from `@open-mercato/core/helpers/integration/salesFixtures`, admin token, fixtures created and deleted per test, settings restored in `finally`):** `TC-SALES-043` default path totals against literal constants recorded on the baseline; `TC-SALES-044` the settings write is gated (403 with `requiredFeatures` containing `sales.settings.manage` for a `sales.settings.view`-only role, pattern of `__integration__/TC-SALES-037.spec.ts:62-98`; 401 unauthenticated); `TC-SALES-045` an unregistered key is rejected and the stored setting unchanged; `TC-SALES-046` explicit `product-rate` parity and the settings round trip. Ids: `TC-SALES-043` to `046` are the first free numbers at head (highest in use `TC-SALES-042`; `TC-SALES-EXT` is reserved by the open external-amounts implementation); three open PRs reuse 042, so the implementation PR re-runs the check and renumbers or takes the word family `TC-SALES-TAXPROV-001` to `004`. `TC-SALES-047` and `TC-SALES-048` run under the test-only `tax_stub` provider (next bullet).
- **Provider-path integration coverage.** A fake provider cannot be registered from a Playwright spec (the application runs as a detached process and modules register providers at start), so the specification ships a test-only built-in provider the way core already registers its built-in payment providers (`lib/providers/defaultProviders.ts:100`, `:143`) and the way `push_notifications` ships its stub adapter: `lib/tax/stubProvider.ts` (key `tax_stub`; a deterministic fixed rate per line and per charge; no network) is registered from `sales/di.ts` only when `OM_ENABLE_SALES_TAX_STUB_PROVIDER` is set (the pattern of `packages/core/src/modules/push_notifications/lib/push-stub-adapter.ts:32-35` and `packages/core/src/modules/push_notifications/di.ts:8-12`), inert in production; the integration harness sets the flag next to `OM_ENABLE_PUSH_STUB_ADAPTER` (`packages/cli/src/lib/testing/integration.ts:2204`; one line in the `cli` package). `TC-SALES-047` creates and updates an order and a quote under `tax_stub` (line `taxAmount` and gross through the line routes; the record and the strategy key through the audit-log data the document history widget reads); `TC-SALES-048` covers the `tax`-kind rejection (400) and the switch back to `product-rate` (totals equal the baseline again). The root rule that providers live in their own packages (`AGENTS.md:183`) applies to external integrations; a built-in test provider is not one, exactly like the built-in payment providers.
- **QA scenarios.** `.ai/qa/scenarios/TC-SALES-006-order-tax-calculation.md` and `TC-SALES-016-tax-rate-configuration.md` describe rate selection by location and exempt customers that this specification neither implements nor contradicts (`product-rate` consults no address); they are not edited here; `TC-SALES-016` names a feature `sales.tax.manage` that does not exist in code (the tax-rate routes require `sales.settings.manage`).
- **Validation commands:** the module set (`yarn db:generate` as a schema-diff probe, `yarn generate`, `yarn workspace @open-mercato/core build`, `yarn workspace @open-mercato/core test`), then the full gate of `.ai/agentic.config.json` before review.

---

## 18) Documentation changes

`apps/docs/docs/user-guide/taxes.mdx` (`:52`, `:77` send external engines to the unit seam) and `apps/docs/docs/framework/pricing-tax-overrides.mdx` (`:144-191`) gain a chapter "document-level tax providers" with the table of what the unit seam cannot carry and the provider example (the tested fake's body); the totals-hook example at `:66-90` is corrected (declared context fields only; an exported type); `apps/docs/docs/framework/modules/sales/calculations.mdx` states the rule for prepended and appended calculators; `apps/docs/docs/framework/modules/sales-providers.mdx` lists the third provider kind; `apps/docs/docs/framework/modules/sales/events.mdx` lists the two ids; `apps/docs/docs/user-guide/sales/sales-settings.mdx` documents the setting (`sales.settings.manage`). New i18n keys: `sales.tax.errors.*` and the settings labels, in the five locales; the existing key `sales.documents.history.fields.taxInfo` stays.

---

## 19) Out of scope (with the specification that owns each item)

- Provider-side lifecycle (commit, adjust, void, refunds, retries and the commit point) is not declared in the `TaxProvider` type and has no behaviour here; Spec 3 adds the optional methods. In this specification `record` means that the platform stores the result on an order; it never asks a provider to record a transaction for filing.
- Deterministic provider document codes, idempotency keys and retry semantics: Spec 3; this specification stores the provider's reference as returned and carries `documentNumber`.
- Per-line tax detail columns, additional line kinds (`handling`, `refund`), per-line addresses, a product tax code with a variant override, owner fact services and their names, exemption facts and certificates, and the allocation of document discounts to lines: Spec 4a. Exemption appears only as result vocabulary and status; reverse-charge and OSS logic are not planned in this roadmap.
- Recalculation triggers beyond today's (address, customer, date, elapsed time), the explicit recalculate command, the stored-tax carry-over fix, return reversal at the original tax date, honour-versus-re-quote on conversion, and the line dialog change: Spec 4b. The fingerprint protects one write against moving inputs and is not a cache.
- Configurable failure policies, timeouts per organization, fallback to another provider, credentials, the admin log and raw request retention: Spec 3 and provider packages.
- Selection by destination, by sales channel or by any other scope: a later specification; the provider is selected once per organization.
- Matching `SalesTaxRate` rows by address, customer group, channel or date, CSV import and export, and the sourcing option: Spec 2 (working name `tax-destination-table-rate`).
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
| root AGENTS.md | No direct ORM relationships between modules; no new cross-module ORM reads | Compliant | § 4.11: facts from the document's own snapshots or a `tryResolve`d owner service, `null` when absent |
| root AGENTS.md | Filter by `organization_id`; never expose cross-tenant data | Compliant | the setting and the provider are resolved for the document's own scope (§ 4.4, § 8) |
| root AGENTS.md | Validate inputs with zod in `data/validators.ts`; derive types with `z.infer` | Compliant | `salesTaxProviderSettingsSchema` (§ 7); the command's local extension derives its input type |
| root AGENTS.md | `findWithDecryption` / `findOneWithDecryption` for encrypted reads | Compliant | address snapshots and the channel address are read through the decryption-aware loaders (§ 4.11) |
| root AGENTS.md | Default migration workflow (`yarn db:generate`, review SQL and snapshot; ask before `db:migrate`) | Compliant | § 6, § 16 step 8 |
| root AGENTS.md | RBAC: feature-based guards in route `metadata` | Compliant | § 7 `metadata` with `requireFeatures: ['sales.settings.manage']` |
| root AGENTS.md | Never hard-code user-facing strings; i18n keys | Compliant | § 7, § 18 (`sales.tax.errors.*`) |
| root AGENTS.md | Event IDs `module.entity.action` (`:206`) | Compliant with a note | the two ids follow the `.before/.after` shape of the existing calculation lifecycle events (`events.ts:82-99`); alternatives recorded in § 4.16 |
| root AGENTS.md | Run `yarn generate` after changing auto-discovered files | Compliant | § 16 step 14 |
| root AGENTS.md | Optimistic locking on every new user-editable entity | N/A | no new entity; the settings row keeps today's behaviour; the document commands keep `enforceSalesDocumentOptimisticLock` |
| root AGENTS.md | No `any`; functional, data-first utilities | Compliant | typed contract (§ 4.3); registry and fingerprint as functions |
| packages/core/AGENTS.md | API routes export `metadata` per method and `openApi`; custom write routes run the mutation guard registry (`:115-119`) | Compliant | § 7: `runRouteMutationGuards` (every registry guard plus the bridged legacy guard), not the deprecated pair the sibling settings routes use |
| root AGENTS.md | Integration coverage for all affected API paths ships in the same change (`:166`) | Compliant | § 17: `TC-SALES-043` to `048`; the provider path runs end to end under the flag-gated test-only `tax_stub` provider |
| root AGENTS.md (`:102`), error-reporting.mdx | A catch that records an error MUST also `reportError` | Compliant | § 8 logging rule: `reportError` with an enumerated code and ids only |
| packages/core/AGENTS.md | Encryption maps for PII / GDPR-relevant columns | Compliant with a stated choice | no new column holds personal data; `tax_info` stores jurisdiction codes, not a person's data (§ 6); the alternative (map entry) is recorded |
| packages/core/AGENTS.md | Cross-Module Coupling: optional consumer owns the glue, `try/catch` resolve, no hard `requires` (`:242-250`) | Compliant | § 4.11; `index.ts:12` unchanged |
| packages/core/AGENTS.md | Migrations: snapshot updated in the same commit (`:188`) | Compliant | § 6 |
| sales/AGENTS.md | MUST use `salesCalculationService` for document math; never reimplement inline | Compliant | the phase lives inside the engine; Resolve reuses the engine's first pass; no inline math |
| sales/AGENTS.md | Ask First: Quote → Order → Invoice flow (`:13`); adjustment kinds and configuration entity semantics (`:14`) | Compliant | Ask First paragraphs in § 4.14, § 4.8 and § 4.4 |
| sales/AGENTS.md | Validation commands (`yarn db:generate`, `yarn generate`, `yarn workspace @open-mercato/core build`) | Compliant | § 16 step 14, § 17 |
| packages/events/AGENTS.md | Declare events in the emitting module's `events.ts` with `createModuleEvents`; run `yarn generate`; Ask First on renaming | Compliant | § 4.16; nothing renamed |
| .ai/specs/AGENTS.md | `{date}-{title}.md`, no `SPEC-*` prefix; required sections; README row | Compliant | this file; the row is added in the same PR |
| .ai/qa/AGENTS.md | Integration tests in module `__integration__` folders, self-contained, no seeded data; new API behaviour covered by route-level tests | Compliant | § 17: route-level tests for the settings route, the default path and the provider path under `tax_stub`; fixtures created and deleted per test |
| BACKWARD_COMPATIBILITY.md | Validators never narrowed (§1); types additive (§2); event ids FROZEN (§5); schema ADDITIVE-ONLY (§8); DI names STABLE (§9); ACL ids FROZEN (§10); section titled "Migration & Backward Compatibility" (Deprecation Protocol step 5) | Compliant | § 10 |
| packages/ui/AGENTS.md, DS rules, packages/cache/AGENTS.md | CrudForm / DataTable / design tokens; cache strategy | N/A | no UI; no cached read API (the settings route reads one row through `loadSalesSettings`, which has no cache today) |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | the settings column, the record shape and the route body agree (§ 6, § 7) |
| API contracts match UI/UX section | N/A | no UI in this specification |
| Risks cover all write operations | Pass | provider apply, the settings write, conversion keeping the key `null`, undo and redo, concurrent writes are each in § 9 or § 12 |
| Commands defined for all mutations | Pass | no new command; `sales.settings.save` extended; the twelve recalculating commands named in § 4 |
| Cache strategy covers all read APIs | N/A | no cache; the settings read is a single-row `findOne` |
| Worked examples agree with the rules | Pass | § 5.2, § 5.5 and § 5.6 reproduce the consistency rule and the verbatim-amount rule; § 5.4 shows the discount limitation of § 4.8; § 5.8 shows the silent staleness Spec 4b owns and the racing-inputs case that fails closed |
| One name per concept | Pass | provider key, strategy key, charge, provenance record, tax phase, Resolve step, Apply step (§ 4) |
| No other software or analysis cited | Pass by design | external engines named only as the upstream docs name them |
| Exactly four Decision Requested items; Ask First items as body paragraphs | Pass | § 13; § 4.4, § 4.8, § 4.13, § 4.14 |

### Non-Compliant Items

None.

### Verdict

- **Compliant** — additive on every contract surface; no behaviour change without a configured provider; route-level coverage of the settings route, the default path and the provider path; the four answers of § Decision Requested are open; nothing here is a maintainer decision.

---

## Changelog

### 2026-10-03
- Initial proposal; status proposed — decision requested. Submitted in one PR with the roadmap `2026-10-03-tax-providers-roadmap.md`.

### Review — 2026-10-03
- **Reviewer**: Agent (fresh-context adversarial review, two passes: scope cohesion, then the checklist and compliance review against `develop` @ `7f0ebf653`)
- **Security**: fixed — the settings route runs the mutation guard registry through `runRouteMutationGuards` instead of the deprecated pair the sibling routes use (§ 7); conversion no longer carries a provenance key a client could forge (§ 4.14); failures are reported through `reportError` with enumerated codes and no request data (§ 8)
- **Performance**: fixed — the deadline races `provider.calculate` against a timer instead of relying on `withTimeout` alone (§ 4.13); the lifecycle events fire once per calculation pass and the worst case is stated (§ 4.2, § 4.16, § 10)
- **Cache**: N/A — no read API; the settings read is a single-row lookup
- **Commands**: fixed — charges are order-scope adjustments with `amountNet ≥ 0`, credits stay out of the request (§ 4); the charge carry-over reads only rows marked by the Apply step, so provider-backed shipping and payment rows of an organization without a tax provider are untouched (§ 4.8); `tax`-kind and discount rows are neutralized in the rebuild and never rewritten or removed (§ 4.8, § 6, § 10); the request's charge set is the set present at the phase's position (§ 4.2); a second mismatch fails closed on update as on create (§ 4.2, second review); a `.before` result is recorded as `overridden` (§ 4.16)
- **Risks**: the integration coverage of the provider path was first recorded as a proposed deviation and then replaced by route-level tests under the flag-gated `tax_stub` provider (second review); DR-3 narrowed to the location of the contract types; §3 tables and the Ask First defaults labelled as proposals; citations corrected (`data/entities.ts:890`, the address specification `:11`, `setup.ts:72-85`)
- **Verdict**: Needs maintainer decisions (§ Decision Requested); no open Critical/High/Medium findings

### Review — 2026-10-03 (second pass)
- **Reviewer**: Agent (fresh context, the `om-spec-writing` review mode; checklist and compliance review against `develop` @ `7f0ebf653`)
- **Security**: Passed — conversion keeps `tax_strategy_key` `null` (confirmed); the keyed-hash alternative names `hashForLookup` (§ 4.14, § 4.15)
- **Performance**: Passed — no change
- **Cache**: N/A
- **Commands**: fixed — a second fingerprint mismatch fails closed on update as on create (§ 4.2, § 5.8, § 7, § 9 F10, § 17); the phase records the lines and charges it sees on `context.tax.captured`, and Apply recomputes the fingerprint from them without a third pass (§ 4.1, § 4.2, § 4.3)
- **Risks**: fixed — the provider path gains route-level coverage under the flag-gated test-only `tax_stub` provider, the pattern of the built-in payment providers and the push stub adapter, so the Final Compliance Report has no deviation (§ 16, § 17); the barrel risk names the real import path through `totals.ts` (§ 12, § 16 step 4); `official-modules #55` cited without a file id (§ 11)
- **Verdict**: Needs maintainer decisions (§ Decision Requested); no open findings
