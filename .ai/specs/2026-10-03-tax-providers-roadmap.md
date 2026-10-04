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
- Two built-in strategies (`product-rate` as the pass-through default; `tax-destination-table-rate` as the working name of the table provider), one new module (`tax_gateways`, proposed); vendor adapter packages stay outside this roadmap, which exposes only the contract and the gateway seam.
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

### 1.2 What argues against this direction, and where each point is answered

| Counter-argument | Answered in |
|---|---|
| SPEC-024 places transaction tax in the planned financial module through country plugins (`SPEC-024-2026-02-11-financial-module.md:15`, `:2104`, `:2866`) | ADR-1; Spec 1 DR-1 |
| Names already taken by SPEC-024 and the parallel period-level work (`ITaxEngine`, `TaxCode`, `tax_management`, `taxEngineRegistry`) | § 9 naming rule; Spec 1 naming section |
| "The seam already exists": `setResult()` and a DI swap of `taxCalculationService` (`apps/docs/docs/user-guide/taxes.mdx:52`, `:77`; `apps/docs/docs/framework/pricing-tax-overrides.mdx:144`, `:157`) | § 2 point 2; ADR-3 |
| The cart and buyer context carry no address (`2026-08-14-cart-module.md:41`, `:106`; ecommerce suite roadmap ADR-7, `2026-08-14-ecommerce-suite-roadmap.md:253`) | ADR-3 consequence; RD-4 |
| SPEC-045 gives each category its own hub with "zero core module modifications" (`implemented/SPEC-045-2026-02-24-integration-marketplace.md:63`, `:68`, `:77-78`) | ADR-1 rationale; ADR-7 |
| An externally taxed amounts mode may be the preferred route for some deployments (`2026-09-07-sales-external-amounts-mode.md:3`) | ADR-4 consequence; § 11 |
| Country normalization and VAT-id validation are deferred by the address spec | ADR-5; § 7 related work |
| The customer-groups spec presumes rate matching by group that no code performs (`2026-08-14-customer-groups-and-b2b-terms.md:89`, `:386-388`) | ADR-6; Spec 2 row; § 11 |

---

## 2) Problem Statement

Paths are under `packages/core/src/modules/sales/` unless stated.

1. **Tax is a per-line, rate-only computation.** `buildBaseLineResult` (`lib/calculations.ts:118`) uses an explicit `taxAmount` when present, otherwise `round(net × taxRate / 100)` (`:164-167`), honours a supplied `totalGrossAmount` verbatim (`:168-171`) and, when tax was not explicit and the rate yields zero, derives it from gross minus net (`:177-180`). The calculation context is `{ tenantId, organizationId, currencyCode, metadata?, resolve? }` (`lib/types.ts:160-166`) and the two builders named `buildCalculationContext` set no address, customer, channel or date (`commands/documents.ts:2967`, `commands/returns.ts:156`). Destination tax, exemptions and reverse charge are not expressible.
2. **The documented seam is a unit converter.** `CalculateTaxInput` carries an amount, a mode, the tenant scope and a rate id or raw rate (`services/taxCalculationService.ts:8-15`); `resolveRate` finds a `SalesTaxRate` by id only (`:92`). The totals engine never calls it; the line upserts call it only to fill a missing price side. The docs send integrators here for external engines; the seam receives no document, no status and no commit or void.
3. **Stored tax is frozen and the recalculation triggers are narrow.** `mapPersistedLine` feeds stored `taxAmount` and `totalGrossAmount` back as explicit inputs with `totalsFromStoredRow: true` (`lib/lineSnapshots.ts:59-67`); both line upserts keep `parsed.taxAmount ?? existingSnapshot?.taxAmount` (`commands/documents.ts:7575`, `:8067`). Header updates recalculate only when the shipping method, the payment method or the currency changes (`shouldRecalculateTotals`, `:5522` quote, `:5797` order); document-address commands never write the header snapshots and never calculate (`commands/documentAddresses.ts`, zero references). A provider result would go stale silently after an address or customer change.
4. **Header fields exist but are unsafe.** `SalesOrder.tax_strategy_key` (`data/entities.ts:397`) and `tax_info` (`:403`), and `SalesQuote.tax_info` (`:896`), are free-form (`data/validators.ts:703`, `:705`, `:756`), client-writable on create, copied by conversion (`commands/documents.ts:6773` writes `taxStrategyKey: null`) and undo, and not consumed by tax calculation or provider selection (`taxInfo` is displayed through the document history widget, `widgets/injection/document-history/widget.client.tsx:108`). Reuse needs an output-only rule and a legacy-value rule.
5. **The rate table is designed for scoping that no code performs.** `SalesTaxRate` (`data/entities.ts:258`) carries `country_code`, `region_code`, `postal_code`, `city`, `customer_group_id`, `product_category_id`, `channel_id`, `priority`, `is_compound`, `starts_at`, `ends_at` (`:277-313`); the only rate resolver matches by id (`services/taxCalculationService.ts:92`); `catalog` reads the table directly by id (`packages/core/src/modules/catalog/commands/products.ts:361`, `packages/core/src/modules/catalog/commands/variants.ts:228`), which issue #6733 (cross-module data ownership audit) lists for remediation.
6. **Remote calls do not fit the transaction shape.** Header updates calculate inside `withAtomicFlush(..., { transaction: true })` (`commands/documents.ts:5610`, `:5873`); quote conversion runs under `LockMode.PESSIMISTIC_WRITE` (`:6673`), as does the public accept route (`api/quotes/accept/route.ts:99`); the returns path locks the order lines (`commands/returns.ts:604`, `:439`) and calculates in the same transaction (`:724`, `:538`). A provider must be called before the transaction and applied inside it.
7. **No status, no provenance, no place for charge tax.** The only core totals hook runs shipping and then payment inside one function (`lib/providers/totals.ts:183`, `:199`, `:282`) and starts by rebuilding the document from its `lines` argument (`:191-197`); payment fees are computed on `document.totals.grandTotalGrossAmount` (`lib/providers/defaultProviders.ts:128`, `:194`), so tax must be known before them, and there is no step between the two. The document tax total is the sum of line tax plus `tax`-kind adjustments plus the tax portion of adjustments that carry `metadata.taxRate` (`lib/calculations.ts:213-222`, `:256-259`). A document cannot say whether its tax is calculated, estimated, stale, exempt or failed, nor which strategy produced it; period-level and posting consumers (parallel work) need per-rate and per-jurisdiction amounts that nothing stores.

---

## 3) Proposed Solution (direction; every item is a proposal)

- **A `tax` phase** in the `sales` totals pipeline, shipping → tax → payment, as a fixed step inside the existing provider totals calculator (default) or, if the maintainers want an explicit phase API, a named phase option on the registry (ADR-1). After the phase, line tax plus charge tax equals the result's `taxTotalAmount`; `tax`-kind adjustments, `taxPortion` and explicit line `taxAmount` are never double-counted.
- **Resolve/Apply** (ADR-2). Resolve runs in the command layer before the transaction, on the future document state, and calls the provider; Apply runs inside the engine and writes the result into the line results and adjustments, then `rebuildDocumentResult` (`lib/calculations.ts:505`). The input fingerprint is compared before the write is flushed; one retry, then fail closed (409, nothing written); `stale` is reserved for Spec 4b.
- **Contract (proposed names):** `TaxProvider` `{ key, label, description?, settings?, calculate(request, ctx) }` mirroring `ShippingProvider`; `SalesTaxRequest` and `SalesTaxResult` as boundary types with intent `display | estimate | record` and the status vocabulary of § 9; registry `registerTaxProvider` / `getTaxProvider` / `listTaxProviders` (ADR-3, ADR-12).
- **Selection** (ADR-4): the provider is configured per organization in the existing sales settings (one additive nullable column); documents carry server-written provenance (`tax_strategy_key` = `tax-provider:<providerKey>`, `tax_info` = the provenance record); never per document.
- **Built-in strategies** (ADR-5, ADR-6): `product-rate` (pass-through; nothing changes without a configured provider) and the built-in table provider on the existing `SalesTaxRate` columns (working name `tax-destination-table-rate`; CSV import and export; `sourcing: destination` by default, `origin` as an option).
- **Tax gateway module** (ADR-7, ADR-8): `tax_gateways` (proposed): settings UI, credentials through `integrations` with an additive `tax` category, commit/adjust/void, failure policy `fail | fallback-table | block`, idempotency keys, admin-visible log.
- **Provider packages outside the core modules** for remote engines (the docs name Avalara and TaxJar only as examples; this roadmap plans no vendor adapter inside core): the first providers are the built-in `product-rate` and the destination table provider of Spec 2; nexus, address validation and VAT-id validation stay in a vendor package; where and when such packages are built is outside this roadmap, which only exposes the contract (Spec 1) and the gateway seam (Spec 3); inside this repository the root rule for external integration providers (`AGENTS.md:183`) applies to them.
- **Facts via owners** (ADR-10): customer facts, product tax facts and ship-from come from DI services owned by `customers` / `customer_groups`, `catalog` and `sales` (channel), resolved with a local `tryResolve`; no new cross-module ORM reads.
- **Inputs, recalculation and presentation** (ADR-9, ADR-11): owner-resolved facts, address sources, line detail columns and discount allocation (Spec 4a); wider recalculation triggers, `stale`, the recalculate command and the frozen-tax fix (Spec 4b); net/gross presentation kept apart from entry mode and from the request's inclusive flag (Spec 5).
- **Events (proposed, additive):** `sales.tax.document.calculate.before/after` (Spec 1), `sales.tax.input.changed` (Spec 4b); `tax_gateways.transaction.committed / voided / failed` declared in the gateway module's `events.ts` (Spec 3, the emitter); the existing `sales.tax.calculate.*` pair (`events.ts:90-91`) stays with the unit seam.
- **Commands:** Spec 1 adds no command. An explicit recalculation command (`sales.orders.recalculate_totals` / `sales.quotes.recalculate_totals`, free at `7f0ebf653`) belongs to Spec 4b; the ids follow the module's plural convention (`sales.orders.lines.upsert`, `sales.quotes.convert_to_order`), see the Final Compliance Report.

