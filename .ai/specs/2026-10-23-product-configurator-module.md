# Product Configurator (CPQ) Module

**Date:** 2026-10-23
**Status:** Draft (spec-only, decisions requested)
**Scope:** OSS - new package `packages/product-configurator` (module `product_configurator`), one additive service in `packages/core/src/modules/catalog`
**Related:** PR #6749 (review of an optional vertical module: placement and data access), PR #1589 (closed window-coverings configurator spec), [`2026-09-30-forms-module-into-core.md`](./2026-09-30-forms-module-into-core.md)

## TLDR

**Key Points:**
- A rule-based product configurator. An admin authors a versioned model (features, conditions, rules, formulas, lookups, BOM). A sales rep configures it from a quote. The result becomes a quote line with a net price built from catalog prices, plus an immutable snapshot that follows the line to the order.
- It fills a gap in `catalog`: variants and option schemas describe options, but not rules between them, computed quantities, or a price built from a bill of materials.
- The source is a working hackathon build on 0.8.0. It is reduced to a product-agnostic core and brought in line with upstream contracts: commands with audit and optimistic locking, selected-organization scoping, sales RBAC respected, no reads of other modules' tables, crash-safe finalisation.

**Scope:**
- Deterministic evaluator and definition DSL with a canonical hash
- Model studio with full UI authoring, validation and versioned publishing
- Configuration sessions launched from a quote, priced through `catalogPricingService`
- Finalisation into a sales quote line (`configuration` jsonb) plus a snapshot, shown on the quote and on the converted order
- An admin test mode for the saved draft, and "Add another identical" / "Configure again" to add a re-priced copy of a configuration
- Phase E, after v1: re-configure in place (replace a configured line and carry over its commercial terms)
- Opt-in: the module is off unless `OM_ENABLE_PRODUCT_CONFIGURATOR=true`

**Non-goals (v1):**
- 3D or any visualization
- Customer share link and customer accept / request-change flow (sales already has the public quote page and accept-to-order)
- Printable configuration document
- Cost price and margin
- Tax and discount logic in the configurator (sales owns both)
- Translating authored model content
- Dashboard widgets (follow-up spec: needs a defined audience, thresholds and actions)
- Quantity above 1 on a configured line (one configured unit is one line; "Add another identical" creates more)
- Re-configure in place (Phase E). In v1 a rep changes a configured machine by adding a changed copy, re-entering the commercial terms that differ (name if renamed, comment, discount, a changed tax rate) and removing the old line in Items

## Open Questions for Maintainers *(remove before finalizing)*

- **Q1 Placement**: own package `packages/product-configurator`, enabled in `apps/mercato` and the create-app template behind `OM_ENABLE_PRODUCT_CONFIGURATOR` (default off), following the merged `OM_ENABLE_STORAGE_S3` pattern (`apps/mercato/src/modules.ts:227`, `packages/create-app/template/src/modules.ts:218`). Acceptable, or do you prefer another placement?
- **Q2 Sales command contract**: v1 (Phases A-D) depends on `sales.quotes.lines.upsert`, the line `configuration` field, and command interceptors on `sales.quotes.lines.upsert`, `sales.orders.lines.upsert`, `sales.quotes.create`, `sales.orders.create` and `sales.quotes.convert_to_order` (an `afterExecute` cleanup only). Command ids are not a category in `BACKWARD_COMPATIBILITY.md`. Can these ids and input schemas be treated as STABLE? Phase E (re-configure in place, after v1) also needs `sales.quotes.lines.delete`: with existing commands, replacing a line is two sales writes, and a conversion that slips between them can leave both lines on the order; the spec narrows and detects this but cannot close it. Would you prefer a sales-owned atomic "replace configured line" command for Phase E? Your answer shapes Phase E only; v1 does not depend on it.
- **Q3 Catalog seam**: is a new `catalogPriceRowService` in `catalog` (below) the right way for another module to fetch price rows and resolve SKUs? It ships as the first commit of PR A, next to its only consumer. We can split it into its own PR if you prefer.
- **Q4 CI for opt-in modules**: the integration specs declare `requiredEnvVars: ['OM_ENABLE_PRODUCT_CONFIGURATOR']`, so CI skips them unless the flag is set. Should CI set it, or is there a preferred mechanism?
- **Q5 Quote items integration**: the standard sales line dialog requires a variant for a catalog line (`LineItemDialog.tsx:1490`) and has no discount or comment field, so a configured line (product, no variant) cannot be saved from Items. v1 edits a configured line's commercial fields from the Configurations tab instead. Would you accept an additive quote-items host (like `data-table:sales.order.items:columns`, which today is order-only) for a "Configured" column and row action, and is a variant-less product line in the dialog something sales plans to support? The dialog's field widgets also cannot tell which line is open (`LineFormState` has no id or `configuration`, `LineItemDialog.tsx:162-178`), so v1 shows its notice in the details spot instead; could sales pass the line id or `configuration` to `crud-form:sales.sales_quote_line:fields` widgets? For Phase E: is there a spot higher on the document page than `sales.document.detail.*:details` (rendered below the totals) for the two-line warning?

## Decisions

