# Sales Tax Provider Contract

Status: **proposed**. Every contested point is a proposal with a recorded alternative (§ 3); implementation starts after this specification merges and an "Implement:" tracking issue exists (roadmap § 16).
Roadmap: [Tax Providers — Roadmap & Boundaries](./2026-10-03-tax-providers-roadmap.md) (this is Spec 1 of that roadmap; its ADR-1 … ADR-5, ADR-10 and ADR-12 are the positions this specification details).
Scope: `packages/core/src/modules/sales/{lib/calculations.ts, lib/types.ts, lib/providers/{totals,index}.ts, lib/tax/* (new), commands/{taxRequest,taxResolve}.ts (new), commands/documents.ts, commands/settings.ts, api/settings/tax-provider/route.ts (new), data/entities.ts (SalesSettings only), data/validators.ts (additive exports: the command's extended settings schema, the route schema and the result schema; `salesSettingsUpsertSchema` unchanged), di.ts (`tax_stub` registration under `OM_TEST_MODE`), events.ts, migrations/*, i18n/*, the `openApi` declarations of api/documents/factory.ts, api/orders/route.ts, api/quotes/route.ts, lib/makeSalesLineRoute.ts, api/order-adjustments/route.ts and api/quote-adjustments/route.ts (§ 7)}`; root `UPGRADE_NOTES.md` and `BACKWARD_COMPATIBILITY.md` (dated entries, § 10), `.ai/specs/README.md` (the row of this specification); docs `apps/docs/docs/user-guide/taxes.mdx`, `apps/docs/docs/framework/pricing-tax-overrides.mdx`, `apps/docs/docs/framework/modules/sales/calculations.mdx`, `apps/docs/docs/framework/modules/sales-providers.mdx`, `apps/docs/docs/framework/modules/sales/events.mdx`, `apps/docs/docs/user-guide/sales/sales-settings.mdx`. `lib/calculations.ts` additionally exports `extractAdjustmentTaxRate` and `NET_RECONCILIATION_TOLERANCE` (`lib/calculations.ts:33`, `:35`, private today).
Related: [Sales `external` amounts mode](./2026-09-07-sales-external-amounts-mode.md) (parallel work), [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) ADR-2, [Pricing Engine](./2026-08-21-pricing-engine.md) (registry precedent), [Order payment-ledger input deprecation](./2026-08-01-sales-order-payment-ledger-input-deprecation.md) (precedent for an accepted-but-overwritten input), [SPEC-024 §10.2](./SPEC-024-2026-02-11-financial-module.md), [SPEC-045](./implemented/SPEC-045-2026-02-24-integration-marketplace.md), [Address-level contact details and tax identifiers](./2026-08-10-address-contact-and-tax-fields.md).
Verified against: `develop` @ `7f0ebf653` (2026-10-02). Line numbers are pinned to that commit and drift; the symbol or command id beside each is the durable identifier. Paths are under `packages/core/src/modules/sales/` unless stated.

## TLDR

**Key Points:**
- The `sales` totals pipeline gets a document-level seam, a **tax phase**, through which the tax provider configured for the organization computes line and charge tax (proposed). `product-rate` names the default state (no provider configured), in which today's single calculation pass runs unchanged, so an organization in that state sees no change in any line, adjustment, total or `tax_info`.
- The contract is three types and a registry (`TaxProvider`, `SalesTaxRequest`, `SalesTaxResult`; `registerTaxProvider` / `getTaxProvider` / `listTaxProviders`), one additive nullable settings column (`sales_settings.tax_provider_key`), one new settings route, two new event ids and server-written provenance on documents (`tax_strategy_key` = `tax-provider:<providerKey>` on orders, `tax_info` = the provenance record on orders and quotes). No document or line table changes; no new command.
- A remote provider is called in the command layer before the write transaction (the Resolve step) and its result is applied after a fresh read of the document's version and of the setting, still before the transaction opens (the Apply step); a moved version fails closed (409, nothing written); `stale` stays reserved for Spec 4b. The unit seam (`taxCalculationService`, `sales.tax.calculate.*`) stays unchanged as the predecessor.

**Scope:** the tax phase and its ordering (Option B, Option A as the fallback); the contract and the registry; the organization-level provider setting and its route; the default state (`product-rate`); the Resolve and Apply steps and the status vocabulary; provenance; exemptions as vocabulary only; one sentence on calculation modes; docs. Out of scope and pointed at later specifications in § 19: line detail columns and the customer group set (Spec 4a), wider recalculation triggers and the stored-tax carry-over fix (Spec 4b), the built-in table provider (Spec 2), the gateway module and credentials (Spec 3), net/gross presentation (Spec 5), cart, checkout and POS (6a, 6b), OSS and reverse-charge logic, any UI, provenance fields in the read API.

**Acceptance tests (detailed in § 17):**
1. With no provider configured for the organization (`sales_settings.tax_provider_key` is `NULL`, or the settings row is missing), every existing fixture, command and API path produces byte-identical lines, adjustments, totals and `tax_info`.
2. The test-only `tax_stub` provider (§ 17) sets line tax, charge tax and the provenance record in `tax_info` on quote and order create and update.
3. The provider setting is organization-level: changing it changes how every later calculation of that organization's quotes and orders runs; no field on a document changes how that one document is calculated, and the document's `tax_strategy_key` and `tax_info` only record what produced its amounts.
4. `taxCalculationService` and the `sales.tax.calculate.*` events keep working unchanged.

**Concerns:** the single provider totals hook rebuilds the document from its `lines` argument (`lib/providers/totals.ts:191-197`), so the phase lives inside it (Option B) or the hook is split (Option A); stored line tax is fed back as an explicit input on every recalculation (`lib/lineSnapshots.ts:59-67`), so a provider overwrites it deliberately and the carry-over fix stays a later specification; `tax_info` is client-writable on create, so it is output-only by contract and never read as authority; the open externally taxed amounts mode touches the same files and is parallel work only; the provider path is exercised end to end by the test-only `tax_stub` provider (§ 17), so no route-level coverage waits for Spec 2.

---

## 1) Overview

Give the `sales` totals pipeline a document-level seam through which the tax provider configured for the organization computes line and charge tax and which, with no provider configured (the default state, `product-rate`), reproduces today's behaviour exactly, so that an external provider package (for example an adapter for one of the engines the sales user guide already names, `apps/docs/docs/user-guide/taxes.mdx:52`) and a later built-in table provider (Spec 2, working name `tax-destination-table-rate`) can plug in without further engine changes. This PR is the first contact on the topic: the specification is additive, changes no behaviour unless a provider is configured, and shows every contested point as a proposal with alternatives.

Who needs it: a merchant selling in the United States or on another market where the rate is computed at calculation time from the ship-to address, the product's tax code and the customer's exemption facts, per jurisdiction, with an estimate on the quote and a recorded figure on the order; and every other merchant, who must notice nothing.

> **Market Reference**: the platforms studied are Shopware 6, Magento Open Source 2, Medusa v2, Sylius and Odoo; the roadmap's Market Reference paragraph carries the comparison and states what the design adopts and rejects from each. The two external tax engines the repository's docs already name are Avalara and TaxJar (`apps/docs/docs/user-guide/taxes.mdx:52`, `apps/docs/docs/framework/pricing-tax-overrides.mdx:157`). From that comparison this specification takes a default strategy plus a replaceable provider, tax as a late phase after the charges it taxes and before the fees computed on the gross total, one provider call per document write returning amounts with a jurisdiction breakdown, an explicit status with a fail-closed default, and amounts written verbatim; it rejects a separate tax module, a rates-only contract, a provider that runs at checkout only, per-document provider selection and a global net/gross switch.

---

## 2) Problem Statement (the seams this specification touches)

1. **One hook, two blocks, no step between them.** `ensureProviderTotalsCalculator` registers the only core totals hook (`lib/providers/totals.ts:179`, `:183`); the hook drops non-manual provider adjustments (`:188-190`), rebuilds `working` from its `lines` argument (`:191-197`), runs shipping (`:199`) and then payment (`:282`), and payment providers compute fees on `document.totals.grandTotalGrossAmount` (`lib/providers/defaultProviders.ts:128`, `:194`). The only ordering primitive is registration order with `prepend` (`lib/calculations.ts:351-352`, `:498-503`). A separately registered hook therefore runs either before shipping exists or after payment fees were computed on an untaxed gross.
2. **Line tax is explicit-or-derived, and stored tax comes back as explicit.** `buildBaseLineResult` (`lib/calculations.ts:118`) uses an explicit `taxAmount` verbatim (`:164-167`), honours a supplied `totalGrossAmount` verbatim (`:168-171`) and derives tax from gross minus net only when tax was not explicit (`:177-180`); `mapPersistedLine` feeds stored `taxAmount` and `totalGrossAmount` back with `totalsFromStoredRow: true` (`lib/lineSnapshots.ts:59-67`); both line upserts keep `parsed.taxAmount ?? existingSnapshot?.taxAmount` (`commands/documents.ts:7575`, `:8067`). The document tax total is line tax plus `tax`-kind adjustments plus the tax portion of adjustments with `metadata.taxRate` (`lib/calculations.ts:213-222`, `:245-246`, `:256-259`); `round` keeps 4 decimals (`:25`) and `NET_RECONCILIATION_TOLERANCE` is 0.005 (`:33`).
3. **No context, no setting, no provenance reader.** `SalesCalculationContext` is `{ tenantId, organizationId, currencyCode, metadata?, resolve? }` (`lib/types.ts:160-166`); `buildCalculationContext` sets no address, customer, channel or date (`commands/documents.ts:2967`); `resolve?` is declared and never populated. `SalesSettings` holds number formats and two status lists only (`data/entities.ts:755`). `tax_strategy_key` and `tax_info` on orders (`:397`, `:403`) and `tax_info` on quotes (`:896`) are accepted on create (`data/validators.ts:703`, `:705`, `:756`), stripped on update by `documentUpdateSchema` (`commands/documents.ts:603`), written as `null` and copied by conversion (`:6773`, `:6775-6777`), restored by undo, and not consumed by tax calculation or provider selection (`taxInfo` is displayed through the document history widget, `widgets/injection/document-history/widget.client.tsx:108`). The document list routes return neither field (`api/documents/factory.ts:387-424`).
4. **Transactions and locks.** Creates and the line and adjustment commands calculate before `withAtomicFlush` (`commands/documents.ts:5191` before `:5207`; `:6259` before `:6276`; `:7639` before `:7654`; `:8131` before `:8145`); the two header updates calculate inside it (`:5610`, `:5873`, under `withAtomicFlush(..., { transaction: true })`); conversion (`:6673`), public acceptance (`api/quotes/accept/route.ts:99`) and undo (`commands/documents.ts:4100`, `:4557`, `:4564`, `:5352`) hold `PESSIMISTIC_WRITE` locks and never calculate; the return create and redo paths lock the order lines (`commands/returns.ts:604`, `:439`) and calculate under the lock (`:724`, `:538`), while the return undo helper calculates without a lock (`:388`).
5. **The unit seam is a converter.** `CalculateTaxInput` carries an amount, a mode, the tenant scope and a rate id or raw rate (`services/taxCalculationService.ts:8-15`); `resolveRate` finds a `SalesTaxRate` by id (`:92`); the line upserts call it only to fill a missing price side (`commands/documents.ts:7458`, `:7951`). The docs point external engines at it (`apps/docs/docs/user-guide/taxes.mdx:52`, `apps/docs/docs/framework/pricing-tax-overrides.mdx:157`), and the documented totals-hook example reads `context.countryCode`, which the type does not declare (`apps/docs/docs/framework/pricing-tax-overrides.mdx:75`).

---

## 3) Proposed Solution

A `tax` phase inside the provider totals calculator, between the shipping and payment blocks; a contract and a registry in `sales` under `lib/tax/`; an organization-level provider setting; `product-rate` as the name of the default state; the Resolve and Apply steps before the write transaction, with a fresh read of the document version before the second pass; provenance on documents.

### Design Decisions (proposed defaults)

| Decision | Rationale |
|---|---|
| The tax phase is a step of the `sales` totals pipeline | `sales` owns the arithmetic, `SalesTaxRate` and the single totals hook; SPEC-024 §10.2 sketched a per-country engine inside a planned financial module, nothing implements it at this head, and the `tax_management` specification of PR #6168 states that transaction-level tax calculation is `SalesTaxRate`'s territory in `sales`, so §10.2 is read as superseded for transaction-level tax only, with the period-level work untouched |
| The tax phase is a fixed step inside the provider totals calculator (Option B) | The hook rebuilds from its `lines` argument and runs both blocks itself (`lib/providers/totals.ts:191-197`, `:199`, `:282`), so "after shipping, before payment" is reachable only from inside it; no public signature changes |
| Contract types in core `sales` under `lib/tax/` | The phase and the registry are `sales` code and the contract stays with its consumer, as the shipping and payment provider types do (`lib/providers/types.ts`) |
| Resolve, the version check and the Apply pass before `withAtomicFlush` opens, in all twelve commands (§ 4.2) | Two header updates calculate inside a transaction today and the returns paths calculate under row locks (§ 2 point 4); a network call must hold neither, and one transaction boundary is simpler than two |
| Provider selected per organization in `sales_settings`; documents carry provenance only | A free-text, client-writable document field cannot be an authority; quotes have no `tax_strategy_key` column; one nullable column is reversible |
| `product-rate` is the name of the default state (the `NULL` setting), not a registered provider | No provider, no Resolve, no `tax` slot: today's single pass, so existing fixtures stay byte-identical |
| Explicit status vocabulary and a document-level `taxTotalAmount` in the result | The consistency rule needs an anchor; a provider's document-level rounding can differ from the sum of line tax (§ 5.6) |
| `tax_info` content rule: provenance and results only, never addresses, names or tax ids | `tax_info` is not in the sales encryption map (`encryption.ts` encrypts the address snapshots, `encryption.ts:8-9`, `:25-26`); the record stays safe in clear |
| Fail closed in this specification (the default of the Ask First paragraph, § 4.13) | No gateway policy exists yet; a silent zero is the known failure class |
| New registry on `globalThis` | The repository lesson (`.ai/lessons/global-registries-in-publishable-packages-must-use.md:14`) and the pricing registry precedent (`packages/core/src/modules/catalog/lib/pricing.ts:193`, `:215`) |

### Alternatives Considered (not proposed)