---

## 4) Module Inventory

| Module | Role | Must not own |
|---|---|---|
| `sales` (extended) | Tax phase, contract types, registry, organization-level selection, `product-rate`, table matching on `SalesTaxRate` (Spec 2), line detail columns (Spec 4a), triggers (Spec 4b), presentation-mode consumption (Spec 5), the Resolve service for non-command callers (Spec 1b) | Credentials, provider logs, vendor code, period liabilities |
| `catalog` (extended) | Product tax facts (`taxRateId` and `taxRate` on product and variant, `packages/core/src/modules/catalog/data/entities.ts:106`, `:109`, `:618`, `:621`; `taxClassificationCode`, `:177`; a proposed `provider_tax_code` with a variant override) through its own service | Tax arithmetic |
| `customers` / `customer_groups` (extended; the latter is specified on `develop` and has no module at this head; its implementation is parallel work) | Customer tax facts: tax ids (today only on address snapshots), exemption facts, group set | Rates, arithmetic |
| `tax_gateways` (new, proposed) | Settings UI, credentials via `integrations`, provider lifecycle (commit/adjust/void), failure policy, log | Arithmetic, rate matching |
| `integrations` (additive) | The `tax` category on `IntegrationCategory` (`packages/shared/src/modules/integrations/types.ts:20-27` has none today); credential storage and log services as `payment_gateways` uses them (`packages/core/src/modules/payment_gateways/lib/gateway-service.ts:80`, `:82`, `:199`) | Provider-specific logic (its own Ask First rule) |
| Provider packages (outside the core modules per the root rule `AGENTS.md:183`; their location and timing are outside this roadmap) | Vendor adapters for remote engines (the docs' examples: Avalara, TaxJar), nexus, address validation, VAT-id validation | Anything in the `sales` contract |
| Touchpoints: `@open-mercato/checkout` (`packages/checkout` at head); `cart`, `ecommerce` and POS (specified on `develop`, no module at this head) | Call the contract through `salesCalculationService` (ecommerce suite roadmap ADR-2), with the `context.tax` slot supplied by the Resolve service of Spec 1b (ADR-2) | Own tax arithmetic; their own Resolve |

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
               │ product-rate│        │ tax code)│      │ (tax ids, exemption, │
               └──────┬──────┘        └──────────┘      │  group set)          │
                      ▲                                 └──────────────────────┘
      registers       │ consumes types          ┌──────────────┐
      a TaxProvider   │                         │ integrations │  credentials, log
                      │                         └──────▲───────┘
               ┌──────┴────────┐    credentials        │
               │ tax_gateways  │───────────────────────┘
               │ (lifecycle,   │
               │  policy, log) │◄──── vendor provider packages (adapters)
               └───────────────┘

   tax_management / ledger / GL posting (parallel work) ──► read sales output; never read by sales
