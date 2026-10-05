# Tax Providers — Roadmap & Boundaries

| Field | Value |
|-------|-------|
| **Status** | **proposed** (umbrella; the child specifications detail and implement it phase by phase) |
| **Created** | 2026-10-03 |
| **Type** | Roadmap / architecture decision record |
| **Verified against** | `develop` @ `4fc4b65c8` (2026-10-04). Line numbers are pinned to that commit and drift; the symbol or command id beside each is the durable identifier |
| **Companion spec (same PR)** | [Sales Tax Provider Contract](./2026-10-03-sales-tax-provider-contract.md) (Spec 1 of this roadmap) |
| **Related** | [SPEC-024 §10.2](./SPEC-024-2026-02-11-financial-module.md), [SPEC-045](./implemented/SPEC-045-2026-02-24-integration-marketplace.md), [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md), [Cart Module](./2026-08-14-cart-module.md), [Customer Groups & B2B Terms](./2026-08-14-customer-groups-and-b2b-terms.md), [Simple Checkout](./2026-03-19-checkout-simple-checkout.md), [SPEC-022 POS](./SPEC-022-2026-02-07-pos-module.md), [Sales `external` amounts mode](./2026-09-07-sales-external-amounts-mode.md), [Address-level contact details and tax identifiers](./2026-08-10-address-contact-and-tax-fields.md), [Pricing Engine](./2026-08-21-pricing-engine.md) |

---

## TLDR

