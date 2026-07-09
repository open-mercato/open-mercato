# 2026-06-23 — PrestaShop Integration Feasibility

> **Status:** Analysis / Feasibility study (not an implementation spec)
> **Author:** Sellision
> **Date:** 2026-06-23
> **Related analyses:** ANALYSIS-009 (Magento 2), ANALYSIS-005 (Shopify), ANALYSIS-007 (Akeneo PIM)
> **Target platform:** PrestaShop **8.x and 9.x** as primary targets; **PrestaShop 1.7.x as best-effort / requires validation** (Webservice API)

## Executive Summary

This document assesses the feasibility of building a **PrestaShop → Open Mercato** data integration as a future standalone module / community contribution. PrestaShop is a widely deployed open-source PHP e-commerce platform whose **Webservice API** exposes the shop database as a CRUD REST API.

**Overall verdict: FEASIBLE for a read-only import MVP (rough estimate ~80% catalog/customer/order coverage), with a clearly bounded set of caveats.** The strongest fit is the same as for Shopify and Magento: Customers, Catalog (Products + Categories), and Orders map onto existing Open Mercato entities. The recognized platform gap is identical to the other storefront integrations — **Open Mercato has no Inventory module**, so stock levels are explicitly out of scope for the MVP.

The core Webservice resources the MVP relies on (`customers`, `orders`, `products`, `combinations`, `categories`) are listed in the official resource catalog, **but their exact fields and runtime behavior must be validated per supported PrestaShop version** rather than assumed — this is a feasibility assessment, not a confirmed contract.

Two PrestaShop-specific characteristics drive most of the engineering risk:

1. **JSON output does not imply JSON input.** The Webservice can *return* JSON (`output_format=JSON`), but **POST/PUT/PATCH bodies must be XML** (confirmed against official docs: *"As of PrestaShop 8.1, the Webservice is only able to output JSON, it cannot read JSON inputs"*). This does not affect a read-only MVP, but it shapes any future write-back work.
2. **No reliable native delta-sync signal.** PrestaShop has no bulk API and no webhooks in core. Incremental sync depends on `filter[...]` + `date` parameters, and filtering on `date_upd` specifically is **not reliably supported across versions** and **requires validation** (see §2, §7). The MVP therefore ships with **manual, full read-only sync** and treats incremental delta as a follow-up.

Recommendation: proceed with a read-only, manually-triggered, tenant-aware import module built as a dedicated workspace package (`@open-mercato/sync-prestashop`) modeled on `packages/sync-akeneo`. Resolve the Review Questions in §11 before promoting this analysis to an implementation spec.

## 1. Entity Mapping Matrix

Mappings are graded **Direct** (clean 1:1), **Partial** (maps with transformation/loss), or **None** (no Open Mercato equivalent). Field-level details for each resource must be validated against each supported PrestaShop version before implementation.

### 1.1 Customers

| PrestaShop resource | Open Mercato entity | Confidence | Notes |
|---|---|---|---|
| `customers` | `CustomerEntity` (kind=person) + `CustomerPersonProfile` | Direct | email, firstname, lastname, active |
| `addresses` | `CustomerAddress` | Direct | 1:N; PrestaShop links address → customer via `id_customer` |
| `groups` (customer groups) | `CustomerDictionaryEntry` / custom field | Partial | group semantics differ; map as dictionary or tag |
| `newsletter` / `optin` flags | Custom fields (`ce.ts`) | Partial | marketing consent stored as custom field |

### 1.2 Catalog — Products & Categories

| PrestaShop resource | Open Mercato entity | Confidence | Notes |
|---|---|---|---|
| `products` | `CatalogProduct` | Direct | name, description (HTML), reference (SKU), active |
| `combinations` | `CatalogProductVariant` | **Partial** | PrestaShop combinations = cartesian product of attribute values; flattening risk (see §4.1) |
| `categories` | `CatalogProductCategory` + `CatalogProductCategoryAssignment` | Direct | tree via `id_parent` |
| `product_option_values` / `product_options` (Attributes) | `CatalogOptionSchemaTemplate` | Partial | drive variant axes |
| `product_features` / `product_feature_values` (Features) | Custom fields (`ce.ts`) | Partial | non-variant descriptive attributes |
| product price (`price`, specific prices) | `CatalogProductPrice` / `CatalogOffer` | Partial | tax-inclusive vs exclusive; specific prices = rules |
| `manufacturers` | Custom field / `CustomerDictionaryEntry` | Partial | no brand entity in OM |
| `suppliers` | Custom field | Partial | no supplier entity in OM |
| product images (`/images/products`) | `Attachment` | Partial | binary download required; not part of MVP core |
| `stock_availables` | — | **None** | no Inventory module (out of scope) |

