# Tax Providers — Roadmap & Boundaries

| Field | Value |
|-------|-------|
| **Status** | **proposed — decision requested** (umbrella; no implementation lands until § Decision Requested is answered) |
| **Created** | 2026-10-03 |
| **Type** | Roadmap / architecture decision record |
| **Verified against** | `develop` @ `7f0ebf653` (2026-10-02). Line numbers are pinned to that commit and drift; the symbol or command id beside each is the durable identifier |
| **Companion spec (same PR)** | [Sales Tax Provider Contract](./2026-10-03-sales-tax-provider-contract.md) (Spec 1 of this roadmap) |
| **Related** | [SPEC-024 §10.2](./SPEC-024-2026-02-11-financial-module.md), [SPEC-045](./implemented/SPEC-045-2026-02-24-integration-marketplace.md), [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md), [Cart Module](./2026-08-14-cart-module.md), [Customer Groups & B2B Terms](./2026-08-14-customer-groups-and-b2b-terms.md), [Simple Checkout](./2026-03-19-checkout-simple-checkout.md), [SPEC-022 POS](./SPEC-022-2026-02-07-pos-module.md), [Sales `external` amounts mode](./2026-09-07-sales-external-amounts-mode.md), [Address-level contact details and tax identifiers](./2026-08-10-address-contact-and-tax-fields.md), [Pricing Engine](./2026-08-21-pricing-engine.md) |

---

## TLDR