| Alternative | Why Rejected |
|---|---|
| Option C: no phase; resolve before `calculateDocumentTotals` and feed tax through explicit `taxAmount` and `metadata.taxRate` in a second pass | The provider calculator regenerates its adjustments on every run (`lib/providers/totals.ts:188-190`), so tax placed on them through metadata is lost; shipping charges created by the first pass cannot be taxed consistently; no seam for a status or a provenance record |
| The documented unit seam (DI swap of `taxCalculationService`, `setResult()` in `sales.tax.calculate.before` or `sales.document.calculate.after`) | The seam carries six scalar fields (`services/taxCalculationService.ts:8-15`), the engine never calls it, `sales.document.calculate.after` fires after payment fees (`lib/calculations.ts:437-448`), and a subscriber runs inside the transaction on header updates |
| A separate tax module, or the plugin hook SPEC-024 §10.2 sketched for the financial module (`SPEC-024-2026-02-11-financial-module.md:2432`, `:2437`) | Collides with the ecommerce suite roadmap's ADR-2 (`2026-08-14-ecommerce-suite-roadmap.md:175-179`) and with the names of the parallel period-level work; needs a cross-module workflow layer that does not exist; transaction-level tax needs the document, addresses and charges only the `sales` pipeline has |
| A type-only contract in `packages/shared` (precedent `packages/shared/src/modules/integrations/types.ts`) | The phase and the registry are `sales` code; the contract stays with its one consumer, as the shipping and payment provider types do |
| Per-document provider selection through a namespaced `tax_strategy_key` | Quotes have no such column (`data/entities.ts:896` is `tax_info` only); the update schema strips the field; conversion writes `null`; a client-writable input would become an authority |
| A jsonb settings bag instead of one column | Schemaless, no database-level validation; the two existing jsonb columns are typed status lists (`data/validators.ts:82-86`) |
| Provider results in line and adjustment `metadata` | Client-writable, overwritten by client edits, and provider adjustments are regenerated on every run |
| `estimate` only (no intent in the type) | A provider written against this contract would assume every call is an estimate, and `display` (never remote) could not be expressed for the cart |
| Fail open or fall back to `product-rate` | A figure the provider did not compute becomes an invoice amount; recorded as the alternative in the Ask First paragraph of § 4.13 |
| Committing an update with the stored amounts under a `stale` record after a failed version check | The update response (`api/documents/factory.ts:210-252`) and the list API (`:387-424`) expose no `tax_info`, so a client could not see that the amounts were not the provider's; `stale` stays reserved for Spec 4b |
| Module-local `Map` for the new registry | The failure class the lesson names (a provider registered in one module instance invisible to another) |
| Core-owned product tax code and exemption columns filled by owner services | Core cannot know what each provider needs; a column designed for one engine is wrong for the next; the framework lets a package extend another module's data without touching core entities |

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