```

**Rules:**
- Touchpoints point to `sales`; `sales` consumes `catalog` and `customers` facts only through DI services resolved in `try/catch` (`packages/core/AGENTS.md:242-250`), never through ORM reads of their entities.
- `tax_gateways` consumes `sales` types and `integrations`, never the reverse; vendor packages register providers into `sales` and credentials into `integrations`; `integrations` never imports a provider (its own Never rule).
- Period-level tax, the ledger and GL posting read `sales` output and are never read by `sales`. Every edge is an FK id plus a DI-resolved service; optional peers degrade to `null` facts, never to a hard `requires` (`index.ts:12` requires `catalog`, `customers`, `dictionaries` only, and this roadmap adds nothing to that list).

---

## 6) Architecture Decisions (proposals; alternatives recorded)

Each ADR is a proposal with a recommended default; it binds the child specs only once a maintainer records it in § Decision Record. Where § 14 routes a question to a child spec, the ADR states the leaning and the child spec decides.

### ADR-1 — The tax phase is a step of the `sales` totals pipeline, inside the provider totals calculator
**Decision (proposed).** Transaction-level tax is computed by a tax phase of the `sales` totals pipeline, between the shipping block and the payment block of the existing provider totals calculator (`lib/providers/totals.ts:183`, `:199`, `:282`), with no public API change (Option B). The contract types and the registry are exported by `sales`.
**Rationale.** `sales` owns the arithmetic, `SalesTaxRate` and the single totals hook; payment fees are computed on the gross total (`lib/providers/defaultProviders.ts:128`, `:194`), so tax must precede them, and the hook rebuilds from its `lines` argument (`lib/providers/totals.ts:191-197`), so a separately registered hook cannot sit between the two blocks. The ecommerce suite roadmap's ADR-2 requires the cart to inherit tax from `salesCalculationService`. SPEC-045's hub rule ("hub defines adapter contract, spokes implement it", `implemented/SPEC-045-2026-02-24-integration-marketplace.md:63`; "zero core module modifications", `:68`) is kept for credentials and lifecycle (ADR-7); the calculation seam cannot run outside the totals calculation, which no hub can do from outside.
**Consequence.** Third-party totals hooks keep today's behaviour: a prepended hook's edits to totals are rebuilt away by the provider calculator today; an appended hook runs after tax and its charges stay untaxed, and Spec 1 adds that rule to the docs page that shows appended calculators adding fees (`apps/docs/docs/framework/modules/sales/calculations.mdx:39-45`), which does not mention tax today.
**Rejected alternatives.** Option A, an additive `{ id?, phase?: 'charges' | 'tax' | 'post-tax' }` option on `registerSalesTotalsCalculator` (`lib/calculations.ts:498`) with the provider calculator split into two registrations (the fallback if the maintainers want an explicit phase API now). Option C, no phase: the command layer resolves tax before `calculateDocumentTotals` and feeds it through explicit `taxAmount` and `metadata.taxRate` in a second pass (rejected: the provider calculator regenerates its adjustments on every run, so tax placed on them through metadata is lost; charges created by the shipping step cannot be taxed consistently; there is no seam for a status or a provenance record). A separate tax module (rejected: collides with the ecommerce roadmap's ADR-2 and needs a cross-module workflow layer that does not exist at head). The SPEC-024 §10.2 plugin hook (rejected: transaction-level tax needs the document, the addresses and the charges that only the `sales` pipeline has in hand; §10.2 is proposed as superseded for the transaction-level part only).
**Decision Requested:** yes — asked in Spec 1 as DR-1 (placement), DR-2 (Option B versus A) and DR-3 (where the contract types live; default core `sales`); not repeated here.

### ADR-2 — Resolve before the transaction, Apply inside the engine
**Decision (proposed).** The command layer runs a first calculation pass on the future document state, builds `SalesTaxRequest`, calls `provider.calculate` outside `withAtomicFlush` and `em.transactional`, then applies the result inside the write transaction after recomputing the input fingerprint; on a mismatch it rolls back, re-reads, resolves once more and applies in a second transaction; a second mismatch fails closed on a create and on an update alike (409, nothing written); `stale` is reserved for Spec 4b's trigger-based staleness. `product-rate` runs one pass and skips Resolve.
**Rationale.** The lock sites of § 2 point 6 must not hold rows during network I/O; the engine stays deterministic, which the ecommerce Phase 2 gate (cart totals byte-identical to the order) depends on.
**Consequence.** Header updates run Resolve before entering the flush and Apply inside it; return commands run no provider call in Spec 1 and keep today's behaviour (`commands/returns.ts:724`, `:538`); the explicit recalculate command that refreshes a `stale` document is Spec 4b. Callers that are not `sales` commands (the cart, checkout, POS) run Resolve through a `sales`-owned DI service (working name `salesTaxResolutionService`) that runs the Resolve step on a non-persisted document and returns the `context.tax` slot that `calculateDocumentTotals` applies; Spec 1b (a follow-up of Spec 1, Phase 1) specifies and registers it on top of Spec 1's request builder and phase, and until it exists those callers receive `product-rate` figures from the service.
**Rejected alternative.** The provider call inside `calculateDocumentTotals` (holds transactions and `PESSIMISTIC_WRITE` locks for a round trip; makes the engine non-deterministic).
**Decision Requested:** yes — the fail-closed policy for a create is an Ask First item asked in Spec 1 § 4.13; the Resolve/Apply split itself has no separate question and binds only through the sign-off recorded in § Decision Record.

### ADR-3 — A document-level contract with explicit status; the unit seam stays as the predecessor
**Decision (proposed).** `SalesTaxRequest` carries the document, the three addresses, customer facts, lines with their tax inputs, charges, tax date, currency, `pricesIncludeTax` and the intent; `SalesTaxResult` carries a status, per-line and per-charge results keyed by `ref`, jurisdictions, rounding, a provider reference and messages; the invariant `gross = net + tax` is enforced at the boundary. `taxCalculationService` and `sales.tax.calculate.before/after` stay unchanged and are documented as the predecessor for unit price entry; the docs gain a chapter on document-level providers with a table of what the unit seam cannot carry.
**Rationale.** A rates-only contract cannot carry provider amounts, flat fees or jurisdictions; the unit seam has no document, address, customer, status or lifecycle (`services/taxCalculationService.ts:8-15`).
**Consequence.** The intent is set by the caller, never derived from the document kind, because the cart calls the engine with a quote-like document (`2026-08-14-cart-module.md:106`): `estimate` for quotes and for a cart once a ship-to address is known, `record` for orders, `display` for cart and UI previews, never remote (Spec 1 § 4.7). For the touchpoints this means: the cart shows `display` figures without a ship-to (local math only: `product-rate`, or the table provider from the channel's origin; the request carries customer facts and the tax mode), checkout runs `estimate` with the address, `cart.lock()` recalculates with the address, the order's `record` calculation happens when checkout creates the order after payment, and `failed` blocks submit; POS taxes at the store location with gross prices (`SPEC-022-2026-02-07-pos-module.md:405`). Those are amendment proposals to the owners of the e-commerce specs (RD-4), not edits.
**Rejected alternative.** A Deprecation Protocol entry for `taxCalculationService` and `sales.tax.calculate.*` (listed in § Open Questions; a maintainer can ask for it in review).
**Decision Requested:** no separate question; binding only through the sign-off recorded in § Decision Record (open to objection in review).

### ADR-4 — The provider is selected per organization; documents carry server-written provenance
**Decision (proposed).** Provider selection is organization-level configuration, specified by Spec 1 and named here only to fix ownership: one additive nullable column `sales_settings.tax_provider_key` (`SalesSettings`, `data/entities.ts:755`; `NULL` means `product-rate`), written through a new route `GET`/`PUT /api/sales/settings/tax-provider` that runs the existing `sales.settings.save` (`commands/settings.ts:50`) extended with an optional field, behind the existing `sales.settings.manage` (`acl.ts:112`). Nothing on a document selects a provider: `tax_strategy_key` on orders records `tax-provider:<providerKey>` as provenance, `tax_info` records the provenance record; quotes record provenance in their existing `tax_info`; no quote column; client-supplied values stay accepted (schemas untouched) and are overwritten when a provider runs. The phase runs in the engine's normal calculation mode; a future mode that stores externally taxed amounts verbatim must skip the phase at the point where the shipping and payment provider steps would also be skipped, inside the provider totals calculator (no such guard exists at head).
**Rationale.** Per-document selection would make a free-text, client-writable field an authority and needs a quote column; a jsonb settings bag hides a typed setting; one nullable column is reversible.
**Consequence.** Per-channel or other scoped overrides of the setting are a later spec (channel scoping is an Ask First item of `packages/core/src/modules/sales/AGENTS.md:13`); the provenance prefix is a convention for server-written values, not a guarantee, and a record is trustworthy only with the server-computed fingerprint of the same write.
**Rejected alternatives.** Per-document selection through a namespaced `tax_strategy_key`; new provenance columns; a jsonb settings bag; two design variants for the externally taxed amounts mode (one with, one without the open implementation).
**Decision Requested:** no separate question; binding only through the sign-off recorded in § Decision Record.

### ADR-5 — `product-rate` is a pass-through; OSS destination rates and reverse charge come later
**Decision (proposed).** `product-rate` reproduces today's line tax (§ 2 point 1) and overwrites nothing, so documented hooks such as the gift line that zeroes `taxAmount` keep working and totals stay byte-identical. OSS destination rates and EU reverse charge are not part of v1: the request carries ship-to country and tax ids so a later resolver over the unused `country_code` / `region_code` columns can add them; the proposed cross-border default is `keep-net`: when a destination rate differs from the product's rate, the net price is kept and the gross changes; `keep-gross` keeps the gross price and lets the net change. Under any configured provider every gross-entered line keeps its net and its gross changes (Spec 1 § 4.10) until the gross-preserving split lands in Spec 5 together with Spec 4a's line columns.
**Rationale.** The first PR must not change amounts for any existing tenant; the address spec defers country normalization and VAT-id validation, on which both features depend.
**Consequence.** Spec 2 may add an EU resolver later without touching the contract.
**Rejected alternative.** A built-in EU destination resolver in v1; a `product-rate` that recomputes tax from the rate id on every pass (overwrites explicit `taxAmount`).
**Decision Requested:** yes — RD-3.

### ADR-6 — The built-in table provider runs on the existing `SalesTaxRate` columns
**Decision (proposed).** The table provider (working name `tax-destination-table-rate`; the final name is chosen in Spec 2) matches `SalesTaxRate` rows on the existing columns (`data/entities.ts:258-323`): country, region, postal code or range, city, channel, priority, compound and validity dates, and customer groups as a set; the existing `product_category_id` column (`:292`) can match only once Spec 4a puts the product facts on the line, and a product-code key needs a new column that Spec 2 names, so category and code matching depend on Spec 4a; with CSV import and export and `sourcing: destination` by default, `origin` (ship-from = channel address) as an option. Group matching takes a set of group ids from an owner-provided DI service when one is registered and otherwise matches rows with `customer_group_id = null` only; orphaned ids are reported, not ignored (ecommerce roadmap risk R3).
**Rationale.** The schema was designed and documented for this (`README.md:11`); only the logic is missing. Destination sourcing is the only sourcing that works for remote and cross-border sales and reuses the ship-to the contract carries.
**Consequence.** The provider is deterministic and needs no remote call, so it can ship before Spec 4b; it recomputes on every recalculating write, but a ship-to change alone does not recalculate until Spec 4b widens the triggers (§ 2 point 3), so a table-provider document can hold stale tax after an address change exactly like a remote one; the Phase 1 gate states that limitation. Destination facts come from the header snapshot. The admin UI extends the existing tax-rate CRUD (`api/tax-rates/route.ts`, `makeCrudRoute`, every method behind `sales.settings.manage`) and its form, the `CrudForm` dialog in `components/TaxRatesSettings.tsx:370` rendered on `/backend/config/sales` (`backend/config/sales/page.tsx:37`); that form declares no `entityId` and no `injectionSpotId`, so it publishes no `crud-form:<entityId>:fields` spot at this head (`packages/ui/src/backend/CrudForm.tsx:910-917`; issue #6414, sales: tax-rate CrudForm `entityId`), and Spec 2 decides whether to add one (additive, `BACKWARD_COMPATIBILITY.md:170`).
**Rejected alternatives.** A new rate table (duplicates `SalesTaxRate`); origin sourcing only; an external provider only; a mock provider as the contract proof (the table provider is the proof).
**Decision Requested:** yes — RD-2.

### ADR-7 — A separate `tax_gateways` module; credentials through `integrations`; vendor packages outside the core modules
**Decision (proposed).** A new core module `tax_gateways` (name proposed; table prefix `tax_gateway_`) shaped like `payment_gateways` and `shipping_carriers` (`implemented/SPEC-045-2026-02-24-integration-marketplace.md:77-78`) holds the settings UI, the provider lifecycle, the failure policy and the admin-visible log; credentials live in `integrations` under an additive `tax` member of `IntegrationCategory` (a `packages/shared` change; "registry type contracts" are an Ask First item of `integrations/AGENTS.md`); sensitive fields are declared through the module's `encryption.ts` maps. Vendor adapters are packages outside the core modules (the root rule `AGENTS.md:183` inside this repository); where and when any of them is built is outside this roadmap.
**Rationale.** The contract and the registry must stay in `sales` (ADR-1), but lifecycle, credentials and logs are the hub's job per SPEC-045; `payment_gateways` already consumes `integrationCredentialsService` and `integrationLogService` (`packages/core/src/modules/payment_gateways/lib/gateway-service.ts:80`, `:82`, `:199`).
**Consequence.** `tax_gateways` consumes `sales` types and `integrations`; vendor packages register a `TaxProvider` into `sales` and credentials into `integrations`; providers resolve credentials through the typed `resolve` of the provider context, which Spec 3 wires (`SalesCalculationContext.resolve` is declared, `lib/types.ts:165`, and never populated).
**Rejected alternatives.** Everything in `sales` (too much for one module); everything in vendor packages (no shared lifecycle or log); an own credential store.
**Decision Requested:** yes — RD-1 (module and category).

### ADR-8 — Commit, adjust and void run through durable subscribers with idempotency and a failure policy
**Decision (proposed).** `commit`, `adjust` and `void` are optional provider methods typed by Spec 3 and triggered from durable subscribers of `sales` events with an idempotency key per call; the commit point is configurable per provider and organization (leaning: `invoice` default, `payment` and `order_confirmed` as options; § Open Questions 4); one failure policy per provider (`fail | fallback-table | block`; `fallback-table` falls back to the table provider of Spec 2, or to `product-rate` when none is installed), a fallback result recorded with status `fallback`; a provider disabled mid-quote sets `stale` and falls back per policy; invoices and credit memos keep caller-supplied amounts in v1 (`sales.invoices.create` and `sales.credit_memos.create` never call the engine).
**Rationale.** A remote call must not sit inside a document command; subscribers are the sanctioned side-effect mechanism (`packages/events/AGENTS.md`).
**Consequence.** Changing the invoice amounts source touches the Quote → Order → Invoice flow, an Ask First item.
**Rejected alternatives.** Commit fixed at invoice; invoice tax derived pro rata from the order in v1; silent zero on failure.
**Decision Requested:** routed to Spec 3 — § Open Questions 4 and 5.

### ADR-9 — Inputs and recalculation are two specs after the contract: 4a carries the facts, 4b the triggers
**Decision (proposed).** Spec 4a (tax inputs) gives the request the facts it lacks today: product tax code, customer tax ids, exemption facts and the group set through owner services (ADR-10); ship-to from the header snapshot only as the leaning (§ Open Questions 6; `SalesDocumentAddress` rows, `data/entities.ts:1855`, do not feed tax until a reconciliation rule exists) and ship-from from a `sales`-owned resolver (channel address, `data/entities.ts:16`, `:50`; then a settings default; `wms` may override later); line detail columns (proposed names `price_entry_mode`, `tax_rate_id`, `provider_tax_code`, `tax_details`, `tax_manual_override`; Spec 4a governs the names, § Open Questions 7) on order, quote, invoice and credit-memo lines; document discounts allocated to lines before the tax phase. Spec 4b (tax recalculation) widens recalculation to address, customer, channel, `placedAt` and `exchangeRate` changes and to the next write after the organization's provider setting changes; sets `stale` on rate, product-code or customer edits, elapsed time and undo; adds the explicit recalculate command; fixes the frozen-tax carry-over in the two line upsert paths at head behind `tax_manual_override`, with the `price_entry_mode` backfill; reverses tax on returns; changes the line dialog to send only the entered price, its mode and the rate id.
**Rationale.** Each half works without the other: richer requests under today's triggers (4a alone) and safer triggers over today's inputs (4b alone); one combined document would span three modules, four line tables, a backfill and a behaviour change for every tenant, which would be too large for one review. A remote provider whose result survives an address change is unsafe in production, so 4b closes Phase 2; the frozen-tax fix changes stored amounts and needs an `UPGRADE_NOTES.md` entry in the "heals on next write" style with a flag that protects explicit `taxAmount`.
**Consequence.** Until Spec 4b lands, provider documents can hold stale tax after an address change; Phase 2 does not close before it; the per-line and per-jurisdiction breakdown lives in the header `tax_info` record until Spec 4a's columns exist. 4a precedes 4b (proposed order; the inverse works for the triggers only, because they read fields that exist today, while the carry-over fix and the `price_entry_mode` backfill need Spec 4a's columns).
**Rejected alternatives.** One combined inputs-and-recalculation spec; estimate on every line save (cost and races); header-only results forever (posting and period tax need per-line data); fixing the carry-over in Spec 1 (breaks "nothing changes without a provider").
**Decision Requested:** routed to Spec 4a (§ Open Questions 2, 3, 6, 7) and Spec 4b (§ Open Questions 3, 8).

### ADR-10 — Facts come from their owners through soft-resolved DI services
**Decision (proposed).** Product tax facts, customer tax facts and exemption facts enter the request through DI services owned by `catalog`, `customers` or `customer_groups`, resolved with a local `tryResolve`; when no service is registered the fields are `null` and the request still validates; Spec 1 fills only what is already on the document (line snapshot, address snapshots).
**Rationale.** Issue #6733 (cross-module data ownership audit) lists `catalog` reading `SalesTaxRate` and `sales` reading `customers` entities for remediation; `packages/core/AGENTS.md:250` names the optional consumer as the owner of the glue.
**Consequence.** This ADR proposes the mechanism, not the owner: the owner of exemption facts (`customers`, `customer_groups` or the gateway module) is chosen in Spec 4a (§ 14 Q2). Service names are chosen in Spec 4a with the owners; `taxClassificationCode` has no reader in `sales` at head and stays unpopulated until an owner-provided read contract exists.
**Rejected alternative.** New ORM reads in `sales`.
**Decision Requested:** no separate question; binding only through the sign-off recorded in § Decision Record.

### ADR-11 — Three net/gross concepts are kept apart; presentation derives from the group's price kind
**Decision (proposed).** Entry mode (per line, `metadata.priceMode` today), the request's inclusive flag (`pricesIncludeTax`: `true`, `false` or `'mixed'`) and presentation mode (`tax_mode`, `gross | net`, the name the cart spec already uses, `2026-08-14-cart-module.md:145`, `:444`) are three different things. Presentation derives from the `displayMode` of the price kind the customer group points to (customer-groups spec §6.1a, `2026-08-14-customer-groups-and-b2b-terms.md:326`; `CatalogPriceKind.displayMode`, `packages/core/src/modules/catalog/data/entities.ts:754`), then from the selling country or channel, then from the document's price kind; the line dialog's change to send only the entered price, its mode and the rate id (the server derives the other side) ships with Spec 4b, because it is an entry-mode fix, not presentation.
**Rationale.** A global net/gross switch is the known failure class; the customer-groups spec says the price kind is the only source of display mode for a group, while the cart spec says `resolveTerms()` returns a tax mode (`2026-08-14-cart-module.md:80`), an inconsistency the owners must settle.
**Consequence.** Spec 5 proposes a named presentation component for the cache, projection and index keys whose output depends on the mode, within the ecommerce roadmap's rule that every such key is built from named `BuyerContext` scope components (`2026-08-14-ecommerce-suite-roadmap.md:287-295`; ADR-7, `:253`, `:267`); amending `BuyerContext` needs the e-commerce owners' acceptance (RD-4).
**Rejected alternative.** Variant (b): explicit overrides group → country → price kind, only with the owner's agreement.
**Decision Requested:** yes — RD-5 (variant); where the selling country lives is routed to Spec 5 (§ Open Questions 9).

### ADR-12 — The new tax registry is `globalThis`-backed; the existing registries stay as they are
**Decision (proposed).** The tax provider registry stores its state on `globalThis` under a stable key with lazy initialization, replace-on-re-register by key and an unregister function, following the catalog pricing resolver registry (`packages/core/src/modules/catalog/lib/pricing.ts:193`, `:215`) and the repository lesson (`.ai/lessons/global-registries-in-publishable-packages-must-use.md:14`); the shipping and payment registries (`lib/providers/registry.ts:6-7`, module-local `Map`s) are untouched, and moving all three together is offered as a follow-up.
**Rationale.** The pricing engine spec calls module-local registry state a latent bug under duplicated module instances (`2026-08-21-pricing-engine.md:20`, `:33`).
**Consequence.** Registration from a vendor package survives a second module instance; the registry keeps the sibling registries' overwrite-on-same-key semantics and differs in storage, in protecting `product-rate`, and in an identity-checked disposer keyed by the normalized key (Spec 1 § 4.17; today's disposers delete the untrimmed `provider.key`, `lib/providers/registry.ts:17`, `:27`).
**Rejected alternatives.** A module-local `Map` for symmetry, with the duplicated-instance limitation stated; moving all three registries in the same change.
**Decision Requested:** yes — asked in Spec 1 as DR-4; not repeated here.

---

## 7) Spec Breakdown

| # | Spec (proposed file name) | Status | Module(s) | Depends on | Content |
|---|---|---|---|---|---|
| 1 | `2026-10-03-sales-tax-provider-contract.md` | written in this PR | `sales` | — | Tax phase (fixed step inside the provider calculator by default; named phase option as the fallback), `TaxProvider` and registry, `SalesTaxRequest` / `SalesTaxResult`, organization-level provider setting (one nullable column on `sales_settings`), `product-rate`, Resolve/Apply, statuses, `tax_info` as the provenance record, one new settings route. No document or line table change; no new command. |
| 1b | `{date}-sales-tax-resolution-service.md` (working file name) | to write | `sales` | 1 | The `sales`-owned DI service (working name `salesTaxResolutionService`) that runs the Resolve step on a non-persisted document and returns the `context.tax` slot that `calculateDocumentTotals` applies, for callers that are not `sales` commands (checkout today; cart and POS when their modules exist); no command, no table. |
| 2 | `{date}-sales-tax-destination-table-rate-provider.md` (working file name) | to write | `sales` | 1; 4a for category and product-code matching | Matching on the existing columns (category and code only after Spec 4a; a product-code key needs a new column); CSV import and export; admin UI on the existing tax-rate CRUD; `sourcing: destination` default with `origin` option; group-set matching on `customer_group_id` with a soft-resolved group service; orphan reporting. |
| 3 | `{date}-tax-gateways-module.md` | to write | `tax_gateways` (new), `integrations` | 1; 2 for the `fallback-table` policy value | Credentials via the `tax` category, settings UI, commit/adjust/void, commit timing, failure policy, idempotency, log: what a remote-engine provider needs in production. |
| 4a | `{date}-sales-tax-inputs.md` (working file name) | to write | `sales`, `catalog`, `customers` | 1 | Owner fact services resolved with `tryResolve` (product tax code, customer tax ids and exemption facts, group set), address sources (ship-to from the header snapshot, a ship-from resolver), line detail columns, document-discount allocation to lines before the tax phase. |
| 4b | `{date}-sales-tax-recalculation.md` (working file name) | to write | `sales` | 1 (4a for the line detail it persists) | Recalculation triggers, `stale`, the explicit recalculate command, the frozen-tax carry-over fix with `tax_manual_override` and the `price_entry_mode` backfill, return reversal, the line dialog sending only the entered side. |
| 5 | `{date}-sales-tax-presentation-mode.md` | to write | `sales`, `customer_groups`, `ecommerce` | 1, 4a, 4b; the `customer_groups` and `ecommerce` implementations (parallel work, not at head) | Three concepts kept apart, the selling country or channel, group interplay per §6.1a, the presentation mode as a cache-key component; the gross-preserving split for gross-entered and POS lines (ADR-5). Co-owned with the customer-groups spec owners. |
| 6a | Amendment proposal to the e-commerce owners: ecommerce suite roadmap ADR-2 and ADR-7; `2026-08-14-cart-module.md` §5.2 and `tax_mode`; `2026-03-19-checkout-simple-checkout.md` lock and re-price | amendment proposal, not an edit | `cart`, `@open-mercato/checkout`, `ecommerce` | 1, 1b (the Resolve service) | Cart `display` without ship-to (never remote); checkout runs `estimate` with the address; `cart.lock()` recalculates with it; the order's `record` calculation after payment; `failed` blocks submit. |
| 6b | Amendment proposal to the POS owners: SPEC-022 place of taxation | amendment proposal, not an edit | POS | 1, 1b (the Resolve service) | The store location is the place of taxation; prices are gross; `display` must be cheap; final tax before payment. |
| 6c | Amendment proposal to the customer-groups owners: §6.1a and the cart spec's `resolveTerms()` sentence | amendment proposal, not an edit | `customer_groups` | 1, 5 | One source of presentation mode (RD-5); the `2026-08-14-cart-module.md:80` versus §6.1a inconsistency settled by the owner. |
| — | Related, not scoped (mention only) | — | — | — | A separate stream for country-ready presets built on top of this roadmap; vendor adapter packages for remote engines (outside this roadmap); OSS destination rates and EU reverse charge; VAT-id validation; address validation; nexus. |

### 7.1 What each spec must contain beyond the standard checklist

| Spec | Non-obvious required content |
|---|---|
| 1 — Contract | The byte-identical proof for `product-rate` over every existing engine fixture; the lock sites where Resolve may not run; the fingerprint contents; the overwrite rule for client-supplied `taxInfo` / `taxStrategyKey`; the four Decision Requested items with defaults and fallbacks; the Ask First paragraphs (tax-kind adjustments under a provider, conversion keeping today's copy semantics, fail-closed policy) |
| 1b — Resolve service | The DI name and the input shape (a non-persisted document: lines, adjustments, header facts) of the Resolve service; the deadline and the failure policy it inherits from Spec 1; no persistence; the byte-identical rule under `product-rate` |
| 2 — Table provider | Exact match semantics for postal code ranges, priority, compound and validity dates; consumption of the group-set service whose contract and DI name Spec 4a fixes with the owners (until it is registered: `customer_group_id = null` rows only, ADR-6); orphan reporting; CSV row results and the worker threshold (an import above it runs as a queue worker with a `ProgressJob` and writes through the `sales.tax-rates.*` commands, `packages/core/AGENTS.md:310-314`); which `SalesTaxRate` columns gain semantics without changing the entity's meaning (applied by analogy with the configuration-entity Ask First rule of `packages/core/src/modules/sales/AGENTS.md:14`, which does not list tax rates) |
| 3 — Gateway module | Credential fields with `secret` types; the `tax` category addition in `packages/shared`; the commit timing and the invoice question; idempotency keys; log retention and access (requests carry addresses and customer ids); the failure policy UI; env preconfiguration inside the provider package (`packages/core/src/modules/integrations/AGENTS.md:13`); the `estimate` cache through the DI `cache` service (key = tenant + organization + fingerprint; tags `tenant:<id>` and `org:<id>`; a TTL; invalidated on a provider-setting or tax-rate change) |
| 4a — Inputs | The DI service names chosen together with the `catalog` and `customers` owners and the module-absent behaviour; the address-source rule; the migration for the line detail columns; the discount allocation rule and its rounding |
| 4b — Recalculation | The trigger matrix per command; the `UPGRADE_NOTES.md` text for the frozen-tax fix; the `price_entry_mode` backfill with a `legacy` state; return reversal; honour-versus-re-quote on conversion; the line dialog change |
| 5 — Presentation | Resolution order of the three sources; the cache-key component; where the selling country lives; the gross-preserving split for gross-entered and POS lines |
| 6a, 6b, 6c — Amendments | One proposal per owner, each quoting the sentence it changes and the gate it must keep (ecommerce Phase 2: cart totals byte-identical to the order) |

---

## 8) Phasing

Each phase is gated; the next does not start until the gate passes. Delivery order: contract → table provider → gateway module → inputs → recalculation → presentation → touchpoints.

### Phase 0 — Spec 1 (contract)
**Gate:** without a configured provider, totals for every existing test are byte-identical; a test provider sets line tax, charge tax and the tax total on create and update of a quote and an order; `tax_info` carries status and fingerprint; `taxCalculationService` and `sales.tax.calculate.*` are unchanged; the phase runs only in the engine's normal calculation mode, with the one guard point named; the provider assertions run end to end under Spec 1's flag-gated test-only `tax_stub` provider (the pattern of the built-in payment providers and the push stub adapter) as well as at command level.

### Phase 1 — Spec 2 (table provider) and Spec 1b (Resolve service)
**Gate:** a destination rate table imported from CSV yields per-jurisdiction tax for a quote and an order without any external account; `product-rate` documents are unchanged; orphaned `customer_group_id` rows are reported, not ignored; the limitation that a ship-to change alone does not re-tax a document before Spec 4b is stated in the spec and shown in the admin UI; the Resolve service returns, for a non-persisted document, the tax figures the create command persists for the same inputs (byte-identical under `product-rate`).

### Phase 2 — Spec 3 (gateway module), then Spec 4a (inputs) and Spec 4b (recalculation), one combined gate
Spec 3 lands first (proposed order; the alternative is Spec 4b first), Spec 4a and then Spec 4b follow in the same phase, and the phase does not close before Spec 4b, because a provider result that survives an address change is unsafe in production. The three are written separately; one combined inputs-and-recalculation document would be too large for one review (ADR-9).
**Gate:** changing ship-to, customer, exemption facts, date or currency re-taxes and persists line tax; returns reduce tax; a test provider package delivered with Spec 3's integration tests runs estimate on the quote → record on order creation → commit on invoice → void on cancel on a test tenant with log entries and an idempotent retry; the failure policy is visible in admin; the line dialog no longer sends a browser-computed gross.

### Phase 3 — Spec 5 (presentation)
**Gate:** a B2B and a B2C buyer see the correct presentation of the same document without a second source of truth.

### Phase 4 — Spec 6 accepted by the owners
Proposals can be sent from Phase 1 on, one per owner (6a, 6b, 6c); each owner's acceptance is tracked separately in the Changelog, and the e-commerce owners' acceptance gates this phase.
**Gate:** the ecommerce Phase 2 gate (cart totals byte-identical to the resulting order) still passes under a configured provider; checkout keeps aborting with `409 price_changed` whenever any total changes (`2026-03-19-checkout-simple-checkout.md:307`, `:332-333`), and unchanged tax inputs introduce no spurious difference.

---

## 9) Data Models

This umbrella defines no entity. It proposes the owners and the names of the boundary types; the field lists below are indicative and Spec 1's text governs the exact shapes.

- **`SalesTaxRequest`** (owner `sales`): strategy key, intent (`display | estimate | record`), document kind and id, tenant and organization, channel, currency and exchange rate, tax date, `pricesIncludeTax` (`true | false | 'mixed'`, derived from per-line `priceMode`), ship-to / ship-from / bill-to as typed addresses, customer facts (id, tax ids with type, group ids; exemption facts are the Spec 4a addition to the type), lines (`ref`, kind, product and variant ids, quantity, post-discount net, `taxRateId`, `taxRate`, product tax code, `priceMode`), charges (`ref`, kind, net, tax code), `inputsFingerprint`. A charge is an order-scope adjustment of kind `shipping`, `surcharge`, `custom` or an operator-defined kind with a non-negative net; a negative one is a credit and stays out of the request (Spec 1 § 4).
- **`SalesTaxResult`** (owner `sales`): status (`calculated | estimated | exempt | not_applicable | stale | failed | fallback | overridden`), provider key and reference, document `taxTotalAmount`, per-line and per-charge results keyed by `ref` (taxable amount, tax, effective rate, `isExempt`, `exemptReason`, `isReverseCharge`, jurisdictions), jurisdiction list (level, code, name, rate, taxable amount, tax), rounding `{ level, decimals }`, messages, `inputsFingerprint`. The exemption vocabulary follows SPEC-024 (`SPEC-024-2026-02-11-financial-module.md:765-767`). Invariant: the phase writes `gross = net + tax` per line and per charge; the engine tolerance (`lib/calculations.ts:33`) governs the taxable base and the document `taxTotalAmount` (Spec 1 § 4.10).
- **`TaxProvider`** (owner `sales`): `{ key, label, description?, settings?: ProviderSettingsDefinition, calculate(request, ctx) }` mirroring `ShippingProvider`; `commit?`, `adjust?`, `void?` reserved and typed by Spec 3; a provider-declared list of input sensitivities is a Spec 4b addition.
- **Provenance record** (the content of `tax_info`, owner `sales`): version, provider key, intent, status, fingerprint, provider reference, calculated-at, rounding, jurisdictions, per-line and per-charge results keyed by `ref`, messages; never addresses or tax ids; its `inputsFingerprint` is an unkeyed SHA-256 over inputs that include the addresses and tax ids, and Spec 1 § 4.15 records the guess-testing caveat and the keyed-hash alternative. The jurisdiction list names tax jurisdictions (the code and name of a state, county, city or district), not a person: it says where tax is due, carries no street, name or identifier, and the same codes apply to every buyer in that area, so `tax_info` stays outside the sales encryption map (`encryption.ts` encrypts the address snapshots, `encryption.ts:8-9`, `:25-26`); Spec 1 states that reasoning and records the alternative (adding `tax_info` to the map) for a maintainer who reads the codes as personal data.

| Concept | Owning module | Table prefix |
|---|---|---|
| Tax phase, contract, registry, provider setting, provenance, `product-rate`, table matching, line detail columns | `sales` | `sales_` |
| Gateway settings, lifecycle state, failure policy, provider log entries | `tax_gateways` (proposed) | `tax_gateway_` (proposed) |
| Credentials, integration log | `integrations` | existing tables |
| Product tax code and its variant override | `catalog` | `catalog_` |
| Customer tax ids, exemption facts, group set | `customers` / `customer_groups` (proposed; the owner of exemption facts is chosen in Spec 4a, § 14 Q2) | their own prefixes |
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

States read on 2026-10-03 with read-only tracker queries; `develop` was still `7f0ebf653`. None of these is a base or a dependency; each is coordinated, not assumed. File overlap: #6092, #6184, #6255, #6146 and #5192 touch the files Spec 1, 4a and 4b change, and #6092 and #5192 regenerate the sales migration snapshot; one implementation PR per phase rebases on whichever lands first, and the Spec 1 settings column has no textual overlap with any of their hunks (`SalesSettings` is untouched by all of them).

| Ref | Relationship |
|---|---|
| #6092 feat(sales): the opt-in external amounts mode for mirrored orders (open; base `develop`; not on `develop`) | Edits the same engine files (`lib/calculations.ts`, `lib/providers/totals.ts`, `commands/documents.ts`, entities, validators, migration snapshot). Spec 1 names one guard point (ADR-4) and nothing else; question to the author: where the one guard for externally taxed documents should live so that the tax phase and the provider calculator share it, and which change rebases on the other. |
| `2026-09-07-sales-external-amounts-mode.md` (on `develop`, `proposed — decision requested`, `2026-09-07-sales-external-amounts-mode.md:3`) | Precedent for the status line and the `## Decision Requested` / `## Decision Record` shape (`:1041`, `:1063`); defines `totalsMode`, which does not exist in code at head. |
| #6184 perf(sales): write a whole order line set in one aggregate load (open; base `main`) | Rewrites the single line upsert and adds a bulk path. Spec 4b covers the two upsert paths at head (`commands/documents.ts:7575`, `:8067`); coordinate with the author about the stored-tax rule in the bulk path and the merge order with #6146. |
| #6146 fix(sales): lineNumber as a target position on line upsert (open); #6255 fix(sales): refresh the query index after customFields update (open); #6833 fix(sales): stale undo (merged at this head) | Textual conflicts in the same functions as Spec 4b; undo paths changed in #6833, so undo behaviour is cited from this head only. |
| Issues #6461 (sales: line editor resets an API-created line's tax rate; fix #6815 open), #6075 (sales: quote line dialog sole variant and zero price; fix #6637 open), #5853 (sales: caller-supplied `totalGrossAmount` reconciliation), #6459 (sales: quantity change leaves gross stale) | Defects on the Spec 4b path and in the line dialog that the contract must not repeat; `product-rate` reproduces today's results including these until Spec 4b. |
| Issue #6733 Fix: cross-module data ownership violations (open; priority-high); issue #2121 CRM/Sales/Catalog audit item K-04 | `catalog` reads `SalesTaxRate` (D01) and `sales` reads `customers` and `catalog` entities (D02); ADR-10 adds no new read; question to the author: whether an owner-provided read contract for product tax codes and exemption facts is planned. |
| #6168 docs(tax-management): core framework `tax_management` + `financial_pl` (open; base `main`); official-modules #55 (`financial_pl`, open); SPEC-024 §10.2 (on `develop`, epic) | Period liabilities, `TaxCode` without rate or jurisdiction, `taxEngineRegistry`; names reserved here; its text calls transaction-level tax the territory of `sales`, SPEC-024 §10.2 places it behind a plugin; the roadmap cites both and asks which holds (Spec 1 DR-1). |
| #6046 docs(specs): sales invoice GL posting (open); #6340 feat(ledger): general ledger core engine (open) | GL posting sums line `taxAmount` only, so charge tax must be visible to it; the ledger is a later consumer; question in § Open Questions 10. |
| #5384 docs(specs): ecommerce module suite (merged 2026-09-17): ecommerce suite roadmap ADR-2 and ADR-7, `2026-08-14-cart-module.md`, `2026-03-19-checkout-simple-checkout.md`; #6346 docs(specs): assisted selling and the cart proposal seam (open) | Spec 6 targets; that roadmap has an active owner and is changing: propose, never edit. The assisted-selling proposal cart copies the target's `tax_mode`; tax must use the target buyer's facts. |
| #6709 feat: ecomm Release 2 — availability contract + customer groups (open; no file under `sales/`); issue #6414 (sales: tax-rate CrudForm `entityId`) | Introduces `customer_groups`, which has no module at head; Spec 2 designs on the `customer_group_id` column at head and on the §6.1a text on `develop`; question to the author: whether the column keeps its meaning and who adds the group picker to the tax-rate form. |
| #6268 feat(catalog): pricing engine admin UI + resolver hardening (merged); #5771 feat(customers,sales): tax id on addresses (merged; the address spec's later phases pending); #5192 feat(catalog): Omnibus price tracking (open; shares `sales/data/entities.ts` and the migration snapshot) | `globalThis` registry pattern (ADR-12); `taxId` / `taxIdType` as optional request input; whichever of #5192, #6092 and the Spec 1 column lands last regenerates the sales migration snapshot. |