| Decision | Outcome |
|---|---|
| Naming | Module id `product_configurator`, package `@open-mercato/product-configurator`. Avoids the `cpq` id and `/backend/cpq/*` routes of the third-party `@dainamite/cpq` |
| Dependencies | `requires: ['catalog', 'sales']` |
| Spec shape | One spec, one PR per phase. v1 is four phases (A engine, B studio, C configurator, D finalise); B and C depend only on A. Phase E (re-configure in place) follows after v1 is merged and Q2 is answered |
| Re-configure in place | Phase E. Replacing a line needs two sales writes, a conversion guard with a residual race, and carried-over commercial terms. v1 offers a re-priced copy and manual removal of the old line |
| Catalog data | New `catalogPriceRowService` (Q3), first commit of PR A. Price selection stays in `catalogPricingService` |
| Sales data | Existing seams only: sales commands via the command bus, `queryEngine` reads of quotes and lines, widget spots, public line APIs. No `sales` change (Q2) |
| Sales RBAC | Every session operation requires sales visibility of its quote; finalising requires `sales.quotes.manage` |
| Price ownership | The configurator produces a net unit price. Sales applies tax (the bound product's `taxRateId`) and discounts through `salesCalculationService`, like any other line |
| Currency precision | Minor-unit exponent from `Intl.NumberFormat` for the currency code, the same source `formatCurrency` uses. No `currencies` change |
| Quote line product | The line carries the `productId` of the catalog product the model is bound to. A product can have several models (for example one per currency) |
| Feature visibility | Features can declare `visibleWhen` conditions. A hidden feature takes its default and is left out of the summary |
| Configured line edits | Command interceptors protect the configuration marker and the configured inputs (product, currency, quantity, unit, net unit price). Name, comment, discount and tax are edited from the Configurations tab (the standard sales dialog cannot save a variant-less product line, Q5); gross and totals are derived by sales |
| Quantity | One configured unit is one line. "Add another identical" opens a session prefilled from a snapshot and adds a separate, re-priced line |
| Dashboard widgets | Not in v1; a follow-up spec defines audience, thresholds and actions |

---

## Overview

Sales teams that sell engineered or made-to-order products (machines, pumps, windows, furniture, industrial equipment) cannot express their offer as a fixed list of variants. The number of combinations is too large, some combinations are invalid, some choices force others, and the price depends on computed quantities of parts. Open Mercato has no place to model this today. Reps fall back to spreadsheets and type a free-text quote line.

The module gives an admin a studio to describe such a product as data, and gives a rep a guided configurator inside the quote. The configurator never lets an invalid configuration reach the quote, and the price always comes from the catalog prices of the parts.

> **Market Reference**: Odoo's product configurator (product attributes with exclusions and per-value price extras) is the closest open-source reference. Adopted: declarative compatibility rules evaluated on the server, and the configured result stored on the sales line. Rejected: per-attribute price extras. They cannot express quantities computed from other choices (for example, cable length from mounting height), which is why this module prices a generated BOM against catalog SKUs instead. The third-party `@dainamite/cpq` covers a different scope (attributes, multi-charge pricing tables, guided wizards, customer inventory, amend / renew / cancel) and is not a basis for this design.

### Relation to catalog `configurable` products and option schemas

- Catalog `productType: 'configurable'` is a variant parent: the product create page sets it when the product has variants (`catalog/backend/catalog/products/create/page.tsx:1495-1503`), and the customer picks one of the pre-built variants, each with its own SKU and price. Option schema templates (`catalog_product_option_schemas`) describe those variant options (select, text, number).
- A configurator model is different: there is no pre-built variant to pick. The result is computed (BOM, quantities, price) from rules.
- The two coexist. A model binds to any catalog product. A product without variants is the expected case; the quote line carries `productId` and no `productVariantId`. A model does not read or change the product's option schema or variants. Variant SKUs may still appear as BOM parts.

## Problem Statement

1. Catalog variants and option schema templates describe which options exist. They cannot express that option A forbids option B, that choosing X forces Y, or that a part quantity is a formula of other choices.
2. Prices of configured products are a sum of parts whose quantities depend on the configuration. Catalog prices single SKUs well (`catalogPricingService`), but nothing composes them.
3. A quote line has a `configuration` jsonb column (`sales/data/entities.ts:1097`) that is cloned to the order (`sales/commands/documents.ts:6933-6935`), but nothing fills it with a validated, reproducible configuration.
4. A configured quote must stay explainable after the model changes. Today there is no record of which rules and prices produced a line.

Evidence of demand: a community spec for a window-coverings configurator (PR #1589) was proposed and closed without an implementation, and the hackathon build was made for a machinery dealer scenario. Screenshots of the working hackathon build are in `assets/product-configurator/current-*.png` (see Mockups).

## Proposed Solution

The module has four v1 parts, each owned by one phase, and a fifth part after v1.

1. **Engine (Phase A).** A pure, deterministic evaluator in two steps: structure (`definition, selections -> settled selections, visibility, formulas, BOM quantities`) and price (`structure, unit prices, currency exponent -> totals, hash`). The definition is a versioned JSON document validated by zod and by publication checks. Publishing freezes a version and stores its hash.
2. **Studio (Phase B).** Backend pages to author a model through forms and tables only, including a text expression editor and a BOM row editor, plus an advanced JSON view of the whole draft.
3. **Configurator (Phase C).** A session bound to a quote and a published model version. Every change re-evaluates on the server. Unit prices come from catalog price rows selected by `catalogPricingService`.
4. **Finalise (Phase D).** Finalising writes a snapshot, then a quote line through `sales.quotes.lines.upsert`, with reconciliation so a retry never creates a second line. The quote and the converted order show a tab that links each configured line to its snapshot. The Configurations tab also edits a configured line's commercial fields and adds re-priced copies.
5. **Line replacement (Phase E, after v1).** Re-configure replaces a configured line in place and carries over its commercial terms (see Phase E below).

### Design Decisions

| Decision | Rationale |
|---|---|
| Evaluator is a pure function in the module's `lib/` | Deterministic, unit-testable without a database, safe to run on every change |
| Evaluator split into structure and price steps | Tiered catalog prices depend on quantities, which depend on the evaluation |
| Hash covers settled values and scaled integers only | Formatting and rendered messages change with locale and copy. The hash must not |
| Prices come from BOM SKUs, not from option price extras | Quantities can be formulas. The catalog stays the single source of prices |
| Net price only, sales owns tax and discount | `sales/AGENTS.md`: document math goes through `salesCalculationService`, never inline |
| Finalise reconciles before writing | Sales commits independently, and an upsert with a predetermined `id` is an update, not an insert (`documents.ts:8051,8165`). Looking up the line by snapshot id is the only way to make retries safe without a sales change |
| Command interceptors for the line guard | An API interceptor on `sales/quote-lines` misses inline `lines` on quote create, inbox actions and undo. Command interceptors run on every execute |
| `auto_add` rule effect dropped | In the hackathon build it behaves exactly like `force` |
| Several models per product | One product may be sold in several currencies, and the model currency must match the quote |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Extend catalog option schemas with rules, formulas and BOM | Turns `catalog` into a rule engine for one vertical use case, and option schemas exist to pick pre-built variants, not to compute a BOM |
| Module inside `packages/core` | The #6749 review would rule it out for a vertical module. `forms` went to core because it is a central primitive that imports core internals |
| Read catalog price rows through DI-resolved entity classes (inbox_ops pattern) | Still queries catalog tables, which the #6749 review asked to avoid |
| `GET /api/catalog/prices` from the server | One product per call, no SKU filter, page size capped at 100 |
| Ship `catalogPriceRowService` as its own PR before PR A | An API without a consumer is hard to justify in review, and a blocked core PR would block every phase. Kept as an option (Q3) |
| Read `Currency.decimalPlaces` | No service exposes it and `sales` does not use it either (it stores `numeric(18,4)`). `Intl` matches what the UI shows |
| VAT and customer discount in the model (hackathon) | Duplicates sales math and conflicts with `sales/AGENTS.md` |
| Price each BOM line at its own quantity | The same SKU on two lines could land in different tiers. Pricing by total SKU quantity is deterministic and matches how a supplier prices an order |

## User Stories

- **Admin** wants to **author a configurable product as rules and a BOM in a UI** so that **sales can quote it without spreadsheets**.
- **Admin** wants to **see publication errors before publishing** so that **reps never meet a broken model**.
- **Admin** wants to **publish a new version without changing quotes already sent** so that **old quotes stay explainable**.
- **Sales rep** wants to **configure a product from a quote and see the price, BOM and rule messages live** so that **the quote is correct the first time**.
- **Sales rep** wants to **leave the configurator and come back to the same session** so that **work is not lost on refresh**.
- **Sales rep** wants to **re-open a configured line and change it** so that **customer feedback is handled without configuring from scratch**. v1: a changed copy plus manual removal of the old line; Phase E: in place, with the commercial terms carried over.
- **Back office** wants to **see on the order which configuration was sold** so that **fulfilment builds the right product**.
- **Sales rep** wants to **add another identical configuration** so that **five machines do not mean configuring five times**.
- **Admin** wants to **try the saved draft with real choices before publishing** so that **the first tester of a rule is not a rep on a live quote**.

## Architecture

### Package layout

```
packages/product-configurator/
  package.json (version = workspace version), build.mjs, watch.mjs, jest.config.cjs, tsconfig.json
  src/modules/product_configurator/
    AGENTS.md, index.ts, acl.ts, setup.ts, events.ts, di.ts
    data/{definition.ts, validators.ts, entities.ts}
    lib/evaluator/*          pure engine (no I/O)
    lib/{validate,hash,exprParse,exprFormat,dependencyGraph,summary,money}.ts
    lib/{pricing,finalise,quoteAccess}.ts
    commands/{models,sessions,interceptors}.ts
    api/**                   routes (see API Contracts)
    backend/product_configurator/**
    components/**, widgets/injection/**
    i18n/{en,de,es,ko,pl}.json
    migrations/
    __integration__/ (meta.ts with requiredEnvVars and dependsOnModules)
```

The env-gated registration follows the merged `OM_ENABLE_STORAGE_S3` pattern: `enabledModules.push` behind the flag in `apps/mercato/src/modules.ts` and `packages/create-app/template/src/modules.ts`. A UI package also needs what `storage-s3` does not: an `apps/mercato/package.json` dependency and the same dependency in `packages/create-app/template/package.json.template` with a review of the template lockfile (`packages/create-app/AGENTS.md` rule 6), `@xyflow/react` declared in the new package's own `package.json`, commented `# OM_ENABLE_PRODUCT_CONFIGURATOR=false` in both `.env.example` files, the three Dockerfile `COPY` lines, `scripts/package-peer-deps-allowlist.json`, an error-severity `om-ds/*` block in `eslint.ds.config.mjs` (as for `tillio`), and ACL feature labels in `packages/core/src/modules/auth/i18n/*` (`auth.acl.features.product_configurator.*`). Phase A confirms whether the create-app module fact-sheet guard (`scripts/template-sync.ts`) needs a harness entry for an env-gated module.

Entity ids of other modules are read with `getEntityIds()` from `@open-mercato/shared/lib/encryption/entityIds`, with optional chaining (`E.sales?.sales_quote`).

### Cross-module seams

| Need | Seam | Owner change |
|---|---|---|
| Quote header (`status`, `currency_code`, `channel_id`, `customer_entity_id`, `customer_snapshot`, `quote_number`, `updated_at`) | `queryEngine` on `E.sales.sales_quote` (decrypts). Same pattern as `wms/lib/salesOrderInventoryAutomation.ts` | none |
| Lines of one quote or order (reconcile, guard, order tab) | `queryEngine` on `E.sales.sales_quote_line` / `sales_order_line` filtered by parent id. The hybrid engine reads base-table columns and only uses the index for custom fields (`query_index/lib/engine.ts:420-425,519-521`), so `configuration` is live. `queryEngine` returns 20 rows by default, so every line read here pages through all lines (`pageSize` 100) until the last page. Never `omitAutomaticTenantOrgScope` | none |
| Write the configured line | `commandBus.execute('sales.quotes.lines.upsert', { input: { body }, ctx })`, returns `{ quoteId, lineId }` | none |
| Remove the replaced line (Phase E) | `sales.quotes.lines.delete` with `{ body: { id, quoteId, organizationId, tenantId } }`. Not found counts as removed | none |
| Quote / order tabs | Spots `sales.document.detail.quote:tabs` and `sales.document.detail.order:tabs`; lines via `/api/sales/{quote,order}-lines` | none |
| Bound product, SKUs, price rows | New `catalogPriceRowService` (below) | additive `catalog` service |
| Price selection | `catalogPricingService.resolvePriceMany(Array<{ rows, context }>)` | none |
| Currency exponent | `new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits` | none |
| Guard configured lines | Command interceptors (see Configured line guard) | none |

`catalogPriceRowService` (new, `packages/core/src/modules/catalog/services/catalogPriceRowService.ts`, DI key `catalogPriceRowService`, interface plus `DefaultCatalogPriceRowService` like `catalogPricingService`):

```ts
type CatalogScope = { tenantId: string; organizationId: string }
type BoundProductRef = {
  productId: string
  sku: string | null
  title: string
  taxRateId: string | null
}
type CatalogItemRef = {
  sku: string
  productId: string
  variantId: string | null
  title: string
  unit: string | null              // product: defaultSalesUnit ?? defaultUnit; variant: its product's
  salesUnitQuantity: string        // product's defaultSalesUnitQuantity (publication needs 1)
}
type SkuResolution = { items: Map<string, CatalogItemRef>; ambiguous: string[] }
type PriceKindRef = { id: string; code: string; currencyCode: string | null; isPromotion: boolean }

interface CatalogPriceRowService {
  resolveProducts(ids: string[], scope: CatalogScope): Promise<Map<string, BoundProductRef>>
  resolveSkus(skus: string[], scope: CatalogScope): Promise<SkuResolution>
  resolvePriceKinds(ids: string[], scope: CatalogScope): Promise<Map<string, PriceKindRef>>
  findPriceRows(
    items: CatalogItemRef[],
    context: PricingContext,
    scope: CatalogScope,
    options?: { excludePromotions?: boolean },
  ): Promise<Map<string, PriceRow[]>>   // keyed by CatalogItemRef.sku
}
```

- `resolvePriceKinds` backs the `price_kind` publication check and the create dialog's price kind picker. It includes price kinds with no organization (`catalog_price_kinds.organization_id` is nullable, `catalog/data/entities.ts:743`). Variants have no unit column, so a variant item carries its product's unit and sales unit quantity.
- `resolveProducts` returns the bound product even when it has no SKU (`CatalogProduct.sku` is nullable, `catalog/data/entities.ts:101`). `resolveSkus` matches products and variants by SKU and carries the item's unit (`catalog/data/entities.ts:122`). Both exclude soft-deleted rows. Product and variant SKUs are unique in separate tables (`catalog/data/entities.ts:66,550-553`), so a SKU found in both is returned in `ambiguous`.
- `findPriceRows` uses `findWithDecryption` with `buildPriceRowFilter(context)` and populates price kind and offer. A product item gets product-level rows only (`variant_id IS NULL`), a variant item gets the variant rows. This fixes the hackathon bug where a variant price could win for a product SKU. `excludePromotions` drops `isPromotion` price kinds inside catalog, because `buildPriceRowFilter` admits them when `priceKindId` is set.
- At most 500 SKUs per call (the BOM limit).

### Pricing

1. The structure step returns BOM lines with SKUs and quantities.
2. Quantities are summed per SKU. This is safe because publication rejects a BOM line whose `uom` differs from the catalog item's unit, or an item whose `defaultSalesUnitQuantity` is not 1 (`bom_unit_mismatch`); unit conversion is not supported in v1. One `PricingContext` per SKU: `currencyCode` = model currency, `priceKindId` = `commercial.priceKindId`, `channelId` = quote channel, `customerId` and `customerIds` = quote customer when present, `quantity` = total SKU quantity, `date` = evaluation time. When customer-group pricing ([`2026-08-14-customer-groups-and-b2b-terms.md`](./2026-08-14-customer-groups-and-b2b-terms.md)) adds `customerGroupIds` to the pricing context, the configurator passes the quote customer's groups too; until then group prices do not apply to configured lines.
3. `findPriceRows` and `resolvePriceMany` select one unit price per SKU. Promotions are excluded unless `commercial.allowPromotions` is true. A SKU with no row or a null `unitPriceNet` fails with `price_missing`.
4. The price step multiplies each BOM line by the SKU unit price.

The model currency must equal the quote currency, otherwise opening a session fails with `currency_mismatch`.

### Money

- Catalog unit prices keep their stored precision (4 decimals, `numeric(16,4)`) as scaled BigInt. Quantities keep the formula precision (at most 6 decimals).
- A BOM line total is `unitPrice x quantity`, rounded half-up to the currency exponent once. The net price is the sum of rounded line totals.
- The line sent to sales uses `unitPriceNet` = net price as a decimal string with `quantity: 1`, so sales receives an amount already rounded to the currency.

### Quote line write

```ts
commandBus.execute('sales.quotes.lines.upsert', {
  input: {
    body: {
      organizationId, tenantId, quoteId,
      productId,                         // product bound to the model
      name: modelTitle, description: summary,
      quantity: 1,
      currencyCode,
      unitPriceNet: '<decimal string>',
      priceMode: 'net',
      taxRateId,                         // bound product's taxRateId, omitted when null
      configuration: { productConfigurator: { snapshotId, modelVersionId, hash, summary } },
    },
  },
  ctx,                                   // auth and scope kept; request replaced, see Session flow step 5
})
```

Gross, tax and totals are computed by sales, which recalculates the whole quote on every line write. One configured unit is one line; "Add another identical" creates more lines.

A copy ("Add another identical", "Configure again") gets the defaults of a new line: name = model title, the bound product's tax rate, no comment and no discount. The rep re-enters what differs through "Edit line details". Carrying the source line's terms over is part of Phase E.

### Summary

The summary goes into the line `description`, which the customer sees on the public quote page.

- Visible features with `inSummary`, in `order`, as `<label>: <value>[ <unit>]`, joined with `; `.
- A choice or color shows the option `label`. A number is formatted with `Intl.NumberFormat` in the app default locale. A boolean appears only when true, as its label.
- Authored text is used as is (no translation in v1). Maximum 1000 characters, cut at the last whole entry.

### Session flow

Finalise is serialized per quote with a Postgres session-level advisory lock, `pg_try_advisory_lock(hashtextextended('product_configurator:quote:' || quote_id, 0))`, taken on a dedicated connection and held until finalise ends. The repo already uses the transaction-scoped form for similar serialization (`currencies/commands/currencies.ts:99`, `wms/commands/inventory-actions.ts:745`); the session-scoped form is needed here because finalise spans the module's own writes and a sales transaction (two in Phase E). If the process dies, its connection closes and Postgres releases the lock, so there is no time-based takeover and a paused worker keeps its lock instead of being overtaken. The canonical `withAdvisoryXactLock` (`packages/shared/src/lib/db/advisoryLock.ts`) does not fit: its callback must do all I/O on one transaction and never fork, while the sales upsert forks its own EntityManager (`sales/commands/documents.ts:7981`). The lock connection must be a direct database connection, never a transaction-mode pooler, which silently drops session-level locks (same requirement as `2026-07-27-mercato-upgrade-reconcile-command.md`); this goes into the module docs. If the lock connection breaks while the process lives, finalise stops before its next write and the session stays `finalising`, which the next call reconciles.

```
open(quoteId, modelId?, fromSnapshotId?, mode?) -> session(open, revision 0)
evaluate(selections, revision) -> structure -> prices -> result (stored, revision + 1)
finalise(expectedHash, revision)
  1. lock the quote (busy -> finalise_in_progress); CAS open|finalising -> finalising
  2. if the session already has a snapshot:
       linked (quote_line_id set)   -> go to 7
       unlinked                     -> read the quote's lines, or, when the quote is gone, the lines
                                       of the order with the quote's id (conversion's default
                                       order id); if one carries this snapshotId, adopt it as
                                       quote_line_id (no re-evaluation) and go to 7
  3. re-read quote (exists, currency, updatedAt) and bound product; check revision (stale -> session_changed);
     re-evaluate; reject unless finalisable; hash differs from expectedHash -> result_changed
     (no write, returns the new result so the rep confirms the new price)
  4. write the snapshot (insert, or replace the unlinked one); it is immutable once quote_line_id is set
  5. dispatch sales.quotes.lines.upsert with a trusted server-side Request carrying
     OPTIMISTIC_LOCK_HEADER_NAME = quote updatedAt from step 3; store quote_line_id.
     Sales 409 -> status open, error quote_changed. Sales 404, or any other failure after
     which a fresh read finds no quote (converted or deleted) -> status cancelled, error
     quote_converted. Other failure -> status open, error quote_line_write_failed.
     A crash here is handled by step 2 on the next call.
  6. Phase E only (replace mode): remove the replaced line, see Phase E.
  7. CAS finalising -> finalised; emit snapshot.created; release the lock (always, in finally)
```

- **Conversion during finalise (v1)**: no blocking guard is needed. Conversion takes `FOR UPDATE` on the quote row before it reads the lines (`sales/commands/documents.ts:6730-6747`) and deletes lines and quote in the same transaction (`:7061-7063`); a line insert takes `FOR KEY SHARE` on the quote row through the `quote_id` foreign key (`sales/migrations/Migration20251030150038.ts:87`). So the two serialize: either the line commits first and conversion copies it with its `configuration` (`:6933-6935`), or conversion commits first and the insert fails, which step 5 maps to `quote_converted`. A configured line is never lost; a transaction can still abort under contention and is then retried like any write failure. `TC-PCFG-062` pins this.
- The lock header uses `OPTIMISTIC_LOCK_HEADER_NAME` from `@open-mercato/shared/lib/crud/optimistic-lock-headers`, which `enforceSalesDocumentOptimisticLock` reads from `ctx.request` (`sales/commands/shared.ts:38-49`). It is a no-op when optimistic locking is disabled for `sales.quote`; step 3's re-read still applies.
- Converting a quote deletes the quote and its lines (`documents.ts:7061-7062`). The upsert then fails, mapped to `quote_converted`: the session can never finish, so it is cancelled and the UI offers a way out instead of a retry.
- Errors before the line write (`model_deleted`, `product_missing`, `price_missing`, `currency_mismatch`, `not_finalisable`, `result_changed`, `session_changed`, `quote_changed`) set the session back to `open`; the rep can fix, retry or discard. `quote_converted` cancels it. `quote_line_write_failed` sets it back to `open` with Retry.
- Recovery never re-evaluates before checking for a committed line, so a crash between the sales commit and storing `quote_line_id` never attaches a new price to an old line.
- There is no quote status rule: quote statuses are tenant dictionary values and sales has no "editable" rule. A session can be opened and finalised while the quote exists; conversion deletes the quote, which ends that.
- **Revision**: every successful `evaluate` increments the session `revision` and returns it. `evaluate` and `finalise` carry the revision the client last saw; a stale one is rejected with 409 `session_changed` and the current state, so an older request can never overwrite a newer one and two windows on a shared session cannot silently overwrite each other. The UI keeps the rejected local choices and shows them next to the current ones, with "Keep current" or "Apply my choices" (re-sent on the current revision).
- **Price confirmation**: `finalise` carries the `expectedHash` of the result the rep saw. Re-evaluation in step 3 uses current catalog prices; if the hash differs, nothing is written and 409 `result_changed` returns the new result. A replay of a finalised session still returns the stored result.
- **Intent vs result**: `selections` stores only what the user chose. Values set by `force` rules live only in `evaluation`. When the condition of a force rule stops holding, the user's own value (or the default) comes back. Hidden and shown features keep the user's value in `selections`.
- **Modes**: v1 has `new` and `duplicate`. `fromSnapshotId` without `mode` means `duplicate`: the session is prefilled from the snapshot, re-priced, and finalise adds a separate line. `source_snapshot_id` records the copy source, which the header uses ("Copy of: <line name>"); it has no replacement meaning in v1. `mode: 'replace'` returns 400 `mode_not_supported` until Phase E, which adds it as an explicit value and keeps `duplicate` as the default.
- **Selection migration**: opening from a snapshot whose model version is older than the latest maps the old selections onto the new version and returns `migration: { kept[], dropped[], reset[] }`, each item with the feature label, the old value and the reason (feature removed, option removed, out of range). Nothing is silently replaced. It applies to `duplicate` (and to `replace` in Phase E), so "Add another identical" shows a review when the latest version changed the copied choices. When the list is not empty, `finalise` requires `migrationAcknowledged: true` (else 422 `migration_unconfirmed`). Plain `evaluate` stays strict.
- **Orphaned sessions**: an `afterExecute` hook on the `sales.quotes.convert_to_order` interceptor (`packages/shared/src/lib/commands/command-interceptor.ts:25`) cancels the quote's `open` sessions with reason `quote_converted`. For the quote's `finalising` sessions it tries the quote lock: when free, it runs the step-2 reconcile against the lines of the order in the command result (`result.orderId`, which also covers a conversion with an explicit `orderId`; order lines keep the quote line ids, `documents.ts:6897`) (a line carrying the snapshot -> adopt and finalise, none -> cancel); when busy, the running finalise ends the session itself. It is idempotent. This covers a crash between the sales commit and storing `quote_line_id` followed by a conversion, which would otherwise leave the session in `finalising`. Undoing a conversion restores the quote but not the sessions the hook cancelled; the rep starts a new configuration. Redo of a finalise line write is rejected by the guard (`configured_line_forged`), because redo runs the interceptors with an untrusted request; the rep configures again.
- `fromSnapshotId` must belong to the same quote and model (`snapshot_not_in_quote`).
- Finalise failures are logged with `createLogger('product_configurator.finalise')` and reported with `reportError` (`packages/telemetry/src/facade/report-error.ts`).

### Phase E: line replacement (after v1)

Designed now so v1 does not block it; it ships after A-D are merged and Q2 is answered. If maintainers provide a sales-owned atomic replace command, step 6 and the conversion guard below switch to it.

- **Re-configure**: `mode: 'replace'` (explicit; the default stays `duplicate`) opens a session from a snapshot whose line is on the quote. When no quote line carries the snapshot, open returns 409 `source_line_removed` and the tab offers "Configure again" instead; if the source line is deleted after open, finalise returns the same error before writing anything. Only one active replacement per source: unique `(source_snapshot_id)` where `mode = 'replace'` and `status in ('open', 'finalising')`; a second open gets 409 `source_in_use`.
- **Carry-over**: when the session replaces a line, finalise reads the source line through `queryEngine` and carries over its commercial terms, because a new line otherwise gets `comment: null` and `discountPercent: 0` from the upsert:
  - `name` when it differs from the model title (the rep renamed it), `comment` and `discountPercent` are copied as they are;
  - the source line's numeric `taxRate` is copied (quote lines store the rate, not `taxRateId`, `sales/data/entities.ts:1085`); with `priceMode: 'net'`, a net price and no gross, the upsert computes gross through `taxCalculationService` (`sales/commands/documents.ts:8013-8037`);
  - a fixed `discountAmount` (with `discountPercent` 0) was negotiated on the old price, so finalise needs `discountAmountDecision: 'keep'` (copied) or `'remove'` (not copied); without it 422 `discount_amount_unconfirmed`;
  - the summary is always rebuilt from the new choices.
- **Review**: before "Replace line" the workspace always shows the re-configure review: old and new choices (with the migration items when there are any), the carried-over terms, the old price, the new price and the difference, and the fixed-discount decision when it applies. The difference is not split into causes. 
- **Step 6**: delete the source snapshot's line, with no lock header (step 5 has just updated the quote, so the step-3 `updatedAt` is stale, and the delete only removes a line this module wrote). Line not found -> done. Quote not found (converted) -> `replacement_state = incomplete_after_conversion`. Other failure -> `replacement_state = pending`, release the lock and return `replacementPending`; the session stays `finalising` and step 7 is not reached. The retry action takes the lock, goes straight to step 6 through step 2 (later price or model changes do not block it) and retries the delete. Step 7 clears `replacement_state` (or keeps `incomplete_after_conversion`). Phase E changes step 2: a linked or adopted snapshot whose session still has a replacement to finish (a `source_snapshot_id` in `replace` mode and no `replacement_state` of `incomplete_after_conversion`) goes to step 6, not 7, so Retry resumes the delete.
- **Conversion guard**: an interceptor on `sales.quotes.convert_to_order` tries the same advisory lock and releases it at once; if finalise holds it, conversion is rejected with 409 `configuration_in_progress`. A conversion that passed this check just before finalise took the lock can still run alongside step 5-6; then the order may carry both the new and the replaced line. That case is detected (`incomplete_after_conversion`), shown on the order tab with the replaced snapshot, and left to the user to remove. Q2 asks whether sales prefers to own an atomic "replace configured line" command that closes this window.
- **Contract additions**: finalise accepts `discountAmountDecision` and returns `replacementPending`; new errors 409 `source_line_removed`, 409 `source_in_use`, 422 `discount_amount_unconfirmed`, 409 `configuration_in_progress` (conversion). Snapshot `lineState` adds `replaced` and `replacement_pending` (by `quoteId`) and `replaced_before_conversion` (by `orderId`), plus `replacement: { replacesSnapshotId?, replacedBySnapshotId?, state? }`; the source snapshot of a pending replacement stays `present` with `replacement.replacedBySnapshotId`.
- **Data**: sessions gain `replacement_state` (`pending` | `incomplete_after_conversion`) and the partial unique index above, in Phase E's own migration.
- **UI**: "Re-configure" on configured lines; header "Replacing: <line name>" with the source and target model version; "Replace line" opens the re-configure review, "Edit choices" returns to the workspace and "Replace line" in the review finalises; "Re-configuration in progress" disables a second one; a pending replacement is one card for the new line that names the old line and offers Retry, and is not announced as full success; "Replaced configurations" history; the two-line warning in `sales.document.detail.{quote,order}:details` while a quote has `replacement_pending` or an order has a line replaced before conversion; on orders the "Configured" column and the order tab mark the old line "Replaced before conversion". Outcomes: `source_line_removed` offers Discard and "Configure again"; `source_in_use` points to the running re-configuration; a conversion refused with `configuration_in_progress` says to try again in a moment.

### Access control at runtime

Routes declare `requireFeatures` in metadata. Commands and custom read routes re-check through `rbacService.userHasAllFeatures` / `authorizeFeatures` from `@open-mercato/shared/security/featurePolicy` (wildcard-aware), as `packages/shared/AGENTS.md` requires:

| Operation | Features |
|---|---|
| `sessions.open`, `sessions.evaluate`, `sessions.cancel`, `GET /sessions` | `product_configurator.sessions.manage`, `sales.quotes.view` |
| `sessions.finalise` | `product_configurator.sessions.manage`, `sales.quotes.manage` |
| `GET /snapshots` by `quoteId` or `id`, quote tab, snapshot page opened from a quote | `product_configurator.snapshots.view`, `sales.quotes.view` |
| `GET /snapshots` by `orderId` (alone or with `id`), order tab, snapshot page opened from an order | `product_configurator.snapshots.view`, `sales.orders.view`; with `id`, the order must have a line carrying that snapshot |
| `POST /models/preview` (studio Test tab) | `product_configurator.models.manage`, `catalog.products.view` (it returns catalog prices, also customer-specific ones) |
| `GET /catalog-items` (studio BOM and lookup editors) | `product_configurator.models.manage`, `catalog.products.view` |
| `POST /lines/update` (edit line details) | `product_configurator.sessions.manage`, `sales.quotes.manage` |

Sessions are shared within the organization: any user who passes the checks can continue another rep's session. `created_by` is kept for audit and shown as "Started by". Concurrent edits are caught by the session revision. `createdBy.displayName` is read at request time from the auth user and never stored; the exact auth read is confirmed in Phase C. When the selected organization is "all", the session, snapshot, validate, publish, preview, `lines/update` and `catalog-items` routes return `organizationScopeRequiredResponse()` (400); `makeCrudRoute` routes keep the factory behaviour.

### Configured line guard

`commands/interceptors.ts` registers interceptors without `features` (an interceptor with features is skipped for users without them) and with `priority: 1000`, so they run after every other interceptor and see the final input (lower priority runs earlier). The context has no `em`; the guard resolves `queryEngine` from `container`. It runs before the sales transaction, so the read is not transactional (see risks).

- **`sales.quotes.lines.upsert` and `sales.orders.lines.upsert` with `input.body.id`**: read the stored line. If it carries `configuration.productConfigurator`, reject with 409 `configured_line_locked` when the body changes the marker (including `configuration: {}` or `null`) or a configured input: `productId`, `productVariantId`, `currencyCode`, `quantity`, `quantityUnit`, `unitPriceNet`. Numbers are compared after rounding both sides to 4 decimals (`numeric(18,4)`), so the standard line dialog, which resends the same values as floats, passes. Sales accepts explicit `taxAmount`, `totalNetAmount` and `totalGrossAmount` and uses them as given (`sales/data/validators.ts:348`, `sales/lib/calculations.ts:164`), so on a configured line the guard also rejects a body that carries any of them with a value different from the stored one; `product_configurator.lines.update` never sends them and lets sales derive them from net, tax and discount. If the stored line has no marker and the body adds one, reject with 422 `configured_line_forged`.
- **Line inserts (no `id`) carrying the marker**: allowed only when all of these hold, otherwise 422 `configured_line_forged`:
  - `ctx.request` is a Request the finalise command created itself (kept in a process-local `WeakSet`; commands run in-process on the command bus, so no public route can present one);
  - the referenced snapshot exists in the same scope and quote, has no `quote_line_id`, and its session is `finalising`;
  - the body matches the snapshot: `productId`, `currencyCode`, `quantity: 1`, `unitPriceNet` equal to the snapshot net price, and the marker's `hash` equal to the snapshot hash.
- **`sales.quotes.create` and `sales.orders.create` with inline `lines`** (flat input): lines carrying the marker are rejected the same way.
- **Standard line dialog**: it cannot save a configured line at all, because a catalog line without a variant fails its validation (`sales/components/documents/LineItemDialog.tsx:1490`) before reaching the guard, and it has no discount or comment field. v1 does not change it. Commercial fields of a configured line are edited from the Configurations tab (see UI/UX); Q5 asks maintainers about a quote-items host and about exposing the line to dialog field widgets. The guard still protects every other write path (API, inline lines, inbox actions).
- **`sales.quotes.convert_to_order`**: no guard in v1, only the `afterExecute` cleanup (see Conversion during finalise); Phase E adds the conversion guard. The order line keeps price and configuration, and the order-line guard protects it from then on.
- **Undo**: not intercepted. Sales undo restores the stored quote graph.
- Deletion stays allowed. Messages go through `resolveTranslations`.

### Commands & Events

| Command | Audit | Undo | Lock |
|---|---|---|---|
| `product_configurator.models.create` | yes | soft-deletes the model | - |
| `product_configurator.models.update` | yes | restores previous title and draft | `updatedAt` |
| `product_configurator.models.delete` | yes | restores the model | `updatedAt` |
| `product_configurator.models.publish` | yes | no - versions are immutable and may be referenced by snapshots | `updatedAt` |
| `product_configurator.sessions.open` | yes | no - transient work item, cancel instead | - |
| `product_configurator.sessions.evaluate` | no - runs on every change, stores draft selections only | no | session `revision` |
| `product_configurator.sessions.cancel` | yes | no | - |
| `product_configurator.sessions.finalise` | yes | no - see below | per-quote advisory lock, `revision`, `expectedHash` |
| `product_configurator.lines.update` | yes | sales undo of the line write | quote `updatedAt` (lock header) |

`product_configurator.lines.update` edits `name`, `comment`, the discount and the tax rate of a configured line by dispatching `sales.quotes.lines.upsert` with the stored configured inputs unchanged, so the guard passes. Discount modes are explicit because a non-zero percentage always wins in sales (`sales/lib/calculations.ts:97`): choosing an amount sends `discountPercent: 0`, choosing a percentage sends `discountAmount: 0`, choosing none sends both 0. A tax change sends the chosen `taxRateId` and its numeric `taxRate`; Phase D verifies that gross is recomputed on an existing line (`TC-PCFG-055`). Commands return domain results and throw `CrudHttpError` helpers (`badRequest`, `notFound`, `conflict`). HTTP mapping stays in routes. Reference: `customers/commands/interactions.ts` (`buildLog`, undo via `extractUndoPayload`, `emitCrudSideEffects`, `enforceCommandOptimisticLockWithGuards`). Events are declared with `createModuleEvents`.

Finalise has no undo of its own. The line write (and in Phase E the replaced-line delete) is a sales command with its own undo entry (`undoQuoteGraph`, `documents.ts:4093`). Sales treats an undo as stale only when the set of line or adjustment ids, notes, tags or addresses changed (`documents.ts:4076-4091`). Edits to line content or the quote header made later are silently reverted by such an undo. This is sales behaviour, not changed by this module. The quote tab shows a snapshot whose line is gone as "line removed" and offers "Configure again".

| Event | Payload |
|---|---|
| `product_configurator.model.created` / `.updated` / `.deleted` | `{ id, tenantId, organizationId }` |
| `product_configurator.model_version.published` | `{ modelId, modelVersionId, version, hash, tenantId, organizationId }` |
| `product_configurator.snapshot.created` | `{ snapshotId, sessionId, modelVersionId, quoteId, quoteLineId, hash, tenantId, organizationId }` |

Events are emitted from commands after commit. None are `clientBroadcast` in v1.

## Definition DSL

`schemaVersion: 1`. The definition is tenant data. Authored labels and messages are model content, not UI strings.

- **`commercial`**: `currencyCode` (ISO 4217), `priceKindId` (uuid), `allowPromotions` (boolean, default false), `priceDisclaimer?`. Both `currencyCode` and `priceKindId` are chosen in the create dialog; there are no hidden defaults.
- **`fixedSpecification[]`**: `{ label, value }`, display only.
- **`features[]`**: `key`, `label`, `type: 'choice' | 'boolean' | 'number' | 'color'`, `options?: { value, label, order, swatch? }[]`, `optionsFromLookup?: lookupKey` (a `permitted` lookup), `min?`, `max?`, `step?`, `unit?`, `group?`, `default`, `order`, `inSummary` (replaces the hackathon `drivesGeometry`), `visibleWhen?: Condition[]`. `color` is a choice whose options carry a `swatch` validated as `#RRGGBB`.
- **Conditions** (AND-combined, empty = true): `compare { featureKey, op: eq|neq|gt|gte|lt|lte, value }` (`eq`/`neq` as strings, ordering ops as numbers), `includes` / `not_includes { featureKey, value }` (one whitespace tokenisation shared by evaluator and validator), `not_in_lookup { featureKey, lookupKey, keyedBy }`, `calculated { formulaKey, op: gt|gte|lt|lte, value }`.
- **Rules**: `id`, `label?` (friendly name shown with the id in the studio and validation reports), `effect: 'error' | 'warning' | 'force' | 'surcharge'`, `when`, `action?` (required for `force`), `messageTemplate`, `featureKeys`, `order`.
- **Actions**: `set { featureKey, value }` writes a value; `map { featureKey, from: Record<string, string> }` replaces the current value of the feature using the table (no entry = no write); `lookup_default { featureKey, lookupKey, keyedBy }` writes the `default` of the `permitted` row matching the `keyedBy` feature (no row = no write).
- **Message placeholders**: `{feature.<key>}` (option label for choices), `{formula.<key>}` (with formula decimals), `{lookup.<key>}` (a `value` lookup renders its value; a `permitted` lookup renders the allowed values joined with `, `), `{line.<bomId>.total}`. Rendered as plain text, never as HTML.
- **Expressions**: AST `const | feature | formula | lookup | op(+,-,*,/)`. Phase B adds a hand-written text parser (`feature.boom_reach * lookup.weight / 2`) that round-trips with the printer and never uses `eval` or `new Function`.
- **Formulas**: `key`, `label?`, `expr`, `unit?`, `decimals?` (0-6).
- **Lookups**: `value { key, label?, keyedBy, rows: { match, value }[] }` and `permitted { key, label?, keyedBy, rows: { match, values[], default }[] }`. `label` is the friendly name shown in the studio, autocomplete and errors (the key when absent). `match` is compared with the string form of the `keyedBy` selection.
- **BOM**: `id`, `sku` or `skuFromLookup { lookupKey, keyedBy }` (a `value` lookup whose values are SKUs), `uom`, `quantity` (number or `{ formulaKey }`), `when`, `ruleId?` (binding to a `surcharge` rule), `order`. The line label comes from the catalog title.
- **Missing SKU mapping**: when a BOM line's `when` holds but its `skuFromLookup` has no row for the selection, evaluation adds the blocking error `bom_sku_unmapped { bomId, featureKey, value }`. A part is left out only through an explicit `when`, never through a gap in a lookup.
- **Units**: a fixed-SKU line takes its `uom` from the catalog (read-only in the studio). A `skuFromLookup` line needs one common catalog unit across all reachable SKUs; none, or a missing unit, fails publication with `bom_unit_mismatch`.
- **Surcharge**: a `surcharge` rule never changes selections. A BOM line bound to it is included when the line's own `when` holds. The rule's own `when` only decides whether its message is shown, with `{line.<bomId>.total}` filled in; the message is never shown for a line that is not in the BOM.

### Limits

Enforced by the zod schema and the evaluate route: at most 200 features, 500 rules, 100 formulas, 100 lookups with 1000 rows each, 500 BOM lines, 50 conditions per rule; a definition of at most 512 KB; an evaluate request of at most 64 KB.

### Evaluator contract

- **Structure step** input: definition, version id and hash, raw selections. Output: settled selections, visibility, forced changes, `calculated` formula values, BOM lines with quantities, availability, errors and warnings, `finalisable`.
  1. Normalise: unknown keys rejected, types coerced, `min` / `max` / `step` / option membership enforced (`invalid_selection`), defaults applied.
  2. Settle: each pass applies visibility (a hidden feature takes its default) and then `force` rules in `order`. Max 3 passes plus one confirming pass. Every pass rebuilds the context, so `calculated` conditions read formulas computed from the current selections. Still changing after the last pass: `fixed_point_not_reached`.
  3. Validate forced values against bounds and options (`forced_value_invalid`).
  4. Formulas, BOM, then `error` / `warning` rules in `order`.
  5. Availability: a feature with `optionsFromLookup` allows the `values` of the `permitted` row matching its `keyedBy` selection; no row means no allowed values and reason code `no_permitted_values`. Other features allow all their options.
  6. Enforce availability: a visible feature whose settled value is not allowed adds the blocking error `option_not_available`; a visible feature with no allowed values adds the blocking error `no_permitted_values`. Hidden features are exempt. This holds without any authored rule, so a direct API call cannot finalise a disallowed value.
- **Price step** input: structure, unit prices per SKU, currency exponent. Output: BOM line totals, net price, `hash`.
- Errors and warnings are `{ ruleId, params }`, rendered in the UI.
- Expression failures (missing lookup row, division by zero, non-numeric input) become typed evaluation errors (422 `expression_error`), never a 500.
- Hash: sha256 of canonical JSON over version id and hash, settled selections, `calculated`, forced changes, error and warning rule ids with params, BOM `{ sku, quantity, unitPrice, total }` as scaled integers, currency and price kind. No formatted strings, no rendered messages.

### Publication checks

`schema`, `limits`, `lookup_coverage` (every option of a choice, color or boolean feature used as `keyedBy` by `skuFromLookup` or `optionsFromLookup` has a row), `duplicate_key` (features, formulas, lookups, BOM ids, rule ids), `referential_integrity` (SKUs and the bound product through `catalogPriceRowService`), `ambiguous_sku`, `bom_unit_mismatch`, `formula_cycle`, `fixed_point` (including reads through `calculated` and `visibleWhen` conditions), `numeric_expr_reference`, `default_valid` (defaults inside options and bounds), `surcharge_binding` (a surcharge rule bound to at most one BOM line), `placeholder_reference`, `price_kind`. Each issue is `{ check, code, params, refs }` with an i18n message key.

## Data Models

All tables carry `tenant_id` and `organization_id`. Cross-module references are uuid columns, never ORM relations. No column stores customer personal data, so no `encryption.ts` entry is needed. The customer name shown in the configurator header is read from the quote at request time and never stored.

```mermaid
flowchart LR
    classDef newEntity fill:#2f6feb,color:#fff,stroke:#1b4fb0
    classDef existingEntity fill:#e5e7eb,color:#111,stroke:#9ca3af

    entity_1["ConfigurationModel"]:::newEntity
    entity_2["ConfigurationModelVersion"]:::newEntity
    entity_3["ConfigurationSession"]:::newEntity
    entity_4["ConfigurationSnapshot"]:::newEntity
    entity_5["CatalogProduct (id)"]:::existingEntity
    entity_6["SalesQuote (id)"]:::existingEntity
    entity_7["SalesQuoteLine (id, configuration)"]:::existingEntity
    entity_8["SalesOrderLine (configuration)"]:::existingEntity

    entity_2 -->|"n-1 model_id"| entity_1
    entity_3 -->|"n-1 model_version_id"| entity_2
    entity_4 -->|"1-1 session_id"| entity_3
    entity_4 -->|"n-1 model_version_id"| entity_2
    entity_3 -->|"n-1 source_snapshot_id"| entity_4
    entity_1 -->|"n-1 product_id"| entity_5
    entity_3 -->|"n-1 quote_id"| entity_6
    entity_4 -->|"n-1 quote_id"| entity_6
    entity_4 -->|"1-1 quote_line_id"| entity_7
    entity_7 -->|"n-1 configuration snapshotId"| entity_4
    entity_8 -->|"n-1 configuration snapshotId"| entity_4
```

Blue: new entities. Grey: existing entities, with only the fields the relation uses. Every arrow is a uuid column or a jsonb reference, never an ORM relation. BOM SKUs are resolved through `catalogPriceRowService` and stored as values, not as references.

### ConfigurationModel (`product_configurator_models`)
- `id` uuid PK, `tenant_id`, `organization_id`
- `product_id` uuid (catalog product, FK id only)
- `model_key` text, `title` text
- `currency_code` text (set in the create dialog, kept equal to `commercial.currencyCode`; the studio does not change it)
- `draft_definition` jsonb, `draft_hash` text
- `latest_version_id` uuid nullable
- `created_at`, `updated_at` (optimistic lock), `deleted_at` nullable
- unique `(tenant_id, organization_id, model_key)` where `deleted_at is null`; indexes `(tenant_id, organization_id, product_id)`, `(tenant_id, organization_id, currency_code)`
- Derived state: "not published" when `latest_version_id` is null; "unpublished changes" when `draft_hash` differs from the latest version hash. Editing the draft never hides a published model: newly opened sessions use the latest published version, and an open session stays on the version it was opened with.

### ConfigurationModelVersion (`product_configurator_model_versions`)
- `id`, `tenant_id`, `organization_id`, `model_id`, `version` int, `definition` jsonb, `validation_report` jsonb, `hash` text, `published_at`
- unique `(model_id, version)`
- Immutable by design: no `updated_at`, no edit or delete API, so exempt from optimistic locking.

### ConfigurationSession (`product_configurator_sessions`)
- `id`, `tenant_id`, `organization_id`, `model_version_id`, `quote_id`, `source_snapshot_id` nullable (copy source; the replaced snapshot in Phase E)
- `selections` jsonb (user intent only), `evaluation` jsonb nullable (settled result), `revision` int default 0, `mode` text (`new` | `duplicate`; Phase E adds `replace`), `migration` jsonb nullable
- `status` text (`open` | `finalising` | `finalised` | `cancelled`; the hackathon called the last one `abandoned`)
- `created_by`, `created_at`, `updated_at`
- indexes `(tenant_id, organization_id, quote_id)`, `(tenant_id, organization_id, status)`; Phase E adds `replacement_state` and a partial unique index (see Phase E)
- Concurrency: `revision` guards `evaluate` and `finalise`; finalise is also serialized by the per-quote advisory lock. Open sessions do not expire in v1; they are cancelled from the UI, and automatically when their quote is converted.

### ConfigurationSnapshot (`product_configurator_snapshots`)
- `id`, `tenant_id`, `organization_id`, `model_version_id`, `model_version_hash`, `session_id`, `quote_id`, `quote_line_id` nullable
- `selections`, `calculated`, `bom`, `warnings`, `price_context` jsonb; `net_price` numeric; `currency_code` text; `summary` text; `hash` text; `created_at`
- unique `(session_id)`; indexes `(tenant_id, organization_id, quote_id)`, `(tenant_id, organization_id, created_at)`
- No `updated_at`. While `quote_line_id` is null the snapshot belongs to an unfinished finalise; the next call first looks for a committed line carrying it and only replaces it when there is none. Once `quote_line_id` is set it is immutable. Errors are not stored: a finalised configuration has none.

### Lifecycle rules

- Deleting a model (soft) blocks new sessions. Open sessions of that model fail on finalise with `model_deleted`. Versions and snapshots stay.
- A deleted bound product or SKU fails publish (`referential_integrity`) and finalise (`product_missing`, `price_missing`).
- After conversion the quote and its lines no longer exist. The snapshot's `quote_id` and `quote_line_id` keep their values as history; the order tab finds snapshots through `configuration.productConfigurator.snapshotId` on order lines.

## API Contracts

All routes live under `/api/product_configurator/`, export `openApi`, and scope with the selected organization. CRUD routes use `makeCrudRoute` with command-backed writes and `indexer: { entityType }`, so mutation guards run through the factory. Custom routes call `resolveOrganizationScopeForRequest`, then `runRouteMutationGuards` (`shared/lib/crud/route-mutation-guard.ts`), re-validate its `modifiedPayload`, and call its `runAfterSuccess`. The deprecated `validateCrudMutationGuard` is not used, because it bypasses the guard registry. The definition is documented as an opaque object in OpenAPI, because the recursive schema overflows the generator. Responses return only the fields the UI needs.

| Method + path | Feature | Request -> Response | Errors |
|---|---|---|---|
| `GET /models` | `models.view` | `page`, `pageSize` (max 100), `search`, `productId`, `published`, `currencyCode`, `sortField` (`title`, `modelKey`, `updatedAt`), `sortDir` -> items with `updatedAt`, latest version, unpublished-changes flag, no definition (one grouped query, no N+1); `id` -> detail with `draftDefinition`, `title`, `modelKey`, `productId`, `updatedAt` for the studio | 404 |
| `POST /models` | `models.manage` | `{ productId, modelKey, title, currencyCode, priceKindId, draftDefinition? }` (empty skeleton with these commercial values when omitted) -> `{ id }` | 409 `duplicate_model_key` |
| `PUT /models` | `models.manage` | `{ id, title?, draftDefinition? }` + lock header -> `{ id, updatedAt }` | 400 `invalid_definition`, 409 lock |
| `DELETE /models` | `models.manage` | `{ id }` + lock header | 409 lock |
| `POST /models/validate` | `models.manage` | `{ id }` -> validation report | 404 |
| `POST /models/publish` | `models.manage` | `{ id }` + lock header -> `{ modelVersionId, version, hash }` | 422 `validation_failed`, 409 lock |
| `GET /model-versions` | `models.view` | `modelId` -> versions without definition; `id` -> one version with definition | 404 |
| `GET /sessions` | see Access control | `id` or `quoteId` -> `{ id, status, mode, revision, quoteId, quote: { number, customerName }, modelVersion, selections, evaluation, sourceSnapshotId, migration, createdBy: { id, displayName }, createdAt }` | 404 |
| `POST /sessions` | see Access control | `{ quoteId, modelId?, fromSnapshotId?, mode? }` -> `{ sessionId, revision, modelVersion, quote: { id, number, customerName }, migration? }` | 404, 400 `mode_not_supported` (`replace` before Phase E), 409 `currency_mismatch`, 409 `no_published_version`, 409 `model_required` (with candidate ids), 422 `snapshot_not_in_quote`; Phase E adds 409 `source_in_use`, 409 `source_line_removed` |
| `POST /sessions/evaluate` | see Access control | `{ id, selections, revision }` -> evaluation result with the new `revision` | 409 `session_not_open`, 409 `session_changed`, 422 `bom_sku_unmapped`, 413 `payload_too_large`, 422 `invalid_selection`, 422 `forced_value_invalid`, 422 `fixed_point_not_reached`, 422 `price_missing`, 422 `expression_error` |
| `POST /sessions/cancel` | see Access control | `{ id }` -> `{ status }` | 409 `session_not_open` |
| `POST /sessions/finalise` | see Access control | `{ id, expectedHash, revision, migrationAcknowledged? }` -> `{ snapshotId, quoteLineId, hash, replay }`; Phase E adds `discountAmountDecision` and `replacementPending` | 409 `result_changed` (with the new result), 409 `session_changed`, 409 `session_not_open` (discarded or cancelled; a finalised session returns its stored result with `replay: true`), 422 `migration_unconfirmed`, 409 `finalise_in_progress`, 409 `quote_changed` (quote edited after step 3), 409 `quote_converted` (quote converted or deleted), 409 `currency_mismatch`, 409 `model_deleted`, 422 `not_finalisable`, 422 `product_missing`, 422 `price_missing`, 422 `expression_error`, 422 `fixed_point_not_reached`, 502 `quote_line_write_failed` |
| `POST /lines/update` | `sessions.manage` + `sales.quotes.manage` | `{ quoteId, lineId, name?, comment?, discount?: { mode: 'percent' \| 'amount' \| 'none', value? }, taxRateId? }` + quote lock header -> `{ lineId, updatedAt }` | 404, 409 lock, 422 `not_a_configured_line` |
| `POST /models/preview` | `models.manage` | `{ id, selections, context?: { channelId?, customerId?, date? } }` -> evaluation of the saved draft priced from the catalog for the given context (or a labelled reference context), plus `trace: { firedRules: [{ ruleId, label, effect }] }`; no session, no finalise | 404, 422 evaluation errors |
| `GET /catalog-items` | `models.manage` | `skus` (comma-separated, max 100) -> `{ items: [{ sku, title, unit }], unknown[], ambiguous[] }` through `catalogPriceRowService.resolveSkus`, so the studio shows catalog titles and units and marks unknown or ambiguous SKUs while a row is edited | 400 over the limit |
| `GET /snapshots` | see Access control | `quoteId`, `orderId`, `ids` (max 100) or `id` -> snapshot read model (below) | 404 |

Snapshot read model: `id`, `sessionId`, `quoteId`, `quoteLineId`, `lineState`, `lineName` (name of the document line that carries the snapshot, read through `queryEngine`; null when the line is gone, and the UI then shows `modelTitle`), `modelTitle`, `modelVersion { id, version, hash }`, `summary`, `selectionRows[{ label, value, unit }]` (visible features), `calculatedRows[{ label, value, unit }]` (labelled formulas), `specification[{ label, value }]`, `bom[{ sku, label, quantity, uom, unitPrice, total }]`, `netPrice`, `currencyCode`, `warnings[{ ruleId, message }]`, `hash`, `createdAt`. `orderId` reads the order's lines and returns the snapshots they reference.

`lineState` is computed against the document asked for. By `quoteId` or `orderId`: `present` or `removed` (no line of that document carries the snapshot); Phase E adds the replacement states and the `replacement` field. By `id` alone: `present` when the quote line `quote_line_id` exists, or an order line with the same id carries the snapshot (order lines keep the quote line ids), otherwise `removed`.

Feature ids are prefixed with `product_configurator.`. Model candidates for `model_required` are all non-deleted models with a published version in the organization whose `currency_code` matches the quote; the `currencyCode` filter of `GET /models` uses the same column. The quote tab shows them in a picker and sends `modelId`.

No caching in v1. Every read goes to the database. Each read is bounded: lists by `pageSize` ≤ 100, snapshots by quote, price rows by the BOM limit.

## Access Control

`acl.ts`: `product_configurator.models.view`, `product_configurator.models.manage` (depends on view), `product_configurator.sessions.manage`, `product_configurator.snapshots.view`.

`setup.ts` `defaultRoleFeatures`: `superadmin` and `admin` get `product_configurator.*`. `employee` gets `product_configurator.sessions.manage`, `product_configurator.models.view` and `product_configurator.snapshots.view`, matching the sales quote features employees already hold (`sales/setup.ts:60-61`). Existing tenants pick these up with `yarn mercato auth sync-role-acls`. No demo roles and no `seedDefaults` users.

`seedExamples` creates one neutral reference model with its catalog products and prices through catalog commands. Integration tests never depend on it.

## Internationalization (i18n)

- Namespaces: `product_configurator.models`, `.studio`, `.versions`, `.configurator`, `.snapshot`, `.quoteTab`, `.orderTab`, `.validation`, `.errors`, `.nav`; ACL labels under `auth.acl.features.product_configurator.*`.
- Validation issues and evaluation errors carry `code` and `params`. The UI renders them with `useT`. The line guard uses `resolveTranslations`.
- Every locale the app ships (`en`, `de`, `es`, `ko`, `pl`), checked by `i18n:check-sync` and `i18n:check-usage`.

## UI/UX

- `/backend/product_configurator/models`: `DataTable` of models with publish state (`StatusBadge`) and unpublished-changes flag, filters and sort; create dialog as `CrudForm` (title, key, catalog product, currency, price kind).
- `/backend/product_configurator/models/[id]`: studio with tabs Overview (`CrudForm`), Features, Formulas, Lookups, Rules, BOM, Dependencies, Test, and an advanced JSON view of the whole draft (validated, same lock).
  - Features, Lookups, Rules and BOM use `DataTable` row editors with `ConditionRows`, including `visibleWhen`. The feature editor covers key, label, type, options (order, swatch) or `optionsFromLookup`, min/max/step and unit for numbers, group, order, default, `inSummary` and `visibleWhen`. The rule editor covers effect, all condition kinds, the force action (set a value, map values, or default from a permitted lookup), the message and "Fields highlighted for the rep" (`featureKeys`), prefilled with the features used in the conditions and editable. Rules show `label` and id. Large lookups (up to 1000 rows) are edited in the row editor or, for bulk changes, in the advanced JSON view, which is a supported path with the same validation. Spreadsheet paste is not in v1.
  - Formulas use a text input with autocomplete by friendly name (a combobox: arrows, Enter, Escape; picking a suggestion inserts the key), live parse errors and a preview. Errors name both the friendly name and the key and offer a one-click fix for a close match.
  - BOM units are read-only from the catalog for a fixed SKU; for a SKU from a lookup the common unit is shown and checked. BOM and lookup editors read titles and units through `GET /catalog-items` when a row is edited and mark unknown or ambiguous SKUs; there is no fuzzy SKU suggestion in v1. Validate runs the same checks on the saved draft.
  - Draft save and publish go through `useGuardedMutation` with `retryLastMutation` and the optimistic-lock header. Validate and Publish act on the saved draft, so they are disabled while there are unsaved edits. "Discard unsaved changes" (with confirmation) restores the last saved draft. Publish shows the validation report inline.
  - A 409 on save shows the conflict bar through `surfaceRecordConflict` with a custom `onRefresh`: before refreshing, the admin confirms losing local edits and can copy them first ("Copy my draft (JSON)").
  - **Test tab**: the configurator workspace runs against the saved draft through `POST /models/preview`, with no session and no finalise. The admin picks a pricing context (channel from `/api/sales/channels`, customer, date) or uses the reference context: the model's price kind with no channel and no customer at today's date, labelled as such. With unsaved edits the tab says that it tests the saved draft. Needs `models.manage`.
- `/backend/product_configurator/models/[id]/versions/[versionId]`: read-only published version.
- `/backend/product_configurator/configure/[sessionId]`: loads the session through `GET /sessions?id=`, then a two-panel workspace.
  - Options grouped by `group` in collapsible sections, hidden features left out. Controls by type: a choice with up to 5 options as a radio group (segmented look), more as a select; boolean as a switch; color as a radio group of swatches; number as a text field with unit. Disabled options stay focusable with the reason linked as their description.
  - A number field keeps its own text while typing; it sends to `evaluate` on Enter, blur or a 400 ms pause, and only a valid number. Range and step errors show under the field. While any field holds text that is not a valid, evaluated value, the primary action stays disabled.
  - A sticky summary on the right holds the net price, status and the primary action; the BOM below it is collapsible. On a narrow screen the summary becomes a bottom bar.
  - Messages link to the fields they concern (`featureKeys`): clicking one scrolls to and highlights the field.
  - While a change is evaluated the result is shown as updating (previous result greyed, primary action disabled). Errors map to states: `invalid_selection` under the field; `bom_sku_unmapped` and `price_missing` name the part (and channel) and say an admin must fix the model or the catalog; `expression_error`, `fixed_point_not_reached` and `forced_value_invalid` block with "This model needs a fix by an admin" and the reference; `session_changed` reloads the current state and explains that someone else changed it; `session_not_open` says the configuration was added or discarded elsewhere and links to the quote; network errors and 5xx keep the last good result with Retry. A partial BOM is shown only when marked incomplete.
  - Header shows quote number, customer name and, for a copy, "Copy of: <line name>" (Phase E adds "Replacing: <line name>"). When `migration` is not empty, every dropped or reset field is marked inline from the moment the workspace opens ("Reset to Navy: Signal red was removed in v4"), so nothing changes without a visible reason.
  - Copy review: when `migration` is not empty, "Add to quote" first shows the choices that moved (old and new value with the reason), "I reviewed the changed choices" and "Add to quote"; "Edit choices" returns to the workspace. No commercial terms are shown, because a copy does not carry them. Without migration items a copy goes straight to "Add to quote".
  - Primary action: "Add to quote" (Phase E adds "Replace line"). "Back to quote" keeps the session; "Discard configuration" ends it after a confirmation. A value set by a force rule shows the other options locked with the reason in plain words.
  - Outcomes: success returns to the Configurations tab with the new line highlighted and focused. `result_changed` shows "The price changed from X to Y" with confirm; `quote_changed`, `finalise_in_progress` and `session_changed` explain and keep the rep's work; `quote_converted` explains that the session cannot finish; `model_deleted`, `product_missing` and `currency_mismatch` explain why it cannot be added and offer Discard; `quote_line_write_failed` keeps the choices and offers Retry; a replay says the configuration was already added and opens the quote with the line highlighted; `session_not_open` says it was discarded in another window, nothing was added. A rep without quote edit rights sees "Your choices are saved. Someone who can edit this quote can finish it from the Configurations tab."
  - Other errors and their way out: `no_published_version` or `currency_mismatch` on open reloads the model candidates and explains why the model is no longer offered; "all organizations" selected (400) asks to pick one organization; a lost permission (403) shows `ErrorMessage`. Work already saved in the session is kept in every case.
  - Evaluate, discard and finalise go through `useGuardedMutation`. In Phase C there is no finalise action; Phase D adds it.
- `/backend/product_configurator/snapshots/[id]`: "Configuration details" (read model above). Links from the quote and order tabs carry `?quoteId=` or `?orderId=`, and the page authorizes against that document.
- Quote tab "Configurations" (`sales.document.detail.quote:tabs`):
  - The model candidates load with the tab: "Configure product" opens a picker when several fit and an empty state with a link for admins when none fits; an API error shows `ErrorMessage`, not an empty list.
  - Configured lines with "Configured net price, before quote discounts", "Configuration details", "Add another identical" and "Edit line details" (name, comment, discount, tax through `POST /lines/update`). The discount control offers None, % and Amount (in the quote currency); None sends `mode: 'none'`. The tax rate list comes from `/api/sales/tax-rates`. Quantity, unit and configured net price are shown read-only.
  - "Add another identical" opens the workspace prefilled from the snapshot (header "Copy of: <line name>"), so the rep sees the current price before "Add to quote". Next to it the tab says how to change a configured machine in v1: add a changed copy, re-enter the name (if renamed), comment, discount and a changed tax rate in "Edit line details", then remove the old line in Items before sending or converting the quote.
  - "Configurations in progress" with "Started by <name>, <date>", "Continue" and "Discard".
  - "Line removed" state: a configuration whose line was deleted in Items stays as history and offers "Configure again" (`duplicate`).
- Configured-lines notice: a widget in `sales.document.detail.quote:details` says "This quote has N configured lines. Edit their name, comment, discount and tax in the Configurations tab" with a link, so a rep who opens a configured line in Items and meets the dialog's variant error knows where to go. It renders below the totals. A notice inside the line dialog itself is not possible in v1, because its field widgets cannot tell which line is open (Q5). Orders show configured lines through the "Configured" column.
- Order: tab "Configurations" (`sales.document.detail.order:tabs`), read-only: one card per configured order line with name, summary, model version, configured net price and "Configuration details"; no configure or edit actions. A "Configured" badge column with a link to the snapshot is added to the order items table through `data-table:sales.order.items:columns`. The quote items table has no column host yet (Q5); the dialog field widget covers quotes meanwhile.
- Copy for rep-facing screens: "Add to quote", "Add another identical", "Configure again", "Configuration details", "Discard configuration", "Configurations in progress". The model version is secondary information. Rep-facing screens never show rule codes or technical keys; rule messages are plain authored text.
- Accessibility: choice groups are native radio groups or DS equivalents with arrow-key navigation; a disabled option's reason is its accessible description; after each evaluation one polite live-region message announces the price and message changes (not on every keystroke); field errors are linked to their controls; after finalise focus moves to the new line. Formula autocomplete follows the combobox pattern.
- All data calls use `apiCall` / `readApiResultOrThrow`. Loading uses `LoadingMessage`; a failed call shows `ErrorMessage`, never an empty state; empty lists use the DS empty state. Icon-only buttons carry `aria-label`. Every dialog supports `Cmd/Ctrl+Enter` and `Escape`. DS tokens only, no status colors.

### Mockups

Low-fidelity UX wireframes of the proposed v1 flow. Each one annotates behaviour and states with numbered notes; they show flow, not visual design, and the implementation uses the Open Mercato design system. They become a binding `Prototype:` reference only after maintainers accept them. Source HTML sits next to each PNG. Frames and notes labelled "Phase E" show re-configure in place, which ships after v1.

| Wireframe | What it shows |
|---|---|
| ![Flow](assets/product-configurator/mockup-00-flow.png) | End-to-end flow by role (admin, sales rep, customer, back office) and the module behind each step |
| ![Configurator](assets/product-configurator/mockup-01-configurator.png) | Configurator: controls by type, disabled option with reason, value set by a rule, conditional field, sticky summary, messages that link to fields, the result states (field error with the primary action disabled, evaluating, missing price, model problem, network error), and a copy with inline reset markers (re-configure header: Phase E) |
| ![Studio formulas](assets/product-configurator/mockup-02-studio-formulas.png) | Studio formulas: draft vs published, text expressions, autocomplete, live preview, inline errors with a fix |
| ![Studio BOM](assets/product-configurator/mockup-03-studio-bom.png) | Studio BOM: SKU from lookup, formula quantity, conditions, units from the catalog, surcharge binding, row editor |
| ![Quote tab](assets/product-configurator/mockup-04-quote-tab.png) | Quote tab: start, model picker, configurations in progress, add another identical with the copy review, edit line details, line removed with Configure again, nothing fits; Phase E regions: re-configure, replacement pending, history, warning outside the tab |
| ![Publish states](assets/product-configurator/mockup-05-publish-states.png) | Studio: validation report with links, concurrent-edit conflict with draft copy, discard, successful publish |
| ![Edit line details](assets/product-configurator/mockup-06-line-edit-lock.png) | Editing a configured line from the Configurations tab (discount none, percent or amount; quantity, unit and price read-only), why the standard Items dialog cannot save it, and the configured-lines notice below the quote totals |
| ![Order](assets/product-configurator/mockup-07-order-snapshot.png) | Back office: "Configured" column in order items, warning for a line replaced before conversion, configuration details, read-only Configurations tab on the order; Phase E regions: the replaced line and its warning |
| ![Adding to the quote](assets/product-configurator/mockup-08-finalise-outcomes.png) | Add to quote outcomes: success, price changed, changed in another window, quote edited, quote converted, another add running, added or discarded in another window, cannot finish with the actual reason, write failed, no edit rights; Phase E states: partly done replacement, line being replaced was deleted |
| ![Re-configure](assets/product-configurator/mockup-09-reconfigure.png) | Phase E. Re-configure review, shown before every replace: changed and reset choices, old and new price with the difference, kept commercial terms, keep or remove a fixed discount, confirm and replace |
| ![Studio rules](assets/product-configurator/mockup-10-studio-rules.png) | Studio rules: names and ids, effects, condition builder with all condition kinds, message with placeholders, fields highlighted for the rep, the three ways a rule sets a value |
| ![Studio lookups](assets/product-configurator/mockup-11-studio-lookups.png) | Studio lookups: typed tables with friendly names, catalog SKU check when a row is edited, coverage, bulk edits through Advanced (JSON) |
| ![Studio test](assets/product-configurator/mockup-12-studio-test.png) | Studio Test tab: the saved draft with a pricing context, rule trace, nothing saved |
| ![Studio features](assets/product-configurator/mockup-13-studio-features.png) | Studio features: types, options with swatches or from a permitted lookup, number range and step, groups, defaults, summary flag, shown-when conditions |

Current state, from the hackathon build this spec is based on (it still contains out-of-scope parts: the 3D viewer, the 3D studio tab, the customer decision badge and the share and document actions):

| Screen | Hackathon build |
|---|---|
| Studio, Rules tab | ![Hackathon studio rules](assets/product-configurator/current-01-studio-rules.png) |
| Configurator | ![Hackathon configurator](assets/product-configurator/current-02-configurator.png) |
| Quote tab | ![Hackathon quote tab](assets/product-configurator/current-03-quote-tab.png) |
| Snapshot detail | ![Hackathon snapshot](assets/product-configurator/current-04-snapshot.png) |

### Frontend architecture contract

| Route / surface | Server root | Client islands | Data owner | Notes |
|---|---|---|---|---|
| models list | `page.tsx` | `ModelsTable` | `GET /models` | |
| studio | `page.tsx` | `ModelStudio`, one leaf per tab | `GET /models?id=`, `PUT /models`, `GET /catalog-items` | each tab under 300 LOC or justified |
| dependencies tab | - | `DependencyGraph` | studio draft | `@xyflow/react` (declared in the package's own `package.json`) via dynamic import |
| version page | `page.tsx` | `ModelVersionView` | `GET /model-versions?id=` | read-only |
| configure | `page.tsx` | `ConfiguratorWorkspace` | `GET /sessions`, `POST /sessions/*` | no viewer, no `three`; also renders the copy review (and the re-configure review in Phase E) |
| studio Test tab | - | `ConfiguratorWorkspace` (preview mode) | `POST /models/preview` | same component, no session |
| snapshot page | `page.tsx` | `SnapshotDetail` | `GET /snapshots?id=` | |
| quote / order tabs | injected widget | `QuoteConfigureTab`, `OrderConfigurationsTab` | `GET /snapshots`, `GET /sessions`, `GET /models`, `POST /lines/update`, `/api/sales/tax-rates`, sales line APIs | loaded only on the sales document page |
| order items column; configured-lines notice; details warning (Phase E) | injected widget | `ConfiguredLineColumn`, `ConfiguredLinesNotice`, `ConfigurationWarning` (Phase E) | `GET /snapshots` | `sales.document.detail.*:details`, `data-table:sales.order.items:columns` |

`"use client"` ledger:

| File | Reason | Imported by | Heavy deps? | Cleanup / hydration risk | Alternative rejected |
|---|---|---|---|---|---|
| `ModelsTable` | DataTable state, filters | models page | no | none | server table (no inline actions) |
| `ModelStudio` + tab leaves | stateful form editing, dirty tracking, lock header | studio page | no | unsaved-changes guard | server form (no live validation) |
| `DependencyGraph` | canvas graph | dependencies tab | `@xyflow/react` | dispose on unmount | static SVG (no navigation) |
| `ConfiguratorWorkspace` | live evaluation on change | configure page | no | debounce timer cleared on unmount | form submit per change |
| widget components | injected client widgets | widget registry | no | none | none (spots are client-side) |

No provider is added at page or app root. Budgets: 0 new page-root `"use client"`, 0 heavy libraries at page root, a hydration smoke test per interactive route in the phase that ships it (`TC-PCFG-014`, `-019`, `-046`), `yarn check:client-boundaries` in the gate. Performance evidence per UI phase PR: configurator evaluate round-trip under 300 ms for the reference model on a local build, and the client bundle size of each new route, attached to the PR body.

## Configuration

- `OM_ENABLE_PRODUCT_CONFIGURATOR` (boolean, default false) in `apps/mercato` and the create-app template.

## Migration & Compatibility

- New tables only, one migration per phase that adds tables (A: models and versions; C: sessions; D: snapshots plus `source_snapshot_id` on sessions; E: `replacement_state` and the partial unique index on sessions), each with its snapshot file.
- New contract surfaces (all additive): module id, routes, ACL features, event ids, widget ids, DI key `catalogPriceRowService`.
- `catalog`: one new service and DI registration, additive under `BACKWARD_COMPATIBILITY.md` (new DI key, new export). No change to existing signatures.
- `sales`: no change. Dependency on line commands, the `configuration` field and command interceptors (Q2).
- Disabling the module leaves sales lines intact. Their `configuration` jsonb stays as plain data. The line guard disappears with the module.

## Edge Cases & Failure Scenarios

| Scenario | Behaviour |
|---|---|
| Process dies after the sales line commits, before `quote_line_id` is stored | Next finalise finds the line by snapshot id and adopts it without re-evaluating |
| Two finalise calls on the same quote | Second gets `finalise_in_progress` while the first holds the advisory lock; a dead process releases it with its connection |
| Prices change between a failed attempt (no line committed) and the retry | The unlinked snapshot is replaced with the new evaluation |
| Conversion while finalise writes the line | Serialized by the quote row lock and the line's foreign key: the line is either copied to the order or not written (`quote_converted`) |
| Crash after the sales commit, then conversion before a retry | The conversion hook reconciles the `finalising` session against the order lines, adopts the line and finalises the session |
| Rep adds a changed copy and forgets to remove the old line | Both lines stay on the quote, as for any two lines; the tab hint asks to remove the old one before sending |
| Phase E: conversion while finalise holds the lock | Conversion rejected with 409 `configuration_in_progress` |
| Phase E: conversion that started just before finalise took the lock, during a re-configure | Order may carry both lines; detected as `incomplete_after_conversion` and shown on the order tab for manual removal |
| A BOM line in `cm` for an item sold in `m` | Publish fails with `bom_unit_mismatch` |
| API submits a value outside the permitted lookup row | Blocking error `option_not_available`; finalise refused |
| Quote converted during configuration | Step 3 or the upsert finds no quote, mapped to `quote_converted`; session cancelled; no line written |
| Quote edited between finalise step 3 and step 5 | Sales rejects the upsert with 409, mapped to `quote_changed`; earlier edits do not conflict |
| Phase E: delete of the replaced line fails | Session stays `finalising`, tab shows "replacement pending" with a retry |
| Phase E: two reps re-configure the same snapshot | Second open gets `source_in_use`; the tab points to the running re-configuration |
| Rep wants to change a line deleted in Items | The tab offers "Configure again", which adds a new line with new-line defaults (Phase E: re-configure returns `source_line_removed`) |
| Phase E: source line deleted while its re-configuration is open | Finalise returns `source_line_removed` before writing; nothing is added |
| Finalise of a session discarded in another window | 409 `session_not_open`; nothing is added |
| Rep edits net price, quantity, UOM or product of a configured line through the API | 409 `configured_line_locked`; name, comment, discount and tax edits from the Configurations tab pass |
| Rep opens a configured line in the standard Items dialog | The dialog cannot save it (variant required); the notice below the totals points to the Configurations tab (Q5) |
| API sends `taxAmount` or `totalGrossAmount` for a configured line | 409 `configured_line_locked` unless equal to the stored value |
| Quote with more than 100 lines, crash, then retry | Step 2 pages through all lines and adopts the committed line; no duplicate |
| Catalog price changes between the rep's last view and finalise | 409 `result_changed`; nothing written; the rep confirms the new price |
| Two windows or two reps evaluate the same session | The older revision gets 409 `session_changed` and the current state |
| Phase E: re-configure of a line with a 10% discount and a comment | The new line keeps them and its tax rate |
| Phase E: re-configure of a line with a fixed 2,000.00 discount | The review asks to keep or remove it; finalise needs `discountAmountDecision` |
| Rep switches a line discount from 5% to 1,000.00 | `discountPercent` is set to 0 so the amount applies |
| "Add another identical" from v3 after v4 removed an option | The copy review lists the dropped value; finalise needs `migrationAcknowledged` |
| A lookup has no SKU row for a selected option | Blocking `bom_sku_unmapped`; publication's `lookup_coverage` catches it for choice, color and boolean features |
| Quote converted while sessions are still open | The sessions are cancelled by the conversion hook |
| Someone writes a line with a fake configuration marker | 422 `configured_line_forged` |
| Model deleted while a session is open | Finalise fails with `model_deleted` |
| Bound product or a BOM SKU deleted | Publish fails; finalise fails with `product_missing` / `price_missing` |
| A SKU exists as both product and variant | Publish fails with `ambiguous_sku` |
| Hidden feature referenced by a rule | Rule reads the feature's default |
| Rules that keep changing each other | Publish fails `fixed_point`; evaluate fails `fixed_point_not_reached` |
| Division by zero or missing lookup row in a formula | 422 `expression_error` |
| Sales undo of the line write after later quote edits | Sales reverts the later edits (sales behaviour, documented) |

## Phasing

| Phase | PR | Ships | Usable after merge |
|---|---|---|---|
| A | engine | `catalogPriceRowService` (first commit), package, models and versions, evaluator, validation, publish, `GET /catalog-items` | admins author and publish models through the API |
| B | studio | studio UI | admins author and publish models in the UI |
| C | configurator | sessions, pricing, configurator UI, quote tab, studio Test tab | reps configure and see prices on a quote; admins test drafts |
| D | finalise | snapshots, finalise (always a new line), line guard, "Add another identical" and "Configure again" with the copy review, line edit from the tab, order tab and items column, conversion cleanup | configured lines land on quotes and orders; v1 complete |
| E | replacement | re-configure in place: `replace` mode, carried-over terms, step 6, conversion guard, replacement states, two-line warning (after v1, pending Q2) | reps change a configured line without re-entering its terms |

## Implementation Plan

### Phase A: Engine (PR A)
1. `catalogPriceRowService` in `catalog` with unit tests (first commit). Proved by catalog unit tests.
2. Package scaffold and opt-in wiring, module `AGENTS.md`, `__integration__/meta.ts`. Proved by `TC-PCFG-007`.
3. DSL types and zod schema with limits, evaluator (structure and price steps) with scaled BigInt money and currency exponent, hash contract. Proved by evaluator unit tests with golden values.
4. Publication checks and their i18n codes. Proved by `TC-PCFG-002`.
5. Entities `ConfigurationModel`, `ConfigurationModelVersion`, one migration. Proved by `TC-PCFG-007`.
6. Model commands (create, update, delete, publish) with audit, undo, optimistic lock, events. Model routes, validate route and `GET /catalog-items`, organization scoping. Proved by `TC-PCFG-001`, `-003`, `-004`, `-006`, `-008`.
7. ACL with labels, `setup.ts`, `seedExamples`, i18n for all locales. Proved by `TC-PCFG-005`.
8. Golden values on the neutral reference model, computed independently, including a 0-decimal (JPY) and a 3-decimal currency, sub-cent catalog prices, a repeated SKU across a tier boundary, a `force` rule reading a `calculated` condition, and a hidden feature.

### Phase B: Studio (PR B)
1. Models list and create dialog. Proved by `TC-PCFG-010`.
2. Studio tabs in UI, expression parser and editor, BOM row editor, `visibleWhen` editor, dependency graph, advanced JSON view. Proved by `TC-PCFG-010`, `-011`.
3. Published version page, publish flow with inline report, conflict handling with draft copy, discard, draft reload. Proved by `TC-PCFG-012` to `-016`.

### Phase C: Configurator (PR C)
1. `ConfigurationSession` entity and migration.
2. Session commands and routes (open without `fromSnapshotId`, evaluate, cancel, get), sales RBAC checks, selected-organization scoping, currency check, model candidates. Proved by `TC-PCFG-020` to `-028`.
3. Pricing through `catalogPriceRowService` and `catalogPricingService`. Proved by `TC-PCFG-020`, `-027`.
4. Configurator workspace (no finalise) with error states, layout and accessibility, session revision, and quote tab (configure, picker, resume, discard). Proved by `TC-PCFG-018`, `-019`, `-029`, `-051`, `-061`.
5. `POST /models/preview` and the studio Test tab. Proved by `TC-PCFG-017`.

### Phase D: Finalise (PR D)
1. `ConfigurationSnapshot` entity, `source_snapshot_id` on sessions, one migration.
2. Finalise command (advisory lock, reconcile-first recovery including order lines, revision and `expectedHash` checks, trusted line write), `fromSnapshotId` with `duplicate` as the default mode, sales RBAC on finalise, events, logging and error reporting. Proved by `TC-PCFG-030` to `-033`, `-039` to `-042`, `-050`, `-060`, `-062` and finalise unit tests.
3. Configured line guard (line upserts, quote and order create). Proved by `TC-PCFG-035` to `-037`, `-048`.
4. Snapshot detail page and its access rules, quote tab lines with line states, order tab, configured-lines notice. Proved by `TC-PCFG-038`, `-043`, `-044`, `-046`, `-047`, `-058`.
5. "Add another identical" and "Configure again" with selection migration and the copy review, edit of a configured line's commercial fields, order items column, conversion cleanup and reconcile of `finalising` sessions. Proved by `TC-PCFG-053` to `-061`.

### Phase E: Line replacement (PR E, after v1)
1. Migration: `replacement_state` and the partial unique index on sessions.
2. `replace` mode on open (`source_line_removed`, `source_in_use`), carry-over of commercial terms with `discountAmountDecision`, finalise step 6 with retry, conversion guard. Proved by `TC-PCFG-034`, `-049`, `-052`, `-063`, `-066` and the replacement unit tests.
3. Re-configure workspace and review, replacement states on the quote and order tabs, two-line warning in the details spot. Proved by `TC-PCFG-064`, `-065`.

### Integration coverage

Tests live in `src/modules/product_configurator/__integration__/` with `meta.ts` declaring `requiredEnvVars: ['OM_ENABLE_PRODUCT_CONFIGURATOR']` and `dependsOnModules: ['catalog', 'sales', 'product_configurator']` (pattern of `packages/enterprise/src/modules/agent_orchestrator/__integration__/meta.ts`). They create their own data through APIs and clean up. None depends on `seedExamples`. Crash and concurrency cases that an HTTP test cannot provoke are unit tests of `lib/finalise.ts` with injected failures.

| Phase | API paths | UI paths |
|---|---|---|
| A | `TC-PCFG-001` create, update, delete model; stale `updatedAt` -> 409. `TC-PCFG-002` validate a broken model (cycle, unknown SKU, ambiguous SKU, bad default, non-settling rules, duplicate key, over limits, BOM unit different from the catalog unit, lookup without a row for an option) -> right codes. `TC-PCFG-003` publish creates version 1, then 2; versions read-only; draft edit keeps the model selectable. `TC-PCFG-004` cross-organization and cross-tenant reads -> 404; "all organizations" on validate and publish -> 400. `TC-PCFG-005` each feature gates its routes. `TC-PCFG-006` a registered mutation guard blocks publish. `TC-PCFG-007` module enabled on a fresh database: migrations apply and `GET /models` answers. `TC-PCFG-008` `GET /catalog-items` returns titles and units, lists unknown and ambiguous SKUs, stays in the selected organization and rejects more than 100 SKUs | - |
| B | covered by A | `TC-PCFG-010` build the reference model from a blank model through the UI only and publish; canonical comparison with the fixture. `TC-PCFG-011` formula parse error shown inline. `TC-PCFG-012` conflict bar on concurrent edit. `TC-PCFG-013` published version page renders. `TC-PCFG-014` hydration smoke test of the models list, studio and version page. `TC-PCFG-015` save a draft, reload the studio, keep editing, then publish. `TC-PCFG-016` conflict refresh asks for confirmation and offers a copy of the local draft; discard restores the last saved draft |
| C | `TC-PCFG-020` open, evaluate golden scenarios, prices match. `TC-PCFG-021` currency mismatch -> 409. `TC-PCFG-022` two models and no `modelId` -> `model_required`, then open with `modelId`. `TC-PCFG-023` invalid selection -> 422; a value outside the permitted lookup row sent straight to the API -> blocking `option_not_available`; a lookup gap -> blocking `bom_sku_unmapped`. `TC-PCFG-024` selected organization switch changes visible data. `TC-PCFG-025` user without `sales.quotes.view` -> 403 on open, evaluate and get. `TC-PCFG-026` cancel; evaluate after cancel -> 409. `TC-PCFG-027` channel price wins over base price. `TC-PCFG-028` another rep resumes a session; revoked sales access blocks it. `TC-PCFG-051` stale revision on evaluate (and on finalise once D ships) -> `session_changed` | `TC-PCFG-029` configure from the quote tab, hidden features appear when their condition holds, refresh restores state, forced values and blocking errors visible. `TC-PCFG-019` hydration smoke test of the configure page and quote tab. `TC-PCFG-017` studio Test tab evaluates the saved draft with a chosen context, without creating a session. `TC-PCFG-018` deterministic errors show their own state (no Retry); keyboard and live-region behaviour of the workspace. `TC-PCFG-061` the primary action stays disabled while a number field holds invalid text |
| D | `TC-PCFG-030` finalise writes a line with `productId`, net price, `taxRateId`, `configuration`; sales computes gross; also for a model bound to a product without SKU. `TC-PCFG-031` replay is idempotent. `TC-PCFG-032` failed line write leaves the session reopenable. `TC-PCFG-033` quote converted between open and finalise -> `quote_converted`, session cancelled, no line; quote edited between steps 3 and 5 -> `quote_changed`, session open. `TC-PCFG-035` on a configured quote line: net price, quantity, UOM, product, marker, or an explicit `taxAmount` / `totalGrossAmount` change -> 409; discount, tax and name change succeed; an earlier interceptor's `modifiedInput` cannot bypass the guard. `TC-PCFG-036` same guard on order lines after conversion. `TC-PCFG-037` forged marker on line insert (including one that references a real pending snapshot), on an update of a plain line, and on inline quote and order create -> 422. `TC-PCFG-038` convert to order keeps `configuration`; order tab finds the snapshot. `TC-PCFG-039` user without `sales.quotes.manage` cannot finalise. `TC-PCFG-040` finalise on a deleted model -> `model_deleted`. `TC-PCFG-041` `fromSnapshotId` of another quote -> 422; `mode: 'replace'` -> 400 `mode_not_supported`. `TC-PCFG-042` a registered mutation guard blocks finalise. `TC-PCFG-043` snapshot routes gated as specified; an order-only user opens a snapshot from the order tab. `TC-PCFG-050` catalog price changed after the last evaluate -> `result_changed`, no line; confirm then succeeds. `TC-PCFG-053` "Add another identical" across model versions returns `migration` and finalise needs `migrationAcknowledged`. `TC-PCFG-054` "Add another identical" adds a separate, re-priced line with new-line defaults and leaves the source line. `TC-PCFG-055` `POST /lines/update` changes name, comment, discount (percent to amount to none) and tax (gross recomputed) and rejects a non-configured line. `TC-PCFG-056` converting a quote cancels its open sessions. `TC-PCFG-059` "Configure again" on a removed line adds a new line. `TC-PCFG-060` finalise of a discarded session -> `session_not_open`, no line. `TC-PCFG-062` convert, then finalise -> `quote_converted`, no line; finalise, then convert -> the order carries the configured line. Unit: crash after sales commit then retry adopts the line without re-evaluating, also with changed prices and a deleted model; crash after sales commit then conversion: the hook adopts the order line and finalises the session; a second finalise on the same quote is refused while the lock is held; against a real database, a conversion holding the quote row lock makes a concurrent configured line insert fail with nothing on the order; a reconcile read past 20 and 100 lines finds the committed line | `TC-PCFG-044` quote -> configure -> finalise -> send -> accept -> order tab links the snapshot. `TC-PCFG-046` hydration smoke test of the snapshot page and order tab. `TC-PCFG-048` edit a configured line's name, comment, discount and tax from the Configurations tab; quantity and price are not offered. `TC-PCFG-047` snapshot page renders the read model. `TC-PCFG-057` "Add another identical" across model versions shows the copy review. `TC-PCFG-058` the quote shows the configured-lines notice below the totals. |
| E | `TC-PCFG-034` re-configure from a snapshot replaces only that line; a second configuration on the same quote stays; a second session on the same source -> `source_in_use`. `TC-PCFG-049` conversion while finalise holds the lock -> 409 `configuration_in_progress`. `TC-PCFG-052` re-configure keeps name, comment, discount percent and the numeric tax rate (gross recomputed); a fixed discount amount needs `discountAmountDecision` and is copied on `keep`, dropped on `remove`. `TC-PCFG-063` re-configure of a removed line -> `source_line_removed`. `TC-PCFG-066` re-configure across versions returns `migration` and needs `migrationAcknowledged`. Unit: delete failure then retry; conversion between insert and delete is marked `incomplete_after_conversion` | `TC-PCFG-064` the re-configure review always shows before Replace line; replacement pending card and Retry; two-line warning in the details spot. `TC-PCFG-065` hydration smoke test of re-configure mode |

## Risks & Impact Review

### Data Integrity Failures
Finalise spans the module's own writes and one sales line write, and is serialized per quote by an advisory lock. Recovery first adopts a committed line (on the quote, or on the order after a conversion) before re-evaluating, and the snapshot is replaceable only while no line carries it. A crash is repaired by the next `finalise` call or by the conversion hook. Conversion and the line write serialize on the quote row, so a configured line is never lost. Model edits use optimistic locking. Phase E adds a second sales write (the replaced-line delete) and its own risks, listed below.

### Cascading Failures & Side Effects
Event subscribers are not required for correctness. The line guard runs on every sales line upsert with an `id`, on line inserts carrying the marker, and on quote and order create with inline lines. It returns early when neither the stored line nor the input carries `configuration.productConfigurator`, so a bug can only block configured lines. Sales recalculates the whole quote on each line write, as for any line.

### Tenant & Data Isolation Risks
Every query filters by `tenant_id` and the selected organization. Cross-module reads use `queryEngine` with its automatic tenant and organization scope and catalog services that scope the same way. Every session operation and quote-linked read requires sales visibility of the quote. `TC-PCFG-004`, `-024`, `-025`, `-028`, `-039`, `-041` and `-043` cover isolation and RBAC.

### Migration & Deployment Risks
New tables only, no backfill. The module is off by default, so an upgrade changes nothing for existing installs.

### Operational Risks
Evaluation runs on each change in the configurator. The engine is pure and bounded (limits above, 3 settle passes, no I/O), `evaluate` writes no audit entry, and price rows are fetched once per evaluation. Snapshot storage grows by one row per finalise. Open sessions accumulate until cancelled; sessions of a converted quote are cancelled automatically. Detection: finalise failures go through `reportError` and structured logs.

### Risk Register

#### Sales line command contract changes
- **Scenario**: `sales.quotes.lines.upsert` input or its `configuration` handling changes and finalise or the guard breaks.
- **Severity**: High
- **Affected area**: finalise, line guard
- **Mitigation**: Q2 asks to treat the commands as STABLE or to provide a sales-owned seam; `TC-PCFG-030`, `-035`, `-037`, `-038` fail fast once Q4 is settled.
- **Residual risk**: until then a sales refactor can break the module between releases.

#### Duplicate line after a crash
- **Scenario**: sales commits the line and the process dies before `quote_line_id` is stored.
- **Severity**: High
- **Affected area**: quote totals
- **Mitigation**: step 2 looks for a line carrying the snapshot before any re-evaluation or write (live base-table read, all pages); the advisory lock keeps a second worker out while the first is alive; unit tests with an injected crash, changed prices and a deleted model.
- **Residual risk**: none known.

#### Conversion during a re-configure (Phase E)
- **Scenario**: a conversion passes the lock check just before finalise takes the lock, and runs while finalise inserts the new line and deletes the old one.
- **Severity**: Medium
- **Affected area**: order totals
- **Mitigation**: conversion is rejected while finalise holds the lock; the remaining case is detected (`incomplete_after_conversion`) and shown on the order tab with the replaced snapshot.
- **Residual risk**: the order can carry both lines until a user removes one. Closing this fully needs a sales-owned atomic replace command (Q2).

#### Crash after the sales commit, then conversion
- **Scenario**: the process dies after sales commits the line and before `quote_line_id` is stored, and the quote is converted before a retry.
- **Severity**: Low
- **Affected area**: session status, `snapshot.created` event
- **Mitigation**: the order carries the line with its configuration, so the order tab is correct; the conversion hook reconciles the `finalising` session against the order lines and finalises it.
- **Residual risk**: if the hook itself fails, the session stays `finalising` with an unlinked snapshot; the order is still correct.

#### Old line left after a changed copy (v1)
- **Scenario**: a rep adds a changed copy of a configured machine and does not remove the old line.
- **Severity**: Low
- **Affected area**: quote totals
- **Mitigation**: both lines are visible on the quote like any two lines; the Configurations tab says to remove the old line before sending or converting. Phase E replaces the line in place.
- **Residual risk**: the quote can be sent with both lines until a person notices.

#### Guard read is not transactional
- **Scenario**: the guard reads the stored line before the sales transaction; a concurrent write changes it in between.
- **Severity**: Low
- **Affected area**: configured line fields
- **Mitigation**: the guard runs last and compares the final input with a fresh read; sales optimistic locking on the document rejects most concurrent writes.
- **Residual risk**: a narrow race between two writers; the snapshot keeps the configured price for comparison.

#### Replacement leaves two lines (Phase E)
- **Scenario**: the delete of the replaced line fails.
- **Severity**: Medium
- **Affected area**: quote totals
- **Mitigation**: the session stays `finalising`, the tab shows "replacement pending", and a retry completes it.
- **Residual risk**: until the rep retries, the quote shows both lines.

#### Quote changes during configuration
- **Scenario**: the quote is converted while a rep configures, or edited between finalise step 3 and step 5.
- **Severity**: Medium
- **Affected area**: quote content
- **Mitigation**: the upsert carries the quote `updatedAt` read in step 3, so a concurrent edit fails with 409 (`quote_changed`); conversion deletes the quote, so the upsert fails with 404 (`quote_converted`).
- **Residual risk**: with optimistic locking disabled for `sales.quote`, only step 3's re-read (quote exists, currency) protects the write; a concurrent edit is not detected.

#### Configured line edited outside the guard
- **Scenario**: a write path that bypasses the sales commands changes a configured price.
- **Severity**: Medium
- **Affected area**: quote totals vs snapshot
- **Mitigation**: the guard covers every known write path and the marker itself.
- **Residual risk**: a future raw write in sales would bypass it. The snapshot keeps the configured price for comparison.

#### Rep sees one price, the quote gets another
- **Scenario**: catalog prices change between the rep's last evaluation and finalise.
- **Severity**: High
- **Affected area**: quote totals
- **Mitigation**: finalise compares the re-evaluated hash with `expectedHash` and refuses with `result_changed` until the rep confirms.
- **Residual risk**: none known.

#### Variant price wins for a product SKU
- **Scenario**: a variant row shares `product_id` and scores higher than the product row.
- **Severity**: Medium
- **Affected area**: configured prices
- **Mitigation**: `findPriceRows` returns product-level rows only for product items; a golden scenario covers a product with variants.
- **Residual risk**: none known.

#### Catalog service rejected in review
- **Scenario**: maintainers prefer a different catalog seam (Q3).
- **Severity**: Medium
- **Affected area**: Phases A and C
- **Mitigation**: the module calls catalog from one file (`lib/pricing.ts`), so swapping the seam does not touch the engine.
- **Residual risk**: rework of one file and its tests.

#### Currency exponent differs from tenant setting
- **Scenario**: an admin set `decimalPlaces` for a currency that differs from ISO / `Intl`.
- **Severity**: Low
- **Affected area**: rounding of configured prices
- **Mitigation**: `Intl` is what the UI already shows, and sales stores 4 decimals.
- **Residual risk**: documented limitation; a `currencies` seam can follow.

#### Opt-in tests not run in CI
- **Scenario**: CI never sets the flag, so the specs are skipped and regressions land unnoticed.
- **Severity**: Medium
- **Affected area**: all phases
- **Mitigation**: Q4; until settled, every phase PR attaches a local integration run.
- **Residual risk**: regressions between releases if Q4 stays open.

Product-direction calls (for maintainers, not rule violations): placement (Q1), relying on sales commands (Q2), the catalog seam (Q3), and quote items integration (Q5).

## Final Compliance Report — 2026-10-27

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/sales/AGENTS.md`
- `packages/core/src/modules/catalog/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md`
- `packages/events/AGENTS.md`, `packages/cache/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `.ai/specs/AGENTS.md`, `.ai/qa/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | uuid columns only |
| packages/create-app/AGENTS.md | Template module registrations and package dependencies aligned | Compliant | `package.json.template` and lockfile in the wiring list |
| root AGENTS.md | Filter by organization | Compliant | selected organization in all routes and commands |
| root AGENTS.md | Optimistic locking on new editable entities | Compliant | models locked; versions immutable; snapshots immutable once linked; sessions exempt with reason |
| root AGENTS.md | Validate inputs with zod in `data/validators.ts` | Compliant | including limits |
| root AGENTS.md | No hard-coded user-facing strings | Compliant | codes + params, all locales |
| root AGENTS.md | `pageSize` at or below 100 | Compliant | |
| root AGENTS.md | DS tokens, no status colors | Compliant | `om-ds/*` error block, `StatusBadge` |
| root AGENTS.md | Encryption for PII | Compliant | no personal data stored |
| root AGENTS.md | Never bypass mutation guards | Compliant | factory for CRUD, `runRouteMutationGuards` in custom routes |
| root AGENTS.md | `apiCall`, `useGuardedMutation` for non-CrudForm writes, `LoadingMessage` / `ErrorMessage` | Compliant | UI/UX section |
| root AGENTS.md | Errors recorded are also reported | Compliant | `reportError` on finalise failures |
| packages/core/AGENTS.md | Cross-module coupling via events, widgets, FK ids, services | Compliant | sales via commands, `queryEngine`, spots, interceptors; catalog via new service |
| packages/core/AGENTS.md | `makeCrudRoute` with `indexer`, `openApi` on every route | Compliant | |
| packages/shared/AGENTS.md | Server authorization through `featurePolicy` | Compliant | `rbacService.userHasAllFeatures` / `authorizeFeatures` |
| packages/events/AGENTS.md | Typed events via `createModuleEvents` | Compliant | |
| packages/cache/AGENTS.md | Cache via DI with tenant-scoped tags | Compliant | no cache in v1 |
| packages/ui/AGENTS.md | `CrudForm` / `DataTable` for forms and lists | Compliant | |
| sales/AGENTS.md | Document math through `salesCalculationService` | Compliant | net price only, sales owns tax and discount |
| sales/AGENTS.md | Lines reference valid products | Compliant | bound product, re-checked on finalise |
| catalog/AGENTS.md | Pricing through `catalogPricingService` | Compliant | |
| .ai/qa/AGENTS.md | Integration tests self-contained, `TC-{CATEGORY}-{XXX}` ids | Compliant | |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | |
| API contracts match UI/UX section | Pass | |
| Risks cover all write operations | Pass | |
| Commands defined for all mutations | Pass | undo and audit per command |
| Cache strategy covers all read APIs | Pass | no cache in v1 |
| Phase boundaries | Pass | `fromSnapshotId` (copy) and finalise in D; re-configure in place in E |

### Non-Compliant Items
None known.

### Verdict
Findings of nine review rounds applied; pending maintainer answers to Q1-Q5. v1 (A-D) has no known open data-integrity risk beyond the low-severity cases in the risk register. Re-configure in place moved to Phase E; its residual risk (conversion during a replacement) is documented and raised in Q2.

## Changelog

### 2026-10-27
- Applied ninth review round (final review before upstream, two independent agents with `om-spec-writing`): the guard also locks explicit tax and gross amounts; every line read pages through all lines; recovery finds a converted order by the quote id or the conversion result; Phase E retry resumes the delete; catalog service returns the sales unit quantity and includes organization-less price kinds; model `currency_code` column; advisory lock rationale and direct-connection requirement; dialog notice replaced by a details-spot notice (Q5 asks about dialog widgets); create-app template dependency; catalog view permission on preview and catalog items; conversion undo and finalise redo documented; test placement fixed.
- Re-configure in place moved to a new Phase E after v1: v1 finalise always adds a new line; `duplicate` is the default with `fromSnapshotId` and `replace` returns `mode_not_supported`; `source_snapshot_id` kept as the copy source; carry-over of commercial terms, step 6, the conversion guard, replacement states and the two-line warning moved to Phase E with their tests, migration and risks. v1 relies on the quote row lock and the line foreign key against conversion (`TC-PCFG-062`), reconciles `finalising` sessions against order lines after a conversion, and adds a copy review for "Add another identical" across model versions. Q2 and Q5 split into v1 and Phase E parts.
- Applied eighth review round (UX flow review of the wireframes by two independent agents, against the team review and the user stories): fixed discount kept or removed explicitly (`discountAmountDecision`); re-configure review shown before every replace, with inline reset markers in the workspace and no split of the price difference; a removed line offers "Configure again" and `source_line_removed`; `session_not_open` on finalise; primary action disabled while a field holds invalid text; `GET /catalog-items` for studio titles, units and SKU checks; lookup `label`; snapshot `lineName`; `lineState` of a pending replacement; feature and rule editor contents; reference context of the Test tab; error-to-action list; read-only order tab and order-line notice; new Features wireframe.
- Applied seventh review round (agent verification of the team review against the sales code): numeric `taxRate` carry-over instead of `taxRateId`, explicit discount modes, confirmation of a fixed discount amount (now `discountAmountDecision`), migration review for duplicates, recovery of rejected local choices on `session_changed`, replacement metadata and `replaced_before_conversion`, deterministic step-6 state, `lookup_coverage` for color, preview trace, configured-line notice in the standard dialog through its CrudForm field spot, real placement of the details spot, terminal error states.
- Applied sixth review round (team UX review, verified by an agent): `expectedHash` and session `revision` with `result_changed` / `session_changed`; re-configure carries over name, comment, discount and tax; `bom_sku_unmapped` and `lookup_coverage` instead of silently dropped parts; selection migration with review for re-configure across versions; error-to-UI mapping; studio Test tab with `POST /models/preview`; intent vs result in sessions; layout and accessibility rules; orphaned sessions cancelled on conversion; conflict refresh with draft copy and discard; rule `label`; read-only BOM units; rep copy glossary; quote items integration raised as Q5; configured line edits moved to the Configurations tab (`POST /lines/update`) because the standard dialog cannot save a variant-less line.
- Decisions: dashboard widgets moved to a follow-up spec; one configured unit per line with "Add another identical".

### 2026-10-26
- Added UX wireframes (flow, configurator, studio formulas and BOM, quote tab, publish states, line edit, order snapshot, finalise outcomes) and hackathon screenshots under `assets/product-configurator/`, reviewed by two agents; resulting spec changes: `quote_converted` error, Validate and Publish on the saved draft only, evaluation progress and failure states, friendly names with keys in studio errors, no rule codes on rep-facing screens.
- Applied fifth review round (agent, `om-spec-writing`): finalise serialized by a per-quote advisory lock instead of attempt fencing, reconcile-first recovery, trusted line insert validated against the snapshot, conversion guard with detected residual case, BOM units checked against catalog units, dynamic availability enforced, snapshot detail authorized by its document, studio draft read, SKU-less bound products.
- Applied fourth review round: line guard locks only configured inputs and covers forged markers and order create, step 5 without lock header and resumable without re-evaluation, order-scoped snapshot reads and `lineState` rules, `resolvePriceKinds`, complete finalise errors, no quote status rule, Q5 for dashboard widgets, data model graph in the canonical format under Data Models, per-phase hydration tests and performance evidence.
- Applied third review round (canonical skill check, pre-implement audit, plan coverage): relation to catalog configurable products, `visibleWhen`, several models per product, `catalogPriceRowService` in PR A, exact sales command input, conversion deletes the quote, `featurePolicy` authorization, guard priority, corrected undo and `queryEngine` statements, `meta.ts` with `requiredEnvVars`, `OM_ENABLE_STORAGE_S3` as precedent, snapshot read model, summary rules, limits, error reporting, data model graph, edge cases, phasing, frontend contract, UI primitives.

### 2026-10-23
- Initial specification.
- First review: sales RBAC, net-only pricing with sales-owned tax and discount, per-command undo and audit, employee grants, maintainer open questions.
- Second review: crash-safe finalise, stricter line guard, `runRouteMutationGuards`, per-SKU tier pricing with scaled precision, session read API, shared sessions, full DSL semantics, model draft / published state.

### Review — 2026-10-23 (round 1)
- **Reviewer**: Agent (fresh context, spec checklist)
- **Security**: sales RBAC bypass on open and finalise; no PII statement (fixed)
- **Performance**: evaluate audited per change; N+1 on latest version (fixed)
- **Cache**: Passed
- **Commands**: undo not specified per command (fixed)
- **Risks**: replacement deleted all earlier lines; no quote re-check (fixed)
- **Verdict**: Needs revision (applied)

### Review — 2026-10-23 (round 2)
- **Reviewer**: Agent (fresh context)
- **Security**: session ownership and sales visibility incomplete (fixed)
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: finalise not crash-idempotent; deprecated mutation guard helpers; replacement not resumable (fixed)
- **Risks**: guard bypasses; quote lock skipped; repeated SKU tiers (fixed)
- **Verdict**: Needs revision (applied)

### Review — 2026-10-26 (round 3)
- **Reviewer**: Agent (three parallel audits: canonical skill and contribution process, `om-pre-implement-spec`, plan and hackathon coverage)
- **Security**: low-level feature helper instead of `featurePolicy` (fixed)
- **Performance**: no size limits, no dashboard index (fixed)
- **Cache**: Passed
- **Commands**: wrong command input shape; conversion returns 404; guard priority (fixed)
- **Risks**: undo and query-index statements inaccurate; opt-in specs not selectable in CI (fixed)
- **Verdict**: Needs revision (applied)

### Review — 2026-10-26 (round 4)
- **Reviewer**: Agent (fresh context, `om-spec-writing`)
- **Security**: forged marker on update of a plain line; `sales.orders.create` inline lines; order tab gated by the wrong sales feature (fixed)
- **Performance**: version list returned full definitions; no performance evidence declared (fixed)
- **Cache**: Passed
- **Commands**: line guard locked derived fields so the standard dialog failed; step-5 delete hit the quote lock; retry blocked for 2 minutes (fixed)
- **Risks**: `quote_not_editable` undefined (removed); finalise error list incomplete; dashboard bundle not raised as a question (Q5 added) (fixed)
- **Verdict**: Needs revision (applied)

### Review — 2026-10-26 (round 5)
- **Reviewer**: Agent (`om-spec-writing`)
- **Security**: a public insert could reference a real pending snapshot; order-only users blocked from snapshot detail (fixed)
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: recovery re-evaluated before adopting a committed line; attempt fencing did not cover the sales commit (fixed with advisory lock); conversion between insert and delete (narrowed and detected, residual raised in Q2)
- **Risks**: BOM units summed without conversion; dynamic options not enforced; studio draft read missing; SKU-less bound products (fixed)
- **Verdict**: Needs revision (applied; one residual risk documented)

### Review — 2026-10-27 (round 6)
- **Reviewer**: Team (UX review, verified by an agent)
- **Security**: Passed
- **Performance**: large models need sticky summary, collapsible BOM and groups (fixed)
- **Cache**: Passed
- **Commands**: price shown vs price saved not bound; last-write-wins on shared sessions; re-configure dropped commercial terms (fixed)
- **Risks**: standard sales dialog cannot save a configured line (moved editing to the tab, Q5); silent BOM gaps; orphaned sessions (fixed)
- **Verdict**: Needs revision (applied)

### Review — 2026-10-27 (round 7)
- **Reviewer**: Agent (verification of round 6 against the sales code)
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: tax carried as `taxRateId` although lines store a numeric rate; discount modes implicit; state after a failed replaced-line delete not deterministic (fixed)
- **Risks**: details spot drawn above the totals; no notice in the standard line dialog; lookup coverage missed color features (fixed)
- **Verdict**: Needs revision (applied)

### Review — 2026-10-27 (round 8)
- **Reviewer**: Agent (two independent UX flow reviews of the wireframes against the team review and the user stories)
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: a fixed discount could not be removed; re-configure of a removed line had no commercial terms; finalise on a discarded session undefined (fixed)
- **Risks**: studio SKU checks had no API; invalid local input did not disable the primary action; feature and rule editors not drawn (fixed)
- **Verdict**: Needs revision (applied)

### Review — 2026-10-27 (round 9)
- **Reviewer**: Agent (two independent final reviews with `om-spec-writing`)
- **Security**: explicit tax and gross amounts could bypass the line guard; preview and catalog items exposed catalog data without catalog permission (fixed)
- **Performance**: candidate query scanned definitions for the currency (fixed with a column)
- **Cache**: Passed
- **Commands**: reconcile read limited to the first page; converted order not found with an explicit order id; Phase E retry skipped the delete (fixed)
- **Risks**: dialog notice not buildable without a sales change (moved to the details spot, Q5); advisory lock behind a pooler; create-app template dependency (fixed)
- **Verdict**: Needs revision (applied)