**Key Points:**
- Tax on a sales document becomes a document-level, provider-backed **tax phase** of the `sales` totals pipeline with an explicit status (proposed). Today line tax is an explicit `taxAmount`, else `round(net × taxRate / 100)`, else gross minus net when a supplied gross exceeds the net, with no ship-to, buyer, date, exemption or lifecycle anywhere in the calculation. Nothing changes for a document unless the organization has configured a provider.
- This roadmap opens no new direction: it collects tax intent already recorded in this repository (the sales user guide and the overrides guide naming external tax engines as the thing to plug in, the `SalesTaxRate` scoping columns, SPEC-024 §10.2, SPEC-045's future `tax` category, the TC-SALES-006 and TC-SALES-016 scenarios) and gives it one contract inside `sales`.
- Every position below is a proposal with an alternative; nothing here is a maintainer decision. The direction-level questions are collected in § Decision Requested; the questions each child spec decides are routed in § Open Questions.

**Scope:**
- Six numbered specifications and one follow-up: Spec 1 (the provider contract, in this PR) with Spec 1b (the Resolve service for callers that are not `sales` commands), a built-in destination table provider on the existing `SalesTaxRate` columns, a tax gateway module, the fourth delivered as two documents (tax inputs, 4a; tax recalculation, 4b), net/gross presentation, and the sixth as one amendment proposal per owner (e-commerce, POS, customer groups).
- One built-in default (`product-rate`, the name of the state without a provider: today's pass) and one built-in table provider (`tax-destination-table-rate` as the working name), one new module (`tax_gateways`, proposed); vendor adapter packages stay outside this roadmap, which exposes only the contract and the gateway seam.
- Ownership boundaries and dependency direction between `sales`, `catalog`, `customers`, `integrations`, the gateway module, the provider packages and the touchpoints; twelve architecture decisions (ADR-1 … ADR-12), proposals that bind the child specs once a maintainer records them in the Decision Record; phasing with gates.

**Concerns:**
- Open work on an externally taxed amounts mode edits the same engine files (`lib/calculations.ts`, `lib/providers/totals.ts`, `commands/documents.ts`); it is parallel work, not a base, and the roadmap names one guard point only.
- Stored line tax is frozen on recalculation today (`lib/lineSnapshots.ts:59-67`), so a provider result goes stale silently after an address or customer change until the recalculation spec (4b) lands; neither a remote nor a table provider is production-safe for documents whose ship-to changes after placement before Phase 2 closes.
- Name collisions with the parallel period-level tax work (`ITaxEngine`, `TaxCode`, `tax_management`) are avoided by construction; the cart and buyer context carry no address, so destination tax before checkout needs an amendment the e-commerce owners must accept.

---

## 1) Overview

This is an umbrella specification. It contains no implementable work of its own: every column, type, endpoint and command it names is specified and owned by a child spec, and the child spec's text governs the exact shape. It proposes which module owns which tax concept and the dependency direction between them, records twelve architecture decisions as proposals (binding on child specs once recorded in the Decision Record), sequences the child specs and gates their phases. A child spec that needs to deviate amends this document first (the rule the ecommerce suite roadmap sets for itself, `2026-08-14-ecommerce-suite-roadmap.md:38`); amendments to documents owned by other teams are proposals until their owners accept them.

Who needs it: a merchant or organization that sells in the United States or on another market where the tax rate is not a fixed rate attached to the product but is computed at calculation time from the ship-to address (state, county, city and special district), the product's tax code and the customer's facts (resale or exemption certificates, entity use, tax ids), with results broken down per jurisdiction and a lifecycle of estimate (quote, cart) and record (order, invoice). The same contract serves a merchant on a fixed-rate market who wants nothing to change: without a configured provider every document calculates exactly as today.

> **Market Reference**: this specification deliberately names no other platform, framework or library. The reference is the business need above, and the two external tax engines the repository already names as the thing to plug in: the sales user guide (`apps/docs/docs/user-guide/taxes.mdx:52`, "an external tax engine such as Avalara") and the overrides guide (`apps/docs/docs/framework/pricing-tax-overrides.mdx:157`, "Call your provider here (Avalara, TaxJar, etc.)"). What the design adopts, as the author's reasoning: a default strategy plus a replaceable provider; tax as a late phase of the totals pipeline, after the charges it must tax and before the fees computed on the gross total; one provider call per document, never one per line; per-line results that carry the provider's identity, the effective rate and the jurisdiction breakdown; an explicit tax-inclusive flag per line; an explicit result status instead of a silently zero figure; amounts frozen at placement and refreshed only by a visible recalculation. What it rejects: a separate tax module (it collides with the ecommerce suite roadmap's ADR-2 and with the names of the parallel period-level work), a rates-only contract (it cannot carry provider amounts, flat fees or jurisdictions), a global net/gross switch, and a silent zero or silent fallback on failure. The failure classes the design guards against: repeated remote calls on every keystroke, incomplete recalculation triggers, rounding regressions between a provider and the engine, and rate-keyed aggregation that merges jurisdictions.

### 1.1 Alignment with intent already recorded in this repository

Since November 2025 the sales user guide has said that `sales.tax.calculate.before` can swap the tax class "based on geography or customer metadata" and short-circuit the default math "when you use an external tax engine such as Avalara" (`apps/docs/docs/user-guide/taxes.mdx:52`); the catalog API guide points at the same seam (`apps/docs/docs/api/catalog.mdx:286`); the overrides guide marks the place to "Call your provider here (Avalara, TaxJar, etc.)" (`apps/docs/docs/framework/pricing-tax-overrides.mdx:157`). `SalesTaxRate` was modelled with geographic, customer, product and priority scoping (`packages/core/src/modules/sales/README.md:11`; columns `data/entities.ts:277-313`; admin form fields `components/TaxRatesSettings.tsx:129-132`), and the scenarios TC-SALES-006 and TC-SALES-016 expect rate selection by customer location, recalculation when the shipping address changes and zero tax for exempt customers (`.ai/qa/scenarios/TC-SALES-006-order-tax-calculation.md:13`, `:30`, `:38`; `.ai/qa/scenarios/TC-SALES-016-tax-rate-configuration.md:37`, `:46`). At `7f0ebf653` none of those inputs reaches the calculation: `CalculateTaxInput` carries an amount, a mode, the tenant scope and a rate id or raw rate (`services/taxCalculationService.ts:8-15`). The financial epic #260 (feat: Financial Management Module) and SPEC-024 §10.2 list transaction tax calculation and exemptions behind a pluggable engine (`SPEC-024-2026-02-11-financial-module.md:2432`, `:2437`), and SPEC-045 names `tax` (TaxJar, Avalara) as a future integration category (`implemented/SPEC-045-2026-02-24-integration-marketplace.md:85`, `:89`). The address specification behind #5232 (Implement: Address-Level Contact Details and Tax Identifiers) records that a B2B invoice address is incomplete without the tax identifier it was issued under (`2026-08-10-address-contact-and-tax-fields.md:7`), and #5771 (an address carries a phone and the tax id it was invoiced under) stores that id on document address snapshots. The ecommerce suite roadmap from #5384 fixes that the cart never computes tax and that all totals go through `salesCalculationService` (its ADR-2, `2026-08-14-ecommerce-suite-roadmap.md:175-179`), so the provider contract sits behind that service and adds no second arithmetic path; the Resolve step that such callers need before the service is a `sales`-owned DI service specified in Spec 1b (ADR-2).

This roadmap proposes that the existing `SalesTaxRate` table becomes a built-in provider, that `taxCalculationService` and the `sales.tax.calculate.*` events keep working unchanged, and that a document without a configured provider calculates exactly as today. Vendor adapters follow the SPEC-045 hub-and-spoke shape as separate packages and are not part of this PR. This proposal would supersede SPEC-024 §10.2 for transaction-level tax only if the maintainers accept Spec 1's DR-1; the period-level work in #6168 (docs(tax-management): core framework spec, open, base `main`) stays untouched and its names are avoided. Whether that split holds is the first question in § Decision Requested of Spec 1 (DR-1), not an assumption.

### 1.2 What argues against this direction

Each ADR records the alternative it rejects and the child spec that answers it; the counter-arguments on record are SPEC-024's placement of transaction tax in the financial module (ADR-1, Spec 1 DR-1), the names taken by the period-level work (§ 9), the existing unit seam (§ 2, ADR-3), the address-less cart (ADR-3, RD-4), SPEC-045's hub rule (ADR-1, ADR-7), the externally taxed amounts mode (ADR-4, § 11), the deferred country normalization (ADR-5) and the customer-groups spec's rate matching by group that no code performs (ADR-6, § 11).

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

## 3) Proposed Solution (direction; every item is a proposal)

- **A `tax` phase** in the `sales` totals pipeline, shipping → tax → payment, as a fixed step inside the existing provider totals calculator (default) or, if the maintainers want an explicit phase API, a named phase option on the registry (ADR-1). After the phase, line tax plus charge tax equals the result's `taxTotalAmount`; `tax`-kind adjustments, `taxPortion` and explicit line `taxAmount` are never double-counted.
- **Resolve/Apply** (ADR-2). Resolve runs in the command layer before the transaction, on the future document state, and calls the provider; Apply passes the result into the engine's second pass, where the tax phase writes it into the line results and adjustments, then `rebuildDocumentResult` (`lib/calculations.ts:505`). Resolve, the fingerprint comparison and the second pass all run before the write transaction opens, in all twelve recalculating commands; a mismatch fails closed (409, nothing written); `stale` is reserved for Spec 4b.
- **Contract (proposed names):** `TaxProvider` `{ key, label, description?, calculate(request, ctx) }` mirroring `ShippingProvider`; `SalesTaxRequest` and `SalesTaxResult` as boundary types with intent `display | estimate | record` and the status vocabulary of Spec 1 § 4.3; registry `registerTaxProvider` / `getTaxProvider` / `listTaxProviders` (ADR-3, ADR-12).
- **Selection** (ADR-4): the provider is configured per organization in the existing sales settings (one additive nullable column); documents carry server-written provenance (`tax_strategy_key` = `tax-provider:<providerKey>`, `tax_info` = the provenance record); never per document.
- **Built-in default and table provider** (ADR-5, ADR-6): `product-rate` names the default state (no provider configured; nothing changes) and the built-in table provider on the existing `SalesTaxRate` columns (working name `tax-destination-table-rate`; CSV import and export; `sourcing: destination` by default, `origin` as an option).
- **Tax gateway module** (ADR-7, ADR-8): `tax_gateways` (proposed): settings UI, credentials through `integrations` with an additive `tax` category, commit/adjust/void, failure policy `fail | fallback-table` (ADR-8), idempotency keys, admin-visible log.
- **Provider packages outside the core modules** for remote engines: the first provider is the destination table provider of Spec 2 (`product-rate` names the default state, not a provider); nexus, address validation and VAT-id validation are outside the `sales` contract; vendor adapter packages, their location and their timing are outside this roadmap, which exposes only the contract (Spec 1) and the gateway seam (Spec 3); inside this repository the root rule for external integration providers (`AGENTS.md:183`) applies to them.
- **Facts via owners** (ADR-10): customer facts, product tax facts and ship-from come from DI services owned by `customers` / `customer_groups`, `catalog` and `sales` (channel), resolved with a local `tryResolve`; no new cross-module ORM reads.
- **Inputs, recalculation and presentation** (ADR-9, ADR-11): owner-resolved facts, address sources, line detail columns and discount allocation (Spec 4a); wider recalculation triggers, `stale`, the recalculate command and the frozen-tax fix (Spec 4b); net/gross presentation kept apart from entry mode and from the request's inclusive flag (Spec 5).
- **Events (proposed, additive):** `sales.tax.document.calculate.before/after` (Spec 1; notification-only), `sales.tax.input.changed` (Spec 4b); `tax_gateways.transaction.committed / voided / failed` declared in the gateway module's `events.ts` (Spec 3, the emitter); the existing `sales.tax.calculate.*` pair (`events.ts:90-91`) stays with the unit seam.
- **Commands:** Spec 1 adds no command. An explicit recalculation command (`sales.orders.recalculate_totals` / `sales.quotes.recalculate_totals`, free at `7f0ebf653`) belongs to Spec 4b; the ids follow the module's plural convention (`sales.orders.lines.upsert`, `sales.quotes.convert_to_order`), see the Final Compliance Report.

---

## 4) Module Inventory

| Module | Role | Must not own |
|---|---|---|
| `sales` (extended) | Tax phase, contract types, registry, organization-level selection, table matching on `SalesTaxRate` (Spec 2), line detail columns (Spec 4a), triggers (Spec 4b), presentation-mode consumption (Spec 5), the Resolve service for non-command callers (Spec 1b) | Credentials, provider logs, vendor code, period liabilities |
| `catalog` (extended) | Product tax facts (`taxRateId` and `taxRate` on product and variant, `packages/core/src/modules/catalog/data/entities.ts:106`, `:109`, `:618`, `:621`; `taxClassificationCode`, `:177`; a proposed `provider_tax_code` with a variant override) through its own service | Tax arithmetic |
| `customers` / `customer_groups` (extended; the latter is specified on `develop` and has no module at this head; its implementation is parallel work) | Customer tax facts: tax ids (today only on address snapshots), exemption facts, group set | Rates, arithmetic |
| `tax_gateways` (new, proposed) with `integrations` (additive) | Settings UI, provider lifecycle (commit/adjust/void), failure policy, log; credentials and log entries through the `integrations` services `payment_gateways` already uses (`packages/core/src/modules/payment_gateways/lib/gateway-service.ts:80`, `:82`, `:199`) under an additive `tax` member of `IntegrationCategory` (`packages/shared/src/modules/integrations/types.ts:20-27` has none today) | Arithmetic, rate matching; `integrations` never owns provider-specific logic (its own Ask First rule) |
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
               │ selection,  │        │ (product │      │ customer_groups      │
               │ provenance  │        │ tax code)│      │ (tax ids, exemption, │
               └──────┬──────┘        └──────────┘      │  group set)          │
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

**Rule:** touchpoints point to `sales`; `sales` consumes `catalog` and `customers` facts only through DI services resolved in `try/catch` (`packages/core/AGENTS.md:242-250`), never through ORM reads of their entities; `tax_gateways` consumes `sales` types and `integrations`, never the reverse; vendor packages register providers into `sales` (under Spec 1's DR-1 default) and credentials into `integrations`, and `integrations` never imports a provider (its own Never rule); period-level tax, the ledger and GL posting read `sales` output and are never read by `sales`; every edge is an FK id plus a DI-resolved service, and optional peers degrade to `null` facts, never to a hard `requires` (`index.ts:12` requires `catalog`, `customers`, `dictionaries` only, unchanged).

---

## 6) Architecture Decisions (proposals; alternatives recorded)

Each ADR is a proposal with a recommended default; it binds the child specs only once a maintainer records it in § Decision Record. Where § 14 routes a question to a child spec, the ADR states the leaning and the child spec decides.

### ADR-1 — The tax phase is a step of the `sales` totals pipeline, inside the provider totals calculator
**Decision (proposed).** Transaction-level tax is computed by a tax phase of the `sales` totals pipeline, between the shipping block and the payment block of the existing provider totals calculator (`lib/providers/totals.ts:183`, `:199`, `:282`), with no public API change (Option B). The contract types and the registry are exported by `sales`.
**Rationale.** `sales` owns the arithmetic, `SalesTaxRate` and the single totals hook; payment fees are computed on the gross total (`lib/providers/defaultProviders.ts:128`, `:194`) and the hook rebuilds from its `lines` argument (`lib/providers/totals.ts:191-197`), so the step is reachable only from inside it; the ecommerce suite roadmap's ADR-2 makes the cart inherit tax from `salesCalculationService`; SPEC-045's hub rule (`implemented/SPEC-045-2026-02-24-integration-marketplace.md:63`, `:68`) is kept for credentials and lifecycle (ADR-7), because the calculation seam cannot run outside the totals calculation.
**Consequence.** Third-party totals hooks keep today's behaviour: a prepended hook's edits to totals are rebuilt away by the provider calculator today; an appended hook runs after tax and its charges stay untaxed, and Spec 1 adds that rule to the docs page that shows appended calculators adding fees (`apps/docs/docs/framework/modules/sales/calculations.mdx:39-45`), which does not mention tax today.
**Rejected alternatives.** Option A (an additive phase option on `registerSalesTotalsCalculator`, the fallback of DR-2), Option C (no phase: tax fed through explicit `taxAmount` and metadata, which the regenerated provider adjustments lose), a separate tax module (collides with the ecommerce suite roadmap's ADR-2 and needs a cross-module workflow layer that does not exist) and the SPEC-024 §10.2 plugin hook (transaction-level tax needs the document, addresses and charges only the `sales` pipeline has; §10.2 is proposed as superseded for the transaction-level part only); Spec 1 § 3 carries the reasons.
**Decision Requested:** yes — asked in Spec 1 as DR-1 (placement), DR-2 (Option B versus A) and DR-3 (where the contract types live; default core `sales`); not repeated here.

### ADR-2 — Resolve before the transaction, Apply before the flush, the phase writes
**Decision (proposed).** The command layer runs a first calculation pass on the future document state, builds `SalesTaxRequest`, calls `provider.calculate` outside `withAtomicFlush` and `em.transactional`, then recomputes the input fingerprint from a re-read of the inputs and, on a match, runs the second calculation pass in which the tax phase writes the result; the write transaction opens after that and only persists, in all twelve recalculating commands (the two header updates, which calculate inside it today, are hoisted before it); a mismatch fails closed on a create and on an update alike (409, nothing written); `stale` is reserved for Spec 4b's trigger-based staleness. Without a configured provider (`product-rate`, the default state) the engine runs today's one pass and there is no Resolve.
**Rationale.** The lock sites of § 2 point 6 must not hold rows during network I/O; the engine stays deterministic, which the ecommerce Phase 2 gate (cart totals byte-identical to the order) depends on.
**Consequence.** One transaction boundary for every recalculating command (Spec 1 § 4.2); return commands run no provider call in Spec 1 and keep today's behaviour (`commands/returns.ts:724`, `:538`); the explicit recalculate command that refreshes a `stale` document is Spec 4b. Callers that are not `sales` commands (the cart, checkout, POS) run Resolve through a `sales`-owned DI service (working name `salesTaxResolutionService`) that runs the Resolve step on a non-persisted document and returns the `context.tax` slot that `calculateDocumentTotals` applies; Spec 1b (a follow-up of Spec 1, Phase 1) specifies and registers it on top of Spec 1's request builder and phase, and until it exists those callers receive `product-rate` figures from the service.
**Rejected alternative.** The provider call inside `calculateDocumentTotals` (holds transactions and `PESSIMISTIC_WRITE` locks for a round trip; makes the engine non-deterministic).
**Decision Requested:** none here; the fail-closed policy is Spec 1's Ask First paragraph (§ 4.13).

### ADR-3 — A document-level contract with explicit status; the unit seam stays as the predecessor
**Decision (proposed).** `SalesTaxRequest` carries the document, the three addresses, customer facts, lines with their tax inputs, charges, tax date, currency, `pricesIncludeTax` and the intent; `SalesTaxResult` carries a status, per-line and per-charge results keyed by `ref` with their jurisdictions, and a provider reference; the invariant `gross = net + tax` is enforced at the boundary. `taxCalculationService` and `sales.tax.calculate.before/after` stay unchanged and are documented as the predecessor for unit price entry; the docs gain a chapter on document-level providers with a table of what the unit seam cannot carry.
**Rationale.** A rates-only contract cannot carry provider amounts, flat fees or jurisdictions; the unit seam has no document, address, customer, status or lifecycle (`services/taxCalculationService.ts:8-15`).
**Consequence.** The intent is set by the caller, never derived from the document kind, because the cart calls the engine with a quote-like document (`2026-08-14-cart-module.md:106`): `estimate` for quotes and for a cart once a ship-to address is known, `record` for orders, `display` for cart and UI previews, never remote (Spec 1 § 4.7). For the touchpoints this means: the cart shows `display` figures without a ship-to (local math only: `product-rate`, or the table provider from the channel's origin; the request carries customer facts and the tax mode), checkout runs `estimate` with the address, `cart.lock()` recalculates with the address, the order's `record` calculation runs when checkout creates the sales document, which precedes the gateway payment in the checkout flow (`2026-03-19-checkout-simple-checkout.md:340`, `:353`), so a tax failure aborts before any payment is taken, and `failed` blocks submit; POS taxes at the store location with gross prices (`SPEC-022-2026-02-07-pos-module.md:405`). Those are amendment proposals to the owners of the e-commerce specs (RD-4), not edits.
**Rejected alternative.** A Deprecation Protocol entry for `taxCalculationService` and `sales.tax.calculate.*` (§ 14 Q11).

### ADR-4 — The provider is selected per organization; documents carry server-written provenance
**Decision (proposed).** Provider selection is organization-level configuration, specified by Spec 1 and named here only to fix ownership: one additive nullable column `sales_settings.tax_provider_key` (`SalesSettings`, `data/entities.ts:755`; `NULL` means `product-rate`), written through a new route `GET`/`PUT /api/sales/settings/tax-provider` that runs the existing `sales.settings.save` (`commands/settings.ts:50`) extended with an optional field, behind the existing `sales.settings.manage` (`acl.ts:112`). Nothing on a document selects a provider: `tax_strategy_key` on orders records `tax-provider:<providerKey>` as provenance, `tax_info` records the provenance record; quotes record provenance in their existing `tax_info`; no quote column; client-supplied values stay accepted (schemas untouched) and are overwritten when a provider runs. The phase runs in the engine's normal calculation mode; a future mode that stores externally taxed amounts verbatim must skip the phase at the point where the shipping and payment provider steps would also be skipped, inside the provider totals calculator (no such guard exists at head).
**Rationale.** Per-document selection would make a free-text, client-writable field an authority and needs a quote column; a jsonb settings bag hides a typed setting; one nullable column is reversible.
**Consequence.** Per-channel or other scoped overrides of the setting are a later spec (channel scoping is an Ask First item of `packages/core/src/modules/sales/AGENTS.md:13`); the provenance prefix is a convention for server-written values, not a guarantee, and a record is trustworthy only with the server-computed fingerprint of the same write.
**Rejected alternatives.** Per-document selection through a namespaced `tax_strategy_key`; new provenance columns; a jsonb settings bag; two design variants for the externally taxed amounts mode (one with, one without the open implementation).

### ADR-5 — `product-rate` names the default state; OSS destination rates and reverse charge come later
**Decision (proposed).** `product-rate` is the name of the default state (no provider configured, the `NULL` setting), not a registered provider: the engine runs today's line tax (§ 2 point 1) in its single pass with no Resolve and no `tax` slot, so documented hooks such as the gift line that zeroes `taxAmount` keep working and totals stay byte-identical. OSS destination rates and EU reverse charge are not part of v1: the request carries ship-to country and tax ids so a later resolver over the unused `country_code` / `region_code` columns can add them; the proposed cross-border default is `keep-net`: when a destination rate differs from the product's rate, the net price is kept and the gross changes; `keep-gross` keeps the gross price and lets the net change. Under any configured provider every gross-entered line keeps its net and its gross changes (Spec 1 § 4.10) until the gross-preserving split lands in Spec 4a with its line columns.
**Rationale.** The first PR must not change amounts for any existing tenant; the address spec defers country normalization and VAT-id validation, on which both features depend.
**Consequence.** Spec 2 may add an EU resolver later without touching the contract.
**Rejected alternatives.** A built-in EU destination resolver in v1; a registered `product-rate` provider (a protected registry entry whose `calculate` recomputes tax from the rate, overwriting explicit `taxAmount`).
**Decision Requested:** yes — RD-3.

### ADR-6 — The built-in table provider runs on the existing `SalesTaxRate` columns
**Decision (proposed).** The table provider (working name `tax-destination-table-rate`; the final name is chosen in Spec 2) matches `SalesTaxRate` rows on the existing columns (`data/entities.ts:258-323`): country, region, postal code or range, city, channel, priority, compound and validity dates, and customer groups as a set; the existing `product_category_id` column (`:292`) can match only once Spec 4a puts the product facts on the line, and a product-code key needs a new column that Spec 2 names, so category and code matching depend on Spec 4a; with CSV import and export and `sourcing: destination` by default, `origin` (ship-from = channel address) as an option. Group matching takes a set of group ids from an owner-provided DI service when one is registered and otherwise matches rows with `customer_group_id = null` only; orphaned ids are reported, not ignored (ecommerce roadmap risk R3).
**Rationale.** The schema was designed and documented for this (`README.md:11`); only the logic is missing. Destination sourcing is the only sourcing that works for remote and cross-border sales and reuses the ship-to the contract carries.
**Consequence.** The provider is deterministic and needs no remote call, so it can ship before Spec 4b; it recomputes on every recalculating write, but a ship-to change alone does not recalculate until Spec 4b widens the triggers (§ 2 point 3), so a table-provider document can hold stale tax after an address change exactly like a remote one; the Phase 1 gate states that limitation. Destination facts come from the header snapshot. The admin UI extends the existing tax-rate CRUD (`api/tax-rates/route.ts`, `makeCrudRoute`, every method behind `sales.settings.manage`) and its `CrudForm` dialog (`components/TaxRatesSettings.tsx:370`; issue #6414).
**Rejected alternatives.** A new rate table (duplicates `SalesTaxRate`); origin sourcing only; an external provider only; a mock provider as the contract proof (the table provider is the proof).
**Decision Requested:** yes — RD-2.

### ADR-7 — A separate `tax_gateways` module; credentials through `integrations`; vendor packages outside the core modules
**Decision (proposed).** A new core module `tax_gateways` (name proposed; table prefix `tax_gateway_`) shaped like `payment_gateways` and `shipping_carriers` (`implemented/SPEC-045-2026-02-24-integration-marketplace.md:77-78`) holds the settings UI, the provider lifecycle, the failure policy and the admin-visible log; credentials live in `integrations` under an additive `tax` member of `IntegrationCategory` (a `packages/shared` change; "registry type contracts" are an Ask First item of `packages/core/src/modules/integrations/AGENTS.md:23`); sensitive fields are declared through the module's `encryption.ts` maps. Vendor adapters are packages outside the core modules (the root rule `AGENTS.md:183`).
**Rationale.** The contract and the registry stay in `sales` under Spec 1's DR-1 default (ADR-1), while lifecycle, credentials and logs are the hub's job per SPEC-045; `payment_gateways` already consumes `integrationCredentialsService` and `integrationLogService` (`packages/core/src/modules/payment_gateways/lib/gateway-service.ts:80`, `:82`, `:199`).
**Consequence.** `tax_gateways` consumes `sales` types and `integrations`; vendor packages register a `TaxProvider` into `sales` and credentials into `integrations`; providers resolve credentials through the `resolve` Spec 3 adds to the provider context.
**Rejected alternatives.** Everything in `sales` (too much for one module); everything in vendor packages (no shared lifecycle or log); an own credential store.
**Decision Requested:** yes — RD-1 (module and category).

### ADR-8 — Commit, adjust and void run through durable subscribers with idempotency and a failure policy
**Decision (proposed).** `commit`, `adjust` and `void` are optional provider methods typed by Spec 3 and triggered from durable subscribers of `sales` events with an idempotency key per call; the commit point is configurable per provider and organization (leaning: `invoice` default, `payment` and `order_confirmed` as options; § 14 Q4); one failure policy per provider with two values: `fail` (the write fails as in Spec 1 § 4.13) and `fallback-table` (the table provider of Spec 2, the result recorded with status `fallback`); a provider disabled mid-quote follows the same policy (`stale` stays reserved for Spec 4b); invoices and credit memos keep caller-supplied amounts in v1 (`sales.invoices.create` and `sales.credit_memos.create` never call the engine).
**Rationale.** A remote call must not sit inside a document command; subscribers are the sanctioned side-effect mechanism (`packages/events/AGENTS.md`).
**Consequence.** Changing the invoice amounts source touches the Quote → Order → Invoice flow, an Ask First item.
**Rejected alternatives.** Commit fixed at invoice; invoice tax derived pro rata from the order in v1; silent zero on failure.

### ADR-9 — Inputs and recalculation are two specs after the contract: 4a carries the facts, 4b the triggers
**Decision (proposed).** Spec 4a (tax inputs) gives the request the facts it lacks today through owner services (ADR-10), the address sources (ship-to from the header snapshot as the leaning, § 14 Q6; ship-from from a `sales`-owned resolver over the channel address, `data/entities.ts:16`, `:50`), the line detail columns on the four line tables (names governed there, § 14 Q7) and the allocation of document discounts to lines before the tax phase. Spec 4b (tax recalculation) widens recalculation to address, customer, channel, `placedAt`, `exchangeRate` and provider-setting changes, sets `stale`, adds the explicit recalculate command, fixes the frozen-tax carry-over in the two line upsert paths behind `tax_manual_override` with the `price_entry_mode` backfill, reverses tax on returns and changes the line dialog to send only the entered price, its mode and the rate id.
**Rationale.** 4a works under today's triggers, and 4b's triggers read fields that exist today, but 4b's carry-over fix and `price_entry_mode` backfill need 4a's columns, so 4a precedes 4b; one combined document would span three modules, four line tables, a backfill and a behaviour change for every tenant. A remote provider whose result survives an address change is unsafe in production, so 4b closes Phase 2; the frozen-tax fix changes stored amounts and needs an `UPGRADE_NOTES.md` entry in the "heals on next write" style with a flag that protects explicit `taxAmount`.
**Consequence.** Until Spec 4b lands, provider documents can hold stale tax after an address change and untaxed regenerated charges after a return (Spec 1 § 4.8); Phase 2 does not close before it; the per-line and per-jurisdiction breakdown lives in the header `tax_info` record until Spec 4a's columns exist.
**Rejected alternatives.** One combined inputs-and-recalculation spec; estimate on every line save (cost and races); header-only results forever (posting and period tax need per-line data); fixing the carry-over in Spec 1 (breaks "nothing changes without a provider").

### ADR-10 — Facts come from their owners through soft-resolved DI services
**Decision (proposed).** Product tax facts, customer tax facts and exemption facts enter the request through DI services owned by `catalog`, `customers` or `customer_groups`, resolved with a local `tryResolve`; when no service is registered the fields are `null` and the request still validates; Spec 1 fills only what is already on the document (line snapshot, address snapshots).
**Rationale.** Issue #6733 (cross-module data ownership audit) lists `catalog` reading `SalesTaxRate` and `sales` reading `customers` entities for remediation; `packages/core/AGENTS.md:250` names the optional consumer as the owner of the glue.
**Consequence.** This ADR proposes the mechanism, not the owner: the owner of exemption facts (`customers`, `customer_groups` or the gateway module) and the service names are chosen in Spec 4a with the owners.
**Rejected alternative.** New ORM reads in `sales`.

### ADR-11 — Three net/gross concepts are kept apart; presentation derives from the group's price kind
**Decision (proposed).** Entry mode (per line, `metadata.priceMode` today), the request's inclusive flag (`pricesIncludeTax`: `true`, `false` or `'mixed'`) and presentation mode (`tax_mode`, `gross | net`, the name the cart spec already uses, `2026-08-14-cart-module.md:145`, `:444`) are three different things. Presentation derives from the `displayMode` of the price kind the customer group points to (customer-groups spec §6.1a, `2026-08-14-customer-groups-and-b2b-terms.md:326`; `CatalogPriceKind.displayMode`, `packages/core/src/modules/catalog/data/entities.ts:754`), then from the selling country or channel, then from the document's price kind; the line dialog's change to send only the entered price, its mode and the rate id (the server derives the other side) ships with Spec 4b, because it is an entry-mode fix, not presentation.
**Rationale.** A global net/gross switch is the known failure class; the customer-groups spec says the price kind is the only source of display mode for a group, while the cart spec says `resolveTerms()` returns a tax mode (`2026-08-14-cart-module.md:80`), an inconsistency the owners must settle.
**Consequence.** Spec 5 proposes a named presentation component for the cache, projection and index keys whose output depends on the mode, within the ecommerce roadmap's rule that every such key is built from named `BuyerContext` scope components (`2026-08-14-ecommerce-suite-roadmap.md:287-295`; ADR-7, `:253`, `:267`); amending `BuyerContext` needs the e-commerce owners' acceptance (RD-4).
**Rejected alternative.** Variant (b): explicit overrides group → country → price kind, only with the owner's agreement.
**Decision Requested:** yes — RD-5.

### ADR-12 — The new tax registry is `globalThis`-backed; the existing registries stay as they are
**Decision (proposed).** The tax provider registry stores its state on `globalThis` under a stable key, following the catalog pricing resolver registry (`packages/core/src/modules/catalog/lib/pricing.ts:193`, `:215`) and the repository lesson (`.ai/lessons/global-registries-in-publishable-packages-must-use.md:14`), so a registration from a vendor package survives a second module instance; the shipping and payment registries (`lib/providers/registry.ts:6-7`, module-local `Map`s) are untouched and moving all three is offered as a follow-up; the semantics are Spec 1 § 4.17.
**Decision Requested:** yes — asked in Spec 1 as DR-4; not repeated here.

---

## 7) Spec Breakdown

| # | Spec (proposed file name) | Status | Module(s) | Depends on | Content |
|---|---|---|---|---|---|
| 1 | `2026-10-03-sales-tax-provider-contract.md` | written in this PR | `sales` | — | Tax phase (fixed step inside the provider calculator by default; named phase option as the fallback), `TaxProvider` and registry, `SalesTaxRequest` / `SalesTaxResult`, organization-level provider setting (one nullable column on `sales_settings`; `NULL` is the default state, `product-rate`), Resolve/Apply before the write transaction, statuses, `tax_info` as the provenance record, one new settings route. No document or line table change; no new command. |
| 1b | `{date}-sales-tax-resolution-service.md` (working file name) | to write | `sales` | 1 | The `sales`-owned DI service (working name `salesTaxResolutionService`) that runs the Resolve step on a non-persisted document and returns the `context.tax` slot that `calculateDocumentTotals` applies, for callers that are not `sales` commands (checkout once the Simple Checkout specification's totals path lands; cart and POS when their modules exist); no command, no table. |
| 2 | `{date}-sales-tax-destination-table-rate-provider.md` (working file name) | to write | `sales` | 1; 4a for category and product-code matching | Matching on the existing columns (category and code only after Spec 4a; a product-code key needs a new column); CSV import and export; admin UI on the existing tax-rate CRUD; `sourcing: destination` default with `origin` option; group-set matching on `customer_group_id` with a soft-resolved group service; orphan reporting. |
| 3 | `{date}-tax-gateways-module.md` | to write | `tax_gateways` (new), `integrations` | 1; 2 for the `fallback-table` policy value | Credentials via the `tax` category, settings UI, commit/adjust/void, commit timing, failure policy, idempotency, log: what a remote-engine provider needs in production. |
| 4a | `{date}-sales-tax-inputs.md` (working file name) | to write | `sales`, `catalog`, `customers` | 1 | Owner fact services resolved with `tryResolve` (product tax code, customer tax ids and exemption facts, group set), address sources (ship-to from the header snapshot, a ship-from resolver), line detail columns, document-discount allocation to lines before the tax phase, the gross-preserving split for gross-entered and POS lines (keep-gross, ADR-5). |
| 4b | `{date}-sales-tax-recalculation.md` (working file name) | to write | `sales` | 1 (4a for the line detail it persists) | Recalculation triggers, `stale`, the explicit recalculate command, the frozen-tax carry-over fix with `tax_manual_override` and the `price_entry_mode` backfill, return reversal, the line dialog sending only the entered side. |
| 5 | `{date}-sales-tax-presentation-mode.md` | to write | `sales`, `customer_groups`, `ecommerce` | 1, 4a, 4b; the `customer_groups` and `ecommerce` implementations (parallel work, not at head) | Three concepts kept apart, the selling country or channel, group interplay per §6.1a, the presentation mode as a cache-key component. Co-owned with the customer-groups spec owners. |
| 6a | Amendment proposal to the e-commerce owners: ecommerce suite roadmap ADR-2 and ADR-7; `2026-08-14-cart-module.md` §5.2 and `tax_mode`; `2026-03-19-checkout-simple-checkout.md` lock and re-price | amendment proposal, not an edit | `cart`, `@open-mercato/checkout`, `ecommerce` | 1, 1b (the Resolve service) | Cart `display` without ship-to (never remote); checkout runs `estimate` with the address; `cart.lock()` recalculates with it; the order's `record` calculation when the sales document is created, before the gateway payment; `failed` blocks submit. |
| 6b | Amendment proposal to the POS owners: SPEC-022 place of taxation | amendment proposal, not an edit | POS | 1, 1b (the Resolve service) | The store location is the place of taxation; prices are gross; `display` must be cheap; final tax before payment. |
| 6c | Amendment proposal to the customer-groups owners: §6.1a and the cart spec's `resolveTerms()` sentence | amendment proposal, not an edit | `customer_groups` | 1, 5 | One source of presentation mode (RD-5); the `2026-08-14-cart-module.md:80` versus §6.1a inconsistency settled by the owner. |
| — | Related, not scoped (mention only) | — | — | — | A separate stream for country-ready presets built on top of this roadmap; vendor adapter packages for remote engines; OSS destination rates and EU reverse charge; VAT-id validation; address validation; nexus. |

### 7.1 What each spec must contain beyond the standard checklist

| Spec | Non-obvious required content |
|---|---|
| 1b — Resolve service | The DI name and the input shape (a non-persisted document: lines, adjustments, header facts) of the Resolve service; the deadline and the failure policy it inherits from Spec 1; no persistence; the byte-identical rule under `product-rate` |
| 2 — Table provider | Exact match semantics for postal code ranges, priority, compound and validity dates; consumption of the group-set service whose contract and DI name Spec 4a fixes with the owners (until it is registered: `customer_group_id = null` rows only, ADR-6); orphan reporting; CSV row results and the worker threshold (an import above it runs as a queue worker with a `ProgressJob` and writes through the `sales.tax-rates.*` commands, `packages/core/AGENTS.md:310-314`); which `SalesTaxRate` columns gain semantics without changing the entity's meaning (applied by analogy with the configuration-entity Ask First rule of `packages/core/src/modules/sales/AGENTS.md:14`, which does not list tax rates) |
| 3 — Gateway module | Credential fields with `secret` types; the `tax` category addition in `packages/shared`; the commit timing and the invoice question; idempotency keys; log retention and access (requests carry addresses and customer ids); the failure policy UI; env preconfiguration inside the provider package (`packages/core/src/modules/integrations/AGENTS.md:13`); whether `estimate` results are cached at all (if so, through the DI `cache` service with tenant-scoped keys and tags) |
| 4a — Inputs | The DI service names chosen together with the `catalog` and `customers` owners and the module-absent behaviour; the address-source rule; the migration for the line detail columns; the discount allocation rule and its rounding; the gross-preserving split and its gate (a gross-entered line keeps its entered gross under a provider) |
| 4b — Recalculation | The trigger matrix per command; the `UPGRADE_NOTES.md` text for the frozen-tax fix; the `price_entry_mode` backfill with a `legacy` state; return reversal; honour-versus-re-quote on conversion; the line dialog change |
| 5 — Presentation | Resolution order of the three sources; the cache-key component; where the selling country lives |
| 6a, 6b, 6c — Amendments | One proposal per owner, each quoting the sentence it changes and the gate it must keep (ecommerce Phase 2: cart totals byte-identical to the order) |

---

## 8) Phasing

Each phase is gated; the next does not start until the gate passes. Delivery order: contract → table provider and Resolve service → gateway module → inputs → recalculation → presentation → touchpoints.

### Phase 0 — Spec 1 (contract)
**Gate:** without a configured provider, totals for every existing test are byte-identical; a test provider sets line tax, charge tax and the tax total on create and update of a quote and an order; `tax_info` carries status and fingerprint; `taxCalculationService` and `sales.tax.calculate.*` are unchanged; the phase runs only in the engine's normal calculation mode, with the one guard point named; the provider assertions run end to end under Spec 1's test-only `tax_stub` provider (a built-in registered from core under `OM_TEST_MODE`, as the payment providers are built-ins) as well as at command level.

### Phase 1 — Spec 2 (table provider) and Spec 1b (Resolve service)
**Gate:** a destination rate table imported from CSV yields per-jurisdiction tax for a quote and an order without any external account; `product-rate` documents are unchanged; orphaned `customer_group_id` rows are reported, not ignored; the limitation that a ship-to change alone does not re-tax a document before Spec 4b is stated in the spec and shown in the admin UI; the Resolve service returns, for a non-persisted document, the tax figures the create command persists for the same inputs (byte-identical under `product-rate`).

### Phase 2 — Spec 3 (gateway module), then Spec 4a (inputs) and Spec 4b (recalculation), one combined gate
Spec 3 lands first (proposed order), then Spec 4a and Spec 4b in ADR-9's order, and the phase does not close before Spec 4b, because a provider result that survives an address change is unsafe in production.
**Gate:** changing ship-to, customer, exemption facts, date or currency re-taxes and persists line tax; returns reduce tax; a test-only provider registered the way Spec 1's `tax_stub` is, extended with commit, adjust and void, runs estimate on the quote → record on order creation → commit on invoice → void on cancel on a test tenant with log entries and an idempotent retry; the failure policy is visible in admin; a gross-entered line keeps its entered gross under a provider (Spec 4a); the line dialog no longer sends a browser-computed gross.

### Phase 3 — Spec 5 (presentation)
**Gate:** a B2B and a B2C buyer see the correct presentation of the same document without a second source of truth.

### Phase 4 — Spec 6 accepted by the owners
Proposals 6a and 6b can be sent from Phase 1 on, 6c with Spec 5 (its dependency); each owner's answer is tracked in the Changelog; the phase closes when each owner has accepted its amendment or, for a declined one, its stated fallback (RD-4, RD-5) is recorded.
**Gate:** the ecommerce Phase 2 gate (cart totals byte-identical to the resulting order) still passes under a configured provider; checkout keeps aborting with `409 price_changed` whenever any total changes (`2026-03-19-checkout-simple-checkout.md:307`, `:332-333`), and unchanged tax inputs introduce no spurious difference; POS computes the final tax before payment (6b); the customer-groups specification names one source of presentation mode (6c).

---

## 9) Data Models

This umbrella defines no entity. Spec 1 defines the contract shapes (`SalesTaxRequest`, `SalesTaxResult`, `TaxProvider` and the provenance record in `tax_info`, its § 4.3 and § 6); this roadmap defines their owners and dependencies:

| Concept | Owning module | Table prefix |
|---|---|---|
| Tax phase, contract, registry, provider setting, provenance, table matching, line detail columns | `sales` | `sales_` |
| Gateway settings, lifecycle state, failure policy, provider log entries | `tax_gateways` (proposed) | `tax_gateway_` (proposed) |
| Credentials, integration log | `integrations` | existing tables |
| Product tax code and its variant override | `catalog` | `catalog_` |
| Customer tax ids, exemption facts, group set | `customers` / `customer_groups` (proposed; the owner of exemption facts is chosen in Spec 4a) | their own prefixes |
| Vendor adapter state | provider package | none in `sales` |

No child spec may introduce an entity under a prefix owned by another module. Names reserved by SPEC-024 and the parallel period-level work are never used for these concepts: `TaxCode`, `TaxCodeAccountMapping`, `TaxLiabilityRecord`, `ITaxEngine`, `ITaxEngineLine`, `ITaxReporting`, `taxEngineRegistry`, `accountRoles`, `tax_management`, `financial_pl`, `TaxContext`, `TaxResult`, `TaxModule`.

## 10) API Contracts

This umbrella specifies no endpoint. It lists the surfaces the child specs own, with their names and guards:

| Surface | Owner | Spec |
|---|---|---|
| `GET` / `PUT /api/sales/settings/tax-provider` — `requireAuth`, `sales.settings.manage` (reused; every default employee holds it, `setup.ts:54`; the existing settings routes require it, `api/settings/order-editing/route.ts:28-29`) | `sales` | 1 |
| `/api/sales/tax-rates` (existing `makeCrudRoute`) extended with import and export | `sales` | 2 |
| `/api/tax-gateways/*` (proposed), `requireAuth`, `tax_gateways.*` features | `tax_gateways` | 3 |
| Events `sales.tax.document.calculate.before` / `.after` (additive; shaped like `sales.document.calculate.*`, `events.ts:82-83`) | `sales` | 1 |
| Event `sales.tax.input.changed` | `sales` | 4b |
| Events `tax_gateways.transaction.committed` / `.voided` / `.failed` (declared in the gateway module's `events.ts`, the emitter) | `tax_gateways` | 3 |
| DI service for Resolve outside the `sales` commands (working name `salesTaxResolutionService`): runs the Resolve step on a non-persisted document and returns the `context.tax` slot | `sales` | 1b |
| Commands `sales.orders.recalculate_totals`, `sales.quotes.recalculate_totals` | `sales` | 4b |

Existing event ids are FROZEN (`BACKWARD_COMPATIBILITY.md:159`) and none is renamed; `sales.tax.calculate.before/after` keep their payload. Provenance fields (`tax_info`, `tax_strategy_key`) are not exposed in the read API by Spec 1; a later spec decides their exposure.

## 11) Parallel Work

States read on 2026-10-03 with read-only tracker queries; `develop` was still `7f0ebf653`. None of these is a base or a dependency; each is coordinated, not assumed; one implementation PR per phase rebases on whichever lands first, and the Spec 1 settings column has no textual overlap with any open hunk (`SalesSettings` is untouched by all of them).

| Ref | Relationship |
|---|---|
| Engine-file overlap (#6092 the external amounts mode, #6184 bulk line writes, #6146, #6255, #6833), the sales defects (#6461, #6075, #5853, #6459), the ownership audit #6733 and the period-level work #6168 with official-modules #55 | Spec 1 § 11 carries each; the roadmap adds nothing beyond: Spec 4b covers the two upsert paths at head (`commands/documents.ts:7575`, `:8067`), ADR-10 adds no cross-module read, the period-level names are reserved in § 9, and Spec 1 DR-1 asks whether SPEC-024 §10.2 or the `tax_management` text (which calls transaction-level tax the territory of `sales`) holds. |
| #6046 docs(specs): sales invoice GL posting (open); #6340 feat(ledger): general ledger core engine (open) | GL posting sums line `taxAmount` only, so charge tax must be visible to it; the ledger is a later consumer; § 14 Q10. |
| #5384 docs(specs): ecommerce module suite (merged 2026-09-17): ecommerce suite roadmap ADR-2 and ADR-7, `2026-08-14-cart-module.md`, `2026-03-19-checkout-simple-checkout.md`; #6346 docs(specs): assisted selling and the cart proposal seam (open) | Spec 6 targets; that roadmap has an active owner and is changing: propose, never edit. The assisted-selling proposal cart copies the target's `tax_mode`; tax must use the target buyer's facts. |
| #6709 feat: ecomm Release 2 — availability contract + customer groups (open; no file under `sales/`); issue #6414 (sales: tax-rate CrudForm `entityId`) | Introduces `customer_groups`, which has no module at head; Spec 2 designs on the `customer_group_id` column at head and on the §6.1a text on `develop`; question to the author: whether the column keeps its meaning and who adds the group picker to the tax-rate form. |
| #6268 feat(catalog): pricing engine admin UI + resolver hardening (merged); #5771 feat(customers,sales): tax id on addresses (merged; the address spec's later phases pending); #5192 feat(catalog): Omnibus price tracking (open; shares `sales/data/entities.ts` and the migration snapshot) | `globalThis` registry pattern (ADR-12); `taxId` / `taxIdType` as optional request input; whichever of #5192, #6092 and the Spec 1 column lands last regenerates the sales migration snapshot. |

---

## 12) Risks & Impact Review

**Data integrity.** Every provider result is applied after the fingerprint comparison and before the write transaction opens (ADR-2); a failed consistency check writes nothing. **Cascading effects.** The engine stays deterministic, so equal inputs give equal totals in every touchpoint, and each touchpoint's integration (6a, 6b) is responsible for supplying them; a `sales.document.calculate.after` subscriber can still rewrite totals after the phase, and the provenance record then describes the provider's result, not the persisted totals (Spec 1 § 12). **Tenant isolation.** The setting, the rate rows and the provenance are organization-scoped; the registry holds code, never tenant data; credentials stay in `integrations`. **Migration.** Spec 1 adds one nullable column with a reversible migration; once an organization selects a provider, its existing documents that carry a `tax`-kind adjustment or a rated discount are refused on their next recalculating write until the row is fixed (Spec 1 § 4.8); Spec 4a's line detail columns are additive and Spec 4b's `price_entry_mode` backfill must be sized by that specification. **Operations.** Provider calls are bounded by a timeout and a per-provider failure policy; the log is the operator's detection path; a provider package resolves credentials only through the `resolve` Spec 3 adds to the provider context (never a process global). **Capacity and consumers.** Phases 0–2 are the minimum useful set and Phases 3–4 can slip without invalidating the contract; period-level and posting consumers read the interim breakdown in `tax_info` until Spec 4a's line detail exists; every child spec lists its i18n keys for the five locales.

### Risk Register

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| **Stale tax until Spec 4b**: a provider-taxed order gets a new ship-to and nothing recalculates (`shouldRecalculateTotals`, `commands/documents.ts:5522`, `:5797`); a return or any other write without a `tax` slot regenerates the charges untaxed (Spec 1 § 4.8); the invoice copies the old tax | High | Phase 2 does not close before Spec 4b; neither a remote nor a table provider is production-safe before then for documents whose ship-to changes; `stale` is in the vocabulary from Spec 1; from Phase 1 the admin notice states the limitation | from Phase 0 (any registered provider) until Spec 4b a production organization that selects a provider can invoice stale tax; proposed for acceptance as a gated phase |
| **Silent zero or silent fallback**: a provider outage returns no tax and the document is written with zero tax and no status | High | fail closed in Spec 1; a per-provider policy with a labelled `fallback` status in Spec 3; `display` never calls a remote provider | a merchant who chooses `fallback-table` accepts approximate tax at checkout; the label is the only protection |
| **External provider outage at checkout or POS**: the provider is down while a buyer submits | High | the order's `record` calculation runs when checkout creates the sales document, before the gateway payment (`2026-03-19-checkout-simple-checkout.md:340`, `:353`), under the per-provider policy, so a failed calculation leaves no paid customer without an order; `commit` runs later through a durable subscriber with retry; POS taxes at the store with the table provider | a `fail` policy stops sales during an outage by design |

The risks Spec 1 owns (double taxation, a provider call under a lock, forged provenance, rounding, the default employee's settings access, the fail-closed outage radius) are in its § 12; the frozen-tax fix is Spec 4b's (§ 7.1) and the orphaned `customer_group_id` rows are Spec 2's (§ 7).

---

## 13) Decision Requested

Spec 1 asks its own four questions (DR-1 placement, DR-2 Option B versus A, DR-3 where the contract types live, DR-4 registry storage) and they are not repeated here. The roadmap asks the direction-level questions below; each has a recommended default and an "if rejected" fallback.

| # | decision | if rejected |
|---|---|---|
| RD-1 | **A separate `tax_gateways` core module** for lifecycle, failure policy and log, with an additive `tax` member on `IntegrationCategory` in `packages/shared` (ADR-7) | lifecycle, policy and log inside `sales` (a larger module, same contract); credentials under the existing `other` category until a `tax` member is accepted |
| RD-2 | **The built-in table provider runs on the existing `SalesTaxRate` columns** with `sourcing: destination` as the default and `origin` as an option (ADR-6); no compliance outcome is promised for either; a product-code key needs a new column, which Spec 2 names | a dedicated rate table owned by Spec 2 with the same matching semantics and `SalesTaxRate` left unchanged; `sourcing` stays a provider setting with the same default |
| RD-3 | **OSS destination rates and EU reverse charge stay out of v1**; the cross-border default is `keep-net` (ADR-5) | a built-in EU destination resolver inside Spec 2's scope with `keep-gross` as the cross-border default (both terms defined in ADR-5) |
| RD-4 | **Amendments to the e-commerce specs** (owners of the ecommerce suite roadmap, the cart and the checkout specs): the cart shows `display` figures without ship-to (never remote), checkout runs `estimate` with the address, `cart.lock()` recalculates with it, `record` when the sales document is created before the gateway payment, `failed` blocks submit (ADR-3) | no tax figure in the cart before checkout's address step (net totals with a "tax at checkout" label); `cart.lock()` under a provider accepts `409 price_changed` whenever the estimate and the final figure differ |
| RD-5 | **Presentation mode variant (a)**: derived from the `displayMode` of the price kind the customer group points to (customer-groups spec §6.1a), then from the selling country or channel, then from the document's price kind; name `tax_mode` (ADR-11) | variant (b): explicit overrides group → country → price kind, proposed to the customer-groups spec owner as an amendment |

## Decision Record

*Empty pending maintainer sign-off. Record each answer here with the date and the login of the maintainer who gave it, and mirror it into the ADR it changes; an ADR without a separate question is recorded here as one sign-off line.*

---

## 14) Open Questions

Questions each child spec decides; the leaning is this roadmap's proposal.

| # | Question | Spec | Leaning |
|---|---|---|---|
| 1 | Units, rounding and precision: is `taxRate` in percentage points; what tolerance and currency precision does the phase honour? | 1 (currency precision in a later spec) | percentage points, 4 decimals, the engine tolerance (`lib/calculations.ts:25`, `:33`) |
| 2 | Which module owns a customer's exemption facts (flag, certificate id, validity, jurisdictions), and does the result adopt the SPEC-024 vocabulary (`isExempt`, `exemptReason`, `isReverseCharge`)? | 4a | the owner module through a DI service; the SPEC-024 names |
| 3 | Are `tax`-kind adjustments, negative corrections and line-scoped allocations allowed under a configured provider? | 1 refuses `tax`-kind adjustments and rated discounts (Ask First); allocation 4a; manual corrections 4b | a manual correction sets `overridden` |
| 4 | Does the provider `commit` fire on invoice issue or on payment when no invoice is issued? | 3 | configurable, `invoice` default |
| 5 | Do invoices and credit memos take tax from the order or keep caller-supplied amounts in v1 (the Quote → Order → Invoice flow, Ask First)? | 3 | caller-supplied in v1 |
| 6 | What is the source of ship-to for tax, the header snapshot or `SalesDocumentAddress` rows; do tax id and exemption enter the `BuyerContext` digest? | 4a, 6a | the header snapshot only; yes to the digest |
| 7 | Which field is the canonical product tax code (`taxClassificationCode`, a new `provider_tax_code`, or a mapping to the period-level `TaxCode`), and may a variant override it? | 4a | a new `provider_tax_code` with a variant override; no relation to the period-level code |
| 8 | On quote → order conversion and public acceptance, honour the quoted tax or recalculate for the order? | 1 keeps today's copy semantics and carries no provenance key (Ask First, § 4.14); the policy is 4b | an organization setting `honor \| re-quote`; `product-rate` honours |
| 9 | Where does the selling country that drives net/gross presentation live (`SalesChannel` has no tax settings)? | 5 | open between a `SalesChannel` setting, a concept in `ecommerce` and an organization setting |
| 10 | For invoice GL posting, does charge tax appear as a `shipping` invoice line or as an extension of the tax total? | the author of the open posting spec (#6046) | not settled by this roadmap |
| 11 | Do `sales.tax.calculate.*` and `taxCalculationService` go through the Deprecation Protocol in favour of the new contract, and in which release? | 1 | no deprecation; the unit seam stays as the predecessor |
| 12 | Do the sales provider and calculator registries move to `globalThis` like the pricing resolver registry, all or none? | 1 (DR-4 asks for the new registry only) | the rest is a follow-up offer |

Ask First items (`packages/core/src/modules/sales/AGENTS.md:13-14`, `packages/core/src/modules/integrations/AGENTS.md`, `packages/events/AGENTS.md`) are body paragraphs with a default and an alternative in the spec that touches them: adjustment kinds and the Quote → Order flow in Spec 1 (`tax`-kind adjustments and rated discounts refused under a provider, new or stored; conversion copies the provenance), `SalesTaxRate` semantics in Spec 2, the commit point and the `integrations` registry type contract in Spec 3, channel scoping in a later spec; no event id is renamed.

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
| §8 Database Schema (`BACKWARD_COMPATIBILITY.md:192`, ADDITIVE-ONLY) | line detail columns (Spec 4a) and the `price_entry_mode` backfill (Spec 4b); gateway tables (Spec 3) |
| §9 DI Service Names (`BACKWARD_COMPATIBILITY.md:207`) | owner services (Spec 4a); the Resolve service for non-command callers (Spec 1b) |
| §10 ACL Feature IDs (`BACKWARD_COMPATIBILITY.md:216`, FROZEN) | `tax_gateways.*` features (Spec 3) |
| `packages/shared` `IntegrationCategory` | additive `tax` member (Spec 3; Ask First) |

`UPGRADE_NOTES.md`: nothing for spec-only PRs; the implementation PR of Spec 1 adds an entry for the settings column and the provenance semantics of `tax_info`; Spec 4b's implementation adds the frozen-tax entry.

## 16) Implementation Plan (delivery plan of the umbrella)

Each step is a pull request that leaves `develop` consistent; implementation PRs follow the phases of the spec they implement.

1. **Phase 0.** This PR: the roadmap, Spec 1 and two README rows; the spec step of Phase 0 ends when both Decision Records are filled, and the phase closes at its § 8 gate.
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
| root AGENTS.md | Every external integration provider in `packages/<provider-package>/`, never in `packages/core/src/modules/` (`AGENTS.md:183`) | Compliant | vendor adapters live outside the core modules in their own packages; this roadmap plans no adapter package and names no location |
| root AGENTS.md | Event IDs `module.entity.action`, dots (`AGENTS.md:206`) | Compliant, with one proposed deviation | `sales.tax.document.calculate.before/after` mirror the existing lifecycle pair `sales.document.calculate.*`; `sales.tax.input.changed` (Spec 4b) and `tax_gateways.transaction.committed/voided/failed` (Spec 3) use a singular entity and the past tense; the recalculate command ids keep the module's plural convention (see Non-Compliant Items) |
| packages/core/AGENTS.md | Cross-Module Coupling: optional consumer owns the glue, `try/catch` resolve, no hard `requires` (`packages/core/AGENTS.md:242-250`) | Compliant | ADR-10; `index.ts:12` unchanged |
| packages/core/src/modules/sales/AGENTS.md | MUST use `salesCalculationService` for document math; Ask First on the Quote → Order → Invoice flow, channel scoping and configuration entity semantics (`packages/core/src/modules/sales/AGENTS.md:13-14`) | Compliant | the tax phase lives inside the engine and the touchpoints call the service (ADR-1, ADR-3); § 14 routes each Ask First item to the spec that touches it |
| packages/core/src/modules/integrations/AGENTS.md | Never import from provider modules; Ask First on registry type contracts; secret fields typed `secret` | Compliant | § 5; RD-1; Spec 3 content row |
| packages/events/AGENTS.md | Declare events in the emitting module's `events.ts`; persistent subscribers idempotent; Ask First on renaming (`packages/events/AGENTS.md:15`) | Compliant | the Spec 1 and Spec 4b ids declared in `sales/events.ts`, the lifecycle ids in `tax_gateways/events.ts` (the emitter, Spec 3); ADR-8 idempotency; nothing renamed |
| .ai/specs/AGENTS.md | `{date}-{title}.md`, no `SPEC-*` prefix; required sections | Compliant | this file and the child file names |
| BACKWARD_COMPATIBILITY.md | Event IDs FROZEN, schema ADDITIVE-ONLY, DI names STABLE, validators never narrowed | Compliant | § 15; Spec 1 § 10 |

Rules the umbrella cannot answer itself (optimistic locking, `makeCrudRoute`, encryption maps, integration tests, `ProgressJob` workers, provider env preconfiguration, cache strategy, UI rules) are routed to the child spec that owns the surface through § 7.1.

### Non-Compliant Items

Open, pending explicit maintainer acceptance: the recalculate command ids of Spec 4b are proposed with the module's plural convention (`sales.orders.*`, `sales.quotes.*`) instead of the singular entity rule, for consistency with every existing `sales` command id (alternative: `sales.order.recalculate_totals` and `sales.quote.recalculate_totals`); Spec 1's lifecycle event-id shape (`sales.tax.document.calculate.before/after`) is recorded the same way in Spec 1.

### Verdict

- **Compliant (umbrella)** — the roadmap defines no implementable work; readiness is assessed per child spec; the direction questions stand in § Decision Requested and nothing here is a maintainer decision.

---

## Changelog

### 2026-10-03
- Initial umbrella specification; companion spec `2026-10-03-sales-tax-provider-contract.md` submitted in the same PR; status proposed — decision requested.

### Review — 2026-10-03
- **Reviewer**: Agent (fresh-context adversarial review: scope cohesion, then the checklist and compliance review against `develop` @ `7f0ebf653`)
- **Security**: Passed — no entity, endpoint or credential of its own; the provenance record stays free of personal data (§ 9)
- **Performance**: fixed — the `estimate` cache now has an owner (Spec 3) with tenant-scoped keys and tags, a TTL and invalidation (§ 7.1, § 12)
- **Cache**: fixed — same item; the compliance matrix routes the cache rules to Spec 3
- **Commands**: fixed — the lifecycle events move to the emitting module (`tax_gateways.transaction.*`, Spec 3); `sales.tax.input.changed` singular; the plural recalculate command ids recorded as a proposed deviation; the Resolve service for callers that are not `sales` commands is owned by Spec 1b, a Spec 1 follow-up (ADR-2, § 7, § 10; second review); the table provider's category and product-code matching depend on Spec 4a (ADR-6, RD-2); keep-net stated for every gross-entered line until Spec 5 (ADR-5)
- **Risks**: fixed — the stale-tax window starts at Phase 0, not at Spec 3 (§ 12); the Phase 2 gate no longer depends on an unscoped vendor package (§ 8); the tax-rate form location and its missing injection spot are named (ADR-6, § 15); "fixes" reworded as proposals; the ADRs without a separate question bind only through the Decision Record (§ 6); `product-rate` described with the gross-minus-net path (§ 2, ADR-5); citations corrected (`commands/returns.ts:156`, `2026-08-14-ecommerce-suite-roadmap.md:38`)
- **Verdict**: Needs maintainer decisions (§ Decision Requested); no open Critical/High/Medium findings

### Review — 2026-10-03 (second pass)
- **Reviewer**: Agent (fresh context, the `om-spec-writing` review mode; checklist and compliance review against `develop` @ `7f0ebf653`)
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed — the `estimate` cache stays routed to Spec 3
- **Commands**: fixed — the Resolve service for callers that are not `sales` commands moves to Spec 1b, a Spec 1 follow-up in Phase 1 (§ 7, § 7.1, § 8, § 10, § 15); the group-set service contract stays with Spec 4a (§ 7.1); ADR-2 fails closed on update as on create
- **Risks**: fixed — the § 15 rows for `data/validators.ts` and DI names match Spec 1; the integration-test compliance row routes Spec 1's flag-gated test provider; vendor names reduced to the docs' examples, the first providers being `product-rate` and the destination table provider (§ 3, § 4, § 7); the gross invariant, the request's customer facts, ADR-9's ordering claim, the fingerprint caveat and the "rejected" wording corrected (§ 6, § 8, § 9, Final Compliance Report)
- **Verdict**: Needs maintainer decisions (§ Decision Requested); no open findings

### 2026-10-03 — scope trim
- The vendor package question (former RD-2) and the vendor-package plan removed: adapters live outside the core modules per the root rule, and their location and timing are outside this roadmap; RD-3 … RD-6 renumbered to RD-2 … RD-5; the body states the design without narrating its reviews.

### Review — 2026-10-04 (third pass)
- **Reviewer**: two independent runs, the `om-spec-writing` review mode and the `om-pre-implement-spec` readiness audit, each executed by two different agents in fresh contexts
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: fixed — the fingerprint failure in § 3 fails closed like ADR-2; the charge definition matches Spec 1 (§ 9); the supersession of SPEC-024 §10.2 is conditional on DR-1 (§ 1.1)
- **Risks**: fixed — the Phase 4 gate keeps checkout's `409 price_changed` for any changed total (§ 8); the scope no longer lists vendor packages as deliverables (TLDR, README); ADR-11 states the `BuyerContext` rule it relies on; `tax_info` readership names the document history widget (§ 2); every bare line reference follows a file on its line; the plural command ids stay an open deviation (Final Compliance Report)
- **Verdict**: Needs maintainer decisions (§ Decision Requested); no open findings

### Review — 2026-10-04 (fourth pass)
- **Reviewer**: two independent `om-spec-writing` review runs in fresh contexts
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: fixed — the failure policy has two defined values, `fail` and `fallback-table`, and Spec 3 never writes `stale` (§ 3, ADR-8, § 12); ADR-2 and § 3 name where Apply runs and that the phase writes; checkout's `record` calculation runs when the sales document is created, before the gateway payment (ADR-3, § 7, § 12, RD-4)
- **Risks**: fixed — the gross-preserving split moves to Spec 4a with its own gate (ADR-5, § 7, § 7.1, § 8); Phase 4 closes only when all three owners have accepted (§ 8); Spec 1b's first consumer is the Simple Checkout totals path, not `packages/checkout` at head (§ 4, § 7); the Phase 2 gate uses a flag-gated test provider, not a package; the delivery order lists the Resolve service; the diagram shows adapters registering into `sales`; vendor capabilities are placed outside the roadmap, not in a package; the § 15 rows list every additive type; citations corrected (`packages/events/AGENTS.md:15`, the integrations guide's full path)
- **Verdict**: Needs maintainer decisions (§ Decision Requested); no open findings

### Review — 2026-10-04 (fifth pass, readiness dry runs)
- **Reviewer**: two independent `om-pre-implement-spec` dry runs of Spec 1 in fresh contexts
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: Passed — no roadmap change beyond the count of Spec 1's validator exports (§ 15)
- **Risks**: Passed
- **Verdict**: Needs maintainer decisions (§ Decision Requested); no open findings

### Review — 2026-10-04 (sixth pass, simplification)
- **Reviewer**: three simplification reviews in fresh contexts (two `om-spec-writing` review runs and one readiness audit), triaged by the author under the rule of preferring the simple, certain rule and stepping back from a decision that breeds patches
- **Security**: Passed
- **Performance**: Passed
- **Cache**: stepped back — the `estimate` cache is no longer prescribed; whether to cache is Spec 3's decision (§ 7.1, § 12)
- **Commands**: fixed — the ADR texts are shortened to their roadmap-level content and their routing lines move into the § 14 table (ADR-1 … ADR-4, ADR-7 … ADR-12); ADR-7 holds under Spec 1's DR-1 default; ADR-8 drops the impossible `product-rate` fallback; ADR-9's rationale states why 4a precedes 4b; the `TaxProvider` line and the status pointer follow Spec 1 (§ 3); Phase 4 sends 6c with Spec 5 and closes on acceptance or a recorded fallback, the spec step of Phase 0 ends with the Decision Records and the phase closes at its gate, and specification work follows the § 7 dependencies (§ 8, § 16); the ADR-2 retry wording matches Spec 1 § 4.2 and Spec 1's `tax_stub` registers under `OM_TEST_MODE` (§ 8)
- **Risks**: fixed — the risk register keeps the three roadmap-level risks as a table and points at Spec 1 and the child specs for the rest; § 12 names the refusal of stored `tax`-kind rows and rated discounts and the untaxed regenerated charges before Spec 4b; § 1.2, § 2, the § 5 rule, § 9's type paragraphs, § 11, § 15's Spec 1 column, the module inventory and the compliance report are reduced to pointers and to the rows that apply; the crud-form spot detail, the vendor refrains and the duplicate "no separate question" lines are gone; "cannot diverge" and the transaction wording are corrected (§ 2, § 12)
- **Verdict**: Needs maintainer decisions (§ Decision Requested); no open findings

### Review — 2026-10-04 (seventh pass, operator decisions)
- **Reviewer**: the author, mirroring the four simplification decisions applied to Spec 1 after the sixth pass (no new review)
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: stepped back — the Spec 1 tax events are notification-only, and a rewrite by a `sales.document.calculate.after` subscriber after the phase is a stated residual risk, not an `overridden` status (§ 3, § 12); no retry after a fingerprint mismatch (§ 3, ADR-2); `product-rate` names the default state, not a registered provider, so the first provider is the destination table provider (TLDR, § 3, § 4, § 5, ADR-5, § 7, § 9, RD-3; the README row says one built-in default and one built-in table provider); one transaction boundary for all twelve recalculating commands, the two header updates hoisted before the flush (§ 3, ADR-2, § 7, § 12)
- **Risks**: Passed
- **Verdict**: Needs maintainer decisions (§ Decision Requested); no open findings
