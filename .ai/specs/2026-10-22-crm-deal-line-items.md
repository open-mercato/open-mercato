# CRM deal line items and amount authority

## 📝 TLDR

Let sales teams describe a deal with manually entered product or service lines and calculate its value consistently across UI, API and import. Make the amount source explicit: calculated from lines or manually overridden. This independently deployable capability implements the line-item requirement of [issue #7700](https://github.com/open-mercato/open-mercato/issues/7700); it does not turn CRM deals into invoices, orders or subscriptions.

## Overview

Proposed 2026-10-22, based on `main` `0c886d0a14c02106ff2abc9728be36c04c5a2ccd`. Follow the [Phase 1 shared contract](2026-10-22-crm-field-model-phase-1.md). Current `CustomerDeal.valueAmount` is nullable `numeric(14,2)`, currency is nullable text, and there is no deal-line entity. This capability requires no catalog selection or pricing integration. Nullable scalar source IDs and local snapshots reserve an additive seam for the separate [catalog selection capability](2026-10-22-crm-deal-catalog-selection.md). Research and product-pattern sources were read on 2026-10-22; source dates, citations and limitations remain in the [research evidence](assets/crm-field-model-phase-1/research.md).

## Resolved assumptions (autonomous defaults)

| Question | Default | Reason |
|---|---|---|
| Which amount wins? | Persist `valueMode=manual\|line_items`; existing deals start manual, new UI selects calculated mode when adding the first line only after confirmation if an amount exists. | Avoid erasing historic estimates. |
| Taxes, subscriptions and discounts? | Net one-time values only; per-line fixed or percent discount; no invoice taxes, ARR/MRR, schedules, stock or currency conversion. | Keep opportunity valuation separate from financial documents. |
| Does a future source update change a saved line? | Never automatically; line-owned name/price/currency snapshots remain authoritative. | Historic negotiation values belong to the deal; concrete catalog selection is separate. |
| Precision? | Four decimal internal money, fixed-point decimal arithmetic; widen existing amount column additively, preserve JSON field name/type. | Match the currencies module's precision requirement without floating-point drift. |

## 📝 Problem Statement and evidence

An unexplained difference between line totals and headline amount undermines forecasts. [Pipedrive](https://support.pipedrive.com/en/article/how-can-i-link-products-to-a-deal) allows deal-specific prices and one currency per deal; [SuiteCRM](https://docs.suitecrm.com/user/sales-relationships/quotes-invoices-contracts/) separates quantities, discounts and totals. A [HubSpot user report](https://community.hubspot.com/t/why-isn-t-deal-amount-updating-after-importing-line-items-in-hubspot/147312) describes associated imported lines not updating deal amount. These sources motivate a common server calculation and visible authority; they do not prescribe Mercato's exact schema. See [research limits](assets/crm-field-model-phase-1/research.md).

## 📝 Proposed Solution

Deal detail gets a Lines section and an amount-source control. Once the parent deal has a valid currency, a manual line needs only name, quantity and unit price. For an existing currency-null deal, explicitly select and save the parent currency first; no default currency or catalog installation is required. The saved line always owns its price. Nullable source identity fields allow a separately installed source adapter to populate a snapshot, but this spec adds no catalog picker or price resolution. The summary always displays calculated total, authoritative deal value and a Manual override badge when they differ.

Deleting the last line in calculated mode produces exactly zero, never restores an old manual value. Switching to manual initializes the override from the current authoritative amount unless the caller provides one. Switching to calculated always recomputes from current active lines. A legacy update that explicitly supplies `valueAmount` switches the deal to manual in the compatibility adapter; an unrelated update never changes mode. New clients cannot send `valueMode=line_items` plus an arbitrary `valueAmount`; the server rejects contradictory intent.

## 📝 Architecture

Customers owns entities, validators, `commands/dealLineItems.ts`, a pure bounded fixed-point calculator and `DealLineItemsSection`/`DealValueModeField`. Use existing decimal support if its exactness is established; otherwise a small scaled-integer utility within customers handles this bounded arithmetic without adding a production dependency. The new utility does not select catalog prices, exchange currency or reproduce the sales calculation engine.

Customers exposes an optional source seam without depending on any concrete catalog implementation. `source`, `productId` and `variantId` are scalar references plus local snapshot fields, never ORM relationships. Base manual writes leave them null. A non-null new source/reference requires an enabled adapter that validates source identity/scope; without one, return a provider-unavailable field error instead of trusting caller-supplied IDs. Existing snapshots remain readable when the source is absent, and unrelated manual price/name edits do not require live source resolution. The concrete `customersDealProductSources` registration, resolver and product picker are specified by the separate catalog selection capability.

The base commands own arithmetic and persist the already validated source snapshot. They perform no catalog price selection or network calls. No direct customers-to-catalog entity imports or mandatory module dependency are introduced; stored source data remains sufficient for lists, totals, undo and export.

## 📝 Data Model

`CustomerDealLineItem`, table `customer_deal_line_items`:

| Field | Type / invariant |
|---|---|
| `id`, `tenant_id`, `organization_id`, `created_at`, `updated_at`, `deleted_at` | Standard UUID/scope/lifecycle; every child read returns `updatedAt`. |
| `deal_id` | Same-scope live deal, same-module FK; index with scope/deleted/order. |
| `source`, `product_id`, `variant_id` | Nullable provider token/UUIDs; scalar cross-module IDs only; manual lines have nulls. |
| `name`, `sku` | Name 1–200 chars, optional SKU ≤100, snapshotted; name encrypted as potentially customer-specific free text. |
| `quantity` | Decimal(18,4), strictly positive, maximum 1,000,000; up to four fractional digits. |
| `unit_price` | Decimal(18,4), nonnegative; up to four fractional digits. |
| `discount_type`, `discount_value` | `none`, `percent`, `fixed`; decimal(18,4), default zero; percent 0..100; fixed is discount on the whole line, not per unit. |
| `line_total` | Decimal(18,4), server computed, nonnegative. |
| `currency` | Three-letter uppercase currency identical to the normalized deal currency; snapshot, not current catalog currency. |
| `position` | Nonnegative integer; stable ordering by position then ID. |

Add `CustomerDeal.valueMode` (`manual` default) and `calculatedValueAmount` (decimal(18,4), default zero). Widen `value_amount` to decimal(18,4) without shrinking existing range; preserve null existing manual values and existing serializer types. New fields use existing API casing conventions; new child amounts are decimal strings. Both decimal overflow and totals over the column bound are 400 field errors, never rounded into an unrelated value. There is no new monetary FX posting: existing reporting's date-based conversion and missing-rate disclosures remain; this feature produces no ledger entries or realized gains/losses.

Formula: `gross = quantity × unitPrice` at exact intermediate precision; `discount = gross × percent/100` or fixed amount; `lineTotal = roundHalfUp(gross − discount,4)`; calculated total is the exact sum of stored four-place active line totals. Validate fixed discount ≤gross before rounding. No tax included. Display uses currency precision but expandable detail/export exposes four-place values; display rounding never feeds back into storage. Example: 3 × 0.3333 = 0.9999; 10% discount → 0.8999. All public samples say net value. Do not aggregate different currencies without the existing currency conversion services and date policy.

Index `(tenant_id, organization_id, deal_id, deleted_at, position, id)` supports bounded paged lines and sums; FK/command checks prevent cross-scope attachment. No uniqueness by product: the same product may appear twice at different negotiated terms. Maximum 1000 active lines/deal, pages ≤100. Every line update or delete increments both line and parent versions within the same transaction. Sensitive `name` and future free text use `defaultEncryptionMaps` and the existing-tenant map backfill migration; no credentials or raw provider payloads are stored.

## 📝 API Contracts

| Route | Request / response | Features |
|---|---|---|
| `GET /api/customers/deal-line-items?dealId=UUID` | Paged existing CRUD envelope; `id` query for a single row. Child fields camelCase, decimal strings, `updatedAt`; includes `dealUpdatedAt` for related-write context. | `customers.deals.view`, authorized parent. |
| `POST /api/customers/deal-line-items` | `{dealId,clientMutationId,expectedDealUpdatedAt,name,quantity,unitPrice,discountType?,discountValue?,position?,source?,productId?,variantId?}` → create envelope with required authoritative totals/parent version and `replayed:false`; replay returns the original result with `replayed:true`. Parent expectation and UUID `clientMutationId` are required. | `customers.deals.manage`. |
| `PUT /api/customers/deal-line-items` | `{id, ...editable fields, expectedDealUpdatedAt?}` with child-version header; dealId immutable. | Same manage feature. |
| `DELETE /api/customers/deal-line-items?id=UUID` | Child-version header, optional parent expectation; soft delete then recompute. | Same manage feature. |
| `PUT /api/customers/deals` | Existing route gains `{id,valueMode,valueAmount?}` with parent-version header. Currency recovery uses its existing `{id,valueCurrency}` input with the parent-version header, then reads the fresh parent version; ordinary deal edits remain compatible. | Same manage feature. |
| Existing deal list/detail/aggregate/summary/map | Existing `valueAmount` stays authoritative; optional `valueMode`, `calculatedValueAmount` on list/detail only. Existing aggregation helpers remain currency-aware. | Existing view guards. |

New CRUD routes use `makeCrudRoute`, indexer, Zod, command bus, `metadata`, OpenAPI and standard 400/401/403/404/409 envelopes. Read-only `lineTotal`/calculated total cannot be trusted from caller input. Parent-scope authorization precedes child lookup output. New forms send child `updatedAt` and parent `expectedDealUpdatedAt`; aggregate operations cannot accidentally reuse a parent optimistic header against a child. Create requires `expectedDealUpdatedAt` in its payload and has no preexisting child version: missing expectation returns 428, a stale expectation returns the standard 409 conflict after locking the parent. Apply the same requirement to imports/service line-create calls; parentless retries must not bypass it. Legacy direct deal writes retain no-header compatibility.

All line mutations, including import/service calls, invoke the same command calculator. Serialize mutations by locking parent deal, then child rows in stable ID order; compare expected versions after lock. Recompute `SUM(line_total)` within that transaction, update `calculatedValueAmount`, and copy to `valueAmount` only in calculated mode. A concurrent manual-mode toggle conflicts or serializes, never loses authority. Command metadata does not deduplicate execution at this baseline. Require UUID `clientMutationId` on every browser/import/service create and reuse it after an unknown outcome. Add internal `customer_deal_line_create_receipts`: UUID ID, tenant/org/deal IDs, client mutation UUID, encrypted canonical creation request and original response snapshot, created/updated timestamps; unique `(tenant_id, organization_id, deal_id, client_mutation_id)`. It is command-owned operational state with no public mutation API. Validate scope and lock the parent first, then look up the receipt **before** checking the expected parent version. A matching prior request returns the stored result (200, `replayed:true`) without touching rows or emitting effects, even if the parent or line changed later; a different request using the key returns 409 `IDEMPOTENCY_KEY_REUSED`. A fresh key checks the parent expectation, writes the line/totals and receipt in one transaction (201). Missing key is 400. Replayed versions describe the original result; the UI refetches current state. A deleted line is never recreated by replay. Canonical comparison includes the original expected version and all normalized create fields. Receipt snapshots use framework encryption maps, including no raw sensitive logs. Do not expire receipts while the deal exists; delete/restore lifecycle follows the parent snapshot contract below.

For a fresh line create, validate the locked parent's `valueCurrency` after receipt replay handling and the expected-parent-version check. Null/absent/blank currency returns 400 `DEAL_CURRENCY_REQUIRED`; a nonblank value that cannot normalize to three alphabetic uppercase characters returns 400 `DEAL_CURRENCY_INVALID`. Return the standard field-error envelope with a `valueCurrency` field error and translated messages (`customers.deals.lineItems.errors.currencyRequired` / `currencyInvalid`). No line, total, value-mode change, receipt or side effect commits. These are preconditions of the new line API/command, including browser/import/service calls; do not tighten the legacy deal schema or fabricate currency for existing records. Normalization trims/uppercases a valid parent code for the line snapshot and comparison, without silently rewriting stored parent data. The existing currency dictionary supplies choices, not a new closed registry requirement.

Recovery is a separate guarded `PUT /api/customers/deals` with `{id,valueCurrency}` and the deal's current optimistic-lock header. It keeps normal manage authorization, mutation guards, snapshots/undo and post-commit effects. Obtain the authoritative new `updatedAt` from the normal deal read after success, verify that its normalized currency still equals the user's saved choice, and use that version as `expectedDealUpdatedAt` for the subsequent line POST. A different currency on that read requires explicit conflict/review recovery, never silently relabeling the pending price. A stale parent update or line create returns the standard 409 and requires refresh; line create never silently selects or overwrites parent currency. A matching receipt replay still returns its original result without revalidating today's currency.

Changing deal currency with active lines returns 400 `DEAL_LINES_CURRENCY_MISMATCH`; user clears/rebuilds lines or keeps currency. No silent conversion. With zero active lines currency remains editable. Selecting currency does not change the numeric manual estimate or imply conversion. A future source snapshot in another currency must be rejected at the seam; manual same-currency price remains available. Concrete catalog lookup behavior is specified separately.


Parent deal deletion and undo of deal creation currently physically remove the deal. Extend those exact commands to lock the parent (the same lock used by line writes), capture all active/deleted line rows and creation receipts in the encrypted aggregate snapshot, remove these children before the parent within the same transaction, and restore parent before its children during undo/redo. Never rely on ON DELETE CASCADE without snapshot restoration. A concurrent child write or later conflicting parent state makes the operation conflict rather than discard new children. Normal line-create undo preserves its receipt so replay cannot recreate the removed line. Parent delete/restore retains original IDs, amounts, versions and receipt semantics; usual post-commit cache/index effects still apply.
## Undo, events and cache

Commands snapshot before/after line, amount mode, authoritative amount, computed amount, parent version and custom fields. Undo performs the inverse under parent+child version checks, then recalculates from active lines; any later edit conflicts with no partial restoration. Undo of adding a first line restores the previous manual null/value and mode if that compound action changed them. An external source read is not undoable, but stored snapshots are.

Declare typed `customers.deal_line_item.created/updated/deleted` events plus normal deal-updated effects after commit; use singular entity IDs even though existing command IDs may be plural. Emit compatible payloads containing scoped IDs/versions, not full sensitive snapshots. Execute/undo invalidate deal detail/list and linked-company/person deal KPI tags, summary/map/aggregate caches and query indexes after commit. Resolve cache through DI; no new child cache is required. The normal parent/detail read uses one paged child query, not one query per product; a source adapter is never called while rendering saved lines. Default read cache TTL/invalidation follows the existing parent route, with tenant/org tags; immediate mutation response carries authoritative totals to avoid stale visual sums.

## 📝 UI/UX and Frontend Contract

Use `DataTable` for line rows, a `CrudForm` line dialog, existing amount inputs with locale parsing, and `DetailFieldsSection` for totals. The header labels Net value and Manual override/Calculated from lines explicitly. Keep quantity, price, discount and computed total visible without opening advanced tax/accounting controls. Empty, read-only, saving, validation and conflict states are distinct. Source-bearing rows always render their stored snapshot even if no adapter is installed; the optional catalog capability adds source-selection/deleted-product states.

On Add line with a missing/invalid parent currency, show a translated prerequisite state with the existing customers `DealCurrencyField`/currency-dictionary selection and explicit Save currency action before enabling line submission. Explain that any existing manual estimate is retained as a number and no conversion occurs. Use `CrudForm` or guarded scoped parent headers for this parent write, never a child header. Preserve entered line values while selecting currency or recovering from a server precondition/conflict error; refresh the parent version before retry. Canceling selection writes nothing and creates no line. Canceling line creation after a successful separate currency save leaves that explicit parent change in place; its normal undo remains available, subject to the active-line currency invariant. Dictionary unavailable/empty/error states stay actionable through existing currency settings for authorized users, without selecting a tenant, product or hard-coded default currency. Catalog is absent in this complete manual flow.

Two client leaves, `DealLineItemsSection` and `DealValueModeField`, own line-dialog and mode-confirmation state respectively; the separate catalog capability may inject a lazy route-scoped picker through the optional seam. No new root `use client`, global pricing provider, sales editor or heavy browser dependency. New leaves ≤300 LOC; existing deal page root remains a temporary legacy exception with no new calculation logic. `apiCall`, guarded writes, parent/child-specific versions, current `Alert` props, semantic tokens, localization, keyboard submit/cancel and mobile stacked rows are mandatory. Hydration tests cover deal create/detail and mode dialog.

## Migration & Backward Compatibility

Expand schema and encryption maps, retain existing amount/currency fields, seed no invented lines. Backfill `valueMode=manual`, `calculatedValueAmount=0`; null amount remains null. Legacy `valueAmount` updates explicitly select manual via compatibility adapter and update calculated value only through line mutations. Preserve existing JSON types, serializer behavior and numeric input acceptance; append fields without replacing response shapes. New decimal-string line APIs are separate contracts. Document precision widening and changed four-place values in upgrade notes, with fixture/API tests for clients using old two-place values; never narrow an existing schema to new stricter child rules.

Disable the new UI on rollback but retain child data/mode; use a compatibility release that can read the widened numeric column. Do not reduce column scale or drop lines after production writes. Base flows are tested with no source adapter and with retained source-bearing snapshots before release. No database migration is applied by spec authoring.

## 📝 Risks & Impact Review

| Scenario / severity | Mitigation | Residual risk |
|---|---|---|
| Import leaves stale headline amount / high | One command/recompute for every writer, verify raw API/import paths. | Direct SQL outside contracts remains unsupported. |
| Simultaneous line edits/manual override / high | Parent lock and expected parent/child versions; atomic totals. | Legacy clients omit versions but still serialize safely. |
| Currency/rounding drift / high | One currency, four-place exact arithmetic, bounds, golden edge fixtures. | UI may show fewer places; explicit exact-detail disclosure. |
| Optional source absent / medium | Scalar IDs + local snapshot, no source read during rendering, manual path remains usable. | New source attachments require the separate adapter. |
| Widened precision surprises downstream formatting / medium | Preserve type, upgrade notes and compatibility fixtures. | Consumers may elect to round for their own presentation. |

## Integration Coverage

`customers/__integration__/TC-CRM-LINES-001.spec.ts`: all child verbs/list/detail; parent create/update mode changes; line create missing parent expectation (428), stale expectation (409), valid expectation and concurrent create; stale child/parent, simultaneous edits, delete-last, zero price, 100%/fixed discounts, overflow, fractional quantity, null legacy values and old number payloads. Verify required parent expectation and derived totals after imports/service calls, child undo and deal undo, and linked KPI/summary/map invalidation with warm caches. Two-tenant/two-org fixtures cover hidden parent IDs and viewer/wildcard permissions. With no source adapter installed, verify manual CRUD and retained snapshots remain usable while new non-null source attachments fail safely. UI covers add/edit/delete, mode confirmation/cancel, locale decimal display, mobile and keyboard, hydration. Also cover unknown-outcome create replay after parent/line edits and after line deletion, mismatched-payload key reuse, concurrent same-key calls, missing key, rollback before receipt commit, physical parent delete/create-undo with children and delete-undo restoration of rows/receipts. Clean fixtures in finally; unit golden vectors verify exact arithmetic. Concrete catalog access/pricing/picker integration tests ship in the catalog selection spec.

Currency-null matrix: create a deal omitting `valueCurrency`, then POST a manual line with valid key/version and assert 400 `DEAL_CURRENCY_REQUIRED`, translated `valueCurrency` error and unchanged parent mode/amount/totals with no line/receipt/effects. Seed malformed legacy parent currency for `DEAL_CURRENCY_INVALID`, and test trimmed/lowercase normalization without narrowing existing deal writes. Recover via guarded parent currency PUT, refetch its version, and successfully create a manual line with catalog/source adapters absent. Cover manage denial, stale currency save, concurrent currency changes before the post-save read and between that read and line POST, import/service preconditions, and receipt replay after a later currency change. Browser tests retain entered line values, prevent submission until explicit save, show empty/error dictionary states, handle cancel at each step, surface both translated errors and stale 409, require review of a changed post-save currency, and keep the manual estimate intact. Currency-save undo after lines exist must reject an incompatible prior currency rather than corrupt snapshots.

## Final Compliance Report — 2026-10-22

Design specifies customers ownership, optional scalar source seam, local snapshots, exact currency precision, child and aggregate concurrency, command undo, post-commit effects, guards/OpenAPI and shared UI. No runtime tests are claimed in this spec PR. Before implementation merge, validate every source path and review precision compatibility against the actual target head.

## Changelog

- 2026-10-22: Initial design with explicit value authority, import-safe recalculation, four-place precision and optional source boundary. Split concrete catalog selection/pricing into its own capability after scope review; retain source IDs/snapshots as additive seam fields.
- 2026-10-25: Define missing/invalid parent-currency errors, separate guarded currency selection, retry/cancel/undo behavior and API/UI coverage for currency-null manual deals without catalog.

## 📋 Implementation Plan

### Phase 1 — Manual lines and amount authority

1. Add schema/migration, exact calculator and compatibility mode adapter; migration/golden numeric tests preserve existing estimates.
2. Ship commands, CRUD/OpenAPI and scoped integration suite with parent locking/recompute/undo. Manual deal flows remain usable without any catalog package.
3. Add lines UI and amount-mode controls with all browser states and version-conflict tests.