---

## 12) Risks & Impact Review

**Data integrity.** Every provider write is applied inside the same transaction as the document write (ADR-2); a failed consistency check writes nothing. **Cascading effects.** The engine stays deterministic, so cart, back office and POS cannot diverge; subscribers of `sales.document.calculate.after` can still rewrite totals and are detected as `overridden`. **Tenant isolation.** The setting, the rate rows and the provenance are organization-scoped; the registry holds code, never tenant data; credentials stay in `integrations`. **Migration.** Spec 1 adds one nullable column with a reversible migration; Spec 4a's line detail columns are additive and Spec 4b's `price_entry_mode` backfill must be sized by that specification. **Operations.** Provider calls are bounded by a timeout and a per-provider failure policy; the log is the operator's detection path; a provider package resolves credentials only through the typed `resolve` of the provider context, which Spec 3 wires (never a process global). **Capacity and consumers.** Phases 0–2 are the minimum useful set and Phases 3–4 can slip without invalidating the contract; period-level and posting consumers read the interim breakdown in `tax_info` until Spec 4a's line detail exists; every child spec lists its i18n keys for the five locales.

### Risk Register

#### Double taxation through `tax`-kind adjustments, `taxPortion` or explicit line `taxAmount`
- **Scenario**: a provider writes line tax while a `tax`-kind adjustment or a `metadata.taxRate` on a charge is still folded into the total (`lib/calculations.ts:256-259`); the document shows tax twice.
- **Severity**: High
- **Affected area**: `sales` totals, invoices copied from orders
- **Mitigation**: the consistency rule after the phase; `tax`-kind adjustments rejected on write under a configured provider (Spec 1 Ask First paragraph); charges carry provider tax through `metadata.taxRate` only when the provider taxed them.
- **Residual risk**: a subscriber of `sales.document.calculate.after` can still add tax; marked `overridden`, not prevented.