### 1.3 Orders / Sales

| PrestaShop resource | Open Mercato entity | Confidence | Notes |
|---|---|---|---|
| `orders` | `SalesOrder` | Direct | reference, total_paid, currency, customer |
| `order_details` (line items) | `SalesOrderLine` | Direct | embedded in order payload |
| order billing/shipping address | `SalesDocumentAddress` | Direct | resolved via `id_address_*` |
| `order_states` + `order_histories` | `SalesOrder.status` + `SalesNote` | Partial | status mapping table required (see §4.5) |
| `order_carriers` / `carriers` | `SalesShippingMethod` | Partial | carrier list maps to shipping methods |
| cart rules / vouchers (`order_cart_rules`) | `SalesOrderAdjustment` | Partial | discount line mapping |
| `order_payments` | `SalesPayment` (record only) | Partial | recorded as payment rows, NOT a live gateway (out of scope) |
| `order_invoices` | — | None (out of scope) | invoices excluded from MVP |
| `order_slips` (credit slips / returns) | — | None (out of scope) | returns excluded from MVP |
| `taxes` / `tax_rules` | `SalesTaxRate` | Partial | preserve original PrestaShop amounts |

### 1.4 Multistore / Channels

| PrestaShop concept | Open Mercato entity | Confidence | Notes |
|---|---|---|---|
| Shop / Shop Group (multistore) | `SalesChannel` | Partial | optional; MVP may target a single shop |
| Languages (`id_lang` per field) | Translation Manager / locale resolution | Partial | every translatable field is keyed by language id |
| Currencies | `currencyCode` on price/order | Direct | per-order currency available |

## 2. Technical Compatibility

### 2.1 API surface

PrestaShop exposes the **Webservice API** — documented as a **CRUD API** (POST=Create, GET=Read, PUT/PATCH=Update, DELETE=Delete), with one resource per shop entity (`/api/customers`, `/api/orders`, `/api/products`, `/api/combinations`, `/api/categories`, …). These core resources appear in the official resource catalog. **Their exact field sets, optionality, and edge-case behavior are not assumed confirmed here and must be validated per supported version (8.x / 9.x primary; 1.7.x best-effort).**

### 2.2 Authentication

- API key generated in PrestaShop back office (Advanced Parameters → Webservice).
- Sent as **HTTP Basic Auth username with no password** (`Authorization: Basic <base64(key:)>`), or as `?ws_key=` in the URL (less safe). Official docs recommend the Authorization header.
- **No OAuth, no token refresh** — a single long-lived secret. Must be stored encrypted (same pattern as Akeneo credentials in `SyncMapping`).
- Per-resource permissions are configurable in the back office; the integration should document the minimum read scopes it needs and fail the connection test clearly if a resource is forbidden.

### 2.3 Output format

- Default response format is **XML**. **JSON output is available** via `output_format=JSON` or `io_format=JSON` query params, or the `Output-Format: JSON` / `Io-Format: JSON` headers (PrestaShop 1.7+).
- **Critical asymmetry (verified):** JSON output does **not** enable JSON input. POST/PUT/PATCH request bodies must be **XML** (typically obtained from `?schema=blank`, filled, and sent back). This is irrelevant to a read-only MVP but is a hard constraint on any future write-back. The integration should request JSON for reads and must not assume symmetric JSON.

### 2.4 Filtering, pagination, sorting

Confirmed against official "Additional list parameters" docs:

