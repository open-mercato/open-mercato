# Tax Providers — Roadmap & Boundaries

| Field | Value |
|-------|-------|
| **Status** | **proposed** (umbrella; the child specifications detail and implement it phase by phase) |
| **Created** | 2026-10-03 |
| **Type** | Roadmap / architecture decision record |
| **Verified against** | `main` @ `e04ffd226` (2026-10-31); paths and symbols are the identifiers |
| **Companion spec (same PR)** | [Sales Tax Provider Contract](./2026-10-03-sales-tax-provider-contract.md) (Spec 1 of this roadmap) |
| **Related** | [SPEC-024 §10.2](./SPEC-024-2026-02-11-financial-module.md), [SPEC-045](./implemented/SPEC-045-2026-02-24-integration-marketplace.md), [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md), [Cart Module](./2026-08-14-cart-module.md), [Customer Groups & B2B Terms](./2026-08-14-customer-groups-and-b2b-terms.md), [Simple Checkout](./2026-03-19-checkout-simple-checkout.md), [SPEC-022 POS](./SPEC-022-2026-02-07-pos-module.md), [Sales `external` amounts mode](./2026-09-07-sales-external-amounts-mode.md), [Address-level contact details and tax identifiers](./2026-08-10-address-contact-and-tax-fields.md), [Pricing Engine](./2026-08-21-pricing-engine.md) |

---

## TLDR