#### A provider call inside a transaction or under a row lock
- **Scenario**: a provider is called from a header update, a conversion or a return while rows are locked (§ 2 point 6); a slow provider holds locks for seconds.
- **Severity**: High
- **Affected area**: `sales` commands, public quote acceptance
- **Mitigation**: Resolve outside the transaction (ADR-2); returns excluded from provider calls in Spec 1; a per-call timeout.
- **Residual risk**: Spec 4b must re-decide returns; the retry doubles the provider traffic on a mismatch.

#### Fingerprint spoofing and forged provenance
- **Scenario**: a client stores a `tax_info` record or a `tax-provider:` strategy key on create (schemas accept both today) and a reader trusts it.
- **Severity**: Medium
- **Affected area**: `sales` documents, document history widget
- **Mitigation**: the fingerprint is computed server-side only and never read from client input; the fields are never read as authority; the prefix is a convention, not a guarantee.
- **Residual risk**: a forged record can appear in the history widget until a later spec exposes provenance through a server-validated read.

#### Silent zero or silent fallback
- **Scenario**: a provider outage returns no tax and the document is written with zero tax and no status.
- **Severity**: High
- **Affected area**: every touchpoint
- **Mitigation**: fail closed in Spec 1; explicit per-provider policy with a labelled `fallback` status in Spec 3; `display` never calls a remote provider.
- **Residual risk**: a merchant who chooses `fallback-table` accepts approximate tax at checkout; the label is the only protection.