**Key Points:**
- Tax on a sales document becomes a document-level, provider-backed **tax phase** of the `sales` totals pipeline with an explicit status. Today line tax is an explicit `taxAmount`, else `round(net × taxRate / 100)`, else gross minus net when a supplied gross exceeds the net, with no ship-to, buyer, date, exemption or lifecycle anywhere in the calculation. Nothing changes for a document unless the organization has configured a provider.
- This roadmap opens no new direction: it collects tax intent already recorded in this repository (the sales user guide and the overrides guide naming external tax engines as the thing to plug in, the `SalesTaxRate` scoping columns, SPEC-024 §10.2, SPEC-045's future `tax` category, the TC-SALES-006 and TC-SALES-016 scenarios) and gives it one contract inside `sales`.
- Each ADR states the decision, its rationale and the alternatives it rejects; the questions each child spec details are listed in § 14.

**Scope:**
- Six numbered specifications and one follow-up: Spec 1 (the provider contract, in this PR) with Spec 1b (the Resolve service for callers that are not `sales` commands), a built-in destination table provider on the existing `SalesTaxRate` columns, a tax gateway module, the fourth delivered as two documents (tax inputs, 4a; tax recalculation, 4b), net/gross presentation, and the sixth as one amendment proposal per owner (e-commerce, POS, customer groups).
- One built-in default (`product-rate`, the name of the state without a provider: today's pass) and one built-in table provider (`tax-destination-table-rate` as the working name), one new module (`tax_gateways`); vendor adapter packages stay outside this roadmap, which exposes only the contract and the gateway seam.
- Ownership boundaries and dependency direction between `sales`, `catalog`, `customers`, `integrations`, the gateway module, the provider packages and the touchpoints; twelve architecture decisions (ADR-1 … ADR-12) binding on the child specs; phasing with gates.

**Concerns:**
- Open work on an externally taxed amounts mode edits the same engine files (`lib/calculations.ts`, `lib/providers/totals.ts`, `commands/documents.ts`); it is parallel work, not a base, and the roadmap names one guard point only.
- Stored line tax is frozen on recalculation today (`lib/lineSnapshots.ts:59-67`), so a provider result goes stale silently after an address or customer change until the recalculation spec (4b) lands; neither a remote nor a table provider is production-safe for documents whose ship-to changes after placement before Phase 2 closes.
- Name collisions with the parallel period-level tax work (`ITaxEngine`, `TaxCode`, `tax_management`) are avoided by construction; the cart and buyer context carry no address, so destination tax before checkout needs an amendment the e-commerce owners must accept.

---

## 1) Overview

This is an umbrella specification. It contains no implementable work of its own: every column, type, endpoint and command it names is specified and owned by a child spec, and the child spec's text governs the exact shape. It proposes which module owns which tax concept and the dependency direction between them, records twelve architecture decisions binding on the child specs, sequences the child specs and gates their phases. A child spec that needs to deviate amends this document first (the rule the ecommerce suite roadmap sets for itself, `2026-08-14-ecommerce-suite-roadmap.md:38`); amendments to documents owned by other teams are proposals until their owners accept them.

Who needs it: a merchant or organization that sells in the United States or on another market where the tax rate is not a fixed rate attached to the product but is computed at calculation time from the ship-to address (state, county, city and special district), the product's tax code and the customer's facts (resale or exemption certificates, entity use, tax ids), with results broken down per jurisdiction and a lifecycle of estimate (quote, cart) and record (order, invoice). The same contract serves a merchant on a fixed-rate market who wants nothing to change: without a configured provider every document calculates exactly as today.

> **Market Reference**: the platforms studied for this design, stated as the author's knowledge: Shopware 6, where a tax-provider step replaces the calculated taxes of lines and deliveries at checkout confirmation and order placement only, never on admin order edits, and PHP providers fail closed while app providers fall back silently in production; Magento Open Source 2, where total collectors around one tax calculation service select the rate from customer and product tax classes with country, region and postcode rules, a missing input yields a silent zero, and net or gross is a store-view setting; Medusa v2, where a separate tax module hands the lines to one provider chosen by the country region, the provider returns rates rather than amounts with no commit or void, and there is no fallback; Sylius, where a per-channel tax calculation strategy runs inside an order processor after shipping and promotions and is re-applied on every cart change, and without a zone or rate the tax is a silent zero; Odoo, where taxes are mapped through fiscal positions chosen by the partner's country, country group, state or ZIP range, and the AvaTax connector is enabled per fiscal position and computes tax when an invoice or credit note is posted. The two external tax engines the repository's docs already name are Avalara and TaxJar (`apps/docs/docs/user-guide/taxes.mdx:52`, `apps/docs/docs/framework/pricing-tax-overrides.mdx:157`).
>
> What the design adopts: a default strategy plus a replaceable provider (Shopware's provider step; Odoo's connector enabled per fiscal position); tax as a late phase after the charges it taxes and before fees computed on the gross total (Sylius's processor order); one provider call per document write returning amounts with a jurisdiction breakdown, because a rates-only contract (Medusa) cannot carry provider amounts, flat fees or jurisdictions; an explicit status and a fail-closed default, the silent zero of Magento and Sylius and the silent fallback of Shopware's app providers being the failure class to avoid; amounts written verbatim, never re-derived from a rate (the author's rule; it keeps a provider's document-level rounding intact); tax detail stored per line item with the provider's code, rate and provider id (Medusa's line item tax lines) as the model for the line detail columns of Spec 4a.
>
> What it rejects: a separate tax module (Medusa), because the e-commerce suite roadmap's ADR-2 makes the cart inherit totals from `salesCalculationService` and the names collide with the parallel period-level work; a provider that runs at checkout only (Shopware), because back-office documents are edited after placement; per-document selection of the provider (Odoo enables its connector per fiscal position, itself detected from the partner's address), because here the setting is organization-level and documents record provenance only; a global net/gross switch (Magento's store-view setting), because presentation, entry mode and the request's inclusive flag are three different things (ADR-11).

### 1.1 Alignment with intent already recorded in this repository

Since November 2025 the sales user guide has said that `sales.tax.calculate.before` can swap the tax class "based on geography or customer metadata" and short-circuit the default math "when you use an external tax engine such as Avalara" (`apps/docs/docs/user-guide/taxes.mdx:52`); the catalog API guide points at the same seam (`apps/docs/docs/api/catalog.mdx:286`); the overrides guide marks the place to "Call your provider here (Avalara, TaxJar, etc.)" (`apps/docs/docs/framework/pricing-tax-overrides.mdx:157`). `SalesTaxRate` was modelled with geographic, customer, product and priority scoping (`packages/core/src/modules/sales/README.md:11`; columns `data/entities.ts:277-313`; admin form fields `components/TaxRatesSettings.tsx:129-132`), and the scenarios TC-SALES-006 and TC-SALES-016 expect rate selection by customer location, recalculation when the shipping address changes and zero tax for exempt customers (`.ai/qa/scenarios/TC-SALES-006-order-tax-calculation.md:13`, `:30`, `:38`; `.ai/qa/scenarios/TC-SALES-016-tax-rate-configuration.md:37`, `:46`). At `4fc4b65c8` none of those inputs reaches the calculation: `CalculateTaxInput` carries an amount, a mode, the tenant scope and a rate id or raw rate (`services/taxCalculationService.ts:8-15`). The financial epic #260 (feat: Financial Management Module) and SPEC-024 §10.2 list transaction tax calculation and exemptions behind a pluggable engine (`SPEC-024-2026-02-11-financial-module.md:2432`, `:2437`), and SPEC-045 names `tax` (TaxJar, Avalara) as a future integration category (`implemented/SPEC-045-2026-02-24-integration-marketplace.md:85`, `:89`). The address specification behind #5232 (Implement: Address-Level Contact Details and Tax Identifiers) records that a B2B invoice address is incomplete without the tax identifier it was issued under (`2026-08-10-address-contact-and-tax-fields.md:7`), and #5771 (an address carries a phone and the tax id it was invoiced under) stores that id on document address snapshots. The ecommerce suite roadmap from #5384 fixes that the cart never computes tax and that all totals go through `salesCalculationService` (its ADR-2, `2026-08-14-ecommerce-suite-roadmap.md:175-179`), so the provider contract sits behind that service and adds no second arithmetic path; the Resolve step that such callers need before the service is a `sales`-owned DI service specified in Spec 1b (ADR-2).

This roadmap proposes that the existing `SalesTaxRate` table becomes a built-in provider, that `taxCalculationService` and the `sales.tax.calculate.*` events keep working unchanged, and that a document without a configured provider calculates exactly as today. Vendor adapters follow the SPEC-045 hub-and-spoke shape as separate packages and are not part of this PR. This roadmap reads SPEC-024 §10.2 as superseded for transaction-level tax only: nothing implements it at this head, and the `tax_management` specification of PR #6168 states that transaction-level tax calculation is `SalesTaxRate`'s territory in `sales`; the period-level work stays untouched.

### 1.2 What argues against this direction

Each ADR records the alternatives it rejects and the child spec that answers it; the counter-arguments on record are SPEC-024's placement of transaction tax in the financial module (ADR-1, Spec 1 § 3), the names taken by the period-level work (§ 9), the existing unit seam (§ 2, ADR-3), the address-less cart (ADR-3, § 14 Q16), SPEC-045's hub rule (ADR-1, ADR-7), the externally taxed amounts mode (ADR-4, § 11), the deferred country normalization (ADR-5) and the customer-groups spec's rate matching by group that no code performs (ADR-6, § 11).

---

## 2) Problem Statement

Paths are under `packages/core/src/modules/sales/` unless stated; Spec 1 § 2 carries the line-level evidence.

1. **Tax is a per-line, rate-only computation**: an explicit `taxAmount`, else `round(net × taxRate / 100)`, else gross minus net (`lib/calculations.ts:118`, `:164-180`); the calculation context carries no address, customer, channel or date (`lib/types.ts:160-166`; `commands/documents.ts:2967`).
2. **The documented seam is a unit converter**: `CalculateTaxInput` carries an amount, a mode, the tenant scope and a rate id or raw rate (`services/taxCalculationService.ts:8-15`); no document, status, commit or void.
3. **Stored tax is frozen and the recalculation triggers are narrow**: stored tax is fed back as an explicit input (`lib/lineSnapshots.ts:59-67`), header updates recalculate only on a method or currency change (`shouldRecalculateTotals`, `commands/documents.ts:5522`, `:5797`) and the address commands never calculate, so a provider result would go stale silently (Spec 4b).
4. **The header fields exist but are unsafe**: `tax_strategy_key` and `tax_info` (`data/entities.ts:397`, `:403`, `:896`) are free-form and client-writable on create (`data/validators.ts:703`, `:705`, `:756`), displayed by the document history widget and read by nothing else.
5. **The rate table is designed for scoping that no code performs**: `SalesTaxRate` carries geographic, customer, product, channel, priority and validity columns (`data/entities.ts:277-313`), the only resolver matches by id (`services/taxCalculationService.ts:92`), and `catalog` reads the table directly (issue #6733).
6. **Remote calls do not fit the transaction shape**: header updates calculate inside `withAtomicFlush(..., { transaction: true })` (`commands/documents.ts:5610`, `:5873`), conversion and the public accept route hold `PESSIMISTIC_WRITE` locks (`:6673`; `api/quotes/accept/route.ts:99`) and returns calculate under locks (`commands/returns.ts:724`, `:538`); a provider must be called before the transaction and applied before the write is flushed.
7. **No status, no provenance, no place for charge tax**: the only totals hook runs shipping then payment (`lib/providers/totals.ts:199`, `:282`) with payment fees computed on the gross total (`lib/providers/defaultProviders.ts:128`, `:194`), so tax must sit between them, and nothing records which strategy produced a document's tax or its per-jurisdiction amounts.

---

## 3) Proposed Solution

- **A `tax` phase** in the `sales` totals pipeline, shipping → tax → payment, as a fixed step inside the existing provider totals calculator (ADR-1). After the phase, line tax plus charge tax equals the result's `taxTotalAmount`; `tax`-kind adjustments, `taxPortion` and explicit line `taxAmount` are never double-counted.
- **Resolve/Apply** (ADR-2). Resolve runs in the command layer before the transaction, on the future document state, and calls the provider; Apply passes the result into the engine's second pass, where the tax phase writes it into the line results and adjustments, then `rebuildDocumentResult` (`lib/calculations.ts:505`). Resolve, a fresh read of the document version and the second pass all run before the write transaction opens, in all twelve recalculating commands; a moved version fails closed (409, nothing written); `stale` is reserved for Spec 4b.
- **Contract:** `TaxProvider` `{ key, label, description?, calculate(request, ctx) }` mirroring `ShippingProvider`; `SalesTaxRequest` and `SalesTaxResult` as boundary types with intent `display | estimate | record` and the status vocabulary of Spec 1 § 4.3; registry `registerTaxProvider` / `getTaxProvider` / `listTaxProviders` (ADR-3, ADR-12).
- **Selection** (ADR-4): the provider is configured per organization in the existing sales settings (one additive nullable column); documents carry server-written provenance (`tax_strategy_key` = `tax-provider:<providerKey>`, `tax_info` = the provenance record); never per document.
- **Built-in default and table provider** (ADR-5, ADR-6): `product-rate` names the default state (no provider configured; nothing changes) and the built-in table provider on the existing `SalesTaxRate` columns (working name `tax-destination-table-rate`; CSV import and export; `sourcing: destination` by default, `origin` as an option).
- **Tax gateway module** (ADR-7, ADR-8): `tax_gateways` (new): settings UI, credentials through `integrations` with an additive `tax` category, commit/adjust/void, failure policy `fail | fallback-table` (ADR-8), idempotency keys, admin-visible log; the invoice link (line tax, charge lines and a provenance reference on invoices and credit memos built from an order) and the stop after `commit` (ADR-8).
- **Provider packages outside the core modules** for remote engines: the first provider is the destination table provider of Spec 2; nexus, address validation and VAT-id validation are outside the `sales` contract; vendor adapter packages, their location and their timing are outside this roadmap, which exposes only the contract (Spec 1) and the gateway seam (Spec 3); inside this repository the root rule for external integration providers (`AGENTS.md:183`) applies to them.
- **Provider-owned facts** (ADR-10): the request carries references and document facts; a provider reads its own fields through `resolve`; core defines no provider-specific field.
- **Inputs, recalculation and presentation** (ADR-9, ADR-11): the customer group set, address sources, line detail columns and discount allocation (Spec 4a); wider recalculation triggers and their stop after an issued invoice, `stale`, the recalculate command and the frozen-tax fix (Spec 4b); net/gross presentation kept apart from entry mode and from the request's inclusive flag (Spec 5).
- **Events (additive):** `sales.tax.document.calculate.before/after` (Spec 1; notification-only), `sales.tax.input.changed` (Spec 4b); `tax_gateways.transaction.committed / voided / failed` declared in the gateway module's `events.ts` (Spec 3, the emitter); the existing `sales.tax.calculate.*` pair (`events.ts:90-91`) stays with the unit seam.
- **Commands:** Spec 1 adds no command. An explicit recalculation command (`sales.orders.recalculate_totals` / `sales.quotes.recalculate_totals`, free at `4fc4b65c8`) belongs to Spec 4b; the ids follow the module's plural convention (`sales.orders.lines.upsert`, `sales.quotes.convert_to_order`), see the Final Compliance Report.

---

## 4) Module Inventory

| Module | Role | Must not own |
|---|---|---|
| `sales` (extended) | Tax phase, contract types, registry, organization-level selection, table matching on `SalesTaxRate` (Spec 2), line detail columns (Spec 4a), triggers and their stop (Spec 4b), the provenance columns on invoices and credit memos (Spec 3), presentation-mode consumption (Spec 5), the Resolve service for non-command callers (Spec 1b) | Credentials, provider logs, vendor code, period liabilities |
| `catalog` | Product tax facts at head (`taxRateId` and `taxRate` on product and variant, `packages/core/src/modules/catalog/data/entities.ts:106`, `:109`, `:618`, `:621`; `taxClassificationCode`, `:177`); provider-specific codes are provider-owned extensions (ADR-10) | Tax arithmetic |
| `customers` / `customer_groups` (extended) | Customer facts (ids, address snapshots with tax id); the group set through `customerGroupsService.resolveGroups`; exemption facts are provider-owned extensions (ADR-10) | Rates, arithmetic |
| `tax_gateways` (new) with `integrations` (additive) | Settings UI, provider lifecycle (commit/adjust/void), failure policy, log; credentials and log entries through the `integrations` services `payment_gateways` already uses (`packages/core/src/modules/payment_gateways/lib/gateway-service.ts:80`, `:82`, `:199`) under an additive `tax` member of `IntegrationCategory` (`packages/shared/src/modules/integrations/types.ts:20-27` has none today) | Arithmetic, rate matching; `integrations` never owns provider-specific logic (its own `AGENTS.md` rule) |
| Touchpoints: `@open-mercato/checkout` (`packages/checkout` exists at head as pay links and transaction tracking; its totals path is the Simple Checkout specification); `cart`, `ecommerce` and POS (specified on `develop`, no module at this head) | Call the contract through `salesCalculationService` (ecommerce suite roadmap ADR-2), with the `context.tax` slot supplied by the Resolve service of Spec 1b (ADR-2) | Own tax arithmetic; their own Resolve |

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
```

**Rule:** touchpoints point to `sales`; `sales` consumes `catalog` and `customers` facts only through DI services resolved in `try/catch` (`packages/core/AGENTS.md:242-250`), never through ORM reads of their entities; `tax_gateways` consumes `sales` types and `integrations`, never the reverse; vendor packages register providers into `sales` and credentials into `integrations`, and `integrations` never imports a provider (its own Never rule); period-level tax, the ledger and general ledger (GL) posting read `sales` output and are never read by `sales`; every edge is an FK id plus a DI-resolved service, and optional peers degrade to `null` facts, never to a hard `requires` (`index.ts:12` requires `catalog`, `customers`, `dictionaries` only, unchanged).

---

## 6) Architecture Decisions

Each ADR binds the child specs. Where § 14 lists a question for a child spec, the ADR states the position and the child spec details it.

### ADR-1 — The tax phase is a step of the `sales` totals pipeline, inside the provider totals calculator
**Decision.** Transaction-level tax is computed by a tax phase of the `sales` totals pipeline, between the shipping block and the payment block of the existing provider totals calculator (`lib/providers/totals.ts:183`, `:199`, `:282`), with no public API change. The contract types and the registry are exported by `sales`.
**Rationale.** `sales` owns the arithmetic, `SalesTaxRate` and the single totals hook; payment fees are computed on the gross total (`lib/providers/defaultProviders.ts:128`, `:194`) and the hook rebuilds from its `lines` argument (`lib/providers/totals.ts:191-197`), so the step is reachable only from inside it; the ecommerce suite roadmap's ADR-2 makes the cart inherit tax from `salesCalculationService`; SPEC-045's hub rule (`implemented/SPEC-045-2026-02-24-integration-marketplace.md:63`, `:68`) is kept for credentials and lifecycle (ADR-7), because the calculation seam cannot run outside the totals calculation. The split also matches statutory VAT practice in Poland: the tax is fixed on the document at transaction time, and the Polish periodic VAT return (JPK_V7M) is built afterwards from the document register, so a period engine consumes document tax and never computes it.
**Consequence.** Third-party totals hooks keep today's behaviour: a prepended hook's edits to totals are rebuilt away by the provider calculator today; an appended hook runs after tax and its charges stay untaxed, and Spec 1 adds that rule to the docs page that shows appended calculators adding fees (`apps/docs/docs/framework/modules/sales/calculations.mdx:39-45`), which does not mention tax today.
**Rejected alternatives.** An additive phase option on `registerSalesTotalsCalculator` (an explicit phase API can be added later without touching the contract), no phase with tax fed through explicit `taxAmount` and metadata (which the regenerated provider adjustments lose), a separate tax module (collides with the ecommerce suite roadmap's ADR-2 and needs a cross-module workflow layer that does not exist) and the SPEC-024 §10.2 plugin hook (transaction-level tax needs the document, addresses and charges only the `sales` pipeline has; §10.2 is read as superseded for the transaction-level part only); Spec 1 § 3 carries the reasons.
**Detailed in Spec 1 § 3.**

### ADR-2 — Resolve before the transaction, Apply before the flush, the phase writes
**Decision.** The command layer runs a first calculation pass on the future document state, builds `SalesTaxRequest`, calls `provider.calculate` outside `withAtomicFlush` and `em.transactional`, then reads the document's `updated_at` and the setting again, fresh (`refresh: true`, never the identity map that served Resolve), and, unchanged, runs the second calculation pass in which the tax phase writes the result; the write transaction opens after that and only persists, in all twelve recalculating commands (the two header updates, which calculate inside it today, are hoisted before it); a moved version or a changed provider key fails closed (409, nothing written; a create checks the setting only); `stale` is reserved for Spec 4b's trigger-based staleness. Without a configured provider (`product-rate`, the default state) the engine runs today's one pass and there is no Resolve.
**Rationale.** The lock sites of § 2 point 6 must not hold rows during network I/O; the engine stays deterministic, which the ecommerce Phase 2 gate (cart totals byte-identical to the order) depends on.
**Consequence.** One transaction boundary for every recalculating command (Spec 1 § 4.2); return commands run no provider call in Spec 1 and keep today's behaviour (`commands/returns.ts:724`, `:538`); the explicit recalculate command that refreshes a `stale` document is Spec 4b. Callers that are not `sales` commands (the cart, checkout, POS) run Resolve through a `sales`-owned DI service (working name `salesTaxResolutionService`) that runs the Resolve step on a non-persisted document and returns the `context.tax` slot that `calculateDocumentTotals` applies; Spec 1b (a follow-up of Spec 1, Phase 1) specifies and registers it on top of Spec 1's request builder and phase, and until it exists those callers receive `product-rate` figures from the service.
**Rejected alternatives.** The provider call inside `calculateDocumentTotals` (holds transactions and `PESSIMISTIC_WRITE` locks for a round trip; makes the engine non-deterministic).

### ADR-3 — A document-level contract with explicit status; the unit seam stays as the predecessor
**Decision.** `SalesTaxRequest` carries the document, the three addresses, the customer id, lines with their tax inputs, charges, tax date, currency, `pricesIncludeTax` and the intent; `SalesTaxResult` carries per-line and per-charge results keyed by `ref` with their jurisdictions, a document-level total and a provider reference, and no status (the stored status is derived by the command, Spec 1 § 4.7); the invariant `gross = net + tax` is enforced at the boundary. `taxCalculationService` and `sales.tax.calculate.before/after` stay unchanged and are documented as the predecessor for unit price entry; the docs gain a chapter on document-level providers with a table of what the unit seam cannot carry.
**Rationale.** A rates-only contract cannot carry provider amounts, flat fees or jurisdictions; the unit seam has no document, address, customer, status or lifecycle (`services/taxCalculationService.ts:8-15`).
**Consequence.** The intent is set by the caller, never derived from the document kind, because the cart calls the engine with a quote-like document (`2026-08-14-cart-module.md:106`): `estimate` for quotes and for a cart once a ship-to address is known, `record` for orders, `display` for cart and UI previews, never remote (Spec 1 § 4.7). For the touchpoints this means: the cart shows `display` figures without a ship-to (local math only: `product-rate`, or the table provider from the channel's origin; the request carries the customer id and `pricesIncludeTax`), checkout runs `estimate` with the address, `cart.lock()` recalculates with the address, the order's `record` calculation runs when checkout creates the sales document, which precedes the gateway payment in the checkout flow (`2026-03-19-checkout-simple-checkout.md:340`, `:353`), so a tax failure aborts before any payment is taken, and `failed` blocks submit; POS taxes at the store location with gross prices (`SPEC-022-2026-02-07-pos-module.md:405`). Those are amendment proposals to the owners of the e-commerce specs (§ 14 Q16), not edits.
**Rejected alternative.** A Deprecation Protocol entry for `taxCalculationService` and `sales.tax.calculate.*` (§ 14 Q11).

### ADR-4 — The provider is selected per organization; documents carry server-written provenance
**Decision.** Provider selection is organization-level configuration, specified by Spec 1 and named here only to fix ownership: one additive nullable column `sales_settings.tax_provider_key` (`SalesSettings`, `data/entities.ts:755`; `NULL` means `product-rate`), written through a new route `GET`/`PUT /api/sales/settings/tax-provider` that runs the existing `sales.settings.save` (`commands/settings.ts:50`) extended with an optional field, behind the existing `sales.settings.manage` (`acl.ts:112`). Nothing on a document selects a provider: `tax_strategy_key` on orders records `tax-provider:<providerKey>` as provenance, `tax_info` records the provenance record; quotes record provenance in their existing `tax_info`; no quote column; client-supplied values stay accepted (schemas untouched) and are overwritten when a provider runs. The phase runs in the engine's normal calculation mode; a future mode that stores externally taxed amounts verbatim must skip the phase at the point where the shipping and payment provider steps would also be skipped, inside the provider totals calculator (no such guard exists at head).
**Rationale.** Per-document selection would make a free-text, client-writable field an authority and needs a quote column; a jsonb settings bag hides a typed setting; one nullable column is reversible.
**Consequence.** Per-channel or other scoped overrides of the setting are a later spec (channel scoping is listed in `packages/core/src/modules/sales/AGENTS.md:13`); the provenance prefix is a convention for server-written values, not a guarantee.
**Rejected alternatives.** Per-document selection through a namespaced `tax_strategy_key`; new provenance columns; a jsonb settings bag.

### ADR-5 — `product-rate` names the default state; OSS destination rates and reverse charge come later
**Decision.** `product-rate` is the name of the default state (no provider configured, the `NULL` setting), not a registered provider: the engine runs today's line tax (§ 2 point 1) in its single pass with no Resolve and no `tax` slot, so documented hooks such as the gift line that zeroes `taxAmount` keep working and totals stay byte-identical. OSS destination rates and EU reverse charge are not part of the specifications this roadmap lists: the request carries ship-to country and tax ids so a later resolver over the unused `country_code` / `region_code` columns can add them; the cross-border default is `keep-net`: when a destination rate differs from the product's rate, the net price is kept and the gross changes. Under any configured provider every gross-entered line keeps its net and its gross changes (Spec 1 § 4.10) until the gross-preserving split lands in Spec 4a with its line columns.
**Rationale.** The first PR must not change amounts for any existing tenant; the address spec defers country normalization and VAT-id validation, on which both features depend.
**Consequence.** Spec 2 may add an EU resolver later without touching the contract.
**Rejected alternatives.** A built-in EU destination resolver among the specifications this roadmap lists; a registered `product-rate` provider (a protected registry entry whose `calculate` recomputes tax from the rate, overwriting explicit `taxAmount`); `keep-gross` as the cross-border default (the gross price kept and the net changed).
**Routed:** § 14 Q15 (Spec 2).

### ADR-6 — The built-in table provider runs on the existing `SalesTaxRate` columns
**Decision.** The table provider (working name `tax-destination-table-rate`; the final name is chosen in Spec 2) matches `SalesTaxRate` rows on the existing columns (`data/entities.ts:258-323`): country, region, postal code or range, city, channel, priority, compound and validity dates, and customer groups as a set; the existing `product_category_id` column (`:292`) can match only once Spec 4a puts the product facts on the line, so category matching depends on Spec 4a, and a product-code key is the provider's own field (Spec 2); with CSV import and export and `sourcing: destination` by default, `origin` (ship-from = channel address) as an option. Group matching takes a set of group ids from an owner-provided DI service when one is registered and otherwise matches rows with `customer_group_id = null` only; orphaned ids are reported, not ignored (ecommerce roadmap risk R3).
**Rationale.** The schema was designed and documented for this (`README.md:11`); only the logic is missing. Destination sourcing is the only sourcing that works for remote and cross-border sales and reuses the ship-to the contract carries.
**Consequence.** The provider is deterministic and needs no remote call, so it can ship before Spec 4b; it recomputes on every recalculating write, but a ship-to change alone does not recalculate until Spec 4b widens the triggers (§ 2 point 3), so a table-provider document can hold stale tax after an address change exactly like a remote one; the Phase 1 gate states that limitation. Destination facts come from the header snapshot. The admin UI extends the existing tax-rate CRUD (`api/tax-rates/route.ts`, `makeCrudRoute`, every method behind `sales.settings.manage`) and its `CrudForm` dialog (`components/TaxRatesSettings.tsx:370`; issue #6414).
**Rejected alternatives.** A new rate table (duplicates `SalesTaxRate`); origin sourcing only; an external provider only; a mock provider as the contract proof (the table provider is the proof).
**Routed:** § 14 Q14 (Spec 2).

### ADR-7 — A separate `tax_gateways` module; credentials through `integrations`; vendor packages outside the core modules
**Decision.** A new core module `tax_gateways` (working name; table prefix `tax_gateway_`) shaped like `payment_gateways` and `shipping_carriers` (`implemented/SPEC-045-2026-02-24-integration-marketplace.md:77-78`) holds the settings UI, the provider lifecycle, the failure policy and the admin-visible log; credentials live in `integrations` under an additive `tax` member of `IntegrationCategory` (a `packages/shared` change; "registry type contracts" are listed in `packages/core/src/modules/integrations/AGENTS.md:23`); sensitive fields are declared through the module's `encryption.ts` maps. Vendor adapters are packages outside the core modules (the root rule `AGENTS.md:183`).
**Rationale.** The contract and the registry stay in `sales` (ADR-1; Spec 1 § 3), while lifecycle, credentials and logs are the hub's job per SPEC-045; `payment_gateways` already consumes `integrationCredentialsService` and `integrationLogService` (`packages/core/src/modules/payment_gateways/lib/gateway-service.ts:80`, `:82`, `:199`).
**Consequence.** `tax_gateways` consumes `sales` types and `integrations`; vendor packages register a `TaxProvider` into `sales` and credentials into `integrations`; providers resolve credentials through the `resolve` of their context (Spec 1 § 4.3), with the credential services Spec 3 registers.
**Rejected alternatives.** Everything in `sales` (too much for one module); everything in vendor packages (no shared lifecycle or log); an own credential store.
**Routed:** § 14 Q13 (Spec 3).

### ADR-8 — Commit, adjust and void run through durable subscribers with idempotency and a failure policy
**Decision.** `commit`, `adjust` and `void` are optional provider methods typed by Spec 3 and triggered from durable subscribers of `sales` events with an idempotency key per call; the commit point is configurable per provider and organization (`invoice` by default, `payment` and `order_confirmed` as options; § 14 Q4); one failure policy per provider with two values: `fail` (the write fails as in Spec 1 § 4.13) and `fallback-table` (the table provider of Spec 2, the result recorded with status `fallback`); a provider disabled mid-quote follows the same policy (`stale` stays reserved for Spec 4b); invoices and credit memos keep caller-supplied amounts until Spec 3 (`sales.invoices.create` and `sales.credit_memos.create` never call the engine before it).
**Rationale.** A remote call must not sit inside a document command; subscribers are the sanctioned side-effect mechanism (`packages/events/AGENTS.md`).
**Consequence.** Changing the invoice amounts source touches the Quote → Order → Invoice flow (`packages/core/src/modules/sales/AGENTS.md:13`). After an issued invoice or a committed provider transaction, whichever comes first, no recalculation trigger rewrites a document's stored tax: a change goes through the provider's `adjust` and a correcting document (a credit memo or a corrective invoice), which keeps posted amounts and the provider's filing reproducible (Spec 3 states the stop after `commit`, because it introduces `commit`, and the `adjust` path; Spec 4b states the stop after an issued invoice). An invoice or credit memo built from an order carries a provenance reference to the order's provider result (an additive column on `sales_invoices` and `sales_credit_memos`, Spec 3), so the GL posting of an invoice can be traced to the calculation that produced its amounts.
**Rejected alternatives.** Commit fixed at invoice; invoice tax derived pro rata from the order before Spec 3; silent zero on failure.

### ADR-9 — Inputs and recalculation are two specs after the contract: 4a carries the facts, 4b the triggers
**Decision.** Spec 4a (tax inputs) gives the request the facts it lacks today (the customer group set through its owner service, ADR-10), the address sources (ship-to from the header snapshot, § 14 Q6; ship-from from a `sales`-owned resolver over the channel address, `data/entities.ts:16`, `:50`), the line detail columns on the four line tables (names governed there) and the allocation of document discounts to lines before the tax phase. Spec 4b (tax recalculation) widens recalculation to address, customer, channel, `placedAt`, `exchangeRate` and provider-setting changes with their stop after an issued invoice (ADR-8), sets `stale`, adds the explicit recalculate command, fixes the frozen-tax carry-over in the two line upsert paths behind `tax_manual_override` with the `price_entry_mode` backfill, reverses tax on returns and changes the line dialog to send only the entered price, its mode and the rate id.
**Rationale.** 4a works under today's triggers, and 4b's triggers read fields that exist today, but 4b's carry-over fix and `price_entry_mode` backfill need 4a's columns, so 4a precedes 4b; one combined document would span three modules, four line tables, a backfill and a behaviour change for every tenant. A remote provider whose result survives an address change is unsafe in production, so 4b closes Phase 2; the frozen-tax fix changes stored amounts and needs an `UPGRADE_NOTES.md` entry in the "heals on next write" style with a flag that protects explicit `taxAmount`.
**Consequence.** Until Spec 4b lands, provider documents can hold stale tax after an address change and untaxed regenerated charges after a return (Spec 1 § 4.8); Phase 2 does not close before it; the per-line and per-jurisdiction breakdown lives in the header `tax_info` record until Spec 4a's columns exist.
**Rejected alternatives.** One combined inputs-and-recalculation spec; estimate on every line save (cost and races); header-only results forever (posting and period tax need per-line data); fixing the carry-over in Spec 1 (breaks "nothing changes without a provider").

### ADR-10 — Core forwards references and the facts it already holds; provider-specific facts belong to the provider package
**Decision.** The request carries identifiers and document facts (addresses, customer id, product and variant ids, line rate and price mode, channel, currency, date). Facts only a given provider needs (a tax code in the provider's own namespace, an exemption certificate or entity use code, a tax-exempt flag) are declared and owned by the provider package as custom fields or an extension entity on the catalog and customer entities, through the framework's extension mechanisms, and read by the provider through the `resolve` of its context (Spec 1 § 4.15); core defines no provider-specific field; the built-in table provider (Spec 2) is part of core `sales` and owns its fields the same way; the customer group set, resolved through `customerGroupsService.resolveGroups`, enters the request in Spec 4a.
**Rationale.** Core cannot know what each provider needs; the framework offers per-package extension of other modules' data without touching core entities; issue #6733 remediates cross-module ORM reads, and a provider reading its own extension data adds none.
**Consequence.** Two providers may hold two different codes for one product, and a merchant switching providers classifies again; a change to a provider-owned field does not trigger a core recalculation (Spec 4b's triggers cover core facts), so the next recalculating write or the explicit recalculate command re-taxes; a provider-owned field that holds an identifier is declared in that package's `encryption.ts` map and read through `findWithDecryption`.
**Rejected alternatives.** Core-owned product tax code and exemption columns filled by owner DI services; one shared canonical tax code (one namespace cannot serve engines with different code sets).

### ADR-11 — Three net/gross concepts are kept apart; presentation derives from the group's price kind
**Decision.** Entry mode (per line, `metadata.priceMode` today), the request's inclusive flag (`pricesIncludeTax`: `true`, `false` or `'mixed'`) and presentation mode (`tax_mode`, `gross | net`, the name the cart spec already uses, `2026-08-14-cart-module.md:145`, `:444`) are three different things. Presentation derives from the `displayMode` of the price kind the customer group points to (customer-groups spec §6.1a, `2026-08-14-customer-groups-and-b2b-terms.md:326`; `CatalogPriceKind.displayMode`, `packages/core/src/modules/catalog/data/entities.ts:754`), then from the selling country or channel, then from the document's price kind; the line dialog's change to send only the entered price, its mode and the rate id (the server derives the other side) ships with Spec 4b, because it is an entry-mode fix, not presentation.
**Rationale.** A global net/gross switch is the known failure class; the customer-groups spec says the price kind is the only source of display mode for a group, while the cart spec says `resolveTerms()` returns a tax mode (`2026-08-14-cart-module.md:80`), an inconsistency the owners must settle.
**Consequence.** Spec 5 proposes a named presentation component for the cache, projection and index keys whose output depends on the mode, within the ecommerce roadmap's rule that every such key is built from named `BuyerContext` scope components (`2026-08-14-ecommerce-suite-roadmap.md:287-295`; ADR-7, `:253`, `:267`); amending `BuyerContext` needs the e-commerce owners' acceptance (§ 14 Q16).
**Rejected alternative.** Variant (b): explicit overrides group → country → price kind, only with the owner's agreement.
**Routed:** § 14 Q17 (Spec 5).

### ADR-12 — The new tax registry is `globalThis`-backed; the existing registries stay as they are
**Decision.** The tax provider registry stores its state on `globalThis` under a stable key, following the catalog pricing resolver registry (`packages/core/src/modules/catalog/lib/pricing.ts:193`, `:215`) and the repository lesson (`.ai/lessons/global-registries-in-publishable-packages-must-use.md:14`), so a registration from a vendor package survives a second module instance; the shipping and payment registries (`lib/providers/registry.ts:6-7`, module-local `Map`s) are untouched and moving all three is offered as a follow-up; the semantics are Spec 1 § 4.17.
**Rejected alternative.** A module-local `Map` for the new registry, for symmetry with `lib/providers/registry.ts`: the failure class the lesson names, a provider registered in one module instance invisible to another.
**Detailed in Spec 1 § 3.**

---

## 7) Spec Breakdown

| # | Spec (file name) | Status | Module(s) | Depends on | Content |
|---|---|---|---|---|---|
| 1 | `2026-10-03-sales-tax-provider-contract.md` | written in this PR | `sales` | — | Tax phase (fixed step inside the provider calculator), `TaxProvider` and registry, `SalesTaxRequest` / `SalesTaxResult`, organization-level provider setting (one nullable column on `sales_settings`; `NULL` is the default state, `product-rate`), Resolve/Apply before the write transaction, statuses, `tax_info` as the provenance record, one new settings route. No document or line table change; no new command. |
| 1b | `{date}-sales-tax-resolution-service.md` (working file name) | to write | `sales` | 1 | The `sales`-owned DI service (working name `salesTaxResolutionService`) that runs the Resolve step on a non-persisted document and returns the `context.tax` slot that `calculateDocumentTotals` applies, for callers that are not `sales` commands (checkout once the Simple Checkout specification's totals path lands; cart and POS when their modules exist); no command, no table. |
| 2 | `{date}-sales-tax-destination-table-rate-provider.md` (working file name) | to write | `sales` | 1; 4a for category matching | Matching on the existing columns (category only after Spec 4a; a product-code key is the provider's own field); CSV import and export; admin UI on the existing tax-rate CRUD; `sourcing: destination` default with `origin` option; group-set matching on `customer_group_id` with a soft-resolved group service; orphan reporting; a rounding method setting (`line`, or `document` for per-rate-group rounding; Spec 1 § 4.10) reported in the result, because statutory invoices in some markets compute the tax from the net sum per rate rather than per line. |
| 3 | `{date}-tax-gateways-module.md` | to write | `tax_gateways` (new), `integrations`, `sales` (the invoice link) | 1; 2 for the `fallback-table` policy value | Credentials via the `tax` category, settings UI, commit/adjust/void, commit timing, failure policy, idempotency, log: what a remote-engine provider needs in production; the invoice link: how an invoice or credit memo built from an order carries the order's line tax, the charge tax as invoice lines of their own (§ 14 Q10) and a provenance reference to the order's provider result (additive columns on `sales_invoices` and `sales_credit_memos`); the stop after `commit` and the `adjust` path for later changes (ADR-8); co-reviewed with the owners of the sales invoice GL posting specification (#6046). |
| 4a | `{date}-sales-tax-inputs.md` (working file name) | to write | `sales`, `customers` | 1 | The customer group set through its owner service resolved with `tryResolve`, address sources (ship-to from the header snapshot, a ship-from resolver), line detail columns (the provider's tax code as returned through an additive line result field, an opaque string without a core taxonomy — ADR-10; the exemption reason; the reverse-charge flag; the per-jurisdiction breakdown as queryable data), document-discount allocation to lines before the tax phase, the gross-preserving split for gross-entered and POS lines (the behaviour before it is Spec 1 § 4.10). |
| 4b | `{date}-sales-tax-recalculation.md` (working file name) | to write | `sales` | 1 (4a for the line detail it persists) | Recalculation triggers and their stop (no trigger rewrites the stored tax of a document after an issued invoice or a committed provider transaction, whichever comes first; ADR-8), `stale`, the explicit recalculate command, the frozen-tax carry-over fix with `tax_manual_override` and the `price_entry_mode` backfill, return reversal, the line dialog sending only the entered side. |
| 5 | `{date}-sales-tax-presentation-mode.md` | to write | `sales`, `customer_groups`, `ecommerce` | 1, 4a, 4b; the `ecommerce` implementation (parallel work, not at head) | Three concepts kept apart, the selling country or channel, group interplay per §6.1a, the presentation mode as a cache-key component. Co-owned with the customer-groups spec owners. |
| 6a | Amendment proposal to the e-commerce owners: ecommerce suite roadmap ADR-2 and ADR-7; `2026-08-14-cart-module.md` §5.2 and `tax_mode`; `2026-03-19-checkout-simple-checkout.md` lock and re-price | amendment proposal, not an edit | `cart`, `@open-mercato/checkout`, `ecommerce` | 1, 1b (the Resolve service) | Cart `display` without ship-to (never remote); checkout runs `estimate` with the address; `cart.lock()` recalculates with it; the order's `record` calculation when the sales document is created, before the gateway payment; `failed` blocks submit. |
| 6b | Amendment proposal to the POS owners: SPEC-022 place of taxation | amendment proposal, not an edit | POS | 1, 1b (the Resolve service) | The store location is the place of taxation; prices are gross; `display` must be cheap; final tax before payment. |
| 6c | Amendment proposal to the customer-groups owners: §6.1a and the cart spec's `resolveTerms()` sentence | amendment proposal, not an edit | `customer_groups` | 1, 5 | One source of presentation mode (§ 14 Q17); the `2026-08-14-cart-module.md:80` versus §6.1a inconsistency settled by the owner. |
| — | Related, not scoped (mention only) | — | — | — | A separate stream for country-ready presets built on top of this roadmap; vendor adapter packages for remote engines; OSS destination rates and EU reverse charge; VAT-id validation; address validation; nexus. |

### 7.1 What each spec must contain beyond the standard checklist

| Spec | Non-obvious required content |
|---|---|
| 1b — Resolve service | The DI name and the input shape (a non-persisted document: lines, adjustments, header facts) of the Resolve service; the deadline and the failure policy it inherits from Spec 1; no persistence; the byte-identical rule under `product-rate` |
| 2 — Table provider | Exact match semantics for postal code ranges, priority, compound and validity dates; consumption of `customerGroupsService.resolveGroups` for the group set (when the service is not registered: `customer_group_id = null` rows only, ADR-6); orphan reporting; CSV row results and the worker threshold (an import above it runs as a queue worker with a `ProgressJob` and writes through the `sales.tax-rates.*` commands, `packages/core/AGENTS.md:310-314`); which `SalesTaxRate` columns gain semantics without changing the entity's meaning (applied by analogy with the configuration-entity rule of `packages/core/src/modules/sales/AGENTS.md:14`, which does not list tax rates); the rounding method setting (`line` or `document`) and the per-rate rounding the document method implies (Spec 1 § 4.10) |
| 3 — Gateway module | Credential fields with `secret` types; the `tax` category addition in `packages/shared`; the commit timing; the invoice link (the line tax, the charge lines and the provenance reference an invoice or credit memo built from an order carries; the mapping of order charges to invoice lines: `shipping` to a `shipping` line, `surcharge`, `custom` and operator-defined charges to a `service` line with their own `taxAmount`; Spec 3 may replace the `service` line with a new `SalesLineKind` value agreed with the `sales` owners and the GL posting specification); the stop after `commit` and the `adjust` path; idempotency keys; log retention and access (requests carry addresses and customer ids); the failure policy UI; env preconfiguration inside the provider package (`packages/core/src/modules/integrations/AGENTS.md:13`); whether `estimate` results are cached at all (if so, through the DI `cache` service with tenant-scoped keys and tags) |
| 4a — Inputs | The call to `customerGroupsService.resolveGroups` and the module-absent behaviour; the address-source rule; the migration for the line detail columns (the provider's code, the exemption reason, the reverse-charge flag, the per-jurisdiction breakdown) and the statutory invoice content they must be able to feed (a reverse-charge marker and the legal basis of an exemption on the invoice, as Polish VAT law requires; the per-rate breakdown the GL posting and the periodic return need); the country-specific rules for these fields come from the country package (`financial_pl` for Poland) and are reviewed with its owners; the discount allocation rule and its rounding; the gross-preserving split and its gate (a gross-entered line keeps its entered gross under a provider) |
| 4b — Recalculation | The trigger matrix per command and the stop (no trigger rewrites stored tax after an issued invoice or a committed provider transaction, whichever comes first; later changes go through `adjust` and a correcting document, ADR-8); the `UPGRADE_NOTES.md` text for the frozen-tax fix; the `price_entry_mode` backfill with a `legacy` state; return reversal; honour-versus-re-quote on conversion; the line dialog change |
| 5 — Presentation | Resolution order of the three sources; the cache-key component; where the selling country lives |
| 6a, 6b, 6c — Amendments | One proposal per owner, each quoting the sentence it changes and the gate it must keep (ecommerce Phase 2: cart totals byte-identical to the order) |

---

## 8) Phasing

Each phase is gated; the next does not start until the gate passes. Delivery order: contract → table provider and Resolve service → gateway module → inputs → recalculation → presentation → touchpoints.

### Phase 0 — Spec 1 (contract)
**Gate:** without a configured provider, totals for every existing test are byte-identical; a test provider sets line tax, charge tax and the tax total on create and update of a quote and an order; `tax_info` carries the status; `taxCalculationService` and `sales.tax.calculate.*` are unchanged; the phase runs only in the engine's normal calculation mode, with the one guard point named; the provider assertions run end to end under Spec 1's test-only `tax_stub` provider (a built-in registered from core under `OM_TEST_MODE`, as the payment providers are built-ins) as well as at command level.

### Phase 1 — Spec 2 (table provider) and Spec 1b (Resolve service)
**Gate:** a destination rate table imported from CSV yields per-jurisdiction tax for a quote and an order without any external account; `product-rate` documents are unchanged; orphaned `customer_group_id` rows are reported, not ignored; the limitation that a ship-to change alone does not re-tax a document before Spec 4b is stated in the spec and shown in the admin UI; the Resolve service returns, for a non-persisted document, the tax figures the create command persists for the same inputs (byte-identical under `product-rate`); the table provider declares its rounding method (`line` or `document`) in the result, and a document rounded per rate group stores the figures of Spec 1 § 5.6.

### Phase 2 — Spec 3 (gateway module), then Spec 4a (inputs) and Spec 4b (recalculation), one combined gate
Spec 3 lands first, then Spec 4a and Spec 4b in ADR-9's order, and the phase does not close before Spec 4b, because a provider result that survives an address change is unsafe in production. Spec 3 states the stop after a committed provider transaction (a recalculating write after `commit` goes through the provider's `adjust` and a correcting document), because it introduces `commit`; Spec 4b states the stop after an issued invoice; between the two, an order invoiced before its commit point (a commit point other than the invoice, ADR-8) can still be re-taxed by a recalculating write, the window § 12 names.
**Gate:** changing ship-to, customer, date or currency re-taxes and persists line tax; a provider-owned fact re-taxes on the next recalculating write or the explicit recalculate command; returns reduce tax; a test-only provider registered the way Spec 1's `tax_stub` is, extended with commit, adjust and void, runs estimate on the quote → record on order creation → commit on invoice → void on cancel on a test tenant with log entries and an idempotent retry; the failure policy is visible in admin; a gross-entered line keeps its entered gross under a provider (Spec 4a); the line dialog sends only the entered price, its mode and the rate id; after `commit` a recalculating write does not rewrite the stored tax (it goes through the provider's `adjust` and a correcting document, Spec 3) and after an issued invoice no trigger re-taxes the order (Spec 4b); an invoice built from an order carries its line tax, its charge tax as invoice lines of their own and a provenance reference to the order's result (Spec 3); the provider's code, the exemption reason, the reverse-charge flag and the jurisdiction amounts are stored as queryable line fields (Spec 4a).

### Phase 3 — Spec 5 (presentation)
**Gate:** a B2B and a B2C buyer see the correct presentation of the same document without a second source of truth.

### Phase 4 — Spec 6 accepted by the owners
Proposals 6a and 6b can be sent from Phase 1 on, 6c with Spec 5 (its dependency); each owner's answer is tracked in the Changelog; the phase closes when each owner has accepted its amendment or, for a declined one, the fallback named in § 14 (Q16, Q17) is adopted; a declined 6b leaves POS on `product-rate`.
**Gate:** the ecommerce Phase 2 gate (cart totals byte-identical to the resulting order) still passes under a configured provider; checkout keeps aborting with `409 price_changed` whenever any total changes (`2026-03-19-checkout-simple-checkout.md:307`, `:332-333`), and unchanged tax inputs introduce no spurious difference; POS computes the final tax before payment (6b); the customer-groups specification names one source of presentation mode (6c).

---

## 9) Data Models

This umbrella defines no entity. Spec 1 defines the contract shapes (`SalesTaxRequest`, `SalesTaxResult`, `TaxProvider` and the provenance record in `tax_info`, its § 4.3 and § 6); this roadmap defines their owners and dependencies:

| Concept | Owning module | Table prefix |
|---|---|---|
| Tax phase, contract, registry, provider setting, provenance (on orders and quotes; on invoices and credit memos through the additive provenance columns of Spec 3), table matching, line detail columns (Spec 4a) | `sales` | `sales_` |
| Gateway settings, lifecycle state, failure policy, provider log entries | `tax_gateways` (new) | `tax_gateway_` (new) |
| Credentials, integration log | `integrations` | existing tables |
| Provider-specific product and customer facts | the provider package (custom fields or extension entities; the built-in table provider's fields are `sales`-owned) | the extension's own prefix |
| Customer tax ids, group set | `customers` / `customer_groups` | their own prefixes |
| Vendor adapter state | provider package | none in `sales` |

No child spec may introduce an entity under a prefix owned by another module. Names reserved by SPEC-024 and the parallel period-level work are never used for these concepts: `TaxCode`, `TaxCodeAccountMapping`, `TaxLiabilityRecord`, `ITaxEngine`, `ITaxEngineLine`, `ITaxReporting`, `taxEngineRegistry`, `accountRoles`, `tax_management`, `financial_pl`, `TaxContext`, `TaxResult`, `TaxModule`.

## 10) API Contracts

This umbrella specifies no endpoint. It lists the surfaces the child specs own, with their names and guards:

| Surface | Owner | Spec |
|---|---|---|
| `GET` / `PUT /api/sales/settings/tax-provider` — `requireAuth`, `sales.settings.manage` (reused; every default employee holds it, `setup.ts:54`; the existing settings routes require it, `api/settings/order-editing/route.ts:28-29`) | `sales` | 1 |
| `/api/sales/tax-rates` (existing `makeCrudRoute`) extended with import and export | `sales` | 2 |
| `/api/tax-gateways/*` (new), `requireAuth`, `tax_gateways.*` features | `tax_gateways` | 3 |
| Events `sales.tax.document.calculate.before` / `.after` (additive; shaped like `sales.document.calculate.*`, `events.ts:82-83`) | `sales` | 1 |
| Event `sales.tax.input.changed` | `sales` | 4b |
| Events `tax_gateways.transaction.committed` / `.voided` / `.failed` (declared in the gateway module's `events.ts`, the emitter) | `tax_gateways` | 3 |
| DI service for Resolve outside the `sales` commands (working name `salesTaxResolutionService`): runs the Resolve step on a non-persisted document and returns the `context.tax` slot | `sales` | 1b |
| Commands `sales.orders.recalculate_totals`, `sales.quotes.recalculate_totals` | `sales` | 4b |

Existing event ids are FROZEN (`BACKWARD_COMPATIBILITY.md:159`) and none is renamed; `sales.tax.calculate.before/after` keep their payload. Provenance fields (`tax_info`, `tax_strategy_key`) are not exposed in the read API by Spec 1; a later spec decides their exposure.

## 11) Parallel Work

States read on 2026-10-04 with read-only tracker queries at `develop` @ `4fc4b65c8`. None of these is a base or a dependency; each is coordinated, not assumed; one implementation PR per phase rebases on whichever lands first, and the Spec 1 settings column has no textual overlap with any open hunk (`SalesSettings` is untouched by all of them).

| Ref | Relationship |
|---|---|
| Engine-file overlap (#6092 the external amounts mode, #6184 bulk line writes, #6146, #6255, #6833), the sales defects (#6461, #6075, #5853, #6459), the ownership audit #6733 and the period-level work #6168 with official-modules #55 | Spec 1 § 11 carries each; the roadmap adds nothing beyond: Spec 4b covers the two upsert paths at head (`commands/documents.ts:7575`, `:8067`), ADR-10 adds no cross-module read, the period-level names are reserved in § 9, and SPEC-024 §10.2 is read as superseded for transaction-level tax, as the `tax_management` text states (§ 1.1); the country-specific rules for the line detail fields of Spec 4a come from the country package (`financial_pl` for Poland) and are reviewed with its owners. |
| #6046 docs(specs): sales invoice GL posting (open); #6340 feat(ledger): general ledger core engine (open) | The posting specification reads each invoice line's `taxAmount` and computes no tax; its first phase posts `product`, `service` and `shipping` lines only and rejects `discount` and `adjustment` lines, so charge tax reaches the ledger only as an invoice line of its own (§ 14 Q10; the mapping of order charges to invoice lines is Spec 3's, § 7.1); one output-tax account per invoice is a stated limitation of that specification, so the per-rate and per-jurisdiction detail stays on the `sales` lines (Spec 4a); the ledger is a later consumer. |
| #5384 docs(specs): ecommerce module suite (merged 2026-09-17): ecommerce suite roadmap ADR-2 and ADR-7, `2026-08-14-cart-module.md`, `2026-03-19-checkout-simple-checkout.md`; #6346 docs(specs): assisted selling and the cart proposal seam (open) | Spec 6 targets; that roadmap has an active owner and is changing: propose, never edit. The assisted-selling proposal cart copies the target's `tax_mode`; tax must use the target buyer's facts. |
| #6709 feat: ecomm Release 2 — availability contract + customer groups (merged; no file under `sales/`); issue #6414 (sales: tax-rate CrudForm `entityId`) | `customer_groups` is on `develop` with `customerGroupsService.resolveGroups`; Spec 2 designs on the `customer_group_id` column at head and on the §6.1a text; the column keeps its meaning as a plain nullable UUID (Spec 2), and the group picker on the tax-rate form (issue #6414) is coordinated with that work. |
| #6268 feat(catalog): pricing engine admin UI + resolver hardening (merged); #5771 feat(customers,sales): tax id on addresses (merged; the address spec's later phases pending); #5192 feat(catalog): Omnibus price tracking (open; shares `sales/data/entities.ts` and the migration snapshot) | `globalThis` registry pattern (ADR-12); `taxId` / `taxIdType` as optional request input; whichever of #5192, #6092 and the Spec 1 column lands last regenerates the sales migration snapshot. |

---

## 12) Risks & Impact Review

**Data integrity.** Every provider result is applied after the fresh read of the document version and before the write transaction opens (ADR-2); a failed consistency check writes nothing. **Cascading effects.** The engine stays deterministic, so equal inputs give equal totals in every touchpoint, and each touchpoint's integration (6a, 6b) is responsible for supplying them; a `sales.document.calculate.after` subscriber can still rewrite totals after the phase, and the provenance record then describes the provider's result, not the persisted totals (Spec 1 § 12). **Tenant isolation.** The setting, the rate rows and the provenance are organization-scoped; the registry holds code, never tenant data; credentials stay in `integrations`. **Migration.** Spec 1 adds one nullable column with a reversible migration; once an organization selects a provider, its existing documents that carry a `tax`-kind adjustment or a rated discount are refused on their next recalculating write until the row is fixed (Spec 1 § 4.8); Spec 4a's line detail columns are additive and Spec 4b's `price_entry_mode` backfill must be sized by that specification. **Operations.** Provider calls are bounded by a timeout and a per-provider failure policy; the log is the operator's detection path; a provider package resolves credentials only through the `resolve` of its context (Spec 1 § 4.3), with the credential services Spec 3 registers (never a process global). **Capacity and consumers.** Phases 0–2 are the minimum useful set and Phases 3–4 can slip without invalidating the contract; period-level and posting consumers read the interim breakdown in `tax_info` until Spec 4a's line detail exists; every child spec lists its i18n keys for the five locales.

### Risk Register

#### Stale tax until Spec 4b
- **Scenario**: a provider-taxed order gets a new ship-to and nothing recalculates (`shouldRecalculateTotals`, `commands/documents.ts:5522`, `:5797`); a return or any other write without a `tax` slot regenerates the charges untaxed (Spec 1 § 4.8); the invoice copies the old tax
- **Severity**: High
- **Affected area**: `sales` documents and invoices
- **Mitigation**: Phase 2 does not close before Spec 4b; neither a remote nor a table provider is production-safe before then for documents whose ship-to changes; `stale` is in the vocabulary from Spec 1; from Phase 1 the admin notice states the limitation
- **Residual risk**: from Phase 0 (any registered provider) until Spec 4b a production organization that selects a provider can invoice stale tax; between Spec 3 and Spec 4b the stop exists only after `commit`, so an order invoiced before its commit point (a commit point other than the invoice, ADR-8) can still be re-taxed by a recalculating write until Spec 4b

#### Silent zero or silent fallback
- **Scenario**: a provider outage returns no tax and the document is written with zero tax and no status
- **Severity**: High
- **Affected area**: every touchpoint
- **Mitigation**: fail closed in Spec 1; a per-provider policy with a labelled `fallback` status in Spec 3; `display` never calls a remote provider
- **Residual risk**: a merchant who chooses `fallback-table` accepts approximate tax at checkout; the label is the only protection

#### External provider outage at checkout or POS
- **Scenario**: the provider is down while a buyer submits
- **Severity**: High
- **Affected area**: checkout and POS
- **Mitigation**: the order's `record` calculation runs when checkout creates the sales document, before the gateway payment (`2026-03-19-checkout-simple-checkout.md:340`, `:353`), under the per-provider policy, so a failed calculation leaves no paid customer without an order; `commit` runs later through a durable subscriber with retry; POS taxes at the store with the table provider
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
| 1 | Units, rounding and precision: is `taxRate` in percentage points; what tolerance and currency precision does the phase honour? | 1 (currency precision in a later spec) | percentage points, 4 decimals, the engine tolerance (`lib/calculations.ts:25`, `:33`); a provider may declare its rounding method (`line`, or `document` for per-rate-group rounding) in the result and the engine writes the amounts verbatim (Spec 1 § 4.10) |
| 2 | Does core own a customer's exemption facts, and does the result keep the SPEC-024 vocabulary? | — (answered by ADR-10) | no: exemption facts are the provider package's own fields; the result vocabulary `isExempt`, `exemptReason`, `isReverseCharge` stays |
| 3 | Are `tax`-kind adjustments, negative corrections and line-scoped allocations allowed under a configured provider? | 1 refuses `tax`-kind adjustments and rated discounts; allocation 4a; manual corrections 4b | a manual correction sets `overridden` |
| 4 | Does the provider `commit` fire on invoice issue or on payment when no invoice is issued? | 3 | configurable, `invoice` default |
| 5 | Do invoices and credit memos take tax from the order or keep caller-supplied amounts until Spec 3 (the Quote → Order → Invoice flow)? | 3 | caller-supplied until Spec 3; Spec 3 defines how an invoice or credit memo built from an order carries the order's line tax, the charge lines and a provenance reference to the order's provider result |
| 6 | What is the source of ship-to for tax, the header snapshot or `SalesDocumentAddress` rows; does the tax id enter the `BuyerContext` digest? | 4a, 6a | the header snapshot only; yes to the digest |
| 7 | Does core define a canonical product tax code? | — (answered by ADR-10) | no: a provider's own code field; no canonical core code |
| 8 | On quote → order conversion and public acceptance, honour the quoted tax or recalculate for the order? | 1 keeps today's copy semantics and carries no provenance key (Spec 1 § 4.14); the policy is 4b | an organization setting `honor \| re-quote`; `product-rate` honours |
| 9 | Where does the selling country that drives net/gross presentation live (`SalesChannel` has no tax settings)? | 5 | not settled by this roadmap; Spec 5 decides |
| 10 | For invoice GL posting, does charge tax appear as a `shipping` invoice line or as an extension of the tax total? | 3 (with the sales invoice GL posting specification, #6046) | as invoice lines of their own: that specification posts `product`, `service` and `shipping` lines and sums their `taxAmount`, so tax carried only in the invoice header is not posted; `shipping` charges map to a `shipping` line; `surcharge`, `custom` and operator-defined charges have no invoice line kind of their own today — the position is a `service` line carrying the charge's `taxAmount`; a new `SalesLineKind` value, agreed with the `sales` owners and that specification, stays open to Spec 3, which settles the mapping |
| 11 | Do `sales.tax.calculate.*` and `taxCalculationService` go through the Deprecation Protocol in favour of the new contract, and in which release? | 1 | no deprecation; the unit seam stays as the predecessor |
| 12 | Do the sales provider and calculator registries move to `globalThis` like the pricing resolver registry, all or none? | 1 (the new registry only; Spec 1 § 3) | the rest is a follow-up offer |
| 13 | Does a separate `tax_gateways` core module own lifecycle, failure policy and log, with an additive `tax` member on `IntegrationCategory` in `packages/shared`? | 3 | yes (ADR-7) |
| 14 | Does the built-in table provider run on the existing `SalesTaxRate` columns with `sourcing: destination` as the default? | 2 | yes (ADR-6); a product-code key is the provider's own field |
| 15 | Do OSS destination rates and EU reverse charge stay out of the specifications this roadmap lists, with `keep-net` as the cross-border default? | 2 | yes (ADR-5) |
| 16 | Do the e-commerce specs accept the amendments: `display` figures in the cart without ship-to, `estimate` at checkout with the address, `record` when the sales document is created before the gateway payment, `failed` blocks submit? | 6a | yes (ADR-3); if the owners decline: no tax figure in the cart before the address step, and `409 price_changed` on `cart.lock()` when the estimate and the final figure differ |
| 17 | Is the presentation mode derived from the price kind the customer group points to, then the selling country or channel, then the document's price kind, under the name `tax_mode`? | 5 | yes, variant (a) (ADR-11); if the owners decline: variant (b), explicit overrides group → country → price kind, as an amendment to the customer-groups spec |
| 18 | Does any recalculation rewrite the stored tax of an invoiced or committed document? | 3 (the stop after `commit` and the `adjust` path), 4b (the stop after an issued invoice) | no: after an issued invoice or a committed provider transaction, whichever comes first, the stored tax is frozen; a change goes through the provider's `adjust` and a correcting document, so posted amounts and the provider's filing stay reproducible (ADR-8); a manual correction (Q3) after that point takes the same path |

The items the module `AGENTS.md` files list under Ask First (`packages/core/src/modules/sales/AGENTS.md:13-14`, `packages/core/src/modules/integrations/AGENTS.md`, `packages/events/AGENTS.md`) are decided in the spec that touches them: adjustment kinds and the Quote → Order flow in Spec 1 (`tax`-kind adjustments and rated discounts refused under a provider, new or stored; conversion copies `taxInfo` and carries no provenance key), `SalesTaxRate` semantics in Spec 2, the commit point and the `integrations` registry type contract in Spec 3, channel scoping in a later spec; no event id is renamed.

---

## 15) Migration & Backward Compatibility

Classification per `BACKWARD_COMPATIBILITY.md`; every item is additive and nothing follows the Deprecation Protocol. Spec 1's surfaces are classified in its § 10; the later specs:

| Category | Later specs |
|---|---|
| §1 Auto-discovery convention files (`BACKWARD_COMPATIBILITY.md:31`), `data/validators.ts` (`BACKWARD_COMPATIBILITY.md:53`) | Spec 2, 4a and 4b add optional fields only |
| §2 Type Definitions (`BACKWARD_COMPATIBILITY.md:69`) | additive fields on the request and result types |
| §3 Function Signatures (`BACKWARD_COMPATIBILITY.md:113`) | none |
| §4 Import Paths (`BACKWARD_COMPATIBILITY.md:155`) | new module `tax_gateways` |
| §5 Event IDs (`BACKWARD_COMPATIBILITY.md:159`, FROZEN) | one more `sales` id (Spec 4b); three ids in the new `tax_gateways` module (Spec 3) |
| §6 Widget Injection Spot IDs (`BACKWARD_COMPATIBILITY.md:170`, FROZEN) | Spec 2 may add one (additive) |
| §7 API Route URLs (`BACKWARD_COMPATIBILITY.md:181`) | import and export on the tax-rate route; gateway routes |
| §8 Database Schema (`BACKWARD_COMPATIBILITY.md:192`, ADDITIVE-ONLY) | line detail columns (Spec 4a) and the `price_entry_mode` backfill (Spec 4b); gateway tables and the provenance columns on `sales_invoices` and `sales_credit_memos` (Spec 3) |
| §9 DI Service Names (`BACKWARD_COMPATIBILITY.md:207`) | the Resolve service for non-command callers (Spec 1b); Spec 4a consumes the existing `customerGroupsService` |
| §10 ACL Feature IDs (`BACKWARD_COMPATIBILITY.md:216`, FROZEN) | `tax_gateways.*` features (Spec 3) |
| `packages/shared` `IntegrationCategory` | additive `tax` member (Spec 3) |

`UPGRADE_NOTES.md`: nothing for spec-only PRs; the implementation PR of Spec 1 adds an entry for the settings column and the provenance semantics of `tax_info`; Spec 4b's implementation adds the frozen-tax entry.

## 16) Implementation Plan (delivery plan of the umbrella)

Each step is a pull request that leaves `develop` consistent; implementation PRs follow the phases of the spec they implement.

1. **Phase 0.** This PR: the roadmap, Spec 1 and two README rows; the spec step of Phase 0 ends when this PR merges, and the phase closes at its § 8 gate.
2. **Phase 0.** Spec 1 implementation, one PR per Spec 1 implementation phase, tests under `packages/core/src/modules/sales/__integration__/` (`.ai/qa/AGENTS.md:5`, `:282`), `UPGRADE_NOTES.md` entry.
3. **Phase 1.** Spec 2 PR (its own branch from the then-current `develop`; a roadmap Changelog entry accompanies it), then its implementation PRs. Spec 1b's PR follows in the same phase, after Spec 1's implementation merges.
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
| root AGENTS.md | Every external integration provider in `packages/<provider-package>/`, never in `packages/core/src/modules/` (`AGENTS.md:183`) | Compliant | vendor adapters live outside the core modules in their own packages; the built-in default state and the built-in table provider are `sales` code |
| root AGENTS.md | Event IDs `module.entity.action`, dots (`AGENTS.md:206`) | Compliant, with two proposed deviations | `sales.tax.document.calculate.before/after` mirror the existing lifecycle pair `sales.document.calculate.*` (a proposed deviation recorded in Spec 1); `sales.tax.input.changed` (Spec 4b) and `tax_gateways.transaction.committed/voided/failed` (Spec 3) use a singular entity and the past tense; the recalculate command ids keep the module's plural convention (see Non-Compliant Items) |
| packages/core/AGENTS.md | Cross-Module Coupling: optional consumer owns the glue, `try/catch` resolve, no hard `requires` (`packages/core/AGENTS.md:242-250`) | Compliant | ADR-10; `index.ts:12` unchanged |
| packages/core/src/modules/sales/AGENTS.md | MUST use `salesCalculationService` for document math; Ask First on the Quote → Order → Invoice flow, channel scoping and configuration entity semantics (`packages/core/src/modules/sales/AGENTS.md:13-14`) | Compliant | the tax phase lives inside the engine and the touchpoints call the service (ADR-1, ADR-3); § 14 names the spec that decides each item |
| packages/core/src/modules/integrations/AGENTS.md | Never import from provider modules; Ask First on registry type contracts; secret fields typed `secret` | Compliant | § 5; § 14 Q13; Spec 3 content row |
| packages/events/AGENTS.md | Declare events in the emitting module's `events.ts`; persistent subscribers idempotent; Ask First on renaming (`packages/events/AGENTS.md:15`) | Compliant | the Spec 1 and Spec 4b ids declared in `sales/events.ts`, the lifecycle ids in `tax_gateways/events.ts` (the emitter, Spec 3); ADR-8 idempotency; nothing renamed |
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
- **Reviewer**: Agent (`om-spec-writing` review and `om-pre-implement-spec` readiness audit against `develop` @ `4fc4b65c8`); triaged by the author
- **Security**: Passed — no entity, endpoint or credential of its own; the provenance record stays free of personal data (§ 9)
- **Performance**: Passed — one provider call per document write, outside every transaction (ADR-2)
- **Cache**: Passed — whether `estimate` results are cached is Spec 3's decision (§ 7.1)
- **Commands**: Passed — Spec 1 adds no command; the recalculate command ids belong to Spec 4b and are recorded as a proposed deviation (Final Compliance Report)
- **Risks**: Passed — the three roadmap-level risks are in § 12, the stale-tax window gated on Spec 4b
- **Verdict**: Approved — no open findings

### 2026-10-05
- Pull request review (#6918) by two contributors to the financial module work (Polish VAT and accounting practice; GL posting and `tax_management`): the boundary confirmed from the financial side; ADR-1 rationale (the register-versus-return boundary); ADR-8 consequence (the stop after an issued invoice or a committed transaction, the invoice provenance link); § 7 and § 7.1 rows 2, 3, 4a and 4b (the rounding method, the invoice link and the charge mapping, the line detail columns, the stop); § 3 and § 4 (the stop and the invoice link named); § 9; § 12 (the window between Spec 3 and Spec 4b); § 15 (the provenance columns of Spec 3); § 11 (the #6046 relationship, country rules from `financial_pl`); § 14 Q1, Q5 and Q10 answered, Q18 added; § 8 gates carry the findings; the Market Reference names Medusa's per-line tax lines as the model for Spec 4a.

### Review — 2026-10-05
- **Reviewer**: Human (pull request review #6918 by two reviewers from the financial module work: statutory VAT practice; general ledger posting and `tax_management`); triaged by the author
- **Security**: Passed (unchanged since 2026-10-04) — no entity, endpoint or credential of its own; the provenance record stays free of personal data (§ 9)
- **Performance**: Passed (unchanged since 2026-10-04) — one provider call per document write, outside every transaction (ADR-2)
- **Cache**: Passed (unchanged since 2026-10-04) — whether `estimate` results are cached is Spec 3's decision (§ 7.1)
- **Commands**: Passed (unchanged since 2026-10-04) — no command added
- **Risks**: Passed — the window between Spec 3 and Spec 4b is named in § 12 and the Phase 2 gate carries the stop, the invoice link and the queryable line fields (§ 8)
- **Findings**: (1) the per-line facts a statutory invoice and the periodic return need (the tax code, the exemption reason, the reverse-charge marker, the per-jurisdiction amounts) must be persisted as queryable line fields, not only inside the provenance record — carried into Spec 4a (§ 7, § 7.1); (2) no recalculation rewrites a line after an issued invoice or a committed provider transaction — the stop in ADR-8, Spec 3 and Spec 4b; (3) the rounding method (per line, or per rate group on the document) must be declared with the result — Spec 1 § 4.10 and the table provider's setting (§ 7.1); (4) invoice amounts must link back to the order's provider result and charge tax must appear as invoice lines, because the GL posting sums line `taxAmount` — § 14 Q5 and Q10, Spec 3; (5) the admin-only feature id of the provider setting, endorsed by the reviewers: stays deferred (Spec 1 § 14 item 6)
- **Verdict**: Approved — the direction confirmed from the financial side; findings resolved in this revision or routed to the owning specification