- **Filtering:** `filter[field]=[value]` with operators — intervals `[1,10]`, OR `[1|5]`, begins `[Jo]%`, ends `%[hn]`, contains `%[oh]%`.
- **Display:** `display=full` or `display=[id,name,price]` to limit fields (important for payload size on large catalogs).
- **Pagination:** `limit=[offset,]limit` (e.g. `limit=50` then `limit=50,50`). Offset-based, **not cursor-based** — large catalogs require careful page iteration.
- **Sorting:** `sort=[field_DESC]`, multiple allowed.
- **Date filtering:** filtering/sorting on date fields requires an extra `&date=1` flag. Official examples use **`date_add`**.

### 2.5 Delta / change tracking — REQUIRES VALIDATION

- There is **no bulk API** and **no core webhook system** in PrestaShop. Real-time push is not available without third-party modules.
- Incremental sync would rely on `filter[date_upd]=[from,to]&date=1`. **However, filtering on `date_upd` is reported as unreliable / unsupported in several PrestaShop versions** — the field is treated as "dynamic" and rejected for GET filtering in some releases (PrestaShop issues #14606, #12385). **This MUST be validated against each supported PrestaShop version before being relied upon.**
- **Consequence for the MVP:** ship **manual full read-only sync** first; treat `date_upd`-based incremental sync as a follow-up gated on the validation above. `date_add` filtering is a more reliable fallback for "new since" scenarios but does not capture updates.

### 2.6 Rate limits

PrestaShop core imposes **no documented rate limit**; throughput is bounded by the merchant's hosting. The client must therefore self-throttle (bounded concurrency, exponential backoff on 5xx/timeouts) to avoid overloading small shops — reuse the Akeneo client's backoff approach.

## 3. What Works Well (Low Risk)

- **Stable, documented CRUD read API.** GET on every needed resource, with field selection (`display`) and basic filtering.
- **Customers and Categories** map closely onto Open Mercato entities.
- **Orders with line items** are retrievable with billing/shipping addresses and totals, sufficient for read-only order ingestion.
- **JSON reads** remove XML-parsing burden for the import path (the constrained side, XML input, is out of scope for the MVP).
- **Field selection + pagination** let the importer keep payloads small and resumable.
- **Architecture parity:** the read-only, adapter-based, queue-driven, reconcilable import pattern from `packages/sync-akeneo` transfers almost directly.
- **No OAuth dance:** a single API key simplifies the connection-test and credential flow.

## 4. Key Challenges / Gaps

### 4.1 Combinations → Variants flattening (Partial, MEDIUM/HIGH)

PrestaShop **combinations** are generated from the cartesian product of attribute values attached to a product. Mapping to `CatalogProductVariant` requires:

- resolving each combination's attribute axes via `product_option_values`,
- deduplicating shared attribute definitions,
- handling products with **zero combinations** (simple products) vs many.

**MVP stance:** import combinations as variants in a **limited** form (basic axis + SKU + price + barcode), or, if core-team review shows the axis resolution is too costly, ship **simple products only** in v1 and treat combinations as an explicit, documented follow-up. Store the original PrestaShop combination payload in metadata for later enrichment.

### 4.2 Attributes vs Features (Partial, MEDIUM)

PrestaShop has **two** distinct attribute systems: **Attributes** (drive combinations / variant axes) and **Features** (descriptive, non-variant). They must be routed to different Open Mercato targets — Attributes → option schema, Features → custom fields — and conflating them produces wrong variant matrices.

### 4.3 Multilingual fields (Partial, MEDIUM)

Translatable fields (`name`, `description`, …) are returned as **per-language arrays keyed by `id_lang`**. The importer needs a locale-resolution strategy (a preferred language with fallback, analogous to Akeneo's `readPreferredValue`) plus a mapping from each PrestaShop language id to the corresponding Open Mercato locale, so that translated values land on the correct Open Mercato locale (via the Translation Manager) and a default locale is always chosen when a translation is missing.

### 4.4 Price model differences (Partial, MEDIUM)

PrestaShop prices can be tax-included or tax-excluded, and **specific prices** are rule-based (per group/country/quantity/date). The MVP should import the **base price** only and preserve original amounts; specific-price rules are a follow-up.

### 4.5 Order status mapping (Partial, MEDIUM)

`order_states` are merchant-configurable (including custom states). A **configurable mapping table** (PrestaShop state id/name → Open Mercato `SalesOrder.status`) is required, with a safe default and a way to surface unmapped states in the sync log rather than silently dropping them.

### 4.6 No native delta + offset pagination (HIGH for incremental)

As described in §2.4/§2.5: no webhooks, no bulk API, unreliable `date_upd` filtering, and offset-only pagination make robust incremental sync non-trivial. This is the main reason the MVP is scoped to **manual full read-only sync**.

### 4.7 Deletion detection (MEDIUM)

The API gives no "deleted since" signal. Detecting records removed in PrestaShop requires **full ID reconciliation** (compare imported external IDs against the current PrestaShop ID set, then deactivate the missing ones) — the same reconciliation pattern Akeneo uses.

### 4.8 Version drift (MEDIUM)

Behavior differs across PrestaShop versions (e.g. JSON output availability, `date_upd` filtering, resource fields). The MVP targets **8.x and 9.x as primary**, with **1.7.x as best-effort pending validation**, and must validate assumptions per supported version.

## 5. Framework Gaps (Open Mercato side)

These are gaps in Open Mercato, not PrestaShop, and are **shared with the Shopify/Magento analyses**:

- **No Inventory module (Critical, shared gap).** `stock_availables` has no home. **Out of scope for the MVP**; revisit when a platform Inventory module exists.
- **No brand/manufacturer or supplier entity.** Map to custom fields / dictionary entries for now.
- **No DAM / media-management module.** Product image binaries can be stored as `Attachment`, but there is no rich media model; images are excluded from the MVP core.
- **Custom-field translations.** Open Mercato custom fields are not natively multilingual; non-default-locale values may need to be stored in metadata (same limitation noted for Akeneo).
- **Returns / credit slips and invoices** have partial sales-document support but are intentionally out of MVP scope.

None of these block the MVP; they bound it.

## 6. Proposed Implementation Architecture

> Architecture sketch only — concrete contracts belong in the follow-up implementation spec.

### 6.1 Packaging

Build a **dedicated workspace package** `@open-mercato/sync-prestashop` (module id `sync_prestashop`), **not** an app-level module. Rationale (per project conventions and the Step-4 comparison): the integration has an external HTTP API, complex N-way mapping, credentials + health check, queues/workers, and an independent release lifecycle — exactly the `packages/sync-akeneo` profile, and far beyond the in-process `example_customers_sync` 1:1 pattern. Provider integrations must live under `packages/`, never in `packages/core`.

### 6.2 Module layout (mirrors `sync-akeneo`)

```text
packages/sync-prestashop/
  src/modules/sync_prestashop/
    index.ts                 # module metadata; requires: integrations, data_sync, catalog, sales, customers
    di.ts                    # registerDataSyncAdapter(...), register health check
    integration.ts           # IntegrationDefinition: credentials (baseUrl, apiKey), category 'data_sync'
    setup.ts                 # optional env preset, default mappings, ACL/feature seeding
    acl.ts                   # data_sync.configure / data_sync.run scopes
    lib/
      client.ts              # Webservice client: Basic auth, JSON reads, filter/limit/sort, backoff, host allowlist
      adapter.ts             # DataSyncAdapter implementation (entry point)
      importer.ts            # transform + upsert per entity (customers, categories, products, orders)
      mapping.ts             # load/resolve field + status mappings from SyncMapping
      cursor.ts              # pagination/cursor serialization (offset-based)
      status-map.ts          # PrestaShop order_state -> SalesOrder.status
      first-import.ts        # orchestration: categories -> products -> customers -> orders
    workers/
      first-import.ts        # queued full-sync worker with ProgressService
    api/
      first-import/route.ts  # POST trigger + GET status (manual sync)
      discovery/route.ts     # connection test + metadata (languages, order states) for UI
    data/validators.ts       # zod schemas for discovery/config payloads
    i18n/                    # en, pl, es, de
```

### 6.3 Connection test

A discovery/health endpoint that calls a cheap authenticated GET (e.g. `/api/?output_format=JSON` or `/api/customers?limit=1`) to verify base URL + API key + resource permissions, returning a clear pass/fail with the failing resource named.

### 6.4 Tenant-aware, encrypted config

Credentials (`baseUrl`, `apiKey`) and field/status mappings persisted per `{ tenantId, organizationId }` in `SyncMapping`, encrypted, loaded via DI — identical to the Akeneo pattern. All writes scoped by tenant/org; no cross-tenant data exposure.

### 6.5 Duplicate protection

Every imported record carries its **PrestaShop external id** (resource + id). Upserts key on `(integrationId, entityType, externalId)` so re-running a sync updates in place rather than duplicating — the same external-id keyed upsert Akeneo uses.

## 7. Data Sync Strategy

### 7.1 MVP — manual, full, read-only import

1. **Trigger:** user clicks "Sync now" (manual) → enqueues a single full-import job (concurrency 1), tracked via `ProgressService`.
2. **Order of operations (respect dependencies):** `categories → products (+ combinations, limited or deferred per review) → customers → orders`.
3. **Read path:** JSON output, `display=[…]` to trim payloads, `limit` offset pagination, bounded concurrency + backoff.
4. **Upsert:** transform → external-id keyed create/update; record every decision.
5. **Reconciliation:** after a full pass, compare PrestaShop IDs vs imported IDs and deactivate records missing upstream (deletion detection).

### 7.2 Sync log / error log

Persist a per-run record (counts created/updated/skipped/failed, per-entity progress, errors with the offending external id and reason). Unmapped order states and skipped/limited combinations are logged explicitly rather than silently dropped. Surface in the integration UI.

### 7.3 Incremental sync (follow-up, gated)

Only after validating `date_upd` (or falling back to `date_add` "new since") per supported version: add an incremental mode using `filter[date_upd]=[from,to]&date=1` and a stored high-water mark. Until then, "incremental" = re-run full sync.

### 7.4 Scheduling

MVP is **manual only**. Automated scheduling (cron/queue cadence) and any real-time strategy are out of scope.

## 8. Implementation Phasing + Effort

Estimates are rough, for sequencing only (not a task breakdown).

| Phase | Scope | Rough effort |
|---|---|---|
| **Phase 1 — MVP (read-only)** | Package scaffold; Webservice client (auth, JSON reads, filter/limit/sort, backoff); connection test; manual full sync; **Customers + Categories + Products + Orders** with order status mapping; **Combinations/variants as a limited import or an explicit follow-up, per core-team review**; external-id dedupe; tenant-aware encrypted config; sync/error log; reconciliation/deletion detection. **Out of scope:** inventory/stock, write-back, invoices, returns, webhooks, advanced scheduler. | ~3–5 weeks |
| **Phase 2 — Incremental & enrichment** | `date_upd`/`date_add` delta (after validation); specific prices; manufacturers/suppliers; product images → `Attachment`; multilingual field resolution polish; multistore → channels | ~2–4 weeks |
| **Phase 3 — Advanced (optional)** | Scheduled sync; write-back (requires XML POST/PUT path); payments/invoices/returns once platform support exists; Inventory once a platform Inventory module exists | gated on platform work |

## 9. Risk Matrix

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| `date_upd` filtering unsupported/unreliable across versions | High | High | **Validate per version**; MVP uses manual full sync; fall back to `date_add` for "new since" |
| No Inventory module in Open Mercato | High | Certain | Stock out of scope for MVP; revisit when platform Inventory exists |
| Combinations → variants flattening is complex/expensive | Medium/High | Medium | Limited combination import in v1, or simple-products-only with combinations as documented follow-up |
| Offset pagination + large catalogs → slow/heavy full syncs | Medium | High | `display` field trimming, bounded concurrency, progress tracking, resumable jobs |
| No native delta / no webhooks | High | Certain | Manual full sync + reconciliation in MVP; incremental as gated follow-up |
| Order-state mapping gaps (custom states) | Medium | High | Configurable status map + safe default + log unmapped states |
| Attributes vs Features conflated | Medium | Medium | Explicit routing: Attributes→option schema, Features→custom fields |
| Multilingual `id_lang` field handling | Medium | High | Locale-resolution strategy + PrestaShop-language → Open Mercato-locale mapping |
| Resource field/behavior differs from assumptions | Medium | Medium | Validate fields per supported version before implementation |
| API key compromised (single long-lived secret) | Medium | Low | Encrypted storage, host allowlist, least-privilege resource scopes |
| No rate limit → overload small shops | Medium | Medium | Self-throttle: bounded concurrency + exponential backoff |
| Version drift (8.x/9.x primary, 1.7.x best-effort) | Medium | Medium | Declare supported versions; validate per version |
| Deletion detection only via full reconciliation | Medium | High | Full ID reconciliation pass after each sync |
| Future write-back requires XML input (no JSON input) | Low (MVP) | Certain | Out of MVP scope; design XML POST/PUT path only if Phase 3 write-back is approved |

## 10. Verdict & Recommendations

**Verdict: FEASIBLE — proceed with a read-only, manual, tenant-aware MVP.**

- The Customers / Catalog / Orders core maps onto Open Mercato well enough to deliver real value in a read-only import, and the engineering pattern is a near-direct reuse of `sync-akeneo`.
- The MVP scope deliberately excludes the hard/blocked areas (inventory, write-back, webhooks, invoices, payments-as-gateway, returns, advanced scheduler, full migration), keeping risk bounded.
- The two genuinely PrestaShop-specific risks — **XML-only input** and **unreliable `date_upd` delta** — do not affect a read-only manual MVP and are explicitly deferred.

**Recommended approach:**

1. Build `@open-mercato/sync-prestashop` as a workspace package modeled on `sync-akeneo`.
2. Ship Phase 1 (read-only, manual, full sync) with external-id dedupe, status mapping, reconciliation, and a sync/error log; decide combinations scope (limited vs follow-up) via core-team review.
3. **Before** Phase 2, validate `date_upd` filtering against each supported PrestaShop version; only then build incremental sync.
4. Keep this document as a feasibility analysis; create a separate implementation spec (`.ai/specs/{date}-prestashop-sync-mvp.md`) once the Review Questions below are resolved.

**Out of scope for the MVP (by design):** bidirectional/write-back sync, inventory/stock, invoices, payment gateway, returns, webhooks, advanced scheduler, full shop migration.

## 11. Review Questions for Open Mercato Core Team

1. **Combinations scope:** For v1, do we ship **limited combination→variant import**, or **simple products only** with combinations as a documented follow-up?
2. **Supported PrestaShop versions:** Confirm the target matrix (proposed: 8.x and 9.x primary, 1.7.x best-effort). Is 1.7.x support required given its weaker JSON/filter behavior?
3. **`date_upd` validation owner:** Who validates `date_upd` filtering per version, and is `date_add`-based "new since" an acceptable interim until that's confirmed?
4. **Order status mapping:** Should the PrestaShop `order_state → SalesOrder.status` map be a shipped default, fully merchant-configurable in the UI, or both?
5. **Manufacturers/suppliers:** Acceptable to land these as custom fields / dictionary entries for now, or is a brand/supplier entity on the platform roadmap?
6. **Images:** Are product images in or out of the MVP? If in, confirm `Attachment` is the right sink and acceptable bandwidth cost.
7. **Multistore:** Does the MVP target a single shop, or must it handle multistore → `SalesChannel` from day one?
8. **Inventory dependency:** Confirm stock stays out until a platform Inventory module exists, matching the Shopify/Magento decision.
9. **Connection-test scope:** Minimum resource permissions the connection test must verify?
10. **Module home:** Confirm this ships as `@open-mercato/sync-prestashop` (workspace package), consistent with the provider-package convention, rather than an app-level module.

## References

- [PrestaShop Webservice — Getting Started (official developer docs)](https://devdocs.prestashop-project.org/9/webservice/getting-started/)
- [PrestaShop Webservice — The PrestaShop Webservice API (official developer docs)](https://devdocs.prestashop-project.org/9/webservice/)
- [PrestaShop Webservice — Additional list parameters: filtering, sorting, pagination (official developer docs)](https://devdocs.prestashop-project.org/8/webservice/tutorials/advanced-use/additional-list-parameters/)
- [PrestaShop GitHub Issue #14606 — "The field date_upd is dynamic. It is not possible to filter GET query with this field."](https://github.com/PrestaShop/PrestaShop/issues/14606)
- [PrestaShop GitHub Issue #12385 — Webservice get products, filter date_upd](https://github.com/PrestaShop/PrestaShop/issues/12385)