Vocabulary, one name per concept: *provider key* is the registry key of a `TaxProvider` (for example `tax_stub`, § 17); *strategy key* is the string the server writes into `tax_strategy_key` as provenance (`tax-provider:<providerKey>`); a *charge* is an order-scope adjustment of kind `shipping`, `surcharge`, `custom` or any operator-defined kind (`SalesAdjustmentKind` admits any string, `data/entities.ts:10`) with `amountNet ≥ 0`; an adjustment of kind `custom` or of an operator-defined kind with `amountNet < 0` is a *credit*, not a charge (those kinds carry an operator-controlled sign, `data/validators.ts:465-482`, `lib/calculations.ts:277-293`); the *provenance record* is the content of `tax_info`; the *tax phase* is the step of the totals pipeline (an implementation phase is a delivery phase; a flush phase is a phase of `withAtomicFlush`); the *Resolve step* and the *Apply step* are the two steps of the command layer (prose names, never identifiers; the roadmap's "the phase writes" in ADR-2 names the engine's part of the Apply step); `SalesTaxContext` is the `tax` slot of the calculation context and is not the `TaxContext` of SPEC-024 (`SPEC-024-2026-02-11-financial-module.md:774`, which is closer to this specification's `SalesTaxRequest`); the intent `display` is not the catalog `displayMode`.

### 4.1 The tax phase (Option B; Option A as the recorded alternative)

**Option B (default).** Inside `ensureProviderTotalsCalculator`, between the shipping block (`lib/providers/totals.ts:199`) and the payment block (`:282`), the hook calls a new `applyTaxPhase({ documentKind, lines: working.lines, adjustments: runningAdjustments, context, current: working })` and rebuilds through `rebuildDocumentResult` (`lib/calculations.ts:505`). The phase reads `context.tax` (§ 4.3): with no `tax` slot (no provider configured, § 4.2) or with a slot that carries no `result` (the first pass under a provider, § 4.2) it returns its input unchanged (identity); with a result it writes per-line `taxAmount` and `grossAmount = netAmount + taxAmount` for every line, including a gross-entered one (§ 4.10), per-charge `amountGross = amountNet + taxAmount` and `metadata.taxRate` (merged into the existing provider metadata, never replacing other keys), and never touches `totals` directly. No public signature changes.

Rules for third-party totals calculators under Option B, stated in the docs page that shows appended calculators (`apps/docs/docs/framework/modules/sales/calculations.mdx:39-45`), which does not mention tax today: a calculator registered with `prepend: true` runs before the provider hook; a charge it adds to `current.adjustments` survives and is manual by contract when it carries no `calculatorKey` (it enters the request under the id the calculator assigns, § 4.8); a calculator that does not want its charges taxed sets a `calculatorKey`; its edits to `current.totals` or a replaced `current.lines` array are rebuilt away by the provider hook, as today (`lib/providers/totals.ts:191-197`; the documented fee example, `apps/docs/docs/framework/pricing-tax-overrides.mdx:66-90`, edits totals only and prepends at `:89`, so its fee is discarded today); a calculator appended after the provider hook runs after tax, sees taxed totals, and charges it adds stay untaxed by the provider. Payment fees computed by the payment block see the tax-inclusive gross (`lib/providers/defaultProviders.ts:128`, `:194`).

**Option A (fallback, if the maintainers want an explicit phase API now).** `registerSalesTotalsCalculator(hook, opts)` gains optional `{ id?: string; phase?: 'charges' | 'tax' | 'post-tax' }` (additive on the existing `{ prepend?: boolean }`, `lib/calculations.ts:351`, `:498`); the provider calculator splits into a `charges` registration (shipping) and a `post-tax` registration (payment); hooks without `phase` keep today's position (appended after the payment step; `prepend: true` before the shipping step); the instance method `salesCalculations.registerTotalsCalculator` (`:351`, reachable through the exported singleton `:477`) changes in step.

**Option C (rejected).** See Alternatives Considered.

Under either option the phase writes the validated result verbatim and never adjusts a provider amount; the consistency rule runs once, in Resolve (§ 4.10).

### 4.2 The Resolve step and the Apply step

- **Resolve (command layer, outside `withAtomicFlush` and `em.transactional`).**
  - The command first reads the organization's setting with `loadSalesSettings` (`commands/settings.ts:28-35`); a missing row or a `NULL` column is the default state (`product-rate`): today's single calculation pass with no `tax` slot and no Resolve.
  - Under a configured provider it resolves the provider by key (`getTaxProvider`; an unregistered key fails closed, § 4.13), refuses the write when the future adjustment set carries a `tax`-kind row or a rated discount (§ 4.8), and runs a first calculation pass on the future state of the document with `context.tax = { intent }` and no `result` (under which the phase returns its input unchanged, § 4.1), which yields post-discount line nets and the adjustments of the final result.
  - The request's charge set is the order-scope charges of that result that are manual (no `calculatorKey`: manual by contract, so a calculator that adds charges it does not want taxed sets a `calculatorKey`, § 4.1) or generated by the built-in shipping step (`calculatorKey` starting with `shipping-provider:`, `lib/providers/totals.ts:16`), identified by key and never by position in the pipeline, so `payment-provider:` surcharges (`:17`) and every other keyed charge never enter the request and stay untaxed by the provider.
  - On a create the command assigns ids to its line and manual adjustment drafts before the first pass, as the upsert paths already do (`commands/documents.ts:7492`, `:8407`; `replaceOrderAdjustments` honours `draft.id`, `:3599-3600`), carries the line id through `createLineSnapshotFromInput` (`:3064-3127`, which sets none today although `SalesLineSnapshot` has the field, `lib/types.ts:43`) and creates the line rows with it in `replaceOrderLines` and `replaceQuoteLines` (`commands/documents.ts:3542`, `:3414`, as `applyOrderLineResults` does, `:3279-3281`), so every `ref` is an id or a generated charge's `<calculatorKey>@<position>` (§ 4.8).
  - It then builds `SalesTaxRequest` (§ 4.11), emits `sales.tax.document.calculate.before` (§ 4.16), calls `provider.calculate(request, ctx)` under a deadline (§ 4.13), validates the result (§ 4.10, § 9 F3–F5), emits `sales.tax.document.calculate.after`, and keeps the result in memory.
- **Apply (before the flush).** On an update the command reads the document's `updated_at` again with `refresh: true` (a fresh read, never the identity map that served Resolve: the repository lesson `.ai/lessons/avoid-identity-map-stale-snapshots-in-command-logs.md:14` and the in-repository pattern `packages/core/src/modules/workflows/lib/workflow-executor.ts:895`) and compares it with the value read for Resolve; the setting is read again the same way; a moved version or a changed provider key fails closed (409, below) and nothing is written; a create has no document to check, so only the setting read applies to it; the column moves with every flushed change of the header (`onUpdate`, `data/entities.ts:514`, `:974`). On a match it passes the result through `context.tax = { intent, result }` into the second calculation pass, where the phase writes the amounts (§ 4.1); `withAtomicFlush(..., { transaction: true })` then only persists lines, adjustments, totals, `tax_strategy_key` (orders) and `tax_info` (orders and quotes). One transaction boundary for all twelve commands: the creates and the line and adjustment commands already calculate before the flush (`commands/documents.ts:5191` → `:5207`, `:6259` → `:6276`, `:7639` → `:7654`, `:8131` → `:8145`; the other recalculating commands at the sites listed under Commands in § 4), and the two header updates, which calculate inside it today (`:5610`, `:5873`), are hoisted before it (below), so a failed check throws before anything is flushed. The window between the check and the flush is today's (§ 9 F10); validation-only passes that some commands run first (the return-kind adjustment upsert calculates a validation baseline before the final result, `:8510`, `:8559`) carry no `tax` slot and count neither as Resolve nor as Apply.
- **Mismatch.** On a moved version or a changed provider key the Apply step throws `CrudHttpError` 409 `sales.tax.errors.inputs_changed` (§ 7) before the flush opens: nothing is written, the client reloads and saves again, as after `optimistic_lock_conflict`. `stale` stays in the vocabulary for Spec 4b's trigger-based staleness (§ 3 records the rejected alternative). One provider call, two calculation passes and one transaction per write; the existing calculation lifecycle events fire once per pass (§ 4.16).
- **Header updates** (`sales.quotes.update`, `sales.orders.update`) recalculate only when `shouldRecalculateTotals` is true (`commands/documents.ts:5522`, `:5797`: shipping method, payment method or currency) and do so inside the flush today: the header is mutated in the first phase and the lines are re-read inside the transaction in the second (`commands/documents.ts:5537-5576`, `:5828-5840`, with the context built from the updated header, `:5598-5608`, `:5861-5871`). This specification hoists that pass before the flush: the command reads the current lines and adjustments on its own fork, derives the method snapshots as `applyDocumentUpdate` does (`commands/documents.ts:1402-1512`), builds the future state from them and the parsed changes, runs Resolve and Apply, and the in-flush phases persist the header, the adjustments and the totals as today (`:5633-5639`, `:5897-5903`) and, when a provider result was applied, the line rows (the files PR #6092 also edits, § 11). A concurrent write that moves the header's `updated_at` between that read and the fresh read is the 409 above.
- **Returns** (`sales.returns.create` and the return redo helper recalculate under `PESSIMISTIC_WRITE` locks, `commands/returns.ts:604` then `:724`, `:439` then `:538`; the return undo helper `reverseReturnEffects` reads without a lock and calculates at `:388`; `sales.returns.delete`, `:985`, recalculates on execute, `:1027` → `:388`, and on undo, `:1085` → `:538`; the exported `recalculateOrderTotalsForDisplay`, `:176-211`, calculates outside any command) build their own context (`:156`): in this specification they run no provider call; the tax phase runs without `context.tax`, the lines keep their stored tax and the regenerated charges are untaxed (§ 4.8); re-taxing returns is Spec 4b.
- **Conversion and public acceptance** run no provider call (§ 4.14). **Undo** restores snapshots that carry amounts and provenance together (`commands/documents.ts:1716`, `:2003-2005`, `:4157-4159`, `:4667-4671`) and never calls a provider; a restored document keeps the old provenance with the old amounts, and the next recalculating write applies the current setting. **Redo** re-executes the command and calls the provider again, which is safe because `calculate` has no provider-side effect (§ 4.7).
- **Every recalculating command forks its own `EntityManager`** at its start (for example `commands/documents.ts:5000`, `:6043`, `:7419`), and `withAtomicFlush` joins an active transaction only when one exists (`packages/shared/src/lib/commands/flush.ts:158-171`), so Resolve runs outside any transaction even when an inbox action, a workflow step or the warranty module dispatches the command. Conversion is the exception that uses the caller's `transactionalEm` (`commands/documents.ts:6657-6660`), and it has no Resolve.
- **One helper for every command.** Resolve and the version check are implemented once, in `commands/taxResolve.ts` (working name `resolveDocumentTax(futureState, deps)`, which returns the result or throws the errors of § 7); the twelve commands call the helper instead of repeating the sequence, and the Resolve service for callers that are not `sales` commands (Spec 1b of the roadmap) wraps the same helper. The future state the helper takes is the engine's input shape (lines, adjustments, header facts), never entities.

### 4.3 Contract types

Location (proposed): `lib/tax/` with `types.ts`, `registry.ts` and `phase.ts`, exported from the `lib/providers` barrel like the shipping and payment registries (`lib/providers/index.ts:7`); the request builder and the Resolve helper are command-layer files (`commands/taxRequest.ts`, `commands/taxResolve.ts`), never imported by `components/*`.

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
  documentKind: SalesDocumentKind          // existing union, data/entities.ts:7
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
    kind: SalesLineKind                    // existing union, data/entities.ts:8
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
    taxRate?: number | null
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
  effectiveRate?: number | null            // percentage points
  isExempt?: boolean; exemptReason?: string | null; isReverseCharge?: boolean
  jurisdictions?: SalesTaxJurisdictionAmount[]
}

type SalesTaxResult = {
  providerKey: string; providerReference?: string | null
  taxTotalAmount: number                   // document-level total the consistency rule compares against
  lines: SalesTaxLineResult[]
  charges: Array<{
    ref: string; taxableAmount: number; taxAmount: number; effectiveRate?: number | null
    jurisdictions?: SalesTaxJurisdictionAmount[]
  }>
}

type SalesTaxProviderContext = {
  tenantId: string; organizationId: string
  signal: AbortSignal                      // the deadline of § 4.13
  resolve: <T>(name: string) => T          // the command's DI container; the shape SalesCalculationContext.resolve declares (lib/types.ts:165)
}

interface TaxProvider {
  key: string; label: string; description?: string
  calculate(request: SalesTaxRequest, ctx: SalesTaxProviderContext): Promise<SalesTaxResult>
  // commit, adjust and void are not declared here: Spec 3 adds them as new optional methods,
  // because typing a reserved `unknown` member later would narrow it for implementers (BACKWARD_COMPATIBILITY.md:71)
}

type SalesTaxProviderError = { code: 'invalid_request' | 'unavailable' | 'rate_limited' | 'unauthorized'; message: string }
// thrown by `calculate`; any other throw is read as `unavailable` (§ 4.13)

type SalesTaxContext = { intent: SalesTaxIntent; result?: SalesTaxResult | null }
// SalesCalculationContext gains `tax?: SalesTaxContext` (additive; lib/types.ts:160-166)
```

Contract rules a provider can rely on: `calculate` is side-effect free at the provider (it must not create, save, commit or otherwise persist a transaction there; a provider that needs a stored transaction waits for the method Spec 3 adds); every request line and charge `ref` appears exactly once in the result, no unknown `ref` appears; amounts are finite numbers, non-negative in this specification (credit documents with negative amounts are later); `taxRate`, `effectiveRate` and jurisdiction `rate` are percentage points, as `SalesTaxRate.rate` and the line `tax_rate` column (the rate column `tax_rate` is numeric(7,4), `data/entities.ts:640`; the amount column `tax_amount` numeric(18,4), `:643`); an adapter whose engine reports fractions converts; `jurisdictions[].level` uses the documented set, with `other` as the catch-all. The header addresses are document defaults; a later per-line address (Spec 4a) overrides them for that line. Line `netAmount` is after the line discount and before any document-level discount (§ 4.8). A provider reads the facts it needs beyond the request through `resolve`, from fields or extension entities its own package declares (§ 4.15).

### 4.4 Provider selection, the setting and provenance

- **The setting.** One additive nullable column `sales_settings.tax_provider_key` (`text`, entity property `taxProviderKey?: string | null`; `SalesSettings`, `data/entities.ts:755`, unique per `(organization_id, tenant_id)`); `NULL` is the default state, `product-rate` (no provider); a missing settings row is the same state, because the row is created at tenant setup for the initial organization only (`setup.ts:72-85`) and lazily by `sales.settings.save` for every other organization (`commands/settings.ts:75-84`).
- **The write.** A new route `GET`/`PUT /api/sales/settings/tax-provider` (§ 7) runs the existing command `sales.settings.save` (`commands/settings.ts:50`) extended with an optional `taxProviderKey`. Precision: the command parses `salesSettingsUpsertSchema` itself today (`:52`), which requires both number formats (`data/validators.ts:89-90`) and strips unknown keys, and on update rewrites both formats (`commands/settings.ts:86-87`). `salesSettingsUpsertSchema` stays untouched; the command parses an exported extension of it, `salesSettingsUpsertWithTaxProviderSchema` (the optional `taxProviderKey` added), which only the new route sends the field to, so the two existing settings routes, which parse the unextended schema (`api/settings/order-editing/route.ts:128`; `api/settings/document-numbers/route.ts:108`, behind the deprecated guard, `:110`), can neither write nor reset the key; the new route loads the current row and passes both number formats unchanged (the sibling route's constants `DEFAULT_ORDER_NUMBER_FORMAT` and `DEFAULT_QUOTE_NUMBER_FORMAT` when no row exists, `api/settings/order-editing/route.ts:145-149`), and the command writes the field only when it is present (`!== undefined`) on update and with `?? null` on create, following the two editing fields (`commands/settings.ts:81-82`, `:88-93`), with the same unchanged race between two concurrent settings writes as the sibling routes' load-and-save sequence. The key is validated against the registry at write time (`getTaxProvider`); an unknown key is rejected with 422 and nothing is written. No new command, so `commands/__tests__/registration.test.ts:125-129` stays unchanged.
- **Who may change it.** The route requires `sales.settings.manage` for `GET` and `PUT`, like every sales configuration route (`api/settings/order-editing/route.ts:28-29`, `api/settings/document-numbers/route.ts:27-28`, `api/tax-rates/route.ts:31-35`). Every default `employee` holds that feature (`setup.ts:54`), so any employee can change how every later document of the organization is taxed; this specification states it and proposes an audit entry (below); an admin-only feature id is the open point of § 14.
- **Audit.** `sales.settings.save` writes no action-log entry today (no `buildLog`, no `undo`). The implementation adds a `buildLog` that records the old and the new provider key when it changes (following the tax-rate update command, which logs before and after, `commands/configuration.ts:2032-2050`); no undo for the setting in this specification: settings commands have no undo today, so this is a recorded deviation from the checklist's rule that every command is undoable (`.ai/review-checklist.md:88`; the write itself goes through a command, as `packages/core/AGENTS.md:13` requires), listed in the Final Compliance Report; documents keep their provenance, so a switch is traceable per document.
- **Organization selection.** The route resolves the organization as the sibling settings routes do (`scope?.selectedId ?? auth.orgId`, `api/settings/order-editing/route.ts:49`), including their fallback to the caller's home organization when the selection is the all-organizations token or was dropped (`packages/core/src/modules/directory/utils/organizationScope.ts:349`, `:406`).
- **Resolution order at calculation time.** The document's own `tenantId` and `organizationId` (never the UI selection) → `loadSalesSettings` → the registered provider; `NULL` or no row is the default state, with no Resolve. The setting is read in Resolve and again, fresh, before the second pass (§ 4.2); a changed provider key between the two reads is the 409 of § 4.2. A key that no longer resolves fails closed (§ 4.13).
- **Provenance on documents.** When a configured provider ran, the server writes `tax_strategy_key` = `tax-provider:<providerKey>` on orders and the provenance record into `tax_info` on orders and quotes (§ 6); under `product-rate` the server writes neither, so those documents keep byte-identical values. The prefix is a convention for server-written values, not a guarantee: a client can store the same shape on create under `product-rate`; the fields are never read as authority, and a forged record can show up in the document history widget, which labels the field "Tax details" (`widgets/injection/document-history/widget.client.tsx:108`, `i18n/en.json:983`). Today's free-text values stay as they are and are never read. The prefix marks a document field, unlike `shipping-provider:` and `payment-provider:`, which mark an adjustment `calculatorKey` (`lib/providers/totals.ts:16-17`).
- **Client-supplied `taxStrategyKey` and `taxInfo` on create.** `orderCreateSchema` keeps accepting both (`data/validators.ts:703`, `:705`) and `quoteCreateSchema` keeps accepting `taxInfo` (`:756`); `data/validators.ts` is a convention file that must not be narrowed (`BACKWARD_COMPATIBILITY.md:53`). The values are stored as today when no provider runs (`commands/documents.ts:5039`, `:6095-6097`), overwritten by the server's provenance when a provider runs, and never read as authority. This specification documents that overwrite rule and adds no deprecation marker and no warning: the inputs keep their effect for organizations without a provider (the payment-ledger precedent's marker is the open point of § 14).
- **Not in the read API.** `GET /api/sales/orders` and `/quotes` list neither field today (`api/documents/factory.ts:387-424`); this specification exposes nothing; provenance is observable at command level and through the document history widget; API exposure is a later specification.
- **Ask First (configuration entity semantics, `packages/core/src/modules/sales/AGENTS.md:14`).** Adding a column to `SalesSettings` changes no existing semantics of statuses, methods, channels, price kinds, adjustment kinds or document numbers; the paragraph is here so a maintainer can object.

### 4.5 `product-rate`

`product-rate` is the name of the default state, `sales_settings.tax_provider_key` `NULL` or no settings row (§ 4.4), not a registered provider: the registry holds no entry for it, `listTaxProviders()` does not return it, and no provider object exists for it. In that state there is no Resolve and no `tax` slot, so the engine runs today's single calculation pass unchanged: no line writes, no charge writes, no `tax_info`, no tax-provider events. Proof: every existing `lib/__tests__/calculations.test.ts` case passes unchanged; a golden test replays the same fixtures with the phase in the pipeline and asserts deep equality and string equality of the serialized result; the documented gift-line hook (`sales.line.calculate.after` setting `taxAmount: 0`, `apps/docs/docs/framework/pricing-tax-overrides.mdx:104-118`) keeps its effect (§ 17).

A document that carries a provider provenance record when the organization switches back to `product-rate` keeps that record: it describes the last provider calculation, not the later calculations without that provider (the lines keep their stored tax through the line carry-over, the regenerated charges are untaxed, § 4.8); the next recalculating write under `product-rate` writes no new record; new lines get engine tax from their own rate.

### 4.6 Calculation modes (one sentence)

The phase runs in the engine's normal calculation mode; a future mode that stores externally taxed amounts verbatim must skip the phase at the point where the shipping and payment provider steps would also be skipped, inside the provider totals calculator in `lib/providers/totals.ts` (no such guard exists at head: the calculator skips only per adjustment through `isManualOverride`, `lib/providers/totals.ts:34`, `:203-206`, `:286-289`). No such mode exists at head; the merged specification `2026-09-07-sales-external-amounts-mode.md` is itself a proposal awaiting maintainer decisions (`2026-09-07-sales-external-amounts-mode.md:3`) and its implementation is parallel work (§ 11). This specification designs on none of its field names.

### 4.7 Intents and statuses

- The command layer sets `estimate` for quotes and `record` for orders; `display` is reserved for cart and UI previews and must never trigger a remote call. The intent cannot be derived from the document kind, because the cart specification calls the engine with a quote-like document (`2026-08-14-cart-module.md:102-107`).
- `record` means that the platform stores the result on an order; it never asks a provider to record a transaction for filing. `calculate` is idempotent per document reference; nothing commits in this specification.
- Status written into the record (the result carries none, § 4.3): `estimated` for intent `estimate`, `calculated` for intent `record`, `exempt` when every line is exempt (when at least one line is taxed the status is `calculated` or `estimated` and the exemption shows per line); `stale` reserved for Spec 4b and never written here (§ 4.2); `not_applicable` reserved; `failed` is never stored in this specification (the error body carries `code`, § 7; only the fail-open alternative of § 4.13 would write it); `fallback` reserved for Spec 3; `overridden` reserved for Spec 4b's manual override and never written here (the two tax events are notification-only, § 4.16).

### 4.8 Charges, adjustments and discounts

- Charges (§ 4 vocabulary: order-scope `shipping`, `surcharge`, `custom` or operator-defined adjustments with `amountNet ≥ 0`, present at the tax phase's position, § 4.2) enter the request with `ref` = the adjustment id for manual charges (assigned before the first pass on create, § 4.2; a calculator that adds a manual charge assigns its id) and `<calculatorKey>@<position>` for provider-generated adjustments (regenerated on every run, `lib/providers/totals.ts:188-190`, so their database id may not be stable; `position` is `10_000 + index`, `:105-129`); the `ref` is stored with that charge's result in the provenance record.
  - The Apply step writes `amountGross = amountNet + taxAmount` and `metadata.taxRate` (merged), which `buildBaseDocumentResult` already folds into `taxTotalAmount` (`lib/calculations.ts:245-246`, `:260-293`); the rate's value does not change the arithmetic, and a written `0` records "untaxed".
  - A credit (a negative `custom` or operator-defined adjustment) stays out of the request; under a provider it is accepted only when the engine's `extractAdjustmentTaxRate` (`lib/calculations.ts:35`, which also reads the aliases `tax_rate`, `taxRateValue` and `tax_rate_value`) yields no rate for it (with one it is refused like a rated discount, below), so it carries no tax portion (`lib/calculations.ts:245-246`); a supplied gross that differs from its net reduces the gross total by that difference without touching the tax total, the § 5.4 limitation that allocation (Spec 4a) removes; under `product-rate` nothing changes.
  - **No carry-over.** Provider adjustments are dropped and regenerated on every calculation (`lib/providers/totals.ts:188-190`): a pass with a result taxes every charge of the request afresh, and a pass without a `tax` slot (a return, or any write after the organization switched back to `product-rate`) regenerates the charges untaxed while the lines keep their stored tax, so the document's charge tax drops on such a pass until the next provider write or Spec 4b's recalculation, the stated limitation of the pre-4b window (§ 5.5, F14).
- Payment surcharges created after the tax phase stay untaxed in Option B and never enter the request (§ 4.2); Option A would let a later specification tax them.
- **Ask First (adjustment kinds, `packages/core/src/modules/sales/AGENTS.md:14`).**
  - Default: while the organization's setting names a provider, writing a `tax`-kind adjustment is refused (400 `unsupported_adjustment`, § 7) by one check in the shared Resolve helper (§ 4.2) over the complete future adjustment set, stored rows plus the write's inputs (the creates map their inputs through `createAdjustmentDraftFromInput`, `commands/documents.ts:5175`, `:6243`, and the adjustment upserts build their drafts separately, `:8424-8445`, `:8877-8898`), so every command that reaches Resolve, from any transport, inbox action or workflow step, answers alike.
  - Under `product-rate` it works exactly as today; a manual tax override is a later feature (`overridden` reserved).
  - A document that already carries a `tax`-kind adjustment when a provider is configured, or an order-scope `discount`, new in the write's inputs or stored, for which the engine's `extractAdjustmentTaxRate` yields a rate (`lib/calculations.ts:35`; `metadata.taxRate` or its aliases `tax_rate`, `taxRateValue`, `tax_rate_value`), is not recalculated under that provider: Resolve fails closed before the provider call with 400 `sales.tax.errors.unsupported_adjustment` and a message naming the row to remove or the rate to clear, so a provider figure is never combined with a manual tax amount or a discount tax portion (the engine folds both into the total on every rebuild, `lib/calculations.ts:248-259`, and the payment block rebuilds after the phase, `lib/providers/totals.ts:149-172`, `:323-330`, so no arithmetic neutralization by the phase could hold).
  - No adjustment row is rewritten or removed by the phase, and undo or redo restores such rows like any snapshot (§ 4.2).
  - Alternative: keep accepting and folding them (`lib/calculations.ts:256-259`), which double-counts tax the provider already computed.
- **Document-level discounts.** `discount` adjustments of order scope reduce the tax total only through `metadata.taxRate` today (`lib/calculations.ts:248-255`). Under a configured provider a discount is accepted only when `extractAdjustmentTaxRate` yields no rate for it (a rated discount is refused, above), so it carries no tax portion and the tax total equals the provider's `taxTotalAmount`; the request does not allocate them to lines, so the provider taxes amounts before the document discount. That is a known limitation stated here with numbers (§ 5.4); allocating a document discount to lines before the request is Spec 4a. Under `product-rate` nothing changes.
- Negative `tax` adjustments stay rejected as today (`data/validators.ts:454-457`, `:479-480`).

### 4.9 Exemptions (vocabulary only)

Result lines carry `isExempt?`, `exemptReason?` and `isReverseCharge?`; the document status `exempt` applies when every line is exempt. Tax identifiers travel on the address snapshots (`taxId`, `taxIdType`, the keys the address specification defined, `2026-08-10-address-contact-and-tax-fields.md:11`); exemption facts are the provider package's own fields (§ 4.15); no exemption storage in core, no certificate reference in the record, no checker (`customers/data/entities.ts` has no exemption field). The tax phase never skips a configured provider because of a customer state: a "tax-free" state, once it exists, is an input to the provider.

### 4.10 Units, rounding and the consistency rule

- `taxRate` is in percentage points; the engine keeps 4 decimals (`round`, `lib/calculations.ts:25-27`); the engine writes the provider's amounts verbatim and never re-derives tax from a rate when amounts are given.
- Consistency rule, applied after a structural parse of the result through the exported Zod schema `salesTaxResultSchema` (`data/validators.ts`, additive; `SalesTaxResult` of § 4.3 derives from it with `z.infer`), checked once, in Resolve on the raw result (a violation is the provider's: 502 `provider_invalid_result`, F3): (a) every request line and charge `ref` appears exactly once; (b) every amount is a finite, non-negative number; (c) per line and per charge, `0 ≤ taxableAmount ≤ netAmount` (or `amountNet`), the upper bound within `NET_RECONCILIATION_TOLERANCE` (0.005, `lib/calculations.ts:33`), so a result that taxes a larger base fails; (d) the sum of line tax plus charge tax equals the result's `taxTotalAmount` within the same tolerance; (e) every amount and every rate is representable at the storage scale (amounts at 4 decimals, `data/entities.ts:643`; `effectiveRate` at 4 decimals and below 1000, as `tax_rate` is numeric(7,4), `:640`; a result with more precision fails rather than being rounded silently) and a line or charge with a zero base carries zero tax (persistence would otherwise reconstruct a positive net from the tax, `commands/shared.ts:118-124`, called at `commands/documents.ts:3164`). A violation fails the command: nothing is written and the error body carries the `code` of § 7. `grossAmount = netAmount + taxAmount` is the write rule the phase enforces by construction, not a validation.
- The phase writes the provider's `effectiveRate` into the line result as an additive optional `taxRate` on `SalesLineCalculationResult` (`lib/types.ts:126-133` has no rate field today) when returned, otherwise keeps the input rate, and the command persists it into `tax_rate` with precedence over `parsed.taxRate ?? existingSnapshot?.taxRate` (resolved at `commands/documents.ts:7453`, `:7946`, overridden by the unit conversion at `:7477`, `:7970`, assigned at `:7574`, `:8066`) whenever a provider result was applied; every line, touched or not, is persisted through `convertLineCalculationToEntityInput` (`commands/documents.ts:3157`), which takes `taxRate` from the line input (`:3198`) and the amounts from the result (`:3199-3201`), and under an applied provider result the converter prefers the result's `taxRate` for every line; `tax_amount` always comes from the provider. The stored rate matters for conversion, which re-derives a missing net from the stored gross and `taxRate` (`commands/documents.ts:6863-6865`; `commands/shared.ts:88-101`).
- A gross-entered line (`priceMode: 'gross'`) is taxed on the net the first pass derived from its gross (`lib/calculations.ts:121-125`); the Apply step writes `grossAmount = netAmount + taxAmount` and `unitPriceGross = grossAmount / quantity` (a line with quantity 0, valid today, `data/validators.ts:333`, keeps its entered unit gross; the converter would otherwise keep the entered unit gross for every line, `commands/documents.ts:3191-3195`), so under a provider the entered gross is not preserved. The request carries `priceMode` and `pricesIncludeTax` for the provider's information only; a gross-preserving split is a later specification (Spec 4a, with its line columns).
- Currency precision stays at the engine's 4 decimals; a currency-aware precision is a question for a later specification.

### 4.11 Inputs

- **Addresses.** `shipTo` and `billTo` come from the header snapshots `billing_address_snapshot` (orders `data/entities.ts:367`) and `shipping_address_snapshot` (`:370`; both encrypted, `encryption.ts:8-9`, `:25-26`) through a tolerant mapper that keeps the well-known keys of `SalesTaxAddress` and drops the rest; `SalesDocumentAddress` rows (`data/entities.ts:1855`) are not read, because the address commands never update the header snapshots and never calculate (`commands/documentAddresses.ts`, zero references). `shipFrom` comes from the document's channel address (`SalesChannel`, `data/entities.ts:16`, `:50`, encrypted `encryption.ts:59`), nullable; every read goes through `findOneWithDecryption` with the document's own tenant and organization scope, so the encrypted snapshots (`encryption.ts:8-9`, `:25-26`) and the channel address (`:59`) arrive in clear only in memory. The request lives in memory only.
- **Dates and money.** `taxDate` is the document's `placedAt` when set (`data/entities.ts:415` orders, `:890` quotes), otherwise the time of Resolve, as an ISO date in UTC; a seller time zone is a later specification. `currencyCode` from the document; `exchangeRate` from orders only (`data/entities.ts:376`; quotes have none).
- **Lines.** `ref`, `kind`, ids, `quantity`, post-discount `netAmount` (from the first pass), `taxRate` from the snapshot (it carries no rate id, `lib/types.ts:42-92`, `lib/lineSnapshots.ts:30-72`; a `taxRateId` on the request line is Spec 4a's additive field); `priceMode` from the line input's top-level `priceMode` (`data/validators.ts:340`), which the commands persist into `metadata.priceMode` (`commands/documents.ts:7488`, `:7980`) and the snapshot carries back; `description` from the line. `pricesIncludeTax` is `true` when every line is `gross`, `false` when every line is `net` or unset, `'mixed'` otherwise; create paths never store `priceMode` today, so most API-created documents read as net or unset.
- **Product and customer facts.** `customer.id` is `customerEntityId`; product and variant ids are on the lines. Every other product or customer fact a provider needs is provider-owned and read through `resolve` (§ 4.15); the customer group set is Spec 4a's additive field once `customer_groups` lands. This specification adds no cross-module ORM read (issue #6733, the cross-module data ownership audit).
- **`context.tax` carries the result only.** The engine passes the whole context to every totals hook and to `sales.document.calculate.before/after` (`lib/calculations.ts:412-435`, `:437-448`); the `SalesTaxRequest` never enters the context.

### 4.12 DI and credentials

`resolve` on the provider context is the command's DI container, passed by the Resolve step; `tax_stub` ignores it; Spec 3 registers credential services reachable through it. Credentials are out of scope; no credential, endpoint or account field is added to `sales_settings`. A third-party replacement of the DI service `salesCalculationService` (`di.ts:134-138`) that does not delegate to `salesCalculations` will not run the tax phase; the interface is unchanged, so this is stated, not a break.

### 4.13 Failure policy (Ask First paragraph)

Default: **fail closed**. A provider throw, a timeout, an invalid or inconsistent result, or a configured key that no longer resolves fails the command with a clear error; the transaction never opens or rolls back; nothing is written. `fallback` is the status of Spec 3's `fallback-table` policy and `failed` stays in the vocabulary for the fail-open alternative below; the default state makes no provider call and cannot fail. Trade-off: fail closed blocks document edits of that organization during a provider outage. Alternatives: fail open (write the document with status `failed` and no tax) or fall back to `product-rate` with status `fallback` recorded in `tax_info`, which keeps editing possible but stores tax the provider did not compute. The write-time validation of the key and the error that names the setting are the mitigation for an uninstalled package.

Deadline (proposal, no external source recommends a value): 10 seconds per `calculate` call, enforced by core by racing `provider.calculate` against a 10-second timer that aborts the `signal` passed on the provider context and rejects with `provider_timeout` (the shared `withTimeout` helper alone aborts the signal and awaits the task, `packages/shared/src/lib/http/fetchWithTimeout.ts:62-84`, so by itself it bounds only a provider that honours `signal`; its own default is 15 seconds, `:16`); adapters must honour `signal` and abandon the call; the value equals an in-repository outbound timeout (`packages/core/src/modules/communication_channels/lib/oauth-token.ts:30`); one call per command. Zero automatic retries of `calculate`; adapter-internal transport retries must fit inside the deadline. A provider may throw `SalesTaxProviderError` (§ 4.3) with `code` `invalid_request`, `unavailable`, `rate_limited` or `unauthorized`; any other throw is `unavailable`; the codes select the status, key and message of § 7. Per-organization configuration of the timeout and the policy is Spec 3.

### 4.14 Conversion and public acceptance (Ask First paragraph, Quote → Order flow, `packages/core/src/modules/sales/AGENTS.md:13`; the default changes nothing in the flow, the alternative would)

Default: `sales.quotes.convert_to_order` keeps today's copy semantics unchanged (line amounts, totals and `taxInfo` copied; `tax_strategy_key` stays `null`; no calculation; `commands/documents.ts:6773`, `:6775-6777`, `:6807-6818`, `:6861-6862`); the copied record keeps status `estimated`, and the order's first recalculating write under the provider writes the server key and a `record` result. The key is not carried on conversion because the server cannot tell a server-written quote record from one a client stored on create under `product-rate` (`taxInfo` is accepted verbatim, `data/validators.ts:756`, `commands/documents.ts:5039`), so carrying it would let a forged record become a server-written key once the organization selects that provider. Alternative: carry `tax-provider:<providerKey>` when the current setting names the copied record's `providerKey` — rejected because the server cannot tell a server-written quote record from a client-stored one, `taxInfo` being accepted verbatim on create. The public accept route (`api/quotes/accept/route.ts:33-35`, `requireAuth: false`; lock at `:99`) changes nothing: no provider call runs under those locks or on the unauthenticated path. Honour-versus-re-quote policy is Spec 4b.

### 4.15 Provider-owned facts

The request carries references and the facts the document already holds (§ 4.11). A fact that only a given provider needs — a tax code in the provider's own namespace, an exemption certificate or entity use code, a tax-exempt flag — is declared and owned by the provider package as a custom field (`ce.ts`) or an extension entity (`data/extensions.ts`) on the catalog or customer entity, and read by the provider through the `resolve` of its context (§ 4.3) for the document's `tenantId` and `organizationId`. Core defines no provider-specific field on products or customers and adds no cross-module ORM read (issue #6733); a provider reading its own extension data adds none. A provider-owned field that holds a certificate number or another identifier is declared in that package's `encryption.ts` map and read through `findWithDecryption`, like any other sensitive column. The built-in table provider (Spec 2) is part of core `sales` and owns its fields the same way. The customer group set is Spec 4a's additive request field once `customer_groups` lands. A change to a provider-owned field does not trigger a recalculation; the next recalculating write (§ 4.2) or the explicit recalculate command of Spec 4b re-taxes the document.

### 4.16 Events

Two additive ids in `events.ts`, declared with `createModuleEvents` next to the calculation lifecycle events (`events.ts:82-99`), `category: 'lifecycle'`, `excludeFromTriggers: true`, no `clientBroadcast`, no `portalBroadcast`:

- `sales.tax.document.calculate.before` — emitted by the Resolve step before `provider.calculate`, outside any transaction; payload `{ documentKind, documentId, organizationId, tenantId, providerKey, intent, lines: [{ ref, netAmount }], charges: [{ ref, amountNet }] }`; never addresses, tax ids, the customer snapshot or the raw request.
- `sales.tax.document.calculate.after` — emitted after validation, still outside the transaction; payload adds the status of § 4.7, `taxTotalAmount` and per-`ref` amounts.

Both are notification-only: the payload carries no setter, so a subscriber cannot change the result or the document.

Both are emitted with the document's `tenantId` and `organizationId` in the emission options, the trusted scope the handler context receives (`packages/events/src/bus.ts:430-435`; `packages/events/AGENTS.md:22`), never inferred from the payload. Neither fires without a configured provider. Under a configured provider the existing calculation lifecycle events (`sales.line.calculate.*`, `sales.document.calculate.*`, the shipping and payment adjustment events) fire once per calculation pass, so twice per write, both passes before the transaction; their payloads are unchanged and persistent subscribers must stay idempotent (`packages/events/AGENTS.md`). Both follow the `.before` / `.after` shape of the existing calculation lifecycle events rather than the past-tense rule of the root `AGENTS.md:206`, as `sales.document.calculate.before/after` do (`events.ts:82-83`) (§ 14 point 7 records the alternatives). `sales.document.calculate.after` still runs last inside the engine and can rewrite totals through its `setResult` (`lib/calculations.ts:437-448`), as the overrides guide documents; a rewrite after the phase is persisted as today and the record then describes the provider's result, not the persisted totals (the residual risk of § 12). Subscribers may see results of writes that later roll back, as with the existing calculation events.

### 4.17 The registry (globalThis; module-local `Map` as the recorded alternative)

State on `globalThis` under a stable key (working name `__openMercatoSalesTaxProviderRegistry__`), lazily initialized, following `getPricingRegistryState` (`packages/core/src/modules/catalog/lib/pricing.ts:199-205`) and the lesson for publishable registries; `registerTaxProvider(provider)` trims the key, ignores a blank key, replaces an existing entry with the same key (the documented semantics of the sibling registries, `apps/docs/docs/framework/modules/sales-providers.mdx:107`), and returns an identity-checked disposer keyed by the normalized key (today's shipping and payment disposers delete the untrimmed `provider.key`, `lib/providers/registry.ts:17`, `:27`); `getTaxProvider(key)`, `listTaxProviders()`, and a test-only `resetTaxProviders()` following `resetCatalogPricingResolvers` (`packages/core/src/modules/catalog/lib/pricing.ts:229-231`). The shipping and payment registries (`lib/providers/registry.ts:6-7`, module-local `Map`s) are untouched; moving all three is offered as a follow-up.

### Commands & Events

- Commands: none added. `sales.settings.save` gains an optional input field. Resolve and Apply run inside the existing recalculating commands: `sales.quotes.create`, `sales.orders.create`, `sales.quotes.update`, `sales.orders.update`, `sales.orders.lines.upsert`, `sales.orders.lines.delete`, `sales.quotes.lines.upsert`, `sales.quotes.lines.delete`, `sales.orders.adjustments.upsert`, `sales.orders.adjustments.delete`, `sales.quotes.adjustments.upsert`, `sales.quotes.adjustments.delete` (call sites `commands/documents.ts:5191`, `:6259`, `:5610`, `:5873`, `:7639`, `:7818`, `:8131`, `:8282`, `:8510`, `:8559`, `:8722`, `:8963`, `:9011`, `:9173`). No provider call in conversion, public acceptance, `sales.returns.create`, `sales.returns.delete`, `recalculateOrderTotalsForDisplay`, undo, returns, invoices, credit memos, document deletes or the seed (`seed/examples.ts:1344`, `:1562` keep today's totals under `product-rate`).
- Events: `sales.tax.document.calculate.before`, `sales.tax.document.calculate.after` (new, § 4.16); `sales.tax.calculate.before/after` (`events.ts:90-91`), `sales.document.calculate.before/after` (`:82-83`), `sales.document.totals.calculated` (`:81`) untouched.

---

## 5) Worked examples

Rates, jurisdictions and dates are illustrative. Engine figures follow the formulas of `lib/calculations.ts` at head (4-decimal rounding); provider figures round half-up from the third decimal. Illustrative jurisdiction set for ship-to "State A": state `ST-A` 6.000, county `CO-A1` 1.000, city `CI-A1` 1.500, special `SP-A1` 0.375, combined 8.875 (percentage points).

### 5.1 `product-rate` pass-through (acceptance test 1)

Order, USD, no provider configured. L1: quantity 3 × 19.99, `taxRate` 23. L2: quantity 2 × 8.1235, `taxRate` 8.

| ref | net | tax (raw → engine) | gross |
|---|---|---|---|
| L1 | 59.9700 | 13.7931 → 13.7931 | 73.7631 |
| L2 | 16.2470 | 1.29976 → 1.2998 | 17.5468 |
| document | 76.2170 | 15.0929 | 91.3099 |

Nothing changes: no `tax_info`, no tax-provider events (the existing calculation lifecycle events fire once), one pass; `tax_strategy_key` and `tax_info` keep what the create path stored. A gross-priced line (quantity 3, `unitPriceGross` 24.99, rate 23) gives net 60.9512, tax 14.0188, gross 74.9700 through the engine's gross path (`lib/calculations.ts:121-125`); the byte-for-byte fixtures include such a line.

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
| Stated limitation: a percentage discount | the same, with the discount entered as 10 % (no rate on the row): the engine resolves it before the hooks to net 30.00 and gross 32.6625 (`lib/calculations.ts:57`, `:62-71`, `:224`, `:404`) | 15.98 + 10.65 = 26.63 | 293.9675 | the tax total stays the provider's; the gross is 2.6625 below net plus tax (296.63) because the discount's gross carries its own tax share; allocation (Spec 4a) removes it |

### 5.5 A shipping charge taxed in one state and not in another

L1 1 × 100.00; shipping through the built-in `flat-rate` provider, net 15.00 (its adjustments carry `metadata: { providerKey, rate }` and no `taxRate`, `lib/providers/defaultProviders.ts:270`, `:281`, `:291`).

| Case | charge tax | `amountGross` | `metadata.taxRate` | document tax | gross |
|---|---|---|---|---|---|
| State A, single rate 6.000, freight taxable | 0.90 | 15.90 | 6 | 6.90 | 121.90 |
| State B, single rate 7.000, separately stated freight not taxable | 0.00 | 15.00 | 0 | 7.00 | 122.00 |

The charge enters the request with `ref` `shipping-provider:flat-rate@10000`; the Apply step merges `taxRate` into the existing metadata. Today a method whose base gross exceeds its net without `metadata.taxRate` puts the difference into the grand gross but not into `taxTotalAmount`; the rule above makes charge tax visible to the total. A cash-on-delivery fee of 2 % computed after the phase sees 121.90, not 121.00. On a pass without `context.tax` (a return on this order, or a pass after switching back to `product-rate`) the regenerated `flat-rate` charge is untaxed and the document tax drops from 6.90 to 6.00 until the next provider write or Spec 4b's recalculation (§ 4.8, F14).

### 5.6 Line-level versus document-level rounding

Three lines of 10.10 at 8.875. Line-level rounding: 0.90 + 0.90 + 0.90 = 2.70, gross 33.00. Document-level rounding: 30.30 × 8.875 % = 2.689125 → 2.69, with one line carrying 0.89 (which line is the provider's choice), gross 32.99. Today's engine stores 0.8964 per line and 2.6892 in total. The result's `taxTotalAmount` decides: a result whose lines sum to 2.70 while it declares 2.69 fails the consistency rule; a result with lines 0.90, 0.90, 0.89 and total 2.69 is stored exactly.

### 5.7 Returns and credit memos (this specification's position)

Order placed 2026-06-15, L1 2 × 50.00, tax 8.88 at the original 8.875; a city rate change on 2026-07-01 raises the combined rate to 9.125; one unit returned on 2026-08-10. Today `sales.returns.create` derives the return line's unit gross from the stored line totals (`commands/returns.ts:673-677`) and writes a `return` adjustment (`:697-713`), so the tax goes back implicitly at 4.44 (half of 8.88), and the return loop moves only the subtotals, never `taxTotalAmount` (`lib/calculations.ts:300-308`). Credit memos store the caller's amounts (`commands/documents.ts:9931`, `:9971-9972`) and have no `tax_info` column. This specification changes none of that and calls no provider on these paths; a provider-side return at the original tax date, with negative amounts and a reference to the original document, is Spec 4b (platform rules) and Spec 3 (provider lifecycle). The contract only avoids blocking it: `documentKind` already has `credit_memo`; `taxDate` can differ from the document date; `documentNumber` is carried.

### 5.8 A stale result after an address change

Order under a provider, ship-to State A: L1 2 × 100.00 tax 17.75, L2 1 × 100.00 tax 8.88, total 26.63, record `calculated`. The ship-to changes to State B (single rate 6.000) through `sales.orders.update` with a new shipping address snapshot: nothing recalculates (`shouldRecalculateTotals`, `commands/documents.ts:5797-5804`; an edit through the document-address commands changes the separate address rows only, `commands/documentAddresses.ts:275`, which the request never reads, § 4.11, so after such an edit the next write still taxes State A), so the amounts stay at 26.63 and the record still says `calculated` although its inputs no longer describe the document. The user then changes L2's quantity to 2 through `sales.orders.lines.upsert`: Resolve builds the request from the future state (State B, quantity 2) and the provider returns 12.00 + 12.00; Apply reads the order's `updated_at` again, fresh, before the transaction opens; unchanged, the document becomes net 400.00, tax 24.00, gross 424.00, `calculated` with a new provenance record. If a concurrent writer commits to the order between Resolve and that read, the version has moved and the update fails closed with 409 `inputs_changed`; nothing is written and the user reloads and saves again. Two distinct things are therefore named: (i) the silent case after the address change, where nothing recalculates until Spec 4b and the record's status does not change (Spec 4b's trigger-based staleness, for which `stale` is reserved); (ii) the racing-writer case, which this specification refuses with 409 instead of committing amounts the provider computed for a document another writer has since changed.

---

## 6) Data Models

No new entity. Changes:

- **`SalesSettings`** (`data/entities.ts:755`): one new property `taxProviderKey?: string | null` on the column `tax_provider_key` (`text`, nullable, no default). Migration `sales/migrations/Migration<YYYYMMDDHHMMSS>_sales_settings_tax_provider_key.ts` with `up()`: `alter table "sales_settings" add column "tax_provider_key" text null;` and `down()`: `alter table "sales_settings" drop column "tax_provider_key";`, the pair of the precedent `migrations/Migration20251126125305.ts:5-11`; no backfill (`NULL` is `product-rate`); `migrations/.snapshot-open-mercato.json` updated in the same commit (`packages/core/AGENTS.md:188`). Not sensitive: `sales_settings` is absent from `encryption.ts`.
- **Adjustment rows** (`SalesOrderAdjustment`, `SalesQuoteAdjustment`): no schema change; existing `tax`-kind, discount and credit rows are never rewritten or removed (a `tax`-kind row or a rated discount makes the write fail closed under a provider, § 4.8); charge rows that enter the request receive the provider's gross and `metadata.taxRate` on Apply.
- **`SalesOrder.tax_strategy_key`** (`data/entities.ts:397`), **`SalesOrder.tax_info`** (`:403`), **`SalesQuote.tax_info`** (`:896`): no schema change; the content of `tax_info` under a provider is the provenance record below, versioned, additive only (later keys are added, never removed); the provider key is limited to 100 characters (§ 7), so the written `tax-provider:<key>` stays within the 120 characters the create validator enforces on client input (`data/validators.ts:703`).
- **Provenance record** (`tax_info` when a provider ran):

```json
{
  "version": 1,
  "providerKey": "example-provider",
  "intent": "record",
  "status": "calculated",
  "providerReference": "<provider document id or null>",
  "calculatedAt": "2026-10-01T12:00:00.000Z",
  "lines": [ { "ref": "<line id>", "taxableAmount": 249.99, "taxAmount": 22.19, "effectiveRate": 8.8764, "jurisdictions": [ { "level": "state", "code": "ST-A", "name": "State A", "rate": 6.0, "taxableAmount": 249.99, "taxAmount": 15.00 }, "…" ] } ],
  "charges": []
}
```

The record never carries addresses, names, e-mail addresses, tax ids, the request, the raw provider response or credentials; The jurisdiction list names tax jurisdictions (the code and name of a state, county, city or district), not a person: it says where tax is due, carries no street, name or identifier, and the same codes apply to every buyer in that area, so `tax_info` stays outside the sales encryption map; adding `{ field: 'tax_info' }` to the order and quote entries of `encryption.ts` is the recorded alternative (§ 14) for a maintainer who reads the codes as personal data (it would apply only when tenant encryption is enabled, and it cannot replace the content rule). The record travels inside the encrypted action-log snapshots of document commands (`packages/core/src/modules/audit_logs/encryption.ts:4-15`).
- **Line columns.** `tax_rate` and `tax_amount` on order and quote lines (`data/entities.ts:640`, `:643`, `:1085`, `:1088`) receive the provider's amounts, and `unit_price_gross` (`:631`, `:1076`) follows the written gross (§ 4.10); nothing else changes; per-line detail columns are Spec 4a.
- **Types.** The exported types of § 4.3 are new names (zero hits at head for `TaxProvider`, `registerTaxProvider`, `SalesTaxRequest`, `SalesTaxResult`, `SalesTaxContext`, `SalesTaxProviderError`, `salesSettingsUpsertWithTaxProviderSchema`, `product-rate`, `tax-provider:`); `SalesCalculationContext` gains `tax?`. No data-model graph is generated (no entity added).

---

## 7) API Contracts

### `GET` / `PUT /api/sales/settings/tax-provider` (new; file `api/settings/tax-provider/route.ts`)

- `metadata`: `GET: { requireAuth: true, requireFeatures: ['sales.settings.manage'] }`, `PUT: { requireAuth: true, requireFeatures: ['sales.settings.manage'] }` (the shape of `api/settings/order-editing/route.ts:27-30`); `openApi` exported.
- Organization: `resolveOrganizationScopeForRequest`, then `scope?.selectedId ?? auth.orgId`; 400 when no organization resolves (as the sibling routes, `api/settings/order-editing/route.ts:48-54`); § 4.4).
- `GET` response: `{ taxProviderKey: string | null, providers: Array<{ key: string; label: string; description?: string }> }` from `loadSalesSettings` and `listTaxProviders()` (registered providers only; server-side registry, so a provider registered only on the server is listed).
- `PUT` request: `{ taxProviderKey: string | null }` (new exported schema `salesTaxProviderSettingsSchema`, `z.string().trim().max(100).nullable()`).
  - `null` selects the default state; an unregistered key → 422 `sales.tax.errors.provider_not_registered`; `withScopedPayload`.
  - Mutation guards through `runRouteMutationGuards({ container, req, auth: { userId: auth.sub, tenantId, organizationId }, input: { resourceKind: 'sales.settings', resourceId: organizationId, operation: 'update', mutationPayload } })` from `@open-mercato/shared/lib/crud/route-mutation-guard` (`packages/shared/src/lib/crud/route-mutation-guard.ts:119`; `RouteMutationGuardAuth` requires `userId` and `tenantId`, `:28-39`, and the sibling route maps `ctx.auth.sub` the same way, `api/settings/order-editing/route.ts:130-139`; `organizationId` is the resolved selection), which runs every registry guard plus the bridged legacy guard (`packages/shared/src/lib/crud/route-mutation-guard.ts:12-24`): return its `errorBody` and `errorStatus` when blocked, merge `modifiedPayload` into the validated input, and call its `runAfterSuccess()` after the command.
  - The sibling settings routes still use the deprecated pair `validateCrudMutationGuard` / `runCrudMutationGuardAfterSuccess` (`api/settings/order-editing/route.ts:130`, `:159`), which resolves only the DI-registered guard service and skips the registry guards (`packages/shared/src/lib/crud/mutation-guard.ts:48-49`, `:67`), so that pair is not copied.
  - Executes `sales.settings.save` with the current number formats and editable-status lists passed unchanged (the sibling route's constants when no row exists, § 4.4) and `taxProviderKey`, through `salesSettingsUpsertWithTaxProviderSchema` (§ 4.4); response as `GET`.
- Errors: 401 unauthenticated; 403 with `requiredFeatures` containing `sales.settings.manage`; 400 no organization; 422 as above. All messages through i18n keys `sales.tax.errors.*` (illustrative values below).

### Document routes

`POST`/`PUT /api/sales/orders`, `/quotes`, the line and adjustment routes: no URL, method, request or response change. Create still accepts `taxStrategyKey` (orders) and `taxInfo` (orders, quotes). Error bodies that a provider failure adds (proposal, with in-repository status precedents: 422 for an unregistered adapter at use time, `packages/core/src/modules/payment_gateways/lib/gateway-service.ts:187-197`; 502 for an upstream provider error, `packages/checkout/src/modules/checkout/api/pay/[slug]/submit/route.ts:521`; 409 for optimistic-lock conflicts, `packages/shared/src/lib/crud/optimistic-lock-command.ts:14-24`):

| Reason | Status | Key (proposed) | Message (illustrative) |
|---|---|---|---|
| provider `unavailable`, `rate_limited`, timeout | 503 (alternative 502 / 504) | `sales.tax.errors.provider_unavailable`, `provider_timeout` | "Tax could not be calculated: the tax provider is not available. Try again later." |
| provider `unauthorized` (credentials rejected) | 503 (alternative 502) | `sales.tax.errors.provider_unavailable` | same message; the log line and the error report carry the code |
| provider `invalid_request` | 422 (alternative 502) | `sales.tax.errors.provider_rejected` | "The tax provider rejected the document: `<code>`." |
| inconsistent or malformed result (F3–F5) | 502 (alternative 422) | `sales.tax.errors.provider_invalid_result` | "The tax provider returned an inconsistent result." |
| configured key not registered (F8) | 422 (alternative 503) | `sales.tax.errors.provider_not_registered` | "Tax provider `<key>` is not available. Ask an administrator to check the sales tax settings." |
| the document's version or the setting's provider key moved between Resolve and the fresh read (F9) | 409 | `sales.tax.errors.inputs_changed` | "The document changed while tax was being calculated. Reload and save again." |
| `tax`-kind adjustment or rated discount, new in the write or stored on the document, under a provider (§ 4.8, F6) | 400 | `sales.tax.errors.unsupported_adjustment` | "Remove the manual tax adjustment or clear the tax rate on the discount before saving under a tax provider." |

Error shape: the commands throw `CrudHttpError(status, body)` (`commands/documents.ts:19`, `:1128`), which `makeCrudRoute` maps to the response (`packages/shared/src/lib/crud/factory.ts:640-642`); the body is `{ error: <translated message>, code: 'sales.tax.<reason>', providerKey }` with `reason` one of `provider_unavailable`, `provider_timeout`, `provider_rejected`, `provider_invalid_result`, `provider_not_registered`, `inputs_changed`, `unsupported_adjustment`, so clients branch on `code` as they do on `optimistic_lock_conflict` (`inputs_changed` is a distinct code, not an optimistic-lock conflict); the affected routes (document create and update, whose `openApi` is `buildDocumentOpenApi`, `api/documents/factory.ts:623`, exported at `api/orders/route.ts:25` and `api/quotes/route.ts:25`; the line routes of `lib/makeSalesLineRoute.ts:239`, `:255`, `:270`, `openApi` at `:333`; the adjustment routes `api/order-adjustments/route.ts:162`, `openApi` at `:184`, and the quote equivalent, `api/quote-adjustments/route.ts:182`) declare these responses in their `openApi` (§ 10).

### Events

Payloads of § 4.16. The existing `sales.document.totals.calculated` (`events.ts:81`; emitted at `commands/documents.ts:3034-3048`) keeps its payload; provenance is not added to it in this specification.

---

## Configuration

- `sales_settings.tax_provider_key` per organization, written through the route of § 7; `NULL` (or a missing row) means `product-rate`. No new environment variable (the existing test-mode switch `OM_TEST_MODE=1` registers the `tax_stub` provider of § 17 and nothing else here), no per-channel or per-destination scope, no provider settings and no credentials in this specification (Spec 3 adds them through `integrations`).
- The 10-second deadline of § 4.13 is a code constant in this specification; Spec 3 decides whether it becomes configurable.

## Internationalization (i18n)

- Error keys (proposed): `sales.tax.errors.provider_unavailable`, `sales.tax.errors.provider_timeout`, `sales.tax.errors.provider_rejected`, `sales.tax.errors.provider_invalid_result`, `sales.tax.errors.provider_not_registered`, `sales.tax.errors.inputs_changed`, `sales.tax.errors.unsupported_adjustment`.
- Audit label `sales.audit.settings.taxProviderChanged`; no other settings labels (no UI in this specification, § 19).
- All keys in the five locales (`de`, `en`, `es`, `ko`, `pl`); `yarn i18n:check-sync` and `yarn i18n:check-usage` run in the gate; the existing key `sales.documents.history.fields.taxInfo` stays.

---

## 8) Security model

- **ACL.** Feature ids are FROZEN and additive (`BACKWARD_COMPATIBILITY.md:216-222`); the setting reuses `sales.settings.manage` (`acl.ts:112`, `dependsOn` `sales.settings.view` `:115`). `dependsOn` (`acl.ts:8`, `:44`, `:115`) is role-editor metadata applied when a role is edited (`packages/shared/src/security/aclDependencies.ts:60`, `:78`; `packages/core/src/modules/auth/api/features.ts:39-45`), not a runtime grant, so nothing here assumes which roles hold `sales.settings.view`; no settings route accepts it alone; the provider key itself is not a secret (it appears in `tax_info` and the document history), so a read-only exposure of the active key to `sales.settings.view` is the alternative to the default (`manage` for `GET`).
- **Scoping.** The setting is read for the document's own `tenantId` and `organizationId` (§ 4.4); the command checks `ensureTenantScope` and `ensureOrganizationScope` (`commands/settings.ts:53-54`); the request carries the document's scope; the registry holds code, never tenant data.
- **Who can trigger a provider call.** Any principal holding `sales.quotes.manage` or `sales.orders.manage`, directly or through the warranty replacement order (`packages/core/src/modules/warranty_claims/api/replacement-order/route.ts:57-58`), inbox actions (`inbox-actions.ts:297`, `:312`, `:320`), the workflow safe command `sales.orders.update` (`workflows.ts:10-23`), the AI assistant's Code Mode tools and API-key clients (they call the same routes over HTTP, `packages/ai-assistant/src/modules/ai_assistant/lib/codemode-tools.ts:808`, `:834-839`), and any holder of `audit_logs.redo_self` who redoes a document command. No unauthenticated route reaches a command that calculates totals: the accept route converts by copy (§ 4.14) and the checkout package writes no sales document.
- **Provider-call amplification.** One provider call per recalculating write; inbox actions, workflow steps, Code Mode and redo add calls on behalf of the principal; this specification sets no throttle and names the quota and cost risk; the per-endpoint rate limiter the accept route uses (`api/quotes/accept/route.ts:37-42`; `packages/shared/src/lib/ratelimit/config.ts:39-49`) is the in-repository option for Spec 3.
- **PII.** The request carries addresses and tax ids from encrypted snapshots in memory only; `tax_info` stores none of them (§ 6); `context.tax` carries the result only (§ 4.11); event payloads carry ids, refs and amounts only (§ 4.16). The public quote view (`api/quotes/public/[token]/route.ts:26-28`) returns `taxTotalAmount` and line amounts and gains no `tax_info`. A provider resolves services with the rights of in-process module code and reads only data scoped to the request's tenant and organization.
- **Logging rule (contract sentence).** Core and provider adapters must not log the `SalesTaxRequest`, the provider's raw request or response, addresses, tax ids or credentials at any level enabled by default; on failure they log the provider key, document kind and id, organization id, status, reason code and the provider's error code only, and report the failure once through `getTelemetryRuntime()?.reportError(error, { module: 'sales', code })` (`packages/shared/src/lib/telemetry/runtime.ts:47`, `:101`) with the `code` of the error body (`sales.tax.<reason>`, § 7), the ids as attributes and never request data, because a catch that records an error must also report it (`apps/docs/docs/framework/runtime/error-reporting.mdx:14`, `:16`); an adapter that wraps an SDK error strips request data before rethrowing. Reason: the shared logger has no redaction and forwards every line to a registered logger extension (`packages/shared/src/lib/logger/index.ts:52-62`). Raw request and response retention with its own retention period and access rights is Spec 3.
- **Secrets.** None stored by this specification; credentials live in `integrations` from Spec 3 on.

---

## 9) Edge Cases & Failure Scenarios

| # | Trigger | Where detected | Persisted state | User-visible effect | Recovery |
|---|---|---|---|---|---|
| F1 | Provider throws (`SalesTaxProviderError` or any other error), including a failure of a service the provider resolves | Resolve, around `calculate` | unchanged; no document on create (the claimed number is lost, as for any create that fails after claiming it: `nextval`, `services/salesDocumentNumberGenerator.ts:243`, no release API) | 503 / 422 per § 7 | retry; switch the setting to `product-rate` |
| F2 | Provider times out (10 s) | Resolve deadline | unchanged | 503 `provider_timeout` | retry; no automatic retry |
| F3 | Result breaks the consistency rule of § 4.10 (taxable base, total, or a missing or duplicated `ref`) | result validation in Resolve | unchanged | 502 `provider_invalid_result` | adapter fix |
| F4 | Result names an unknown `ref`, misses one, or duplicates one | result validation | unchanged | as F3 | as F3 |
| F5 | Negative or non-finite amounts | result validation | unchanged | as F3 | as F3 |
| F6 | The document carries a `tax`-kind adjustment or a rated discount, new in the write or stored, while a provider is configured | Resolve, before the provider call (§ 4.8) | unchanged | 400 `unsupported_adjustment` | remove the row or clear the rate |
| F7 | Admin saves an unregistered key | settings route (write time) | setting unchanged | 422 `provider_not_registered` | install the package or choose another key |
| F8 | Setting names a key that no longer resolves (deploy without the package) | Resolve, provider lookup | unchanged; every recalculating write of that organization fails until fixed (workflow steps, inbox actions and warranty replacement orders too) | 422 `provider_not_registered` | restore the package or clear the setting |
| F9 | The document's `updated_at` or the setting's provider key moved between Resolve and the fresh read before the second pass | Apply, before the flush opens (nothing flushed) | unchanged (a create has no document version; the setting read applies to it) | 409 `inputs_changed`; the client reloads and saves again | the next attempt; a manual recalculate command is Spec 4b |
| F10 | Concurrent writes on the same document | optimistic check only when the client sends the header (`packages/shared/src/lib/crud/optimistic-lock-command.ts:14-24`; `OM_OPTIMISTIC_LOCK` default on) | last header flush wins (issue #6463, parallel line writes, reproduces header and line drift) | with the header, 409 for the loser when its check runs after the winner's commit; two checks before either commit both pass, as for every sales write today (the check at `commands/documents.ts:7427` precedes the transaction at `:7654`); without the header, no error; the version check of § 4.2 also reads before the transaction and adds no serialization | inherit issue #6463; recommend the header to API clients; a `PESSIMISTIC_WRITE` on the document row at the start of Apply is the alternative |
| F11 | Undo of a write that carried provenance | undo handler; staleness guard (`commands/documents.ts:4072-4085`, `:4517-4545`) | snapshot restored: amounts and provenance together | existing undo messages | next recalculating write applies the current setting |
| F12 | Redo of a document command | the bus re-runs `execute` | as a normal write | as F1–F9 | as the original command |
| F13 | Document created before any setting existed | the setting read: default state, no Resolve | no record from the phase | none | the first recalculating write after a provider is configured calls the provider for that document too |
| F14 | Setting switched back to `product-rate` | the setting read: default state, no Resolve | stored line tax kept by the line carry-over; regenerated charges untaxed from the next recalculating write (§ 4.8, § 5.5); the old record stays (§ 4.5) | the document's charge tax drops on that write | the next provider write or Spec 4b's recalculation |
| F15 | Externally taxed amounts document | not at head (§ 4.6) | — | — | coordinate with the author of the open implementation |
| F16 | Transaction aborts after a successful Resolve for another reason (custom fields, guard, database) | any later flush phase | unchanged | the other failure's message | retry; the provider is called again (safe: `calculate` has no provider-side effect) |
| F17 | Provider rate-limits | adapter maps to `rate_limited` | unchanged | 503 | retry later |
| F18 | Settings read fails | Resolve or Apply | unchanged | today's generic command error | as today |
| F19 | Provider down while a customer accepts a quote | no provider call on the accept route | order created from the copied quote amounts | none | none needed |
| F20 | Organization has no `sales_settings` row | `loadSalesSettings` returns `null` | `product-rate` | none | none needed |
| F21 | Provider result applies to a gross-entered line | Apply | net kept (the first pass derived it from the gross), gross = net + provider tax and the unit gross follows (§ 4.10) | the line's gross can differ from the entered gross | a gross-preserving split is a later specification |

A failure inside the flush, after Apply (F16), persists nothing (`withAtomicFlush` rolls back every phase, `packages/shared/src/lib/commands/flush.ts:119-156`, `:172-183`); the events already emitted in Resolve are not rolled back.

---

## 10) Migration & Backward Compatibility

Every surface changes additively, checked against the 14 categories of `BACKWARD_COMPATIBILITY.md`; nothing follows the Deprecation Protocol (`BACKWARD_COMPATIBILITY.md:7-11`).

| Surface | Change | Classification |
|---|---|---|
| §1 `data/validators.ts` (`BACKWARD_COMPATIBILITY.md:53`: "MUST NOT remove or narrow existing schemas") | every existing schema unchanged, `salesSettingsUpsertSchema` included; `taxStrategyKey` and `taxInfo` stay accepted; three new exported schemas, `salesSettingsUpsertWithTaxProviderSchema` (§ 4.4), `salesTaxProviderSettingsSchema` (§ 7) and `salesTaxResultSchema` (§ 4.10) | ✓ ADDITIVE |
| §1 `events.ts`, `acl.ts`, `di.ts`, `index.ts` | two new event entries; `di.ts` registers the test-only `tax_stub` provider only under `OM_TEST_MODE=1` (no DI key); no ACL or module metadata change | ✓ ADDITIVE |
| §2 Type Definitions (`BACKWARD_COMPATIBILITY.md:71`) | optional `tax?: SalesTaxContext` on `SalesCalculationContext`; optional `taxRate` on `SalesLineCalculationResult`; optional nullable `taxProviderKey` on `SalesSettings`; new exported types, `SalesTaxProviderError` among them (§ 4.3); nothing removed or narrowed; `TaxProvider` declares no reserved members, so later optional methods are additive | ✓ ADDITIVE |
| §3 Function Signatures (`BACKWARD_COMPATIBILITY.md:115`) | unchanged under Option B; under the fallback Option A `registerSalesTotalsCalculator` gains optional `{ id?, phase? }` and un-phased hooks keep their position; `registerTaxProvider`, `getTaxProvider`, `listTaxProviders`, `resetTaxProviders` are new; `extractAdjustmentTaxRate` and `NET_RECONCILIATION_TOLERANCE` gain exports from `lib/calculations.ts` (`lib/calculations.ts:33`, `lib/calculations.ts:35`, private today; additive); `ensureProviderTotalsCalculator` keeps its name, idempotency, events and manual-override handling | ✓ ADDITIVE |
| §4 Import Paths (`BACKWARD_COMPATIBILITY.md:157`) | nothing moves; the `lib/providers` barrel gains the tax exports (§ 4.3); the request builder and the Resolve helper are command-layer files; the documented spellings of `lib/calculations` keep resolving | ✓ ADDITIVE |
| §5 Event IDs (`BACKWARD_COMPATIBILITY.md:159-167`, FROZEN) | `sales.tax.document.calculate.before` / `.after` added (notification-only); `sales.tax.calculate.*`, `sales.document.calculate.*`, `sales.line.calculate.*`, the shipping and payment adjustment events and `sales.document.totals.calculated` keep ids, emit points and payloads; under a configured provider they fire once per calculation pass (two passes per write, § 4.2) | ✓ ADDITIVE |
| §6 Widget Injection Spot IDs | unchanged; no UI | — |
| §7 API Route URLs (`BACKWARD_COMPATIBILITY.md:187-189`) | one new route; existing routes and response schemas unchanged; the list and detail field set (`api/documents/factory.ts:387-424`) gains nothing; the document, line and adjustment routes declare the error responses of § 7 in `openApi`, and the OpenAPI description of `taxStrategyKey` / `taxInfo` states the overwrite rule | ✓ ADDITIVE |
| §8 Database Schema (`BACKWARD_COMPATIBILITY.md:197`, `BACKWARD_COMPATIBILITY.md:201`, ADDITIVE-ONLY) | one nullable column on `sales_settings` with `down()`; no backfill; no document or line table change; snapshot updated in the same commit | ✓ ADDITIVE (NULL default; existing rows read as `product-rate`) |
| §9 DI Service Names (`BACKWARD_COMPATIBILITY.md:212-213`) | no key added, renamed or changed; `salesCalculationService` and `taxCalculationService` keep their interfaces | — |
| §10 ACL Feature IDs (`BACKWARD_COMPATIBILITY.md:220-222`, FROZEN) | `sales.settings.manage` reused; no new id (the narrower id is the alternative) | — |
| §11–§13 | no notification type, AI identifier or CLI command change | — |
| §14 Generated File Contracts (`BACKWARD_COMPATIBILITY.md:274`, `BACKWARD_COMPATIBILITY.md:278`) | the generated module registry gains one API route (`modules.generated.ts`, `packages/core/AGENTS.md:646`), the OpenAPI document and the events registry gain entries; no ACL entry; no generator or export name change | ✓ ADDITIVE |

**Migration path for existing tenants and modules:** run the migration; no data changes; an organization that does nothing keeps `NULL` and calculates exactly as today, with the existing engine fixtures as the proof; a module that replaces `salesCalculationService` without delegating to `salesCalculations` skips the phase (stated, not a break). Under a configured provider a document with a `tax`-kind row or a rated discount is refused until the row is fixed (§ 4.8); other adjustment rows stay as entered; charge rows receive the provider's gross and tax metadata.

**Client-supplied `taxStrategyKey` and `taxInfo`.** No request is rejected and no schema is narrowed. Today these values are stored verbatim on create and nothing reads them. After this change they are provenance written by the server: when the organization's sales settings name a tax provider and that provider calculates the document, the server writes `tax_strategy_key` (orders) and `tax_info` (orders and quotes) from the result and overwrites any value the caller sent; the server never reads a caller-supplied value to choose or compute tax; when no provider is configured the server writes neither field, so a caller-supplied value is stored exactly as before. No deprecation marker and no warning are added in this specification (§ 4.4); the payment-ledger precedent's marker is the alternative a maintainer may ask for. **Migration:** stop sending `taxStrategyKey` and `taxInfo`; configure the provider in the organization's sales settings; read provenance from the stored document. Rollback needs no data migration.

**`UPGRADE_NOTES.md`.** Nothing for this spec-only PR. The implementation PR adds one entry under the then-open window, in the file's existing shape (a level-3 heading ending with the PR number, prose, then `**Action for operators:**` and `**Action for module authors:**` lines): the new nullable setting, the byte-identical default, the provenance semantics of `tax_strategy_key` and `tax_info`, the line columns a provider overwrites (`tax_rate` takes the provider's `effectiveRate`, `unit_price_gross` follows the written gross, § 4.10), and the rule for totals calculators under the chosen option. The entry also states that under a configured provider the calculation lifecycle events fire once per pass (two passes per write) and that adjustment rows are never rewritten or removed by the phase. It also names the overwrite of client-supplied `taxStrategyKey` / `taxInfo` when a provider runs and the new error codes on the document routes, and the same PR adds a dated entry to `BACKWARD_COMPATIBILITY.md` for that changed value semantics, in the shape of its dated field entries (`BACKWARD_COMPATIBILITY.md:98-106`).

---

## 11) Parallel work

States read on 2026-10-03 with read-only tracker queries; none is a base or a dependency.

| Ref | Relationship to this specification |
|---|---|
| #6092 feat(sales): the opt-in external amounts mode for mirrored orders (open; base `develop`) | Edits `lib/calculations.ts`, `lib/providers/totals.ts`, `commands/documents.ts`, `lib/types.ts`, entities, validators and the migration snapshot; § 4.6 names one guard point, inside the provider totals calculator where the shipping and payment steps would also be skipped, so the tax phase and that mode share it; whichever change lands first, the other rebases on it. |
| #6184 perf(sales): write a whole order line set in one aggregate load (open; base `main`) | Rewrites the single line upsert and adds a bulk path; the stored-tax rule (`commands/documents.ts:7575`, `:8067`) is cited from `develop`; Spec 4b owns the carry-over fix; coordinate about the same rule in the bulk path and the merge order with #6146 (sales, `lineNumber` as a target position on upsert). |
| #6255 fix(sales): refresh the query index after customFields update (open); #6833 fix(sales): stale undo (merged at this head) | Same functions as the update commands; undo behaviour is cited from this head only. |
| Issues #6461 (sales: line editor resets an API-created line's tax rate; fix #6815 open), #6075 (sales: quote line dialog sole variant; fix #6637 open), #5853 (sales: caller-supplied `totalGrossAmount` reconciliation), #6459 (sales: quantity change leaves gross stale), #6463 (sales: parallel line writes) | Defects on the write paths this specification uses; `product-rate` reproduces today's results including these; F10 inherits #6463; under a provider the stored rate takes the provider's `effectiveRate` whatever the editor sends (§ 4.10), coordinated with #6815. |
| Issue #6733 Fix: cross-module data ownership violations (open; priority-high) | Reason for § 4.11 and § 4.15: no new read of `customers` or `catalog` entities; a provider reads its own extension data through `resolve`. |
| #6168 docs(tax-management): core framework `tax_management` + `financial_pl` (open; base `main`); official-modules #55 (`financial_pl`, open) | Period-level work; names reserved (the roadmap's § 9: `TaxCode`, `ITaxEngine`, `taxEngineRegistry`, `TaxLiabilityRecord`, `tax_management`); the per-rate and per-jurisdiction breakdown this record stores is `sales` output the period engine can read. |
| #6709 feat: ecomm Release 2 — availability contract + customer groups (open; no file under `sales/`); issue #6414 (sales: tax-rate CrudForm `entityId`) | the group set is Spec 4a's request field; `sales_tax_rates.customer_group_id` is read as a plain nullable UUID without a foreign key (Spec 2), coordinated with that work. |
| #6346 docs(specs): assisted selling and the cart proposal seam (open) | `display` never calls a remote provider; the cart integration is 6a; a proposal cart copies the target's `tax_mode` and tax uses the target buyer's facts (roadmap § 11). |
| #6743 (sales, split-payment balances), #6255 and #5615 (sales, order-detail feature-gated affordances) each add a `TC-SALES-042-*` spec file although 042 is taken on `develop` | Numbering race for the integration ids of § 17; the implementation PR re-runs the id check and renumbers if needed. |

---

The roadmap's Spec 1b (the Resolve service for callers that are not `sales` commands) wraps the helper of § 4.2 and adds no Resolve of its own.

---

## 12) Risks & Impact Review

**Data integrity.** The provider result is applied after the fresh read of the document version, before the transaction opens (§ 4.2); a failed consistency check or a provider failure writes nothing; the version check guards one write against a document that moved during Resolve, not against two writers (F10). **Cascading effects.** The engine stays deterministic (no provider call inside it), so equal inputs give equal totals in every touchpoint; a `sales.document.calculate.after` subscriber can still rewrite totals after the phase (the residual risk below); the two new events are in-process and may observe rolled-back writes. **Tenant isolation.** The setting, the rate rows and the provenance are organization-scoped; the registry holds code; the request carries the document's scope. **Migration and deployment.** One nullable column with a reversible migration, no downtime, no backfill; the snapshot is also edited by two open PRs, so whichever lands last regenerates it. **Operations.** Provider calls are bounded by a deadline; failures are logged with codes only; no throttle in this specification.

### Risk Register

#### Double taxation through `tax`-kind adjustments, `taxPortion` or explicit line `taxAmount`
- **Scenario**: a provider writes line tax while a `tax`-kind adjustment or a `metadata.taxRate` on a document discount is still folded into the total; the document shows tax twice or subtracts it twice (§ 5.4 hazard).
- **Severity**: High
- **Affected area**: `sales` totals, invoices copied from orders
- **Mitigation**: the consistency rule; `tax`-kind adjustments and rated discounts are refused under a provider, new or pre-existing (400, § 4.8), so no arithmetic neutralization exists for the payment block's rebuild to undo.
- **Residual risk**: a `sales.document.calculate.after` subscriber can still rewrite totals after the phase, as today (`lib/calculations.ts:437-448`); the record then describes the provider's result, not the persisted totals.

#### A provider call inside a transaction or under a row lock
- **Scenario**: a provider is called while rows are locked; a slow provider holds locks for seconds.
- **Severity**: High
- **Affected area**: `sales` commands, public quote acceptance
- **Mitigation**: Resolve, the comparison and the Apply pass before the transaction opens (§ 4.2); conversion, acceptance, undo and returns make no provider call; a 10-second deadline.
- **Residual risk**: the returns question goes to Spec 4b.

#### Forged provenance
- **Scenario**: a client stores a provenance-shaped `taxInfo` or a `tax-provider:` key on create under `product-rate`, and a reader trusts it.
- **Severity**: Medium
- **Affected area**: document history, later consumers of `tax_info`
- **Mitigation**: the fields are never read as authority; conversion never promotes a copied record into a server-written key (§ 4.14); API exposure is deferred (§ 4.4).
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
- **Mitigation**: the roadmap gates production use of a provider, remote or table, on Spec 4b; every recalculating write calls the provider on the current inputs, so the next one re-taxes; `stale` is reserved in the vocabulary from this specification on.
- **Residual risk**: between this specification and Spec 4b an organization that selects a provider can hold stale tax after an address change; proposed for acceptance as a gated phase.

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

#### Fail-closed outage radius
- **Scenario**: the provider is down; every recalculating write of that organization fails, including inbox actions (`inbox-actions.ts:297`, `:312`, `:320`), workflow steps (`workflows.ts:10-23`), warranty replacement orders and redo.
- **Severity**: Medium
- **Affected area**: back-office automation of the organization
- **Mitigation**: fail closed is the Ask First default (§ 4.13) and Spec 3 adds per-provider policies; the error carries `code` so automations can defer; `product-rate` organizations are unaffected.
- **Residual risk**: proposed for acceptance until Spec 3; no acceptance is recorded.

---

## 13) Decision Record

Every design decision of § 3 is a proposal with a recorded alternative. Maintainers record acceptance or objections here with the date and the login, mirrored into the roadmap's § 13.

---

## 14) Open points

1. A deprecation marker for the client-supplied `taxStrategyKey` and `taxInfo` inputs (the payment-ledger precedent, `2026-08-01-sales-order-payment-ledger-input-deprecation.md:128-136`): not added; the text of § 10 is ready for that case.
2. Returns under a configured provider: no provider call in this specification; Spec 4b decides.
3. Adding `tax_info` to the sales encryption map as defence in depth (the alternative recorded in § 6).
4. Exposing `tax_info` and `tax_strategy_key` in the document read API: a later specification.
5. Clearing a provider's provenance record on the first recalculating write after the organization switches back to `product-rate`: not done; the record describes the last provider calculation (§ 4.5).
6. The test-only `tax_stub` provider (§ 17): registered from `sales/di.ts` under the existing `OM_TEST_MODE=1`; a dedicated flag like the push stub's `OM_ENABLE_PUSH_STUB_ADAPTER` or the `OM_PUSH_FAKE_PROVIDERS`-style client fake are the alternatives.
7. The event ids: `sales.document.tax.calculate.*` (extends the `sales.document.*` family) is the alternative to `sales.tax.document.calculate.*`, and the plural `sales.tax.adjustments.apply.*` does not fit because the phase writes line and charge tax, not adjustments (§ 4.16); the `SalesTaxContext` name (alternative `SalesTaxPhaseContext`).
8. A platform-level deadline value other than 10 seconds (candidates 5, 15 and 30 seconds; § 4.13).
9. The ACL guard of the setting: reuse of `sales.settings.manage` (default) or an admin-only feature id (illustrative `sales.tax_providers.manage`, granted to `admin` only, following `sales.documents.number.edit`, `acl.ts:56-60`, `setup.ts:49`; § 4.4).

---

## 15) Phasing

Four implementation phases, each shippable alone and each leaving the application working; no implementation phase starts before this specification merges (roadmap § 16).

- **Phase A — contract and registry.** Types, the registry and the record shape; no behaviour change. Gate: the new exports exist, the registry survives a second module instance (UT-01 to UT-05, UT-40, UT-41); no migration; no removed export.
- **Phase B — the tax phase.** The step inside the provider calculator, the identity without a `tax` slot, the test double `tax_stub` (§ 17). Gate: the golden test and `TC-SALES-043` pass on the baseline commit before any engine change and after it (UT-50, UT-52, UT-54, UT-10, UT-11, UT-14 to UT-18, UT-62); every existing test unmodified and green.
- **Phase C — Resolve and Apply, the setting, the route, provenance.** The migration, the route, the extended command, the audit entry, Resolve and Apply in the twelve commands, the two events. Gate: UT-60, UT-61, UT-70 to UT-74, CT-01 to CT-21, `TC-SALES-044` to `046`, and `047` and `048` under `tax_stub`; the settings write requires `sales.settings.manage`; an unregistered key is rejected; `product-rate` through the API gives today's totals.
- **Phase D — docs.** The user guide and the overrides guide gain a chapter on document-level providers with a table of what the unit seam cannot carry (addresses, customer, document, charges, status, lifecycle); the totals-hook example is corrected (`context.countryCode` is not declared; `SalesTotalsCalculationHook` is not exported from `lib/calculations`); the appended-calculator rule is stated; the events page lists the two ids; the sales settings page documents the setting. Gate: the docs build passes; `grep` finds `sales.tax.calculate` still documented.

---

## 16) Implementation Plan

### Phase A — contract and registry
1. Add `lib/tax/types.ts` with the types of § 4.3 and the `tax?` slot on `SalesCalculationContext`, and `salesTaxResultSchema` in `data/validators.ts`, from which `SalesTaxResult` derives (§ 4.10); typecheck passes; no runtime change.
2. Add `lib/tax/registry.ts` (`globalThis` state, `registerTaxProvider`, `getTaxProvider`, `listTaxProviders`, `resetTaxProviders`) with `lib/__tests__/taxProviderRegistry.test.ts` (UT-01 to UT-05).
3. Add the provenance record builder with `lib/__tests__/taxProvenanceRecord.test.ts` (UT-40, UT-41; the record contains no address, name or tax id).
4. Export the types and the registry from the `lib/providers` barrel next to the shipping and payment registries (`lib/providers/index.ts:7`); the phase joins the barrel in step 6.

### Phase B — the tax phase
5. Record the golden: the tax-path fixtures (explicit `taxAmount`, explicit zero, supplied gross with and without a rate, `totalsFromStoredRow` with stored tax, a shipping adjustment with and without `metadata.taxRate`, a `tax`-kind adjustment, mixed line kinds, order and quote variants, `existingTotals`, the gift-line hook, a gross-priced line) into `lib/__tests__/fixtures/taxPassThrough.golden.json`, generated on the baseline commit; the commit changes no non-test file under `lib/`.
6. Add `lib/tax/phase.ts` and `lib/tax/stubProvider.ts` (key `tax_stub`, § 17); call the phase inside `ensureProviderTotalsCalculator` between the shipping and payment blocks (Option B; or the Option A split if chosen); `lib/__tests__/taxPassThrough.golden.test.ts` (UT-50, UT-52, UT-54) and `lib/__tests__/taxPhase.test.ts` (UT-10, UT-11, UT-14 to UT-18, UT-62) pass; every existing test file is unmodified and green.
7. Add `TC-SALES-043-tax-default-path-totals.spec.ts` with literal constants recorded on the baseline.

### Phase C — Resolve and Apply, the setting, the route, provenance
8. Migration `Migration<ts>_sales_settings_tax_provider_key.ts` with `up()` and `down()`; entity property; snapshot update; the migration file is the output of `yarn db:generate` under the suffixed name above, trimmed only when the generator emits unrelated diffs (the coding-agent exception of the root `AGENTS.md`).
9. Extend `sales.settings.save` with the optional field written only when present, `?? null` on create, write-time validation against the registry, the exported `salesSettingsUpsertWithTaxProviderSchema` the command parses (§ 4.4) and a `buildLog` entry on change; `commands/__tests__/settings.tax-provider.test.ts` (CT-09, CT-12, CT-17, CT-20, CT-21).
10. Add `api/settings/tax-provider/route.ts` with `metadata`, `openApi`, the mutation guard and the i18n keys; `TC-SALES-044`, `045`, `046`.
11. Add the request builder (`commands/taxRequest.ts`: tolerant address mapper, `taxDate`, `pricesIncludeTax`, charges with `ref`) with `commands/__tests__/taxRequest.test.ts` (UT-60, UT-61).
12. Add the shared helper of § 4.2 (`commands/taxResolve.ts`; `commands/__tests__/taxResolve.test.ts`, UT-70 to UT-74), carry the line id through `createLineSnapshotFromInput` (`commands/documents.ts:3064-3127`) into the rows `replaceOrderLines` and `replaceQuoteLines` create (`:3542`, `:3414`, as `applyOrderLineResults` does, `:3279-3281`), then wire the helper into the twelve recalculating commands (the ten that already calculate before the flush first, then the two header updates, whose calculation pass is hoisted before the flush, § 4.2, in the files PR #6092 also edits, § 11; the fresh reads and the fail-closed 409), the two events, the `tax`-kind adjustment rule and the discount rule; `commands/__tests__/documents.tax-provider.resolve-apply.test.ts` (CT-01 to CT-08, CT-13, CT-14, CT-15, CT-16, CT-18, CT-19) and `documents.tax-provider.provenance.test.ts` (CT-10, CT-11); register `lib/tax/stubProvider.ts` in `sales/di.ts` under `OM_TEST_MODE=1`, then `TC-SALES-047` and `048` (§ 17).
13. Conversion keeps today's copy semantics (§ 4.14); `documents.convert-to-order` coverage extended (CT-10: `tax_strategy_key` stays `null` and `taxInfo` is copied verbatim under a configured provider).
14. Validation: `yarn generate`, `yarn workspace @open-mercato/core build`, `yarn workspace @open-mercato/core test`, `yarn typecheck`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, then the full gate (`yarn build:packages`, `yarn test`, `yarn build:app`) before review; integration `yarn test:integration:ephemeral` with the new ids and the existing tax-adjacent ones (`TC-SALES-006`, `-016`, `-030`, `-034`, `-037`).

### Phase D — docs
15. Update the six docs pages of the Scope line; `yarn workspace open-mercato-docs build` passes; the documented provider example is the body of `tax_stub`.
16. `UPGRADE_NOTES.md` entry (§ 10); `.ai/specs/README.md` row already present from the spec PR; roadmap Changelog line.

---

## 17) Testing Strategy

- **Unit (`lib/__tests__/`; the request tests under `commands/__tests__/`):**
  - Registry (UT-01 to UT-05: lookup, replace-by-key, identity-checked disposer, cross-instance survival through two `jest.isolateModules` evaluations as `packages/core/src/modules/catalog/lib/__tests__/pricing.test.ts:214-241` does, key hygiene).
  - Phase (UT-10 identity without a `tax` slot, with the baseline event sequence `sales.line.calculate.before/after`, `sales.document.calculate.before/after` of `services/__tests__/salesCalculationService.test.ts:165-170`; UT-11 a `tax_stub` result sets line and charge tax consistently for `order` and `quote`; UT-14 `ref` rule (ids and `<calculatorKey>@<position>`); UT-15 payment fees see the tax-inclusive gross with `lib/providers` loaded; UT-16 `sales.document.calculate.after` still runs last and the new events are absent under `product-rate`; UT-17 payment totals survive; UT-18 the gift-line hook keeps its effect; UT-62 document discounts carry no tax portion under a provider).
  - Record (UT-40 shape, status vocabulary and JSON round trip, UT-41 no personal data).
  - Request (UT-60 post-discount nets and charges, UT-61 in-memory only).
  - Resolve helper (`commands/__tests__/taxResolve.test.ts`: UT-70 the consistency rule, 0.004 accepted and 0.006 rejected for the taxable base and for the total, anchored on `taxTotalAmount`, nothing changed; UT-71 reference integrity; UT-72 the `tax`-kind and rated-discount refusal over stored rows plus the write's inputs; UT-73 the version check: a moved `updated_at` or a changed provider key between Resolve and the fresh read is 409, the read passes `refresh: true`, a create skips the document check; UT-74 a create with two new manual charges: every `ref` is the assigned id).
  - Pass-through (UT-50 golden equality under four configurations: nothing configured, a settings row with `NULL`, `tax_stub` registered but not selected, the provider hook loaded; `toStrictEqual` plus `JSON.stringify` equality, logger warnings included; UT-52 non-vacuity: a selected `tax_stub` changes the output; UT-54 deep-frozen inputs).
- **Command level (`commands/__tests__/`, pattern of `documents.create-payment-totals.test.ts`: awilix container, fake `em`, the real `DefaultSalesCalculationService`, `tax_stub` registered in `beforeEach` and removed in `afterEach`):** CT-01 no settings row → `product-rate`, persisted values equal the baseline; CT-02 `null` key behaves the same; CT-03 `calculate` and the second pass run before `em.begin` on create and on update, with intent `estimate` for quotes and `record` for orders; CT-04 an unchanged version applies once and writes server provenance; CT-05 a moved `updated_at` between Resolve and the fresh read fails closed with 409 on update, CT-06 a changed provider key does so on create and on update, nothing persisted and nothing flushed; CT-07 fail closed on throw and on an invalid result, no persist, no flush; CT-08 unregistered key at calculation time fails closed; CT-09 the setting round trip through `sales.settings.save` and the write-time rejection; CT-10 conversion calls no provider, copies the record verbatim and leaves `tax_strategy_key` `null` under a configured provider, a forged client record included; CT-11 undo restores provenance; CT-12 scope enforcement; CT-13 the `{ quote, order } × { create, update }` matrix with recalculation triggers; CT-14 client `taxInfo` is output-only; CT-15 persisted rows under `product-rate` deep-equal a baseline golden; CT-16 settings read for the document's own scope; CT-17 other settings values untouched; CT-18 a client `taxStrategyKey` never selects a provider; CT-19 a setting change affects later calculations only; CT-20 other settings saves keep the key; CT-21 the route and command path.
- **Integration (`__integration__/`, helpers from `@open-mercato/core/helpers/integration/salesFixtures`, admin token, fixtures created and deleted per test, settings restored in `finally`):** `TC-SALES-043` default path totals against literal constants recorded on the baseline; `TC-SALES-044` the settings write is gated (403 with `requiredFeatures` containing `sales.settings.manage` for a `sales.settings.view`-only role, pattern of `__integration__/TC-SALES-037.spec.ts:52-91`; 401 unauthenticated); `TC-SALES-045` an unregistered key is rejected and the stored setting unchanged; `TC-SALES-046` parity of a settings row with `NULL` and the settings round trip. Ids: `TC-SALES-043` to `048` are free at head (the contiguous series ends at `TC-SALES-042`; the issue-numbered ids above 2000 and `TC-SALES-EXT`, reserved by the open external-amounts implementation, do not collide); three open PRs reuse 042, so the implementation PR re-runs the check and renumbers or takes the word family `TC-SALES-TAXPROV-001` to `006`. `TC-SALES-047` and `TC-SALES-048` run under the test-only `tax_stub` provider (next bullet).
- **Provider-path integration coverage.**
  - A fake provider cannot be registered from a Playwright spec (the application runs as a detached process and modules register providers at start), so the specification ships a test-only built-in provider the way core already registers its built-in payment providers (`lib/providers/defaultProviders.ts:100`, `:143`) and the way `push_notifications` ships its stub adapter: `lib/tax/stubProvider.ts` (key `tax_stub`; a deterministic fixed rate per line and per charge; no network; the one test double of this specification) is registered from `sales/di.ts` only when `OM_TEST_MODE=1` is set, the existing test-mode switch that the integration harness already passes to both of its environments (`packages/cli/src/lib/testing/integration.ts:2182`, `:3576`) and that gates other test doubles (`packages/shared/src/lib/email/send.ts:107`).
  - Both harness environments run with `NODE_ENV=production` (`packages/cli/src/lib/testing/integration.ts:2158`, `:3551`), so the switch, not `NODE_ENV`, is the guard, and no harness, lane or environment file changes.
  - The two specs declare no `requiredEnvVars` gate, because that mechanism is reserved for genuine external services (`.ai/qa/AGENTS.md:361`).
  - Registering a test provider from core is an Ask First item (root `AGENTS.md`, provider preconfiguration outside the provider package); the stub is a test double with no vendor logic, as the built-in payment providers and the `push_notifications` stub adapter (`packages/core/src/modules/push_notifications/lib/push-stub-adapter.ts:32-35`, `packages/core/src/modules/push_notifications/di.ts:8-12`).
  - `TC-SALES-047` creates and updates an order and a quote under `tax_stub` through every affected route (document create and update; line upsert and DELETE through `lib/makeSalesLineRoute.ts:239`, `:255`, `:270`; adjustment POST, PUT and DELETE through `api/order-adjustments/route.ts:162` and the quote equivalent), asserting line `taxAmount` and gross on touched and untouched lines, the tax total, the charge read-back, the provenance record and the strategy key through the audit-log data the document history widget reads, and, through the return route (`api/returns/route.ts:86`), a return on the provider-taxed order, whose regenerated shipping charge reads back untaxed (§ 4.8).
  - The mismatch refusal is proven at command level (CT-05, CT-06), because this specification adds no transaction mechanism and the stub carries no failure control.
  - `TC-SALES-048` covers the `tax`-kind and rated-discount refusal (400), scope isolation (another organization's documents untouched) and the switch back to `product-rate`: documents taxed before the switch keep their stored line tax and provenance (§ 4.5), and a document created after the switch equals the default-path baseline.
  - The design has two built-in elements inside core `sales`, the default state `product-rate` and the destination table provider of Spec 2, so built-in providers are part of the design; the root rule about separate packages (`AGENTS.md:183`) concerns external integrations; `tax_stub` is a test double registered only under `OM_TEST_MODE=1`.
- **QA scenarios.** `.ai/qa/scenarios/TC-SALES-006-order-tax-calculation.md` and `TC-SALES-016-tax-rate-configuration.md` describe rate selection by location and exempt customers that this specification neither implements nor contradicts (`product-rate` consults no address); they are not edited here; `TC-SALES-016` names a feature `sales.tax.manage` that does not exist in code (the tax-rate routes require `sales.settings.manage`).
- **Validation commands:** the module set (`yarn db:generate` as a schema-diff probe, `yarn generate`, `yarn workspace @open-mercato/core build`, `yarn workspace @open-mercato/core test`), then the full gate of `.ai/agentic.config.json` before review.

---

## 18) Documentation changes

`apps/docs/docs/user-guide/taxes.mdx` (`apps/docs/docs/user-guide/taxes.mdx:52`, `:77` send external engines to the unit seam) and `apps/docs/docs/framework/pricing-tax-overrides.mdx` (`apps/docs/docs/framework/pricing-tax-overrides.mdx:144-191`) gain a chapter "document-level tax providers" with the table of what the unit seam cannot carry and the provider example (`tax_stub`'s body); the totals-hook example at `:66-90` is corrected (declared context fields only; an exported type); `apps/docs/docs/framework/modules/sales/calculations.mdx` states the rule for prepended and appended calculators; `apps/docs/docs/framework/modules/sales-providers.mdx` lists the third provider kind; `apps/docs/docs/framework/modules/sales/events.mdx` lists the two ids; `apps/docs/docs/user-guide/sales/sales-settings.mdx` documents the setting (`sales.settings.manage`). New i18n keys: `sales.tax.errors.*` and the audit label, in the five locales; the existing key `sales.documents.history.fields.taxInfo` stays.

---

## 19) Out of scope (with the specification that owns each item)

- Provider-side lifecycle (commit, adjust, void, refunds, retries and the commit point) is not declared in the `TaxProvider` type and has no behaviour here; Spec 3 adds the optional methods. In this specification `record` means that the platform stores the result on an order; it never asks a provider to record a transaction for filing.
- Deterministic provider document codes, idempotency keys and retry semantics: Spec 3; this specification stores the provider's reference as returned and carries `documentNumber`.
- Per-line tax detail columns, additional line kinds (`handling`, `refund`), per-line addresses, the customer group set, and the allocation of document discounts to lines: Spec 4a. Provider-specific product and customer facts are the provider package's own fields (§ 4.15; roadmap ADR-10). Exemption appears only as result vocabulary and status; reverse-charge and OSS logic are outside v1 (roadmap ADR-5).
- Recalculation triggers beyond today's (address, customer, date, elapsed time), the explicit recalculate command, the stored-tax carry-over fix, return reversal at the original tax date, honour-versus-re-quote on conversion, and the line dialog change: Spec 4b.
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
| root AGENTS.md | No direct ORM relationships between modules; no new cross-module ORM reads | Compliant | § 4.11, § 4.15: facts from the document's own snapshots; provider-specific facts are the provider package's own extension data, read through `resolve`; the customer group set is Spec 4a's `tryResolve`d owner service, `null` when absent |
| root AGENTS.md | Filter by `organization_id`; never expose cross-tenant data | Compliant | the setting and the provider are resolved for the document's own scope (§ 4.4, § 8) |
| root AGENTS.md | Validate inputs with zod in `data/validators.ts`; derive types with `z.infer` | Compliant | `salesSettingsUpsertWithTaxProviderSchema` (§ 4.4), `salesTaxProviderSettingsSchema` (§ 7) and `salesTaxResultSchema` (§ 4.10), exported from `data/validators.ts`; the command's input type and `SalesTaxResult` derive from them |
| root AGENTS.md | `findWithDecryption` / `findOneWithDecryption` for encrypted reads | Compliant | address snapshots and the channel address are read through the decryption-aware loaders (§ 4.11) |
| root AGENTS.md | Default migration workflow (`yarn db:generate`, review SQL and snapshot; ask before `db:migrate`) | Compliant | § 6, § 16 step 8 |
| root AGENTS.md | RBAC: feature-based guards in route `metadata` | Compliant | § 7 `metadata` with `requireFeatures: ['sales.settings.manage']` |
| root AGENTS.md | Never hard-code user-facing strings; i18n keys | Compliant | § 7, § 18 (`sales.tax.errors.*`) |
| root AGENTS.md | Event IDs `module.entity.action` (`AGENTS.md:206`) | Deviation proposed | the two ids follow the `.before/.after` shape of the existing calculation lifecycle events (`events.ts:82-99`) instead of the singular past-tense form; recorded under Non-Compliant Items for explicit acceptance; alternatives in § 14 |
| root AGENTS.md | Run `yarn generate` after changing auto-discovered files | Compliant | § 16 step 14 |
| root AGENTS.md | Optimistic locking on every new user-editable entity | N/A | no new entity; the settings row keeps today's behaviour; the document commands keep `enforceSalesDocumentOptimisticLock` |
| root AGENTS.md | No `any`; functional, data-first utilities | Compliant | typed contract (§ 4.3); registry as functions |
| packages/core/AGENTS.md | API routes export `metadata` per method and `openApi`; custom write routes run the mutation guard registry (`packages/core/AGENTS.md:115-119`) | Compliant | § 7: `runRouteMutationGuards` (every registry guard plus the bridged legacy guard), not the deprecated pair the sibling settings routes use |
| root AGENTS.md | Integration coverage for all affected API paths ships in the same change (`AGENTS.md:166`) | Compliant | § 17: `TC-SALES-043` to `048`; the provider path runs end to end under the test-only `tax_stub` provider |
| root AGENTS.md (`AGENTS.md:102`), error-reporting.mdx | A catch that records an error MUST also `reportError` | Compliant | § 8 logging rule: `reportError` with an enumerated code and ids only |
| packages/core/AGENTS.md | Encryption maps for PII / GDPR-relevant columns | Compliant with a stated choice | no new column holds personal data; `tax_info` stores jurisdiction codes, not a person's data (§ 6); the alternative (map entry) is recorded; a provider-owned field that holds an identifier is declared in that package's `encryption.ts` map and read through `findWithDecryption` (§ 4.15) |
| packages/core/AGENTS.md | Cross-Module Coupling: optional consumer owns the glue, `try/catch` resolve, no hard `requires` (`packages/core/AGENTS.md:242-250`) | Compliant | § 4.11; `index.ts:12` unchanged |
| packages/core/AGENTS.md | Migrations: snapshot updated in the same commit (`packages/core/AGENTS.md:188`) | Compliant | § 6 |
| packages/core/AGENTS.md, .ai/review-checklist.md | Domain writes through commands (`packages/core/AGENTS.md:13`); every command undoable (`.ai/review-checklist.md:88`) | Compliant; deviation recorded | the write goes through `sales.settings.save`, which gains an audit entry but no undo, like every existing settings command (§ 4.4); listed under Non-Compliant Items |
| packages/core/src/modules/sales/AGENTS.md | MUST use `salesCalculationService` for document math; never reimplement inline | Compliant | the phase lives inside the engine; Resolve reuses the engine's first pass; no inline math |
| packages/core/src/modules/sales/AGENTS.md | Ask First: Quote → Order → Invoice flow (`packages/core/src/modules/sales/AGENTS.md:13`); adjustment kinds and configuration entity semantics (`:14`) | Compliant | Ask First paragraphs in § 4.4, § 4.8, § 4.13, § 4.14 and § 17; workflow states and numbering rules are unchanged |
| packages/core/src/modules/sales/AGENTS.md | Validation commands (`yarn db:generate`, `yarn generate`, `yarn workspace @open-mercato/core build`) | Compliant | § 16 step 14, § 17 |
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
| Worked examples agree with the rules | Pass | § 5.2, § 5.5 and § 5.6 reproduce the consistency rule and the verbatim-amount rule; § 5.4 shows the discount limitation of § 4.8; § 5.8 shows the silent staleness Spec 4b owns and the racing-writer case that fails closed |
| One name per concept | Pass | provider key, strategy key, charge, provenance record, tax phase, Resolve step, Apply step (§ 4) |
| External platforms are named in Market Reference only; nothing outside this repository is cited | Pass | the comparison is the roadmap's Market Reference paragraph; the engines are named as the repository's docs name them |
| Every contested point is a § 3 decision with a recorded alternative; Ask First items as body paragraphs | Pass | § 3, with Option A recorded in § 4.1 and the open points of § 14 carrying their alternatives; § 4.4, § 4.8, § 4.13, § 4.14, § 17 |

### Non-Compliant Items

- Root `AGENTS.md:206` (event ids `module.entity.action`, singular entity and past tense): `sales.tax.document.calculate.before` / `.after` follow the `.before/.after` lifecycle shape of `sales.document.calculate.*` (`events.ts:82-99`); proposed deviation pending explicit acceptance (§ 14 records the alternatives).
- `.ai/review-checklist.md:88` (every command undoable): `sales.settings.save` writes an audit entry and no undo, as every existing settings command; recorded deviation (§ 4.4).

### Verdict

- **Compliant with two recorded deviations** (the lifecycle event-id shape and the non-undoable settings command, above) — additive on every contract surface; no behaviour change without a configured provider; route-level coverage of the settings route, the default path and the provider path; maintainers record acceptance or objections in § 13; nothing here is a maintainer decision.

---

## Changelog

### 2026-10-03
- Initial proposal; status proposed; submitted in one PR with the roadmap `2026-10-03-tax-providers-roadmap.md`.

### Review — 2026-10-04
- **Reviewer**: Agent (fresh-context `om-spec-writing` review and `om-pre-implement-spec` readiness audit against `develop` @ `7f0ebf653`); triaged by the author
- **Security**: Passed — the settings route runs the mutation guard registry (§ 7); conversion carries no provenance key (§ 4.14); failures are reported with enumerated codes and no request data (§ 8)
- **Performance**: Passed — one provider call, two calculation passes and one transaction per write (§ 4.2)
- **Cache**: N/A — no read API; the settings read is a single-row lookup
- **Commands**: Passed — no new command; Resolve and Apply run before the write transaction in the twelve recalculating commands (§ 4.2)
- **Risks**: Passed — the provider path is covered end to end under the test-only `tax_stub` provider (§ 17); the two recorded deviations are in the Final Compliance Report
- **Verdict**: Approved as a proposal — no open findings; maintainer acceptance is recorded in § 13