#### Stale tax after an address or customer change until Spec 4b
- **Scenario**: a provider-taxed order gets a new ship-to; nothing recalculates (`shouldRecalculateTotals`, `commands/documents.ts:5522`, `:5797`); the invoice copies the old tax.
- **Severity**: High
- **Affected area**: orders, invoices
- **Mitigation**: Phase 2 does not close before Spec 4b; the roadmap states that neither a remote nor a table provider is production-safe before then for documents whose ship-to changes; `stale` is in the vocabulary from Spec 1.
- **Residual risk**: from Phase 0 (any registered provider) and Phase 1 (the table provider) until Spec 4b, a production organization that selects a provider can invoice stale tax after a ship-to change; the stated limitation and the admin notice are the only protections; proposed for acceptance as a gated phase.

#### Provider rounding versus the engine
- **Scenario**: a provider rounds per document while the engine keeps 4 decimals (`lib/calculations.ts:25`) and the discount contract reconciles `net × (1 + rate)` against a supplied gross.
- **Severity**: Medium
- **Affected area**: `sales` totals, invoices
- **Mitigation**: the provider declares its rounding; the consistency rule uses the engine tolerance; the engine never re-derives tax from a rate when amounts are given; currency precision is a later spec.
- **Residual risk**: a document-level rounding difference beyond the tolerance fails the command instead of being absorbed.