**Key Points:**
- Tax on a sales document becomes a document-level, provider-backed **tax phase** of the `sales` totals pipeline with an explicit status. Today line tax is an explicit `taxAmount`, else `round(net × taxRate / 100)`, else gross minus net when a supplied gross exceeds the net, with no ship-to, buyer, date, exemption or lifecycle anywhere in the calculation. Nothing changes for a document without a provenance record unless the organization has configured a provider.
- This roadmap opens no new direction: it collects tax intent already recorded in this repository (the sales user guide and the overrides guide naming external tax engines as the thing to plug in, the `SalesTaxRate` scoping columns, SPEC-024 §10.2, SPEC-045's future `tax` category, the TC-SALES-006 and TC-SALES-016 scenarios) and gives it one contract inside `sales`.
- Each ADR states the decision, its rationale and the alternatives it rejects; the questions each child spec details are listed in § 14.

**Scope:**
- Six numbered specifications and one follow-up: Spec 1 (the provider contract, in this PR) with Spec 1b (the Resolve service for callers that are not `sales` commands), a built-in destination `sales-tax-rates` provider on the existing `SalesTaxRate` columns, a tax gateway module, the fourth delivered as two documents (tax inputs, 4a; tax recalculation, 4b), net/gross presentation, and the sixth as one amendment proposal per owner (e-commerce, POS, customer groups).
- One built-in default (`product-rate`, the name of the state without a provider: today's pass) and one built-in `sales-tax-rates` provider (`sales-tax-rates` as the working name), one new module (`tax_gateways`); vendor adapter packages stay outside this roadmap, which exposes only the contract and the gateway seam.
- Ownership boundaries and dependency direction between `sales`, `catalog`, `customers`, `integrations`, the gateway module, the provider packages and the touchpoints; twelve architecture decisions (ADR-1 … ADR-12) binding on the child specs; phasing with gates.

**Concerns:**
- The external amounts mode (#8216, merged at this base) edits the same engine files (`lib/calculations.ts`, `lib/providers/totals.ts`, `commands/documents.ts`); the provider totals calculator returns early for an order in that mode (`lib/providers/totals.ts`), so the tax phase inside it is skipped for such an order, and the commands keep such an order on the default-state path: the two guards the roadmap names (ADR-4, Spec 1 § 4.6).
- Stored line tax is frozen on recalculation today (`lib/lineSnapshots.ts`), so a provider result goes stale silently after an address or customer change until the recalculation spec (4b) lands; neither a remote nor a `sales-tax-rates` provider is production-safe for documents whose ship-to changes after placement before Phase 2 closes.
- Name collisions with the parallel period-level tax work (`ITaxEngine`, `TaxCode`, `tax_management`) are avoided by construction; the cart and buyer context carry no address, so destination tax before checkout needs an amendment the e-commerce owners must accept.

---

## 1) Overview

This is an umbrella specification. It contains no implementable work of its own: every column, type, endpoint and command it names is specified and owned by a child spec, and the child spec's text governs the exact shape. It proposes which module owns which tax concept and the dependency direction between them, records twelve architecture decisions binding on the child specs, sequences the child specs and gates their phases. A child spec that needs to deviate amends this document first (the rule the ecommerce suite roadmap sets for itself, `2026-08-14-ecommerce-suite-roadmap.md`); amendments to documents owned by other teams are proposals until their owners accept them.

Who needs it: a merchant or organization that sells in the United States or on another market where the tax rate is not a fixed rate attached to the product but is computed at calculation time from the ship-to address (state, county, city and special district), the product's tax code and the customer's facts (resale or exemption certificates, entity use, tax ids), with results broken down per jurisdiction and a lifecycle of estimate (quote, cart) and record (order). The same contract serves a merchant on a fixed-rate market who wants nothing to change: without a configured provider every document without a provenance record calculates exactly as today.

> **Market Reference**: the platforms studied for this design, stated as the author's knowledge: Shopware 6, where a tax-provider step replaces the calculated taxes of lines and deliveries at checkout confirmation and order placement only, never on admin order edits, and PHP providers fail closed while app providers fall back silently in production; Magento Open Source 2, where total collectors around one tax calculation service select the rate from customer and product tax classes with country, region and postcode rules, a missing input yields a silent zero, and net or gross is a store-view setting; Medusa v2, where a separate tax module hands the lines to one provider chosen by the country region, the provider returns rates rather than amounts with no commit or void, and there is no fallback; Sylius, where a per-channel tax calculation strategy runs inside an order processor after shipping and promotions and is re-applied on every cart change, and without a zone or rate the tax is a silent zero; Odoo, where taxes are mapped through fiscal positions chosen by the partner's country, country group, state or ZIP range, and the AvaTax connector is enabled per fiscal position and computes tax when an invoice or credit note is posted. The two external tax engines the repository's docs already name are Avalara and TaxJar (`apps/docs/docs/user-guide/taxes.mdx`, `apps/docs/docs/framework/pricing-tax-overrides.mdx`).
>
> What the design adopts: a default strategy plus a replaceable provider (Shopware's provider step; Odoo's connector enabled per fiscal position); tax as a late phase after the charges it taxes and before fees computed on the gross total (Sylius's processor order); one provider call per document write returning amounts with a jurisdiction breakdown, because a rates-only contract (Medusa) cannot carry provider amounts, flat fees or jurisdictions; an explicit status and a fail-closed default, the silent zero of Magento and Sylius and the silent fallback of Shopware's app providers being the failure class to avoid; amounts written verbatim, never re-derived from a rate (the author's rule; it keeps a provider's document-level rounding intact); tax detail stored per line item with the provider's code, rate and provider id (Medusa's line item tax lines) as the model for the line detail columns of Spec 4a.
>
> What it rejects: a separate tax module (Medusa), because the e-commerce suite roadmap's ADR-2 makes the cart inherit totals from `salesCalculationService` and the names collide with the parallel period-level work; a provider that runs at checkout only (Shopware), because back-office documents are edited after placement; per-document selection of the provider (Odoo enables its connector per fiscal position, itself detected from the partner's address), because here the setting is organization-level and documents record provenance only; a global net/gross switch (Magento's store-view setting), because presentation, entry mode and the request's inclusive flag are three different things (ADR-11).

### 1.1 Alignment with intent already recorded in this repository

Since November 2025 the sales user guide has said that `sales.tax.calculate.before` can swap the tax class "based on geography or customer metadata" and short-circuit the default math "when you use an external tax engine such as Avalara" (`apps/docs/docs/user-guide/taxes.mdx`); the catalog API guide points at the same seam (`apps/docs/docs/api/catalog.mdx`); the overrides guide marks the place to "Call your provider here (Avalara, TaxJar, etc.)" (`apps/docs/docs/framework/pricing-tax-overrides.mdx`). `SalesTaxRate` was modelled with geographic, customer, product and priority scoping (`packages/core/src/modules/sales/README.md`; columns `data/entities.ts`; admin form fields `components/TaxRatesSettings.tsx`), and the scenarios TC-SALES-006 and TC-SALES-016 expect rate selection by customer location, recalculation when the shipping address changes and zero tax for exempt customers (`.ai/qa/scenarios/TC-SALES-006-order-tax-calculation.md`; `.ai/qa/scenarios/TC-SALES-016-tax-rate-configuration.md`). At `e04ffd226` none of those inputs reaches the calculation: `CalculateTaxInput` carries an amount, a mode, the tenant scope and a rate id or raw rate (`services/taxCalculationService.ts`). The financial epic #260 (feat: Financial Management Module) and SPEC-024 §10.2 list transaction tax calculation and exemptions behind a pluggable engine (`SPEC-024-2026-02-11-financial-module.md`), and SPEC-045 names `tax` (TaxJar, Avalara) as a future integration category (`implemented/SPEC-045-2026-02-24-integration-marketplace.md`). The address specification behind #5232 (Implement: Address-Level Contact Details and Tax Identifiers) records that a B2B invoice address is incomplete without the tax identifier it was issued under (`2026-08-10-address-contact-and-tax-fields.md`), and #5771 (an address carries a phone and the tax id it was invoiced under) stores that id on document address snapshots. The ecommerce suite roadmap from #5384 fixes that the cart never computes tax and that all totals go through `salesCalculationService` (its ADR-2, `2026-08-14-ecommerce-suite-roadmap.md`), so the provider contract sits behind that service and adds no second arithmetic path of its own (the storefront's display-only rate matching and price-side conversion at head are recorded in § 2 point 5 and § 11); the Resolve step that such callers need before the service is a `sales`-owned DI service specified in Spec 1b (ADR-2).

This roadmap proposes that the existing `SalesTaxRate` table becomes a built-in provider, that `taxCalculationService` and the `sales.tax.calculate.*` events keep working unchanged, and that a document without a configured provider or a provenance record calculates exactly as today. Vendor adapters follow the SPEC-045 hub-and-spoke shape as separate packages and are not part of this PR. This roadmap reads SPEC-024 §10.2 as superseded for transaction-level tax only: nothing implements it at this head, and the `tax_management` specification of PR #6168 states that transaction-level tax calculation is `SalesTaxRate`'s territory in `sales`; the period-level work stays untouched.

### 1.2 What argues against this direction

Each ADR records the alternatives it rejects and the child spec that answers it; the counter-arguments on record are SPEC-024's placement of transaction tax in the financial module (ADR-1, Spec 1 § 3), the names taken by the period-level work (§ 9), the existing unit seam (§ 2, ADR-3), the address-less cart (ADR-3, § 14 Q16), SPEC-045's hub rule (ADR-1, ADR-7), the externally taxed amounts mode (ADR-4, § 11), the deferred country normalization (ADR-5) and the customer-groups spec's rate matching by group, which at head the storefront's display-only matcher and the `catalog` buyer pricing service behind the cart's line prices perform and no code in `sales` does (ADR-6, § 2 point 5, § 11).

---

## 2) Problem Statement

Paths are under `packages/core/src/modules/sales/` unless stated; Spec 1 § 2 states the seams these points touch.

1. **Tax is a per-line, rate-only computation**: an explicit `taxAmount`, else `round(net × taxRate / 100)`, else gross minus net (`lib/calculations.ts`); the calculation context carries no address, customer, channel or date (`lib/types.ts`; `commands/documents.ts`).
2. **The documented seam is a unit converter**: `CalculateTaxInput` carries an amount, a mode, the tenant scope and a rate id or raw rate (`services/taxCalculationService.ts`); no document, status, commit or void.
3. **Stored tax is frozen and the recalculation triggers are narrow**: stored tax is fed back as an explicit input (`lib/lineSnapshots.ts`; a line upsert derives it again only when that line's own pricing inputs change), header updates recalculate only on a method or currency change (`shouldRecalculateTotals`, `commands/documents.ts`; the order update also on a change of its totals mode or a supplied external header) and the address commands never calculate, so a provider result would go stale silently (Spec 4b).
4. **The header fields exist but are unsafe**: `tax_strategy_key` and `tax_info` (`data/entities.ts`) are free-form and client-writable on create (`data/validators.ts`), displayed by the document history widget and read by nothing else.
5. **The rate table is designed for scoping that the engine does not perform**: `SalesTaxRate` carries geographic, customer, product, channel, priority and validity columns (`data/entities.ts`), the engine's only resolver matches by id (`services/taxCalculationService.ts`), `catalog` reads the table directly (issue #6733), and the storefront read side matches rows itself for display (channel, customer-group order, validity dates, `priority` and default: `selectStorefrontTaxRate`, `packages/core/src/modules/ecommerce/lib/storefrontPricing.ts`), and the `catalog` buyer pricing service that prices cart lines matches them by channel, customer-group order, validity dates and `priority` for a missing price side (`selectBuyerTaxRate`, `packages/core/src/modules/catalog/services/catalogBuyerPricingService.ts`), two scoped matchers outside `sales` (§ 11).
6. **Remote calls do not fit the transaction shape**: header updates and the line and adjustment commands calculate inside `withAtomicFlush(..., { transaction: true })` under the document-row lock (`commands/documents.ts`), conversion and the public accept route hold `PESSIMISTIC_WRITE` locks (`commands/documents.ts`; `api/quotes/accept/route.ts`) and returns calculate under locks (`commands/returns.ts`); a provider must be called before the transaction and applied before the write is flushed.
7. **No status, no provenance, no place for charge tax**: the only totals hook runs shipping then payment (`lib/providers/totals.ts`) with payment fees computed on the gross total (`lib/providers/defaultProviders.ts`), so tax must sit between them, and nothing records which strategy produced a document's tax or its per-jurisdiction amounts.

---

## 3) Proposed Solution

- **A `tax` phase** in the `sales` totals pipeline, shipping → tax → payment, as a fixed step inside the existing provider totals calculator (ADR-1). After the phase, line tax plus charge tax equals the result's `taxTotalAmount`; `tax`-kind adjustments, `taxPortion` and explicit line `taxAmount` are never double-counted.
- **Resolve/Apply:** ADR-2.
- **Contract:** `TaxProvider` `{ key, label, description?, calculate(request, ctx) }` mirroring `ShippingProvider`; `SalesTaxRequest` and `SalesTaxResult` as boundary types with intent `display | estimate | record` and the status vocabulary of Spec 1 § 4.3; registry `registerTaxProvider` / `getTaxProvider` / `listTaxProviders` (ADR-3, ADR-12).
- **Selection** (ADR-4): the provider is configured per organization in the existing sales settings (one additive nullable column); documents carry server-written provenance (`tax_strategy_key` = `tax-provider:<providerKey>`, `tax_info` = the provenance record); never per document.
- **Built-in default and `sales-tax-rates` provider** (ADR-5, ADR-6): `product-rate` names the default state (no provider configured; nothing changes for a document without a provenance record) and the built-in `sales-tax-rates` provider on the existing `SalesTaxRate` columns (working name `sales-tax-rates`; CSV import and export; `sourcing: destination` by default, `origin` and `billing` as options).
- **Tax gateway module** (ADR-7, ADR-8): `tax_gateways` (new): settings UI, credentials through `integrations` with an additive `tax` category, commit/adjust/void as workflow activities with a coded default binding (ADR-8), failure policy `fail | fallback-sales-tax-rates` (ADR-8), idempotency keys, admin-visible log; a provenance reference on invoices and credit memos and the stop after `commit` (ADR-8).
- **Provider packages outside the core modules** for remote engines: the first provider is the built-in destination `sales-tax-rates` provider of Spec 2, inside core `sales`; nexus, address validation and VAT-id validation are outside the `sales` contract; vendor adapter packages, their location and their timing are outside this roadmap, which exposes only the contract (Spec 1) and the gateway seam (Spec 3); inside this repository the root rule for external integration providers (`AGENTS.md`) applies to them.
- **Provider-owned facts** (ADR-10): the request carries references and document facts; a provider reads its own fields through `resolve`; core defines no provider-specific field.
- **Inputs, recalculation and presentation** (ADR-9, ADR-11): the customer group set, address sources, line detail columns and discount allocation (Spec 4a); wider recalculation triggers and their stop after an issued invoice, `stale`, the recalculate command and the frozen-tax fix (Spec 4b); net/gross presentation kept apart from entry mode and from the request's inclusive flag (Spec 5).
- **Events (additive):** `sales.tax.document.calculate.before/after` (Spec 1; notification-only), `sales.tax.input.changed` (Spec 4b); `tax_gateways.transaction.committed / voided / failed` declared in the gateway module's `events.ts` (Spec 3, the emitter); the existing `sales.tax.calculate.*` pair (`events.ts`) stays with the unit seam.
- **Commands:** Spec 1 adds no command. An explicit recalculation command (`sales.orders.recalculate_totals` / `sales.quotes.recalculate_totals`, free at `e04ffd226`) belongs to Spec 4b; the ids follow the module's plural convention (`sales.orders.lines.upsert`, `sales.quotes.convert_to_order`), see the Final Compliance Report.

---

## 4) Module Inventory

| Module | Role | Must not own |
|---|---|---|
| `sales` (extended) | Tax phase, contract types, registry, organization-level selection, rate matching on `SalesTaxRate` (Spec 2), line detail columns (Spec 4a), triggers and their stop (Spec 4b), the provenance columns on invoices and credit memos (Spec 3), presentation-mode consumption (Spec 5), the Resolve service for non-command callers (Spec 1b) | Credentials, provider logs, vendor code, period liabilities |
| `catalog` | Product tax facts at head (`taxRateId` and `taxRate` on product and variant, `packages/core/src/modules/catalog/data/entities.ts`; `taxClassificationCode`); provider-specific codes are provider-owned extensions (ADR-10) | Tax arithmetic |
| `customers` / `customer_groups` (extended) | Customer facts (ids, address snapshots with tax id); the group set through `customerGroupsService.resolveGroups`; exemption facts are provider-owned extensions (ADR-10) | Rates, arithmetic |
| `tax_gateways` (new) with `integrations` (additive) | Settings UI, provider lifecycle (commit/adjust/void as workflow activities with a coded default binding), failure policy, log; credentials and log entries through the `integrations` services `payment_gateways` already uses (`packages/core/src/modules/payment_gateways/lib/gateway-service.ts`) under an additive `tax` member of `IntegrationCategory` (`packages/shared/src/modules/integrations/types.ts` has none today) | Arithmetic, rate matching; `integrations` never owns provider-specific logic (its own `AGENTS.md` rule) |
| Touchpoints: `@open-mercato/checkout`, `ecommerce`, `cart`, POS (§ 2 point 5, § 11) | Call the contract through `salesCalculationService` (ecommerce suite roadmap ADR-2), with the `context.tax` slot supplied by the Resolve service of Spec 1b (ADR-2) | Own tax arithmetic; their own Resolve |

---

## 5) Dependency Direction

```
   cart / checkout / POS / back office        (touchpoints; every total via salesCalculationService)
                      │
                      ▼
               ┌─────────────┐   reads facts through DI services, soft-resolved
               │    sales    │──────────────┬──────────────────┐
               │ tax phase,  │              ▼                  ▼
               │ contract,   │        ┌──────────┐      ┌──────────────────────┐
               │ registry,   │        │ catalog  │      │ customers /          │
               │ selection,  │        │(ids only)│      │ customer_groups      │
               │ provenance  │        │          │      │ (group set)          │
               └──────┬──────┘        └──────────┘      │                      │
                      ▲                                 └──────────────────────┘
      consumes types  │ (lifecycle,             ┌──────────────┐
       policy, log)   │                         │ integrations │  credentials, log
                      │                         └──────▲───────┘
               ┌──────┴────────┐    credentials        │
               │ tax_gateways  │───────────────────────┘
               │ (lifecycle,   │
               │  policy, log) │◄──── vendor provider packages (adapters): register a TaxProvider into sales, credentials into integrations
               └───────────────┘

   tax_management / ledger / GL posting (parallel work) ──► read sales output; never read by sales
   workflows (coded definition, activities) ◄──── tax_gateways ships the lifecycle workflow; the merchant customizes it
```

**Rule:** touchpoints point to `sales`; `sales` consumes `catalog` and `customers` facts only through DI services resolved in `try/catch` (`packages/core/AGENTS.md`), never through ORM reads of their entities; `tax_gateways` consumes `sales` types, `integrations` and the workflow module (a coded definition and activity registration, ADR-8), never the reverse; vendor packages register providers into `sales` and credentials into `integrations`, and `integrations` never imports a provider (its own Never rule); period-level tax, the ledger and general ledger (GL) posting read `sales` output and are never read by `sales`; every edge is an FK id plus a DI-resolved service, and optional peers degrade to `null` facts, never to a hard `requires` (`index.ts` requires `catalog`, `customers`, `dictionaries` only, unchanged).

---

## 6) Architecture Decisions

Each ADR binds the child specs. Where § 14 lists a question for a child spec, the ADR states the position and the child spec details it.

### ADR-1 — The tax phase is a step of the `sales` totals pipeline, inside the provider totals calculator
**Decision.** Transaction-level tax is computed by a tax phase of the `sales` totals pipeline, between the shipping block and the payment block of the existing provider totals calculator (`lib/providers/totals.ts`), with no public API change. The contract types and the registry are exported by `sales`.
**Rationale.** `sales` owns the arithmetic, `SalesTaxRate` and the single totals hook; payment fees are computed on the gross total (`lib/providers/defaultProviders.ts`) and the hook rebuilds from its `lines` argument (`lib/providers/totals.ts`), so the step is reachable only from inside it; the ecommerce suite roadmap's ADR-2 makes the cart inherit tax from `salesCalculationService`; SPEC-045's hub rule (`implemented/SPEC-045-2026-02-24-integration-marketplace.md`) is kept for credentials and lifecycle (ADR-7), because the calculation seam cannot run outside the totals calculation. The split also matches statutory VAT practice in Poland: the tax is fixed on the document at transaction time, and the Polish periodic VAT return (JPK_V7M) is built afterwards from the document register, so a period engine consumes document tax and never computes it.
**Consequence.** Third-party totals hooks keep today's behaviour: a prepended hook's edits to totals are rebuilt away by the provider calculator today; an appended hook runs after tax and its charges stay untaxed, and Spec 1 adds that rule to the docs page that shows appended calculators adding fees (`apps/docs/docs/framework/modules/sales/calculations.mdx`), which does not mention tax today.
**Rejected alternatives.** An additive phase option on `registerSalesTotalsCalculator` (an explicit phase API can be added later without touching the contract), no phase with tax fed through explicit `taxAmount` and metadata (which the regenerated provider adjustments lose), a separate tax module (collides with the ecommerce suite roadmap's ADR-2 and needs a cross-module workflow layer that does not exist) and the SPEC-024 §10.2 plugin hook (transaction-level tax needs the document, addresses and charges only the `sales` pipeline has; §10.2 is read as superseded for the transaction-level part only); Spec 1 § 3 carries the reasons.
**Detailed in Spec 1 § 3.**

### ADR-2 — Resolve before the transaction, Apply before the flush, the phase writes
**Decision.** The provider is called in the command layer before the write transaction, on the future document state; the result is applied in a second calculation pass before the flush (under a configured provider the two header updates and the line and adjustment commands calculate before the transaction instead of inside it under the document-row lock; under `product-rate`, and for an order on the default-state path of the external amounts mode, every command calculates as today, the line, adjustment and header-update commands inside their transaction under the document-row lock of #6925), and any change between Resolve and the write fails closed with 409 (Spec 1 § 4.2); without a provider there is no Resolve.
**Rationale.** The lock sites of § 2 point 6 must not hold rows during network I/O; the engine stays deterministic, which the ecommerce Phase 2 gate (cart totals byte-identical to the order) depends on.
**Consequence.** Under a configured provider, one transaction boundary for every recalculating command (Spec 1 § 4.2); return commands run no provider call in Spec 1 and keep writing the header totals only (`commands/returns.ts`), with the stored `shipping-provider:` rows of a provider-taxed order kept (Spec 1 § 4.8); the explicit recalculate command that refreshes a `stale` document is Spec 4b. Callers that are not `sales` commands (the cart, checkout, POS) run Resolve through a `sales`-owned DI service (working name `salesTaxResolutionService`) that runs the Resolve step on a non-persisted document and returns the `context.tax` slot, with the first pass's shipping drafts, that `calculateDocumentTotals` applies; Spec 1b (a follow-up of Spec 1, Phase 1) specifies and registers it on top of Spec 1's request builder and phase, and until it exists those callers receive `product-rate` figures from the service.
**Rejected alternatives.** The provider call inside `calculateDocumentTotals` (holds transactions and `PESSIMISTIC_WRITE` locks for a round trip; makes the engine non-deterministic).

### ADR-3 — A document-level contract with explicit status; the unit seam stays as the predecessor
**Decision.** `SalesTaxRequest` carries the document, the three addresses, the customer id, lines with their tax inputs, charges, tax date, currency, `pricesIncludeTax` and the intent; `SalesTaxResult` carries per-line and per-charge results keyed by `ref` with their jurisdictions, a document-level total and a provider reference, and no status (the stored status is derived by the command, Spec 1 § 4.7); the invariant `gross = net + tax` holds by construction where the tax phase writes the result (Spec 1 § 4.10). `taxCalculationService` and `sales.tax.calculate.before/after` stay unchanged and are documented as the predecessor for unit price entry; the docs gain a chapter on document-level providers with a table of what the unit seam cannot carry.
**Rationale.** A rates-only contract cannot carry provider amounts, flat fees or jurisdictions; the unit seam has no document, address, customer, status or lifecycle (`services/taxCalculationService.ts`).
**Consequence.** The intent is set by the caller, never derived from the document kind, because the cart calls the engine with a quote-like document (`2026-08-14-cart-module.md`): `estimate` for quotes and for a cart once a ship-to address is known, `record` for orders, `display` for cart and UI previews, never remote (Spec 1 § 4.7). For the touchpoints this means: the cart shows `display` figures without a ship-to (local math only: `product-rate`, or the `sales-tax-rates` provider from the channel's origin; the request carries the customer id and `pricesIncludeTax`), checkout runs `estimate` with the address, `cart.lock()` recalculates with the address, checkout creates the order as a quote and its conversion (`2026-03-19-checkout-simple-checkout.md`), which copies without a calculation, so the order's `record` result comes from its first recalculating write (Spec 1 § 4.14), which amendment 6a places before the gateway payment, so a tax failure aborts before any payment is taken, and `failed` blocks submit; POS taxes at the store location with gross prices (`SPEC-022-2026-02-07-pos-module.md`). Those are amendment proposals to the owners of the e-commerce specs (§ 14 Q16), not edits.
**Rejected alternative.** A Deprecation Protocol entry for `taxCalculationService` and `sales.tax.calculate.*` (§ 14 Q11).

### ADR-4 — The provider is selected per organization; documents carry server-written provenance
**Decision.** The provider is selected per organization in `sales_settings` (one nullable column, `NULL` = `product-rate`); documents carry server-written provenance only, and orders in the external amounts mode never call a provider (Spec 1 § 4.4, § 4.6).
**Rationale.** Per-document selection would make a free-text, client-writable field an authority and needs a quote column; a jsonb settings bag hides a typed setting; one nullable column is reversible.
**Consequence.** Per-channel or other scoped overrides of the setting are a later spec (channel scoping is listed in `packages/core/src/modules/sales/AGENTS.md`); the provenance prefix is a convention for server-written values, not a guarantee.
**Rejected alternatives.** Per-document selection through a namespaced `tax_strategy_key`; new provenance columns on orders and quotes; a jsonb settings bag.

### ADR-5 — `product-rate` names the default state; the OSS applicability rule and the EU reverse-charge rule come later
**Decision.** `product-rate` is the name of the default state (no provider configured, the `NULL` setting), not a registered provider: the engine runs today's line tax (§ 2 point 1) in its single pass with no Resolve and, on a document without a provenance record, no `tax` slot (Spec 1 § 4.8), so documented hooks such as the gift line that zeroes `taxAmount` keep working and totals stay byte-identical. The rule that decides whether the OSS scheme applies to a cross-border sale (the union-wide threshold and the seller's registration) and the rule that decides an EU reverse charge (the buyer's VAT-id validity and the place of supply) are not part of the specifications this roadmap lists: the request carries the ship-to country and the tax ids so a later resolver over the contract can decide them, while the destination country's rate itself is a `SalesTaxRate` row the `sales-tax-rates` provider matches on `country_code` / `region_code` under destination sourcing (ADR-6); the cross-border default is `keep-net`: when a destination rate differs from the product's rate, the net price is kept and the gross changes. Under any configured provider every gross-entered line keeps its net and its gross changes (Spec 1 § 4.10) until the gross-preserving split lands in Spec 4a with its line columns.
**Rationale.** The first PR must not change amounts for any existing tenant; the address spec defers country normalization and VAT-id validation, on which both features depend.
**Consequence.** A later specification outside this roadmap's list may add the OSS and reverse-charge rules over the contract without touching it; the exemption or reverse-charge outcome itself is result vocabulary any provider may return (Spec 1 § 4.9), and how a matched `SalesTaxRate` row expresses it is Spec 2's to state (§ 7.1 row 2).
**Rejected alternatives.** A resolver of the OSS applicability rule or of the EU reverse-charge rule among the specifications this roadmap lists; a registered `product-rate` provider (a protected registry entry whose `calculate` recomputes tax from the rate, overwriting explicit `taxAmount`); `keep-gross` as the cross-border default (the gross price kept and the net changed).
**Routed:** § 14 Q15 (Spec 2).

### ADR-6 — The built-in `sales-tax-rates` provider runs on the existing `SalesTaxRate` columns
**Decision.** The `sales-tax-rates` provider (working name `sales-tax-rates`; the final name is chosen in Spec 2) matches `SalesTaxRate` rows on the existing columns (`data/entities.ts`): country, region, postal code or range, city, channel, priority, compound and validity dates, and customer groups as a set under the set-membership substitution and the group precedence of the customer groups specification (`2026-08-14-customer-groups-and-b2b-terms.md` §7.2 and §3.2), where how that precedence combines with the row's `priority` is Spec 2's to state; the existing `product_category_id` column can match only once Spec 4a puts the product facts on the line, so category matching depends on Spec 4a, and a product-code key is the provider's own field (Spec 2); with CSV import and export and a sourcing setting of the organization, not a column of the table: `destination` by default, `origin` (ship-from = channel address) and `billing` (bill-to) as options. Group matching takes the set of group ids from the owner's DI service when one is registered (Spec 2 resolves it with `tryResolve`; from Spec 4a the request carries it as a named field, ADR-10) and otherwise matches rows with `customer_group_id = null` only; orphaned ids are reported, not ignored (ecommerce roadmap risk R3).
**Rationale.** The schema was designed and documented for this (`README.md`); only the matching logic in `sales` is missing (the storefront's display-only matcher and the `catalog` buyer pricing service are recorded in § 2 point 5). Destination sourcing is the default because it works for remote and cross-border sales of goods and reuses the ship-to the contract carries; origin exists for markets that tax by the seller's location, and billing for supplies taxed where the customer is established (services to businesses in the EU), which is why the request carries all three addresses (Spec 1 § 4.11).
**Consequence.** The provider is deterministic and needs no remote call, so it can ship before Spec 4b; it recomputes on every recalculating write, but a ship-to change alone does not recalculate until Spec 4b widens the triggers (§ 2 point 3), so a document under the `sales-tax-rates` provider can hold stale tax after an address change exactly like one under a remote provider; the Phase 1 gate states that limitation. Destination facts come from the header snapshot. The admin UI extends the existing tax-rate CRUD (`api/tax-rates/route.ts`, `makeCrudRoute`, every method behind `sales.settings.manage`) and its `CrudForm` dialog (`components/TaxRatesSettings.tsx`; issue #6414). The outcome for a line or charge that no scoped row matches and how a matched row expresses an exemption or a reverse charge are Spec 2's to state (§ 7.1 row 2), under the Phase 1 gate (§ 8). The storefront read side and the `catalog` buyer pricing service match rows themselves at head (§ 2 point 5, § 11); Spec 2 states the `sales`-owned read of the provider's matching that these readers consume once the organization selects the provider, so one matcher applies.
**Rejected alternatives.** A new rate table (duplicates `SalesTaxRate`); origin sourcing only; an external provider only; a mock provider as the only proof of the contract (the `sales-tax-rates` provider proves it for real use; Spec 1's test-only `tax_stub` proves the provider path in tests).
**Routed:** § 14 Q14 (Spec 2).

### ADR-7 — A separate `tax_gateways` module; credentials through `integrations`; vendor packages outside the core modules
**Decision.** A new core module `tax_gateways` (working name; table prefix `tax_gateway_`) shaped like `payment_gateways` and `shipping_carriers` (`implemented/SPEC-045-2026-02-24-integration-marketplace.md`) holds the settings UI, the provider lifecycle, the failure policy and the admin-visible log; credentials live in `integrations` under an additive `tax` member of `IntegrationCategory` (a `packages/shared` change; "registry type contracts" are listed in `packages/core/src/modules/integrations/AGENTS.md`); sensitive fields are declared through the module's `encryption.ts` maps. Vendor adapters are packages outside the core modules (the root rule `AGENTS.md`).
**Rationale.** The contract and the registry stay in `sales` (ADR-1; Spec 1 § 3), while lifecycle, credentials and logs are the hub's job per SPEC-045; `payment_gateways` already consumes `integrationCredentialsService` and `integrationLogService` (`packages/core/src/modules/payment_gateways/lib/gateway-service.ts`).
**Consequence.** `tax_gateways` consumes `sales` types, `integrations` and the workflow module (its coded workflow definition and activities, ADR-8); vendor packages register a `TaxProvider` into `sales` and credentials into `integrations`; providers resolve credentials through the `resolve` of their context (Spec 1 § 4.3), with the credential services Spec 3 registers.
**Rejected alternatives.** Everything in `sales` (too much for one module); everything in vendor packages (no shared lifecycle or log); an own credential store.
**Routed:** § 14 Q13 (Spec 3).

### ADR-8 — Commit, adjust and void run as workflow activities bound to `sales` events, with idempotency and a failure policy
**Decision.** `commit`, `adjust` and `void` are optional provider methods typed by Spec 3; the gateway module exposes them as workflow activities (a function in the DI container run by the `EXECUTE_FUNCTION` activity, or a registered activity type; Spec 3 chooses) and ships a coded workflow definition that binds them to `sales` events, so the trigger is the platform's native configuration: a merchant changes the binding through the workflow module's customization, and the shipped default binding is Spec 3's choice among `sales.order.confirmed`, `sales.payment.created` and `sales.invoice.created` (§ 14 Q4); each activity runs on the durable queue with retries, carries an idempotency key per call and does nothing for an organization without an active gateway; business rules are not used, because their action set is closed to modules; recording a transaction with the provider is a capability of a provider that declares the lifecycle methods (the `sales-tax-rates` provider of Spec 2 declares none) and must be switchable off for an organization that records its transactions elsewhere (the way is Spec 3's); one failure policy per provider with two values: `fail` (the write fails as in Spec 1 § 4.13) and `fallback-sales-tax-rates` (the `sales-tax-rates` provider of Spec 2, the result recorded with status `fallback`); a provider disabled mid-quote follows the same policy (`stale` stays reserved for Spec 4b); invoices and credit memos keep caller-supplied amounts (`sales.invoices.create` and `sales.credit_memos.create` never call the engine; Spec 3 adds a provenance reference to them, no amounts).
**Rationale.** A remote call must not sit inside a document command; durable subscribers and workflow activities on the queue are the sanctioned side-effect mechanisms (`packages/events/AGENTS.md`); a coded workflow definition is live in every tenant without a database row and stays customizable, and the `sales` module already ships one (`packages/core/src/modules/sales/workflows.ts`), so the trigger needs no setting of its own.
**Consequence.** The invoice amounts source does not change, so the Quote → Order → Invoice flow (`packages/core/src/modules/sales/AGENTS.md`) stays as it is. After an issued invoice or a committed provider transaction, whichever comes first, no recalculation trigger rewrites a document's stored tax: a change goes through the provider's `adjust` and a correcting document (a credit memo or a corrective invoice), which keeps posted amounts and the provider's filing reproducible (Spec 3 states the stop after `commit`, because it introduces `commit`, and the `adjust` path; Spec 4b states the stop after an issued invoice). An invoice or credit memo that commits or voids the order's transaction carries a provenance reference to the order's provider result (an additive column on `sales_invoices` and `sales_credit_memos`, Spec 3), so that `adjust` and `void` find the transaction they act on; no specification of this roadmap writes invoice or credit-memo line amounts (Spec 1 § 6).
**Rejected alternatives.** Commit fixed at invoice; a commit-point setting with a fixed list of values (a second place to configure what a workflow already binds); a business rule as the trigger (its action set is closed to modules and a failed action is not retried); invoice tax derived pro rata from the order by a specification of this roadmap; silent zero on failure.

### ADR-9 — Inputs and recalculation are two specs after the contract: 4a carries the facts, 4b the triggers
**Decision.** Spec 4a (tax inputs) gives the request the facts it lacks today (the customer group set through its owner service, ADR-10), the address sources (ship-to from the header snapshot, § 14 Q6; ship-from from a `sales`-owned resolver over the channel address, `data/entities.ts`), the line detail columns on the four line tables (names governed there; on invoice and credit-memo lines they are caller-supplied input, § 14 Q5) and the allocation of document discounts to lines before the tax phase. Spec 4b (tax recalculation) widens recalculation to address, customer, channel, `placedAt`, `exchangeRate` and provider-setting changes with their stop after an issued invoice (ADR-8), sets `stale`, adds the explicit recalculate command, fixes the frozen-tax carry-over (the stored tax fed back by `mapPersistedLine`, and by the line upserts while a line's pricing inputs are unchanged) behind `tax_manual_override` with the `price_entry_mode` backfill, reverses tax on returns and changes the line dialog to send only the entered price, its mode and the rate id.
**Rationale.** 4a works under today's triggers, and 4b's triggers read fields that exist today, but 4b's carry-over fix and `price_entry_mode` backfill need 4a's columns, so 4a precedes 4b; one combined document would span three modules, four line tables, a backfill and a behaviour change for every tenant. A remote provider whose result survives an address change is unsafe in production, so 4b closes Phase 2; the frozen-tax fix changes stored amounts and needs an `UPGRADE_NOTES.md` entry in the "heals on next write" style with a flag that protects explicit `taxAmount`.
**Consequence.** Until Spec 4b lands, provider documents can hold stale tax after an address change, and a provider-taxed document keeps its stored `shipping-provider:` rows on the passes without a provider call that Spec 1 § 4.8 names; Phase 2 does not close before it; the per-line and per-jurisdiction breakdown lives in the header `tax_info` record until Spec 4a's columns exist.
**Rejected alternatives.** One combined inputs-and-recalculation spec; estimate on every line save (cost and races); header-only results forever (posting and period tax need per-line data); fixing the carry-over in Spec 1 (breaks "nothing changes without a provider").

### ADR-10 — Core forwards references and the facts it already holds; provider-specific facts belong to the provider package
**Decision.** The request carries identifiers and document facts (addresses, customer id, product and variant ids, line rate and price mode, channel, currency, date). Facts only a given provider needs (a tax code in the provider's own namespace, an exemption certificate or entity use code, a tax-exempt flag) are declared and owned by the provider package as custom fields or an extension entity on the catalog and customer entities, through the framework's extension mechanisms, and read by the provider through the `resolve` of its context (Spec 1 § 4.15); core defines no provider-specific field; the built-in `sales-tax-rates` provider (Spec 2) is part of core `sales` and owns its fields the same way; the customer group set, resolved through `customerGroupsService.resolveGroups`, enters the request in Spec 4a.
**Rationale.** Core cannot know what each provider needs; the framework offers per-package extension of other modules' data without touching core entities; issue #6733 remediates cross-module ORM reads, and a provider reading its own extension data adds none.
**Consequence.** Two providers may hold two different codes for one product, and a merchant switching providers classifies again; a change to a provider-owned field does not trigger a core recalculation (Spec 4b's triggers cover core facts), so the next recalculating write or the explicit recalculate command re-taxes; a provider-owned field that holds an identifier is declared in that package's `encryption.ts` map and read through `findWithDecryption`.
**Rejected alternatives.** Core-owned product tax code and exemption columns filled by owner DI services; one shared canonical tax code (one namespace cannot serve engines with different code sets).

### ADR-11 — Three net/gross concepts are kept apart; presentation derives from the group's price kind
**Decision.** Entry mode (per line, `metadata.priceMode` today), the request's inclusive flag (`pricesIncludeTax`: `true`, `false` or `'mixed'`) and presentation mode (`tax_mode`, `gross | net`, the name the cart spec already uses, `2026-08-14-cart-module.md`) are three different things. Presentation derives from the `displayMode` of the price kind the customer group points to (customer-groups spec §6.1a, `2026-08-14-customer-groups-and-b2b-terms.md`; `CatalogPriceKind.displayMode`, `packages/core/src/modules/catalog/data/entities.ts`; the derivation the storefront read side already ships, `packages/core/src/modules/ecommerce/lib/buyerContext.ts`, where a buyer who resolves to no price kind gets the store default `priceDisplayModeDefault`, `packages/core/src/modules/ecommerce/data/validators.ts`, which Spec 5's resolution order names), then from the selling country or channel, then from the document's price kind; the line dialog's change to send only the entered price, its mode and the rate id (the server derives the other side) ships with Spec 4b, because it is an entry-mode fix, not presentation.
**Rationale.** A global net/gross switch is the known failure class; the customer-groups spec says the price kind is the only source of display mode for a group, while the cart spec says `resolveTerms()` returns a tax mode (`2026-08-14-cart-module.md`), an inconsistency the owners must settle; for the storefront the shipped code reads no group term: the price kind, else the store default (`resolveTaxMode`, above), so the shipped storefront follows §6.1a; amendment 6c quotes both sentences and the owner settles them (§ 7 row 6c).
**Consequence.** At head the storefront's store-context digest already carries `taxMode` as a named component (`computeStoreContextDigest`, `packages/core/src/modules/ecommerce/lib/buyerContext.ts`), so Spec 5 builds on that component for the cache, projection and index keys whose output depends on the mode rather than proposing one, within the ecommerce roadmap's rule that every such key is built from named `BuyerContext` scope components (`2026-08-14-ecommerce-suite-roadmap.md`, also its ADR-7); any further `BuyerContext` field Spec 5 needs requires the e-commerce owners' acceptance (§ 7 row 6a).
**Rejected alternative.** Variant (b): explicit overrides group → country → price kind, only with the owner's agreement.
**Routed:** § 14 Q17 (Spec 5).

### ADR-12 — The new tax registry is `globalThis`-backed; the existing registries stay as they are
**Decision.** The tax provider registry stores its state on `globalThis` under a stable key, following the catalog pricing resolver registry (`packages/core/src/modules/catalog/lib/pricing.ts`) and the repository lesson (`.ai/lessons/global-registries-in-publishable-packages-must-use.md`), so a registration from a vendor package survives a second module instance; the shipping and payment registries (`lib/providers/registry.ts`, module-local `Map`s) are untouched and moving all three is offered as a follow-up; the semantics are Spec 1 § 4.17.
**Rejected alternative.** A module-local `Map` for the new registry, for symmetry with `lib/providers/registry.ts`: the failure class the lesson names, a provider registered in one module instance invisible to another.
**Detailed in Spec 1 § 3.**

---

## 7) Spec Breakdown

| # | Spec (file name) | Status | Module(s) | Depends on | Content |
|---|---|---|---|---|---|
| 1 | `2026-10-03-sales-tax-provider-contract.md` | written in this PR | `sales` | — | Tax phase (fixed step inside the provider calculator), `TaxProvider` and registry, `SalesTaxRequest` / `SalesTaxResult`, organization-level provider setting (one nullable column on `sales_settings`; `NULL` is the default state, `product-rate`), Resolve/Apply before the write transaction, statuses, `tax_info` as the provenance record, one new settings route. No document or line table change; no new command. |
| 1b | `{date}-sales-tax-resolution-service.md` (working file name) | to write | `sales` | 1 | The `sales`-owned DI service (working name `salesTaxResolutionService`) that runs the Resolve step on a non-persisted document and returns the `context.tax` slot, with the first pass's shipping drafts, that `calculateDocumentTotals` applies, for callers that are not `sales` commands (checkout once the Simple Checkout specification's totals path lands; the `cart` module, whose repricing calls `calculateDocumentTotals` at head; POS when its module exists); no command, no table. |
| 2 | `{date}-sales-tax-rates-provider.md` (working file name) | to write | `sales` | 1; 4a for category matching | Matching on the existing columns (category only after Spec 4a; a product-code key is the provider's own field); CSV import and export; admin UI on the existing tax-rate CRUD; `sourcing` as an organization setting (`destination` default, `origin` and `billing` options); group-set matching on `customer_group_id` with a soft-resolved group service under the customer groups specification's set-membership substitution and group precedence (§7.2, §3.2), with the rule that combines that precedence with the row's `priority`; orphan reporting; the result declares `rounding: 'line'` (Spec 1 § 4.10), because the `sales-tax-rates` provider rounds per line exactly as the engine does today. The outcome for a line or charge that no scoped row matches and how a matched row expresses an exemption or a reverse charge are stated there too (§ 7.1). The `sales`-owned read of the provider's matching that the storefront's display figures consume once the organization selects the provider (ADR-6, § 11). |
| 3 | `{date}-tax-gateways-module.md` | to write | `tax_gateways` (new), `integrations`, `sales` (the provenance reference; the scoped, persistent emission of the order lifecycle events, which `void` needs and the default `commit` binding may need, § 11) | 1; 2 for the `fallback-sales-tax-rates` policy value | Credentials via the `tax` category, settings UI, commit/adjust/void as workflow activities with a coded default binding and the switch that turns recording off (ADR-8), failure policy, idempotency, log: what a remote-engine provider needs in production; the provenance reference an invoice or credit memo carries to the order's provider result (additive columns on `sales_invoices` and `sales_credit_memos`; no line amounts, Spec 1 § 6); the stop after `commit` and the `adjust` path for later changes (ADR-8). |
| 4a | `{date}-sales-tax-inputs.md` (working file name) | to write | `sales`, `customers` | 1 | The customer group set through its owner service resolved with `tryResolve`, address sources (ship-to from the header snapshot, a ship-from resolver), line detail columns (the provider's tax code as returned through an additive line result field, an opaque string without a core taxonomy — ADR-10; the exemption reason; the reverse-charge flag; the per-jurisdiction breakdown as queryable data), document-discount allocation to lines before the tax phase, the gross-preserving split for gross-entered and POS lines (the behaviour before it is Spec 1 § 4.10). |
| 4b | `{date}-sales-tax-recalculation.md` (working file name) | to write | `sales` | 1 (4a for the line detail it persists) | Recalculation triggers and their stop (no trigger rewrites the stored tax of a document after an issued invoice or a committed provider transaction, whichever comes first; ADR-8), `stale`, the explicit recalculate command, the frozen-tax carry-over fix with `tax_manual_override` and the `price_entry_mode` backfill, return reversal, the line dialog sending only the entered side. |
| 5 | `{date}-sales-tax-presentation-mode.md` | to write | `sales`, `customer_groups`, `ecommerce` | 1, 4a, 4b; the `ecommerce` storefront read side at head (#7142), whose `BuyerContext.taxMode` is already derived from the price kind's `displayMode` with the store's `priceDisplayModeDefault` when the buyer resolves to no price kind (`packages/core/src/modules/ecommerce/lib/buyerContext.ts`) | Three concepts kept apart, the selling country or channel, group interplay per §6.1a, the presentation mode as a cache-key component. Co-owned with the customer-groups spec owners. |
| 6a | Amendment proposal to the e-commerce owners: ecommerce suite roadmap ADR-2, ADR-6 and ADR-7; `2026-08-14-cart-module.md` §5.2 and `tax_mode`; `2026-03-19-checkout-simple-checkout.md` lock and re-price | amendment proposal, not an edit; its pointer pull request (#7298: ecommerce suite roadmap ADR-2 and ADR-6, customer groups §7.2, cart §5.2, checkout §5.2) is merged (§ 11); the lock and submit sequence follows the suite's own lock amendment | `cart`, `@open-mercato/checkout`, `ecommerce` | 1, 1b (the Resolve service) | Cart `display` without ship-to (never remote); the storefront's display figures from the `sales`-owned read of Spec 2 once the provider is selected (ADR-6, § 11); checkout runs `estimate` with the address; `cart.lock()` recalculates with it; the order's first recalculating write, which produces its `record` result (Spec 1 § 4.14), after the conversion and before the gateway payment; `failed` blocks submit. |
| 6b | Amendment proposal to the POS owners: SPEC-022 place of taxation | amendment proposal, not an edit | POS | 1, 1b (the Resolve service) | The store location is the place of taxation; prices are gross; `display` must be cheap; final tax before payment. |
| 6c | Amendment proposal to the customer-groups owners: §6.1a and the cart spec's `resolveTerms()` sentence | amendment proposal, not an edit | `customer_groups` | 1, 5 | One source of presentation mode (§ 14 Q17); the `2026-08-14-cart-module.md` versus §6.1a inconsistency settled by the owner. |
| — | Related, not scoped (mention only) | — | — | — | A separate stream for country-ready presets built on top of this roadmap; vendor adapter packages for remote engines; the OSS applicability rule and the rule that decides an EU reverse charge; VAT-id validation; address validation; nexus. |

### 7.1 What each spec must contain beyond the standard checklist

| Spec | Non-obvious required content |
|---|---|
| 1b — Resolve service | The DI name and the input shape (a non-persisted document: lines, adjustments, header facts) of the Resolve service; the deadline and the failure policy it inherits from Spec 1; no persistence; the byte-identical rule under `product-rate` |
| 2 — `sales-tax-rates` provider | Exact match semantics for postal code ranges, priority, compound and validity dates; consumption of `customerGroupsService.resolveGroups` for the group set (when the service is not registered: `customer_group_id = null` rows only, ADR-6; from Spec 4a the set comes with the request), the set-membership substitution and group precedence of the customer groups specification (§7.2, §3.2) and the rule that combines that precedence with the row's `priority`; the sourcing setting (`destination`, `origin` or `billing`) and the origin address from the channel; orphan reporting; CSV row results and the worker threshold; which `SalesTaxRate` columns gain semantics without changing the entity's meaning (applied by analogy with the configuration-entity rule of `packages/core/src/modules/sales/AGENTS.md`, which does not list tax rates); the `rounding: 'line'` declaration in every result (Spec 1 § 4.10); the outcome for a line or charge that no scoped row matches (never a silent zero, § 12); how a matched row expresses an exemption or a reverse charge rather than a rate (a provider-own field on the rate row, a column of `sales_tax_rates` or a key of its `metadata` (§ 15), by analogy with the provider-owned facts of ADR-10; the result line's vocabulary of Spec 1 § 4.9 is the way it is returned), and what gates such a row within the matching ADR-6 fixes (the group set and the row's other columns), the provider validating no VAT id; the `sales`-owned read of the provider's matching that the storefront read side consumes for display once the provider is selected (ADR-6, § 11) |
| 3 — Gateway module | Credential fields with `secret` types; the `tax` category addition in `packages/shared`; the workflow activities (a DI function or a registered activity type) and the coded default binding, chosen among `sales.order.confirmed`, `sales.payment.created` and `sales.invoice.created`, given that `sales.payment.created` is not a paid signal by itself and one payment can settle several orders (§ 14 Q4), under the precondition of § 11 (the order lifecycle events are emitted without tenant and organization scope today) and with the instance-versioning limitation stated (§ 12); the switch that turns recording off for an organization that records its transactions elsewhere; the lock after the provider's filing (a committed transaction the provider has filed cannot be voided or adjusted; a later change is a return document); the provenance reference an invoice or credit memo carries to the order's provider result and the lifecycle calls that read it (`adjust`, `void`); the stop after `commit` and the `adjust` path; idempotency keys; log retention and access (requests carry addresses and customer ids); the failure policy UI; env preconfiguration inside the provider package (`packages/core/src/modules/integrations/AGENTS.md`); whether `estimate` results are cached at all (if so, through the DI `cache` service with tenant-scoped keys and tags) |
| 4a — Inputs | The call to `customerGroupsService.resolveGroups` and the module-absent behaviour; the address-source rule; the migration for the line detail columns (the provider's code, the exemption reason, the reverse-charge flag, the per-jurisdiction breakdown), each holding what the provider returned and nothing the phase derives on order and quote lines, and caller-supplied input on invoice and credit-memo lines, as their `tax_amount` is today (§ 14 Q5) (Spec 1 § 6, the storage contract; the exemption reason and the reverse-charge flag need columns of their own because the numeric `tax_rate` cannot express them); the discount allocation rule and its rounding; the gross-preserving split and its gate (a gross-entered line keeps its entered gross under a provider) |
| 4b — Recalculation | The trigger matrix per command and the stop (no trigger rewrites stored tax after an issued invoice or a committed provider transaction, whichever comes first; later changes go through `adjust` and a correcting document, ADR-8); the `UPGRADE_NOTES.md` text for the frozen-tax fix; the `price_entry_mode` backfill with a `legacy` state; return reversal; honour-versus-re-quote on conversion; the line dialog change |
| 5 — Presentation | Resolution order of the three sources and the storefront's store default; the cache-key component; where the selling country lives |
| 6a, 6b, 6c — Amendments | One proposal per owner, each quoting the sentence it changes and the gate it must keep (ecommerce Phase 2: cart totals byte-identical to the order); 6a names the storefront's read of the `sales-tax-rates` provider's matching through the `sales`-owned read of Spec 2 once the organization selects it (ADR-6, § 11) |

---

## 8) Phasing

Each phase is gated; the next does not start until the gate passes. Delivery order: contract → `sales-tax-rates` provider and Resolve service → gateway module → inputs → recalculation → presentation → touchpoints.

### Phase 0 — Spec 1 (contract)
**Gate:** without a configured provider, totals for every existing test are byte-identical; a test provider sets line tax, charge tax and the tax total on create and update of a quote and an order; `tax_info` carries the status; `taxCalculationService` and `sales.tax.calculate.*` are unchanged; the phase runs only in the engine's normal calculation mode, with both guards named (the provider totals hook's early return and the commands keeping an order in the external amounts mode on the default-state path, Spec 1 § 4.6); the provider assertions run end to end under Spec 1's test-only `tax_stub` provider as well as at command level.

### Phase 1 — Spec 2 (`sales-tax-rates` provider) and Spec 1b (Resolve service)
**Gate:** a destination rate table imported from CSV yields per-jurisdiction tax for a quote and an order without any external account; `product-rate` documents are unchanged; orphaned `customer_group_id` rows are reported, not ignored; the limitation that a ship-to change alone does not re-tax a document before Spec 4b is stated in the spec and shown in the admin UI; the Resolve service returns, for a non-persisted document, the tax figures the create command persists for the same inputs (byte-identical under `product-rate`); the `sales-tax-rates` provider declares `rounding: 'line'` in the result; a row keyed on a customer group that expresses an exemption or a reverse charge yields, for a member of that group, `tax_amount` 0 with the treatment on the result line and in `tax_info`, and, for a buyer outside the group and for a line or charge that no scoped row matches, the outcome Spec 2 states for that case (§ 7.1 row 2), never a silent zero.

### Phase 2 — Spec 3 (gateway module), then Spec 4a (inputs) and Spec 4b (recalculation), one combined gate
Spec 3 lands first, then Spec 4a and Spec 4b in ADR-9's order, and the phase does not close before Spec 4b, because a provider result that survives an address change is unsafe in production. Spec 3 states the stop after a committed provider transaction (a recalculating write after `commit` goes through the provider's `adjust` and a correcting document), because it introduces `commit`; Spec 4b states the stop after an issued invoice; between the two, an order invoiced before its commit fires (a binding other than the invoice event, ADR-8) can still be re-taxed by a recalculating write, the window § 12 names.
**Gate:** changing ship-to, customer, date or currency re-taxes and persists line tax; a provider-owned fact re-taxes on the next recalculating write or the explicit recalculate command; returns reduce tax; a test-only provider registered the way Spec 1's `tax_stub` is, extended with commit, adjust and void, runs estimate on the quote → record on order creation → commit through the shipped workflow binding → void on cancel through the scoped `sales.order.cancelled` event (§ 11) on a test tenant with log entries and an idempotent retry; the failure policy is visible in admin; a gross-entered line keeps its entered gross under a provider (Spec 4a); the line dialog sends only the entered price, its mode and the rate id; after `commit` a recalculating write does not rewrite the stored tax (it goes through the provider's `adjust` and a correcting document, Spec 3) and after an issued invoice no trigger re-taxes the order (Spec 4b); an invoice or credit memo that commits or voids the order's transaction carries a provenance reference to the order's result (Spec 3); the provider's code, the exemption reason, the reverse-charge flag and the jurisdiction amounts are stored as queryable line fields (Spec 4a).

### Phase 3 — Spec 5 (presentation)
**Gate:** a B2B and a B2C buyer see the correct presentation of the same document without a second source of truth.

### Phase 4 — Specs 6a–6c accepted by the owners
Proposals 6a and 6b can be sent from Phase 1 on, 6c with Spec 5 (its dependency); each owner's answer is tracked in the Changelog; the phase closes when each owner has accepted its amendment or, for a declined one, the fallback named in § 14 (Q16, Q17) is adopted; a declined 6b leaves POS on `product-rate`.
**Gate:** the ecommerce Phase 2 gate (cart totals byte-identical to the resulting order) still passes under a configured provider; checkout keeps aborting with `409 price_changed` whenever any total changes (`2026-03-19-checkout-simple-checkout.md`), and unchanged tax inputs introduce no spurious difference; POS computes the final tax before payment (6b); the customer-groups specification names one source of presentation mode (6c).

---

## 9) Data Models

This umbrella defines no entity. Spec 1 defines the contract shapes (`SalesTaxRequest`, `SalesTaxResult`, `TaxProvider` and the provenance record in `tax_info`, its § 4.3 and § 6); this roadmap defines their owners and dependencies:

| Concept | Owning module | Table prefix |
|---|---|---|
| Tax phase, contract, registry, provider setting, provenance (on orders and quotes; on invoices and credit memos through the additive provenance columns of Spec 3), rate matching, line detail columns (Spec 4a) | `sales` | `sales_` |
| Gateway settings, lifecycle state, failure policy, provider log entries | `tax_gateways` (new) | `tax_gateway_` (new) |
| Credentials, integration log | `integrations` | existing tables |
| Provider-specific product and customer facts | the provider package (custom fields or extension entities; the built-in `sales-tax-rates` provider's fields are `sales`-owned) | the extension's own prefix |
| Customer tax ids, group set | `customers` / `customer_groups` | their own prefixes |
| Vendor adapter state | provider package | none in `sales` |

Every specification of this roadmap and every provider package writes a provider result only through the tax phase and only into the places Spec 1 § 6 lists (its storage contract); a child specification that adds a place names it in its own text as an additive extension of that list, and none of them writes invoice or credit-memo line amounts. No child spec may introduce an entity under a prefix owned by another module. Names reserved by SPEC-024 and the parallel period-level work are never used for these concepts: `TaxCode`, `TaxCodeAccountMapping`, `TaxLiabilityRecord`, `ITaxEngine`, `ITaxEngineLine`, `ITaxReporting`, `taxEngineRegistry`, `accountRoles`, `tax_management`, `financial_pl`, `TaxContext`, `TaxResult`, `TaxModule`.

## 10) API Contracts

This umbrella specifies no endpoint. It lists the surfaces the child specs own, with their names and guards:

| Surface | Owner | Spec |
|---|---|---|
| `GET` / `PUT /api/sales/settings/tax-provider` — `requireAuth`, `sales.settings.manage` (reused; every default employee holds it, `setup.ts`; the existing settings routes require it, `api/settings/order-editing/route.ts`) | `sales` | 1 |
| `/api/sales/tax-rates` (existing `makeCrudRoute`) extended with import and export | `sales` | 2 |
| `/api/tax-gateways/*` (new), `requireAuth`, `tax_gateways.*` features | `tax_gateways` | 3 |
| Events `sales.tax.document.calculate.before` / `.after` (additive; shaped like `sales.document.calculate.*`, `events.ts`) | `sales` | 1 |
| Event `sales.tax.input.changed` | `sales` | 4b |
| Events `tax_gateways.transaction.committed` / `.voided` / `.failed` (declared in the gateway module's `events.ts`, the emitter) | `tax_gateways` | 3 |
| The gateway module's workflow surfaces: the coded workflow definition id and the lifecycle activity (a DI function key run by `EXECUTE_FUNCTION`, or an activity type id), names reserved by Spec 3 (ADR-8) | `tax_gateways` | 3 |
| DI service for Resolve outside the `sales` commands (working name `salesTaxResolutionService`): runs the Resolve step on a non-persisted document and returns the `context.tax` slot with the first pass's shipping drafts | `sales` | 1b |
| Commands `sales.orders.recalculate_totals`, `sales.quotes.recalculate_totals` | `sales` | 4b |

Existing event ids are FROZEN (`BACKWARD_COMPATIBILITY.md`) and none is renamed; `sales.tax.calculate.before/after` keep their payload. Provenance fields (`tax_info`, `tax_strategy_key`) are not exposed in the read API by Spec 1; a later spec decides their exposure.

## 11) Parallel Work

States read on 2026-10-31 with read-only tracker queries. None of these is a base or a dependency; each is coordinated, not assumed; one implementation PR per phase rebases on whichever lands first, and the Spec 1 settings column has no textual overlap with any open hunk (`SalesSettings` is untouched by all of them).

| Ref | Relationship |
|---|---|
| Engine-file overlap (the external amounts mode of #8216, carried forward from the closed #6092, bulk order line writes of #8050, carried forward from the closed #6184, and the serialized document writes of #6925, all merged at this head; #6146 open; #6255, #6833, #6815, #6637 and #6923 merged at this head), the sales defects (#5853 open; #6461 and #6075 closed, their fixes #6815 and #6637 merged at this head; #6459 closed, its fix #6923 merged at this head; #6463 closed, its fix #6925 merged at this head), the ownership audit #6733 and the period-level work #6168 with the `financial_pl` specifications moved from official-modules into `.ai/specs/` (#7070, merged at this head) | Engine-file overlap and the sales defects: Spec 1 § 2 and § 11; a provider package may implement a reading port of the period-level work without a dependency between `sales` and that work. |
| `sales` order lifecycle events (`sales.order.confirmed`, `sales.order.cancelled`; `packages/core/src/modules/sales/commands/documents.ts`) and the invoice records | The lifecycle events are emitted without tenant and organization scope and without persistence today, and the missing scope makes the workflow trigger subscriber skip them (`packages/core/src/modules/workflows/subscribers/event-trigger.ts`), while the create, update and delete events carry scope and are persistent; Spec 3 depends on their emission with scope and `persistent: true` (a small `sales` change): `void` needs the scoped `sales.order.cancelled` event, and until the change lands the shipped `commit` binding uses an event that carries scope (`sales.payment.created` or `sales.invoice.created`); no `order paid` or `fulfilled` event exists and `sales.order.updated` carries no status (ADR-8). An invoice carries an `issueDate` and a free-text `status` but no state that marks it as issued and locked, and no step builds an invoice from an order (`sales.invoices.create` stores caller-supplied lines), so an issued invoice means the `sales.invoice.created` event (§ 14 Q18). |
| #6046 docs(specs): sales invoice GL posting (open); #6340 feat(ledger): general ledger core engine (open) | The posting specification reads each invoice line's `taxAmount` and computes no tax; the invoice line columns it reads are written by no specification of this roadmap (Spec 1 § 6), so it reads the same fields under a provider; which line kinds its first phase posts and how an invoice carries charge tax are that specification's and the invoice flow's matter, unchanged by this roadmap (§ 14 Q10); the per-rate and per-jurisdiction detail is `sales` data (the provenance record, Spec 1 § 6; the line detail columns of Spec 4a); the ledger is a later consumer. |
| #5384 docs(specs): ecommerce module suite (merged 2026-09-17): ecommerce suite roadmap ADR-2, ADR-6 and ADR-7, `2026-08-14-cart-module.md`, `2026-03-19-checkout-simple-checkout.md`; #6346 docs(specs): assisted selling and the cart proposal seam (merged at this head); #7142 feat(ecommerce): storefront read side (merged at this head): `BuyerContext` with a derived `taxMode`, which carries no address, and a display-only matching of `SalesTaxRate` rows (§ 2 point 5); issue #7208 (a post-merge review of that suite; of its amendment pull requests, #7211 and #7213 merged at this head, #7209, #7210 and #7212 open); #7298 docs(specs): the suite's pointers at this roadmap in its ADR-2 and ADR-6, customer groups §7.2, cart §5.2 and checkout §5.2 (merged at this head) | Specs 6a–6c targets; that roadmap has an active owner and is changing: propose, never edit. Once the organization selects the `sales-tax-rates` provider, the storefront's display figures come from that provider's matching through a `sales`-owned read that Spec 2 states and amendment 6a names, so one matcher applies (ADR-6); until then the storefront's own matching is the predecessor for display, as the unit seam is for unit price entry (ADR-3). The assisted-selling proposal cart copies the target's `tax_mode`; tax must use the target buyer's facts. The review's question on group tax treatment is routed to Spec 2 (ADR-6). The EU business-to-business VAT gap has three parts: the tax id in the request and the outcome on the result line (Spec 1), the treatment a matched row expresses (Spec 2), and the rule that decides a reverse charge: VAT-id validity, which has no owner at this head (the address specification leaves VIES calls untouched, `2026-08-10-address-contact-and-tax-fields.md`) and is proposed for `customers` / `customer_groups`, and the place of supply, which no listed specification decides as a rule (ADR-5): an external provider applies its own, and the `sales-tax-rates` provider applies the sourcing setting and the row's columns the merchant configures (ADR-6). |
| #6709 feat: ecomm Release 2 — availability contract + customer groups (merged; no file under `sales/`); issue #6414 (sales: tax-rate CrudForm `entityId`) | `customer_groups` is on `main` with `customerGroupsService.resolveGroups`; Spec 2 designs on the `customer_group_id` column at head and on the §6.1a text; the column keeps its meaning as a plain nullable UUID (Spec 2), and the group picker on the tax-rate form (issue #6414) is coordinated with that work. |
| #6268 feat(catalog): pricing engine admin UI + resolver hardening (merged); #5771 feat(customers,sales): tax id on addresses (merged; the address spec's later phases pending); #5192 feat(catalog): Omnibus price tracking (open; shares `sales/data/entities.ts` and the migration snapshot) | `globalThis` registry pattern (ADR-12); `taxId` / `taxIdType` as optional request input; whichever of #5192 and the Spec 1 column lands last regenerates the sales migration snapshot, which #8216 changed at this head. |

---

## 12) Risks & Impact Review

**Data integrity.** Every provider result is applied after the fresh read of the document version and before the write transaction opens (ADR-2); a failed consistency check writes nothing. **Cascading effects.** The engine stays deterministic, so equal inputs give equal totals in every touchpoint, and each touchpoint's integration (6a, 6b) is responsible for supplying them. **Tenant isolation.** The setting, the rate rows and the provenance are organization-scoped; the registry holds code, never tenant data; credentials stay in `integrations`. **Migration.** Spec 1 adds one nullable column with a reversible migration; once an organization selects a provider, its existing documents that carry a `tax`-kind adjustment, a rated discount or a rated credit are refused on their next recalculating write until the row is fixed (Spec 1 § 4.8); Spec 4a's line detail columns are additive and Spec 4b's `price_entry_mode` backfill must be sized by that specification. **Operations.** Provider calls are bounded by a timeout and a per-provider failure policy; the log is the operator's detection path; a provider package resolves credentials only through the `resolve` of its context (Spec 1 § 4.3), with the credential services Spec 3 registers (never a process global). **Capacity and consumers.** Phases 0–2 are the minimum useful set and Phases 3–4 can slip without invalidating the contract; period-level and posting consumers read the interim breakdown in `tax_info` until Spec 4a's line detail exists; every child spec lists its i18n keys for the five locales.

### Risk Register

#### Lifecycle calls through workflows
- **Scenario**: the coded workflow of the gateway module runs in every tenant; an organization without a gateway starts instances that do nothing; a running instance follows the latest definition; the order lifecycle events are skipped by the trigger runtime until they carry scope (§ 11)
- **Severity**: Medium
- **Affected area**: `tax_gateways`, the workflow module
- **Mitigation**: the activity returns at once for an organization without a gateway; an idempotency key per call; the default `commit` binding uses an event that carries scope until the `sales` change lands; Spec 3 states the instance-versioning limitation
- **Residual risk**: a merchant who customizes the binding owns its correctness; no per-tenant opt-in for a coded definition exists today

#### Stale tax until Spec 4b
- **Scenario**: a provider-taxed order gets a new ship-to and nothing recalculates (`shouldRecalculateTotals`, `commands/documents.ts`); after a switch back to `product-rate` a provider-taxed document keeps its stored `shipping-provider:` rows and its shipping net is not re-quoted on a line write (Spec 1 § 4.5, § 4.8); the invoice copies the old tax
- **Severity**: High
- **Affected area**: `sales` documents and invoices
- **Mitigation**: Phase 2 does not close before Spec 4b; neither a remote nor a `sales-tax-rates` provider is production-safe before then for documents whose ship-to changes; `stale` is in the vocabulary from Spec 1; from Phase 1 the admin notice states the limitation
- **Residual risk**: from Phase 0 (any registered provider) until Spec 4b a production organization that selects a provider can invoice stale tax; between Spec 3 and Spec 4b the stop exists only after `commit`, so an order invoiced before its commit fires (a binding other than the invoice event, ADR-8) can still be re-taxed by a recalculating write until Spec 4b

#### Silent zero or silent fallback
- **Scenario**: a provider outage returns no tax and the document is written with zero tax and no status
- **Severity**: High
- **Affected area**: every touchpoint
- **Mitigation**: fail closed in Spec 1; a per-provider policy with a labelled `fallback` status in Spec 3; `display` never calls a remote provider
- **Residual risk**: a merchant who chooses `fallback-sales-tax-rates` accepts approximate tax at checkout; the label is the only protection

#### External provider outage at checkout or POS
- **Scenario**: the provider is down while a buyer submits
- **Severity**: High
- **Affected area**: checkout and POS
- **Mitigation**: the order's `record` result comes from its first recalculating write, because the conversion that checkout runs copies without a calculation (`2026-03-19-checkout-simple-checkout.md`; Spec 1 § 4.14); amendment 6a places that write before the gateway payment, under the per-provider policy, so a failed calculation leaves no paid customer without an order; `commit` runs later as a workflow activity on the durable queue with retries (ADR-8); POS taxes at the store with the `sales-tax-rates` provider
- **Residual risk**: a `fail` policy stops sales during an outage by design

The risks Spec 1 owns (double taxation, a provider call under a lock, forged provenance, the default employee's settings access, the fail-closed outage radius) are in its § 12; the frozen-tax fix is Spec 4b's (§ 7.1) and the orphaned `customer_group_id` rows are Spec 2's (§ 7).

---

## 13) Review

Decisions taken after review are recorded in the Changelog (Review entries) and in the ADR they change.

---

## 14) Positions for the child specifications

Questions each child specification details; the position is this roadmap's.

| # | Question | Spec | Position |
|---|---|---|---|
| 1 | Units, rounding and precision: is `taxRate` in percentage points; what tolerance and currency precision does the phase honour? | 1 (currency precision in a later spec) | percentage points, 4 decimals, the engine tolerance (`lib/calculations.ts`); a provider may declare its rounding method (`line`, or `document` for per-rate-group rounding) in the result and the engine writes the amounts verbatim; the built-in `sales-tax-rates` provider declares `line` (Spec 1 § 4.10) |
| 2 | Does core own a customer's exemption facts, and does the result keep the SPEC-024 vocabulary? | — (answered by ADR-10) | no: exemption facts are the provider package's own fields; the result vocabulary `isExempt`, `exemptReason`, `isReverseCharge` stays |
| 3 | Are `tax`-kind adjustments, negative corrections and line-scoped allocations allowed under a configured provider? | 1 refuses `tax`-kind adjustments, rated discounts and rated credits; allocation 4a; manual corrections 4b | a manual correction sets `overridden` |
| 4 | Does the provider `commit` fire on invoice issue or on payment when no invoice is issued? | 3 | through the platform's workflows: the gateway module ships a coded binding to a `sales` event and the merchant customizes it; the default binding is Spec 3's choice among `sales.order.confirmed` (emitted without scope today, § 11), `sales.payment.created` (not a paid signal by itself at this head, and naming a payment whose order and allocations give the affected orders, § 7.1 row 3) and `sales.invoice.created` (ADR-8) |
| 5 | Do invoices and credit memos take tax from the order or keep caller-supplied amounts (the Quote → Order → Invoice flow)? | 3 (the provenance reference only) | caller-supplied; no specification of this roadmap writes invoice or credit-memo line amounts (Spec 1 § 6); Spec 3 adds the provenance reference an invoice or credit memo carries to the order's provider result |
| 6 | What is the source of ship-to for tax, the header snapshot or `SalesDocumentAddress` rows; does the tax id enter the `BuyerContext` digest? | 4a, 6a | the header snapshot only; yes to the digest |
| 7 | Does core define a canonical product tax code? | — (answered by ADR-10) | no: a provider's own code field; no canonical core code |
| 8 | On quote → order conversion and public acceptance, honour the quoted tax or recalculate for the order? | 1 keeps today's copy semantics and carries no provenance key (Spec 1 § 4.14); the policy is 4b | an organization setting `honor \| re-quote`; `product-rate` honours |
| 9 | Where does the selling country that drives net/gross presentation live (`SalesChannel` has no tax settings)? | 5 | not settled by this roadmap; Spec 5 decides |
| 10 | For invoice GL posting, does charge tax appear as a `shipping` invoice line or as an extension of the tax total? | 1 (Spec 1 § 4.8, § 6) | neither is this roadmap's to decide: under a provider the tax of a charge is written into the fields `product-rate` reads today (the adjustment's `amountGross` and `metadata.taxRate`, folded into the header total), so every reader of adjustments sees the same fields; how an invoice carries charge tax belongs to the invoice flow and to the posting specification, unchanged by this roadmap; an invoice line mapping of that kind (one `service` line per charge and per rate group, each referencing its source charge) is the financial side's to specify in those documents |
| 11 | Do `sales.tax.calculate.*` and `taxCalculationService` go through the Deprecation Protocol in favour of the new contract, and in which release? | 1 | no deprecation; the unit seam stays as the predecessor |
| 12 | Do the sales provider and calculator registries move to `globalThis` like the pricing resolver registry, all or none? | 1 (the new registry only; Spec 1 § 3) | the rest is a follow-up offer |
| 13 | Does a separate `tax_gateways` core module own lifecycle, failure policy and log, with an additive `tax` member on `IntegrationCategory` in `packages/shared`? | 3 | yes (ADR-7) |
| 14 | Does the built-in `sales-tax-rates` provider run on the existing `SalesTaxRate` columns with `sourcing: destination` as the default? | 2 | yes (ADR-6); a product-code key is the provider's own field |
| 15 | Do the OSS applicability rule and the rule that decides an EU reverse charge stay out of the specifications this roadmap lists, with destination rows matched by the `sales-tax-rates` provider (ADR-6) and `keep-net` as the cross-border default? | 2 | yes (ADR-5); the exemption or reverse-charge outcome is result vocabulary (Spec 1 § 4.9), and how a matched row expresses it is Spec 2's (§ 7.1 row 2) |
| 16 | Do the e-commerce specs accept the amendments: `display` figures in the cart without ship-to, `estimate` at checkout with the address, `record` from the order's first recalculating write, after the conversion and before the gateway payment, `failed` blocks submit? | 6a | yes (ADR-3); if the owners decline: no tax figure in the cart before the address step, and `409 price_changed` on `cart.lock()` when the estimate and the final figure differ |
| 17 | Is the presentation mode derived from the price kind the customer group points to, then the selling country or channel, then the document's price kind, under the name `tax_mode`? | 5 | yes, variant (a) (ADR-11); if the owners decline: variant (b), explicit overrides group → country → price kind, as an amendment to the customer-groups spec |
| 18 | Does any recalculation rewrite the stored tax of an invoiced or committed document? | 3 (the stop after `commit` and the `adjust` path), 4b (the stop after an issued invoice) | no: after an issued invoice or a committed provider transaction, whichever comes first, the stored tax is frozen; a change goes through the provider's `adjust` and a correcting document, so posted amounts and the provider's filing stay reproducible (ADR-8); a manual correction (Q3) after that point takes the same path; an issued invoice means the `sales.invoice.created` event (§ 11) |
| 19 | A charge whose tax follows the rates of the goods it accompanies (ancillary costs in some markets are apportioned across the rate groups of the document): does the result carry the split? | 1 (a later revision of the contract; Spec 1 § 14 item 7) | not in this contract: a provider returns one taxable amount, one tax amount and one effective rate per charge, as the adjustment row stores one `metadata.taxRate`; a per-rate-group split of a charge's tax and a per-rate-group rounding method of the `sales-tax-rates` provider are deferred together; the invoice line set stays outside the roadmap (Q10) |

The items the module `AGENTS.md` files list under Ask First (`packages/core/src/modules/sales/AGENTS.md`, `packages/core/src/modules/integrations/AGENTS.md`, `packages/events/AGENTS.md`) are decided in the spec that touches them: adjustment kinds and the Quote → Order flow in Spec 1 (`tax`-kind adjustments, rated discounts and rated credits refused under a provider, new or stored; conversion copies `taxInfo` and carries no provenance key), `SalesTaxRate` semantics in Spec 2, the default lifecycle binding and the `integrations` registry type contract in Spec 3, channel scoping in a later spec; no event id is renamed.

---

## 15) Migration & Backward Compatibility

Classification per `BACKWARD_COMPATIBILITY.md`; every item is additive and nothing follows the Deprecation Protocol. Spec 1's surfaces are classified in its § 10; the later specs:

| Category | Later specs |
|---|---|
| §1 Auto-discovery convention files (`BACKWARD_COMPATIBILITY.md`), `data/validators.ts` (`BACKWARD_COMPATIBILITY.md`) | Spec 2, 4a and 4b add optional fields only |
| §2 Type Definitions (`BACKWARD_COMPATIBILITY.md`) | additive fields on the request and result types |
| §3 Function Signatures (`BACKWARD_COMPATIBILITY.md`) | none |
| §4 Import Paths (`BACKWARD_COMPATIBILITY.md`) | new module `tax_gateways` |
| §5 Event IDs (`BACKWARD_COMPATIBILITY.md`, FROZEN) | one more `sales` id (Spec 4b); three ids in the new `tax_gateways` module (Spec 3) |
| §6 Widget Injection Spot IDs (`BACKWARD_COMPATIBILITY.md`, FROZEN) | Spec 2 may add one (additive) |
| §7 API Route URLs (`BACKWARD_COMPATIBILITY.md`) | import and export on the tax-rate route; gateway routes |
| §8 Database Schema (`BACKWARD_COMPATIBILITY.md`, ADDITIVE-ONLY) | line detail columns (Spec 4a) and the `price_entry_mode` backfill (Spec 4b); gateway tables and the provenance columns on `sales_invoices` and `sales_credit_memos` (Spec 3); a column of the `sales-tax-rates` provider on `sales_tax_rates` when Spec 2 declares one (§ 7.1 row 2) |
| §9 DI Service Names (`BACKWARD_COMPATIBILITY.md`) | the Resolve service for non-command callers (Spec 1b); Spec 4a consumes the existing `customerGroupsService`; the gateway module's workflow function key or activity type id and its coded workflow definition id (Spec 3) |
| §10 ACL Feature IDs (`BACKWARD_COMPATIBILITY.md`, FROZEN) | `tax_gateways.*` features (Spec 3) |
| `packages/shared` `IntegrationCategory` | additive `tax` member (Spec 3) |

`UPGRADE_NOTES.md`: nothing for spec-only PRs; the implementation PR of Spec 1 adds an entry for the settings column and the provenance semantics of `tax_info`; Spec 4b's implementation adds the frozen-tax entry.

## 16) Implementation Plan (delivery plan of the umbrella)

Each step is a pull request that leaves `main` consistent; implementation PRs follow the phases of the spec they implement.

1. **Phase 0.** This PR: the roadmap, Spec 1 and two README rows; the spec step of Phase 0 ends when this PR merges, and the phase closes at its § 8 gate.
2. **Phase 0.** Spec 1 implementation, one PR per Spec 1 implementation phase, tests under `packages/core/src/modules/sales/__integration__/` (`.ai/qa/AGENTS.md`), `UPGRADE_NOTES.md` entry.
3. **Phase 1.** Spec 2 PR (its own branch from the then-current `main`; a roadmap Changelog entry accompanies it), then its implementation PRs. Spec 1b's PR follows in the same phase, after Spec 1's implementation merges.
4. **Phase 2.** Spec 3 PR, with the `tax` category change in `packages/shared` as its own step with the `integrations` owners; Spec 3 implementation PRs.
5. **Phase 2.** Spec 4a PR and its implementation PRs, then Spec 4b PR and its implementation PRs; the combined Phase 2 gate.
6. **Phase 3.** Spec 5 PR with the customer-groups spec owners, then its implementation PRs.
7. **Phase 4.** Amendment proposals 6a and 6b sent from Phase 1 on, 6c with Spec 5; each owner's answer recorded in this roadmap's Changelog.

Rules: specification work follows the dependencies of § 7; implementation starts only after its spec merges and an "Implement:" tracking issue exists; every later spec amends this roadmap first when it deviates.

---

## Final Compliance Report — 2026-10-04

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/sales/AGENTS.md`
- `packages/core/src/modules/integrations/AGENTS.md`
- `packages/events/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | § 5: every edge is an FK id plus a DI-resolved service; ADR-10 |
| root AGENTS.md | Filter by `organization_id` | Compliant | the setting, rate rows and provenance are organization-scoped; the registry holds no tenant data |
| root AGENTS.md | Every external integration provider in `packages/<provider-package>/`, never in `packages/core/src/modules/` (`AGENTS.md`) | Compliant | vendor adapters live outside the core modules in their own packages; the built-in default state and the built-in `sales-tax-rates` provider are `sales` code |
| root AGENTS.md | Event IDs `module.entity.action`, dots (`AGENTS.md`) | Compliant, with two proposed deviations | `sales.tax.document.calculate.before/after` mirror the existing lifecycle pair `sales.document.calculate.*` (a proposed deviation recorded in Spec 1); `sales.tax.input.changed` (Spec 4b) and `tax_gateways.transaction.committed/voided/failed` (Spec 3) use a singular entity and the past tense; the recalculate command ids keep the module's plural convention (see Non-Compliant Items) |
| packages/core/AGENTS.md | Cross-Module Coupling: optional consumer owns the glue, `try/catch` resolve, no hard `requires` (`packages/core/AGENTS.md`) | Compliant | ADR-10; `index.ts` unchanged |
| packages/core/src/modules/sales/AGENTS.md | MUST use `salesCalculationService` for document math; Ask First on the Quote → Order → Invoice flow, channel scoping and configuration entity semantics (`packages/core/src/modules/sales/AGENTS.md`) | Compliant | the tax phase lives inside the engine and the touchpoints call the service (ADR-1, ADR-3); § 14 names the spec that decides each item |
| packages/core/src/modules/integrations/AGENTS.md | Never import from provider modules; Ask First on registry type contracts; secret fields typed `secret` | Compliant | § 5; § 14 Q13; Spec 3 content row |
| packages/events/AGENTS.md | Declare events in the emitting module's `events.ts`; persistent subscribers idempotent; Ask First on renaming (`packages/events/AGENTS.md`) | Compliant | the Spec 1 and Spec 4b ids declared in `sales/events.ts`, the lifecycle ids in `tax_gateways/events.ts` (the emitter, Spec 3); ADR-8 idempotency; nothing renamed |
| .ai/specs/AGENTS.md | `{date}-{title}.md`, no `SPEC-*` prefix; required sections | Compliant | this file and the child file names |
| BACKWARD_COMPATIBILITY.md | Event IDs FROZEN, schema ADDITIVE-ONLY, DI names STABLE, validators never narrowed | Compliant | § 15; Spec 1 § 10 |

Rules the umbrella cannot answer itself (optimistic locking, `makeCrudRoute`, encryption maps, integration tests, `ProgressJob` workers, provider env preconfiguration, cache strategy, UI rules) are routed to the child spec that owns the surface through § 7.1.

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | § 9 names the owner of every shape Spec 1 § 4.3 and § 6 define; § 10 lists each surface with its owner and spec |
| API contracts match UI/UX section | N/A | umbrella; no UI |
| Risks cover all write operations | N/A | the umbrella owns no write; routed to the child specs (§ 7.1, § 12) |
| Commands defined for all mutations | Pass | Spec 1 § 4 (no new command); the recalculate commands are Spec 4b's (§ 10) |
| Cache strategy covers all read APIs | N/A | routed to Spec 3 (§ 7.1) |
| Child-spec rows of § 7 agree with § 8 phases and § 16 steps | Pass | Spec 1 in Phase 0; Spec 2 and Spec 1b in Phase 1; Spec 3, 4a and 4b in Phase 2; Spec 5 in Phase 3; 6a–6c in Phase 4 |

### Non-Compliant Items

Proposed deviation: the recalculate command ids of Spec 4b are proposed with the module's plural convention (`sales.orders.*`, `sales.quotes.*`) instead of the singular entity rule, for consistency with every existing `sales` command id (alternative: `sales.order.recalculate_totals` and `sales.quote.recalculate_totals`); Spec 1's lifecycle event-id shape (`sales.tax.document.calculate.before/after`) is recorded the same way in Spec 1.

### Verdict

- **Compliant (umbrella)** — the roadmap defines no implementable work; readiness is assessed per child spec; the questions the child specs detail are listed in § 14.

---

## Changelog

### 2026-10-03
- Initial proposal; status proposed; submitted in one PR with `2026-10-03-sales-tax-provider-contract.md`.

### Review — 2026-10-04
- **Reviewer**: Agent (spec review and readiness audit against `develop` @ `4fc4b65c8`)
- **Security**: Passed — no entity, endpoint or credential of its own
- **Performance**: Passed — one provider call per document write, before the write transaction (ADR-2)
- **Cache**: Passed — whether `estimate` results are cached is Spec 3's decision (§ 7.1)
- **Commands**: Passed — Spec 1 adds no command
- **Risks**: Passed — the stale-tax window is gated on Spec 4b (§ 12)
- **Verdict**: Approved

### 2026-10-05
- Pull request review (#6918) by the financial module contributors: the register-versus-return boundary (ADR-1), the stop after an issued invoice or a committed transaction and the invoice provenance link (ADR-8), and § 14 Q1, Q5, Q10 and Q18.

### Review — 2026-10-05
- **Reviewer**: Human (pull request review #6918 by the financial module contributors)
- **Security**: Passed — unchanged
- **Performance**: Passed — unchanged
- **Cache**: Passed — unchanged
- **Commands**: Passed — no command added
- **Risks**: Passed — the window between Spec 3 and Spec 4b is named (§ 12)
- **Verdict**: Approved — findings resolved or routed to the owning specification

### 2026-10-06
- Spec 1 revised after its readiness audit; no roadmap position changes.

### 2026-10-07
- Second review round (#6918): the invoice line design leaves the roadmap, § 9 binds every child specification to Spec 1's storage contract, and the provider lifecycle runs as workflow activities with a coded default binding (ADR-8, § 14 Q4).

### Review — 2026-10-07
- **Reviewer**: Human (second round of #6918) and the author's scope review against the module boundary of § 4
- **Security**: Passed — unchanged
- **Performance**: Passed — unchanged
- **Cache**: Passed — unchanged
- **Commands**: Passed — no command added
- **Risks**: Passed — the storage contract binds the child specifications (§ 9)
- **Verdict**: Approved — ADR-8 restated for the lifecycle trigger

### 2026-10-12
- Re-pinned to `develop` @ `7ea720142`; the built-in provider of Spec 2 is named `sales-tax-rates` and the failure policy value of ADR-8 `fallback-sales-tax-rates`.

### 2026-10-13
- What stays outside the listed specifications is narrowed to the OSS applicability rule and the EU reverse-charge rule (ADR-5, § 14 Q15), and Spec 2 owns the outcome for an unmatched line and how a matched row expresses an exemption or a reverse charge (ADR-6, § 7.1 row 2, § 8).

### Review — 2026-10-13
- **Reviewer**: Agent (spec review and readiness audit against `19d2b801f`)
- **Security**: Passed — unchanged
- **Performance**: Passed — unchanged
- **Cache**: Passed — unchanged
- **Commands**: Passed — no command added
- **Risks**: Passed — a line that no scoped row matches is never a silent zero (§ 7.1 row 2, § 8)
- **Verdict**: Approved

### 2026-10-14
- Re-pinned to `develop` @ `3346415f9`, recording the storefront read side of #7142 (§ 2 point 5, ADR-6, ADR-11, § 11) and the paid-totals rule of #7117 (§ 14 Q4).

### 2026-10-22
- Re-pinned to `main` @ `9dfdaf8bd`; Spec 1's review answer carried into ADR-2 and ADR-9, and § 7.1 row 3 notes that one payment can settle several orders.

### 2026-10-29
- Spec 1's answer to its re-review of 2026-10-29 carried into ADR-2.

### 2026-10-31
- Re-pinned to `main` @ `e04ffd226`, with line numbers dropped from every citation; the facts of #8216 (the external amounts mode and its two guards), #6925 (the document-row lock, under which the default state keeps calculating as today), #8050 (the thirteenth recalculating command) and #7592 (the `cart` module, whose missing price sides the `catalog` buyer pricing service matches, a second scoped matcher outside `sales`) applied. ADR-2 and ADR-4 point at Spec 1 for the mechanics, and the text is cut to the roadmap's own positions.