#### The frozen-tax fix is a behaviour change
- **Scenario**: Spec 4b recomputes stored tax on the next write of an old document and changes an amount a user considered final.
- **Severity**: Medium
- **Affected area**: existing quotes and open orders
- **Mitigation**: `UPGRADE_NOTES.md` entry in the "heals on next write" style; `tax_manual_override` protects explicit `taxAmount`; a Decision Requested item in Spec 4b on which document states recompute.
- **Residual risk**: invoiced or paid orders are excluded by default; the rest is announced.

#### New cross-module reads and name collisions
- **Scenario**: a child spec reads `customers` or `catalog` entities from `sales`, or reuses a name of the period-level work.
- **Severity**: Medium
- **Affected area**: `sales`, `catalog`, `customers`, `financial`
- **Mitigation**: ADR-10; the reserved-name list in § 9; the review checklist's cross-module item.
- **Residual risk**: `catalog`'s existing direct read of `SalesTaxRate` is #6733's item, not this roadmap's.

#### Orphaned `customer_group_id` rows change table-provider matches
- **Scenario**: rate rows reference group ids with no group; the group-set matcher silently never matches them.
- **Severity**: Medium
- **Affected area**: Spec 2
- **Mitigation**: orphans reported, not ignored (ecommerce roadmap risk R3); rows with `customer_group_id = null` match when no group service is registered.
- **Residual risk**: depends on tenants acting on the report.

#### External provider outage at checkout or POS
- **Scenario**: the provider is down while a buyer submits; checkout cannot record tax.
- **Severity**: High
- **Affected area**: checkout, POS
- **Mitigation**: `estimate` cached by fingerprint in Spec 3 (DI `cache`, tenant-scoped key and tags, TTL, invalidation on a setting or rate change; § 7.1); the order's `record` calculation runs when checkout creates the order after payment and follows the per-provider policy (block or fallback); `commit` runs later through a durable subscriber with retry; POS taxes at the store with the table provider.
- **Residual risk**: a `block` policy stops sales during an outage by design.

#### Every default employee can switch the provider
- **Scenario**: `sales.settings.manage` is held by the default employee role; a settings change re-taxes every later document of the organization.
- **Severity**: Medium
- **Affected area**: `sales` settings
- **Mitigation**: an audit-log entry on every change of the setting (Spec 1); documents keep their provenance, so a switch is traceable; a narrower feature id is the recorded alternative.
- **Residual risk**: proposed for acceptance in the first PR; revisit with Spec 3's gateway UI.

---

## 13) Decision Requested

Spec 1 asks its own four questions (DR-1 placement, DR-2 Option B versus A, DR-3 where the contract types live, DR-4 registry storage) and they are not repeated here. The roadmap asks the direction-level questions below; each has a recommended default and an "if rejected" fallback.

| # | decision | if rejected |
|---|---|---|
| RD-1 | **A separate `tax_gateways` core module** for lifecycle, failure policy and log, with an additive `tax` member on `IntegrationCategory` in `packages/shared` (ADR-7) | lifecycle, policy and log inside `sales` (a larger module, same contract); credentials under the existing `other` category until a `tax` member is accepted |
| RD-2 | **The built-in table provider runs on the existing `SalesTaxRate` columns** with `sourcing: destination` as the default and `origin` as an option (ADR-6); no compliance outcome is promised for either; a product-code key needs a new column, which Spec 2 names | a dedicated rate table owned by Spec 2 with the same matching semantics and `SalesTaxRate` left unchanged; `sourcing` stays a provider setting with the same default |
| RD-3 | **OSS destination rates and EU reverse charge stay out of v1** of `product-rate`; the cross-border default is `keep-net` (ADR-5) | a built-in EU destination resolver inside Spec 2's scope with `keep-gross` as the cross-border default (both terms defined in ADR-5) |
| RD-4 | **Amendments to the e-commerce specs** (owners of the ecommerce suite roadmap, the cart and the checkout specs): the cart shows `display` figures without ship-to (never remote), checkout runs `estimate` with the address, `cart.lock()` recalculates with it, `record` after payment, `failed` blocks submit (ADR-3) | no tax figure in the cart before checkout's address step (net totals with a "tax at checkout" label); `cart.lock()` under a provider accepts `409 price_changed` whenever the estimate and the final figure differ |
| RD-5 | **Presentation mode variant (a)**: derived from the `displayMode` of the price kind the customer group points to (customer-groups spec §6.1a), then from the selling country or channel, then from the document's price kind; name `tax_mode` (ADR-11) | variant (b): explicit overrides group → country → price kind, proposed to the customer-groups spec owner as an amendment |

## Decision Record

*Empty pending maintainer sign-off. Record each answer here with the date and the login of the maintainer who gave it, and mirror it into the ADR it changes; an ADR without a separate question is recorded here as one sign-off line.*

---

## 14) Open Questions

Questions each child spec decides, in the wording a maintainer can answer directly; the leaning is this roadmap's proposal.

1. **Units, rounding and precision** — "Is `taxRate` in percentage points or a fraction; are negative tax adjustments and line-level adjustments allowed; what rounding tolerance and currency precision should the tax phase honour?" Spec 1 proposes points, 4 decimals and the engine tolerance (`lib/calculations.ts:25`, `:33`); currency precision deferred to a later spec. *Leaning: percentage points, as `SalesTaxRate.rate` and the line `tax_rate` column already are.*
2. **Exemption facts** — "Which module owns a customer's exemption facts (flag, certificate id, validity, jurisdictions): `customers`, `customer_groups` or the tax gateway module; should `SalesTaxResult` adopt the SPEC-024 vocabulary (`isExempt`, `exemptReason`, `isReverseCharge`)?" Spec 4a decides this. *Leaning: the owner module through a DI service; the SPEC-024 names, yes.*
3. **Adjustments** — "Are `tax`-kind adjustments, negative corrections and line-scoped allocations allowed under a configured provider?" Spec 1 rejects `tax`-kind adjustments under a provider (Ask First paragraph); the allocation rule is Spec 4a and manual corrections are Spec 4b. *Leaning: a manual correction sets `overridden`.*
4. **Commit timing** — "Should the provider `commit` fire on invoice issue or on payment when no invoice is issued?" Spec 3 decides this. *Leaning: configurable, `invoice` default.*
5. **Invoices and credit memos** — "Should invoices and credit memos take tax from the order or keep caller-supplied amounts in v1?" Spec 3 decides this; it touches the Quote → Order → Invoice flow (Ask First). *Leaning: caller-supplied in v1.*
6. **Ship-to source** — "What is the source of ship-to for tax: the header snapshot or `SalesDocumentAddress` rows; do tax id and exemption enter the `BuyerContext` digest?" Spec 4a and Spec 6a decide this. *Leaning: the header snapshot only; yes to the digest.*
7. **Product tax code** — "Which field is the canonical product tax code (`taxClassificationCode`, a new `provider_tax_code`, or a mapping to the period-level `TaxCode` of the parallel work), and may a variant override it?" Spec 4a decides this. *Leaning: a new `provider_tax_code` with a variant override; no relation to the period-level code.*
8. **Conversion** — "On quote → order conversion and public acceptance, do we honour the quoted tax or recalculate for the order (`record` intent)?" Spec 1 keeps today's copy semantics and carries no provenance key, because a client-stored record cannot be told from a server-written one without a server-only marker (Ask First paragraph § 4.14); the policy is Spec 4b. *Leaning: an organization setting `honor | re-quote`, `product-rate` honours.*
9. **Selling country** — "Where should the selling country that drives net/gross presentation live, given `SalesChannel` has no tax settings?" Spec 5 decides this. *Leaning: open between a `SalesChannel` setting, a concept in `ecommerce` and an organization setting.*
10. **GL posting** — "For invoice GL posting, should charge tax appear as a `shipping` invoice line or as an extension of the tax total?" A question to the author of the open posting spec (#6046), not settled by this roadmap.
11. **The unit seam** — "Do `sales.tax.calculate.*` and `taxCalculationService` go through the Deprecation Protocol in favour of the new contract, and in which release?" Spec 1 proposes no deprecation; a maintainer can ask for a bridge in review.
12. **All registries** — "Should the sales provider and calculator registries move to `globalThis` like the pricing resolver registry — all of them or none?" Spec 1 DR-4 asks for the new registry only; the rest is a follow-up offer.

**Ask First paragraphs** (`packages/core/src/modules/sales/AGENTS.md:13-14`, `integrations/AGENTS.md`, `packages/events/AGENTS.md`), each carried in the spec that touches the item with a default and an alternative: adjustment-kind semantics (Spec 1: `tax`-kind adjustments rejected under a provider; alternative: excluded from the request and kept in totals); the Quote → Order flow (Spec 1: conversion copies the provenance; Spec 4b: honour versus re-quote); channel scoping (a per-channel provider override is a later spec); `SalesTaxRate` semantics (Spec 2 adds matching semantics to existing columns without changing their meaning); workflow states (Spec 3's commit point); the `integrations` registry type contract (Spec 3 adds `tax` to `IntegrationCategory`); event ids (none renamed; new ids only).

---

## 15) Migration & Backward Compatibility

Classification per `BACKWARD_COMPATIBILITY.md`; every item is additive and nothing follows the Deprecation Protocol in Spec 1.

| Category | Spec 1 | Later specs |
|---|---|---|
| §1 Auto-discovery convention files (`BACKWARD_COMPATIBILITY.md:31`); `data/validators.ts` (`BACKWARD_COMPATIBILITY.md:53`) | existing schemas unchanged; one additive exported schema (`salesTaxProviderSettingsSchema`, Spec 1 § 7); `taxStrategyKey` and `taxInfo` stay accepted, the overwrite rule is documented | Spec 2, 4a and 4b add optional fields only |
| §2 Type Definitions (`BACKWARD_COMPATIBILITY.md:69`) | optional `tax?` on `SalesCalculationContext`; new exported types | additive fields on the request and result types |
| §3 Function Signatures (`BACKWARD_COMPATIBILITY.md:113`) | no change under Option B; `registerSalesTotalsCalculator` gains optional `{ id?, phase? }` only under the fallback Option A | none |
| §4 Import Paths (`BACKWARD_COMPATIBILITY.md:155`) | new exports from `lib/providers/index.ts` (mind that client components import that barrel) | new module `tax_gateways` |
| §5 Event IDs (`BACKWARD_COMPATIBILITY.md:159`, FROZEN) | two new `sales` ids; nothing renamed | one more `sales` id (Spec 4b); three ids in the new `tax_gateways` module (Spec 3) |
| §6 Widget Injection Spot IDs (`BACKWARD_COMPATIBILITY.md:170`, FROZEN) | none; the tax-rate form publishes no `crud-form` spot at head | Spec 2 may add one (additive) |
| §7 API Route URLs (`BACKWARD_COMPATIBILITY.md:181`) | one new route | import and export on the tax-rate route; gateway routes |
| §8 Database Schema (`BACKWARD_COMPATIBILITY.md:192`, ADDITIVE-ONLY) | one nullable column on `sales_settings`, migration with `down()`, no backfill | line detail columns (Spec 4a) and the `price_entry_mode` backfill (Spec 4b); gateway tables (Spec 3) |
| §9 DI Service Names (`BACKWARD_COMPATIBILITY.md:207`) | none: no key added, renamed or changed (Spec 1 § 10) | owner services (Spec 4a); the Resolve service for non-command callers (Spec 1b) |
| §10 ACL Feature IDs (`BACKWARD_COMPATIBILITY.md:216`, FROZEN) | `sales.settings.manage` reused | `tax_gateways.*` features (Spec 3) |
| `packages/shared` `IntegrationCategory` | untouched | additive `tax` member (Spec 3; Ask First) |

`UPGRADE_NOTES.md`: nothing for spec-only PRs; the implementation PR of Spec 1 adds an entry for the settings column and the provenance semantics of `tax_info`; Spec 4b's implementation adds the frozen-tax entry.

## 16) Implementation Plan (delivery plan of the umbrella)

Each step is a pull request that leaves `develop` consistent; implementation PRs follow the phases of the spec they implement.

1. **Phase 0.** This PR: roadmap, Spec 1 and two README rows; § Decision Requested answered in the Decision Record and in Spec 1's Decision Record.
2. **Phase 0.** Spec 1 implementation, one PR per Spec 1 implementation phase, tests under `packages/core/src/modules/sales/__integration__/` (`.ai/qa/AGENTS.md:5`, `:282`), `UPGRADE_NOTES.md` entry.
3. **Phase 1.** Spec 2 PR (its own branch from the then-current `develop`; a roadmap Changelog entry accompanies it), then its implementation PRs. Spec 1b's PR follows in the same phase, after Spec 1's implementation merges.
4. **Phase 2.** Spec 3 PR, with the `tax` category change in `packages/shared` as its own step with the `integrations` owners; Spec 3 implementation PRs.
5. **Phase 2.** Spec 4a PR and its implementation PRs, then Spec 4b PR and its implementation PRs; the combined Phase 2 gate.
6. **Phase 3.** Spec 5 PR with the customer-groups spec owners, then its implementation PRs.
7. **Phase 4.** Amendment proposals 6a, 6b and 6c sent to each owner from Phase 1 on; acceptance recorded in this roadmap's Changelog.

Rules: one spec PR at a time; implementation starts only after its spec merges and an "Implement:" tracking issue exists; every later spec amends this roadmap first when it deviates.

---

## Final Compliance Report — 2026-10-03

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
| root AGENTS.md | Every external integration provider in `packages/<provider-package>/`, never in `packages/core/src/modules/` (`AGENTS.md:183`) | Compliant | vendor adapters live outside the core modules in their own packages, as this rule requires; this roadmap plans no adapter package and names no location |
| root AGENTS.md | Event IDs `module.entity.action`, dots (`AGENTS.md:206`) | Compliant, with one proposed deviation | `sales.tax.document.calculate.before/after` mirror the existing lifecycle pair `sales.document.calculate.*`; `sales.tax.input.changed` (Spec 4b) and `tax_gateways.transaction.committed/voided/failed` (Spec 3) use a singular entity and the past tense; the recalculate command ids keep the module's plural convention (a proposed deviation, see Non-Compliant Items) |
| root AGENTS.md | Optimistic locking on every new user-editable entity | N/A | umbrella; Spec 3's gateway entities carry `updated_at` per the rule |
| packages/core/AGENTS.md | Cross-Module Coupling: optional consumer owns the glue, `try/catch` resolve, no hard `requires` (`packages/core/AGENTS.md:242-250`) | Compliant | ADR-10; `index.ts:12` unchanged |
| packages/core/AGENTS.md | CRUD routes via `makeCrudRoute`; encryption maps for sensitive fields | N/A / Compliant | umbrella; Spec 2 extends the existing `makeCrudRoute` tax-rate route; the provenance record stores no address, name or tax id; its jurisdiction codes identify tax jurisdictions, not a person, so it stays outside the encryption map (§ 9; the alternative is recorded in Spec 1) |
| packages/core/src/modules/sales/AGENTS.md | MUST use `salesCalculationService` for document math; never reimplement inline | Compliant | the tax phase lives inside the engine; touchpoints call the service (ADR-1, ADR-3) |
| packages/core/src/modules/sales/AGENTS.md | Ask First: Quote → Order → Invoice flow, channel scoping, configuration entity semantics (`packages/core/src/modules/sales/AGENTS.md:13-14`) | Compliant | § 14 Ask First paragraphs; each in the spec that touches the item |
| integrations/AGENTS.md | Never import from provider modules; Ask First on registry type contracts; secret fields typed `secret` | Compliant | § 5 rules; RD-1; Spec 3 content row |
| packages/events/AGENTS.md | Declare events in the emitting module's `events.ts`; persistent subscribers idempotent; Ask First on renaming (`events.ts:15`) | Compliant | the Spec 1 and Spec 4b ids declared in `sales/events.ts`, the lifecycle ids in `tax_gateways/events.ts` (the emitter, Spec 3); ADR-8 idempotency; nothing renamed |
| .ai/specs/AGENTS.md | `{date}-{title}.md`, no `SPEC-*` prefix; required sections | Compliant | this file and the child file names |
| .ai/qa/AGENTS.md | Integration tests in module `__integration__` folders, self-contained | Routed | § 16 step 2; each child spec lists its coverage; Spec 1 covers its provider path under a flag-gated test-only provider (Spec 1 § 17) |
| BACKWARD_COMPATIBILITY.md | Event IDs FROZEN, schema ADDITIVE-ONLY, DI names STABLE, validators never narrowed | Compliant | § 15 |
| packages/core/AGENTS.md | `ProgressJob` for bulk or long-running work; queue workers; mutations through commands from workers (`packages/core/AGENTS.md:310-314`) | Routed | Spec 2's CSV import above the worker threshold runs as a queue worker with a `ProgressJob` and writes through the `sales.tax-rates.*` commands (`commands/configuration.ts:1841`, `:1959`, `:2090`) |
| integrations/AGENTS.md | New providers MUST support provider-owned env preconfiguration, implemented in the provider package (`packages/core/src/modules/integrations/AGENTS.md:13`) | Routed | Spec 3 and the provider package (§ 7.1 row 3) |
| packages/cache/AGENTS.md, packages/ui/AGENTS.md, DS rules | Cache strategy, CrudForm/DataTable, design tokens | N/A / Routed | umbrella defines no read API and no UI; the `estimate` cache is Spec 3's (tenant-scoped key and tags, TTL, invalidation; § 7.1); Spec 2 and Spec 5 own the UI and the cache-key component |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | § 9 types and owners match § 10 surfaces and § 7 content rows |
| API contracts match UI/UX section | N/A | no UI in the umbrella |
| Risks cover all write operations | Pass | provider apply, setting change, frozen-tax fix and the outage at checkout are in § 12; CSV import (Spec 2) and commit/adjust/void (Spec 3) are named in § 7.1 as content each child spec must risk-assess |
| Commands defined for all mutations | Pass | Spec 1 adds none; the recalculate commands are named for Spec 4b with the module's plural convention (`sales.orders.*`), proposed instead of the singular naming rule for consistency with every existing `sales` command id |
| Cache strategy covers all read APIs | N/A | umbrella; the `estimate` cache is routed to Spec 3 with tenant-scoped keys and tags |
| One name per concept | Pass | tax phase (one term for the pipeline step), provenance record, charge, provider key, strategy key |
| No other software or analysis cited | Pass by design | external engines named only as the upstream docs name them |

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

### 2026-10-04 — third-pass review
- Findings of two independent reviews applied (the `om-spec-writing` review mode and the `om-pre-implement-spec` readiness audit, each run by two different agents): the Phase 4 gate keeps checkout's `409 price_changed` for any changed total (§ 8); the fingerprint failure in § 3 fails closed like ADR-2; the scope no longer lists vendor packages as deliverables (TLDR, README); the charge definition matches Spec 1 (§ 9); ADR-11 states the `BuyerContext` rule it relies on; the supersession of SPEC-024 §10.2 is conditional on DR-1 (§ 1.1); `tax_info` readership names the document history widget (§ 2); every bare line reference now follows a file on its line; the plural command ids stay an open deviation (Final Compliance Report).
