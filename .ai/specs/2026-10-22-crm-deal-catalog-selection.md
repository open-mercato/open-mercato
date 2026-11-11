# CRM deal catalog selection

## 📝 TLDR

Let sales teams select catalog products for a deal line through a catalog-owned picker and price resolver, then save a deal-owned commercial snapshot. This optional capability of [issue #7700](https://github.com/open-mercato/open-mercato/issues/7700) extends [deal line items and amount authority](2026-10-22-crm-deal-line-items.md); manual line entry and saved snapshots remain usable without catalog. It does not add live repricing, invoices, orders, stock movements or subscriptions.

## Overview

Proposed 2026-10-22; baseline `main` `0c886d0a14c02106ff2abc9728be36c04c5a2ccd`. Follow the [Phase 1 shared contract](2026-10-22-crm-field-model-phase-1.md). The prerequisite customers line model already owns arithmetic, amount authority, versioning and nullable source IDs/snapshot fields. This spec adds the concrete catalog adapter/picker using existing `catalogPricingService` and the resolver pipeline. Do not import sales document entities or reimplement catalog price selection in customers. Research and product-pattern sources were read on 2026-10-22; source dates, citations and limitations remain in the [research evidence](assets/crm-field-model-phase-1/research.md).

## Resolved assumptions (autonomous defaults)

| Question | Default | Reason |
|---|---|---|
| Is catalog required for deal lines? | No; catalog selection is a separately deployable optional capability. | Manual deals must work without the peer module. |
| Does catalog update change a deal? | Never automatically. Copy scoped product/name/price/currency snapshots; explicit reprice is future work. | Historic negotiation values belong to the deal. |
| Which service selects initial price? | Existing catalog pricing DI/resolver, using authorized server-resolved deal customers. | Preserve catalog ownership and established price selection. |
| Can negotiated price differ? | A deal manager may explicitly edit the selected price before saving. | A deal snapshot represents negotiated commercial terms. |
| What monetary model applies? | The prerequisite's exact four-place, single-currency net one-time model. | No parallel calculator, tax model or currency conversion. |

## 📝 Problem Statement

Manual lines are independently useful, but repeatedly copying product names/SKUs and prices can diverge from catalog selection rules. [Pipedrive's deal-specific prices](https://support.pipedrive.com/en/article/how-can-i-link-products-to-a-deal) and [SuiteCRM's catalog-populated quote lines](https://docs.suitecrm.com/user/sales-relationships/quotes-invoices-contracts/) support a selection-then-snapshot pattern. These product patterns do not establish an immutable-history guarantee; snapshot/no-autoreprice behavior is the explicit Mercato design. See [research limitations](assets/crm-field-model-phase-1/research.md).

## 📝 Proposed Solution

An optional lazy catalog picker in the Lines section searches authorized products/variants, resolves an initial same-currency price and previews a line-owned snapshot. The user can negotiate the price explicitly and save through existing customer line commands. Changed/deleted products never rewrite saved lines. No hidden lookup occurs when viewing saved lines, and absent catalog leaves manual entry and totals intact. Do not add a parallel product catalog, source-specific columns, bulk repricing, exchange conversion or sales-document workflow.

## 📝 Architecture

Catalog owns optional product-selection UI and a snapshot-resolver registration against a customers-owned `customersDealProductSources` host contract. A source descriptor exposes `resolve({productId,variantId?,quantity,currency,customerIds},scope)` returning a schema-validated source ID, IDs, display name, SKU, unit price and currency. Its implementation uses `catalogPricingService`/`selectBestPrice`, validates the caller's product access and scope, and supplies no ORM entity to customers. Customers knows only the host interface and scalar ID+snapshot. No direct customers→catalog entity imports or required module dependency. With catalog absent, manual lines and all existing snapshots work; attaching a new catalog reference returns a provider-unavailable field error. Catalog-owned registrations/widgets no-op if the customers host is absent.

A customers-owned `POST /api/customers/deals/{id}/product-preview` handler authorizes the deal, derives its currency and customer IDs from authorized deal links server-side, and calls the optional source resolver. Browser-supplied pricing context is rejected. Existing catalog endpoints serve product/variant search only; their browser-supplied customer context and displayed prices are not trusted for a deal preview. Initial selection can be edited as a negotiated line price by an authorized deal manager; the UI shows the initial source and edited state. Price resolution is an explicit preview step, not an external call inside a DB transaction. Saving revalidates source existence/authorization and the deal version; no implicit live repricing occurs after save.

The adapter owns source-specific price resolution and the picker; customers owns the narrow host type, schema validation and final line persistence. The existing line calculator remains the only amount-authority implementation. Use lazy route-scoped widget/registration patterns and soft optional resolution through established DI; never bypass catalog ACL or customers mutation guards. Source attachment validation must finish before entering the parent/child mutation transaction; applying the preview rechecks authorized source identity and deal versions without doing an external price lookup inside the transaction.

## 📝 Data Model

No new table or source-specific schema is required. Populate the prerequisite `CustomerDealLineItem` fields: nullable `source`, scalar UUID `product_id`/`variant_id`, snapshot `name` (1–200, encrypted), optional `sku` (≤100), positive four-place `quantity`, nonnegative four-place `unit_price`, and three-letter uppercase `currency` identical to the normalized deal currency. Manual lines leave source IDs null. Source IDs are references, not cross-module ORM relationships. The same product may appear more than once with different negotiated terms.

The resolver returns only schema-validated source ID/IDs, display name, SKU, unit price and currency. The preview response adds the authorized deal version and requested quantity; no durable preview receipt or source-version field is introduced. No ORM entity, credentials or raw provider response is stored. Existing line/deal versions, encryption maps, active-row ordering, 1000-line bound and ≤100 pagination remain unchanged. Snapshots retain their values after catalog updates, deletion or disabling. Catalog's current currency does not reinterpret a stored line currency. Exact arithmetic, discounts and authoritative totals remain the prerequisite's responsibility; this capability creates no FX posting or ledger entry.

## 📝 API Contracts

The additive `customersDealProductSources` host descriptor exposes `resolve({productId,variantId?,quantity,currency,customerIds},scope)` and returns the typed snapshot described above. `scope` is authenticated server tenant/organization/user context. The customers preview handler derives `currency` and `customerIds` from the authorized deal and passes them to the adapter; the browser cannot choose a pricing customer or currency.

Use the manual-line prerequisite's parent-currency normalization and translated `DEAL_CURRENCY_REQUIRED` / `DEAL_CURRENCY_INVALID` preconditions before calling the resolver, with the normalized code as provider context and comparison value. Its guarded parent-currency selection/recovery is already available without catalog; preview never chooses or changes currency. Include missing/malformed and lowercase legacy-parent cases in the preview tests.

| Route | Request / response | Authorization and errors |
|---|---|---|
| `POST /api/customers/deals/{id}/product-preview` | Strict JSON `{sourceId,productId,variantId?,quantity}`; quantity is a positive decimal string with at most four fractional digits, maximum 1,000,000. Success `200` returns `{sourceId,productId,variantId:null-or-UUID,snapshot:{name,sku:null-or-string,quantity,unitPrice,currency},dealUpdatedAt}`. Money/quantity are decimal strings and snapshot limits match the line model. | Authenticated scoped deal requires both `customers.deals.view` and `customers.deals.manage`, plus existing catalog product/price ACL in the adapter. `400` for invalid shape/unknown source, forged `customerId`/`customerIds`/`currency` fields, missing deal currency (`DEAL_CURRENCY_REQUIRED`), malformed resolver output or mismatched currency; `401` unauthenticated; `403` missing features; `404` inaccessible/deleted deal, product or variant; `503` registered source/module unavailable. |

The handler exports `metadata`/`openApi`, validates input and output with Zod, and authorizes tenant/organization/parent before resolving linked customers or prices. Response data contains only the explicit snapshot, source identities and deal version; no raw catalog/provider record, customer IDs, credentials or internal pricing rules. Preview writes no deal/line data, does not increment versions, is private/uncached, and creates no durable receipt. The browser carries `dealUpdatedAt` into the existing line mutation as `expectedDealUpdatedAt`. A receipt or source-version token is unnecessary because save permits an explicitly negotiated price: save revalidates source existence/authorization and deal/child versions, not unchanged catalog pricing. No source-version guarantee is claimed by this response.

Existing scoped catalog product/variant APIs remain search interfaces only. Preserve their current ACL/metadata/OpenAPI contracts, but do not call browser-context catalog pricing endpoints as a substitute for the deal-owned preview. Any search-displayed price is advisory; the handler above supplies the initial deal snapshot.

Persistence uses the prerequisite routes unchanged: `POST /api/customers/deal-line-items` accepts `{dealId,clientMutationId,expectedDealUpdatedAt,name,quantity,unitPrice,discountType?,discountValue?,position?,source?,productId?,variantId?}` with required UUID `clientMutationId` and parent expectation; `PUT /api/customers/deal-line-items` uses `{id,...editable fields,expectedDealUpdatedAt?}` and the child-version header. Missing create expectation returns 428; stale expectation returns the standard 409 after parent locking. Reads return the existing paged envelope, snapshots and `updatedAt`/`dealUpdatedAt`; DELETE uses existing guarded child deletion and total recalculation. `customers.deals.manage` remains required for writes, `customers.deals.view` for reads, plus existing catalog product/price access for selection. The deal ID cannot be changed by line update. Line creation uses the prerequisite scoped payload/result receipt: identical-key retries return the original outcome before stale-parent rejection; different payloads return 409 and a replay never creates another line.

Do not trust caller-supplied source IDs or prices as evidence of source authorization. Resolve/validate the selected source before the customer command accepts new references; preserve the explicitly negotiated price after authorization. Wrong scope/inaccessible product follows existing 404 behavior; permission failures follow 403; malformed/unsupported or mismatched-currency snapshots are field errors; absent source returns provider-unavailable. Stale parent/child versions use the existing 409 contract. The picker surfaces failures while preserving the manual path. A catalog result in another currency fails selection; no silent conversion.

Source choice saves through the same command transaction, parent lock, stable child ordering, totals recomputation and retry identity as manual lines. Undo restores the stored snapshot and previous amount/mode under parent/child versions; the external catalog read itself cannot be undone. Post-commit typed line/deal effects, cache tags and query-index invalidation are the same as any line write. Saved-line rendering remains one paged query with no per-product lookups.

## 📝 UI/UX

The catalog-owned picker is lazy and route-scoped within `DealLineItemsSection`; the existing `CrudForm` dialog and `DealValueModeField` remain customers-owned. Show product/variant identity, initial price/currency and the edited/negotiated state before saving. Keep source and saved snapshots visible. Empty, searching, no-results, denied/unavailable source, malformed/mismatched-currency result, saving, deleted-product and conflict states are distinct. Removed products show stored name plus a source-unavailable badge, not a broken row. Do not overwrite a user's pending manual price on background refresh.

Use `apiCall`, mutation guards, child `updatedAt` and parent `expectedDealUpdatedAt`, current `Alert` props, semantic tokens, localization, keyboard submit/cancel and mobile stacked rows. New leaves stay ≤300 LOC; no new root client directive, global pricing provider, sales editor or heavy browser dependency. Do not add calculation logic to the legacy deal page root. Hydration tests cover create/detail, lazy picker and mode-confirmation interaction. Confirm before the first line changes an existing manual amount's authority, using the prerequisite control.

## Migration & Backward Compatibility

This extension adds the deal-owned product-preview route and requires the additive source/snapshot fields supplied by line items; it changes no existing deal serializer types or response shapes. Existing manual and imported lines remain unchanged; there is no inferred product mapping or bulk repricing. Existing source-bearing snapshots survive disabling or uninstalling catalog. No additional schema migration is required by this selection capability, and no migration is applied during spec authoring. Register the host/widget additively, run discovery generation where required, and document the optional extension contract in framework docs and `UPGRADE_NOTES.md` when implemented.

Rollback removes/disables the adapter and picker but retains snapshots; manual entry stays functional. If customers is absent, catalog-owned registration/widgets no-op. If catalog is absent, attaching a new catalog reference fails clearly while unrelated saved-line edits, reads and undo still use stored data. This split retains the original no-autoreprice and no-peer behavior.

## 📝 Risks & Impact Review

| Failure / severity | Mitigation | Residual risk |
|---|---|---|
| Cross-scope product/customer pricing disclosure / critical | Server resolves authorized deal customers; catalog adapter checks product/variant access and scope before returning snapshot. | An authorized manager can view eligible catalog prices by design. |
| Catalog disabled or product deleted / medium | Scalar IDs + local snapshots; optional resolver/picker; manual path. | Source cannot be revalidated while absent. |
| Price/currency mismatch or stale product preview / high | Deal-owned preview derives pricing context; schema/currency checks, source existence/authorization recheck and deal version validation at save; no automatic repricing. | Catalog price can change after preview; negotiated snapshot prices intentionally remain valid. No source-version guarantee is claimed. |
| Adapter reimplements pricing / high | Reuse `catalogPricingService`/`selectBestPrice`; test selected prices against existing resolver fixtures. | Catalog rule changes affect new selections, not saved lines. |
| UI or imports bypass amount authority / high | Save through existing line commands and calculator with operation identity. | Unsupported direct SQL remains outside contracts. |

## Integration Coverage

`customers/__integration__/TC-CRM-CATALOG-SELECTION-001.spec.ts`: exercise `POST /api/customers/deals/{id}/product-preview` success and each specified 400/401/403/404/503 outcome. Two-tenant/two-org scoped fixtures and a fake resolver cover hidden/deleted deal/product/variant IDs, viewer-only/manage-only/wildcard grants, absent/removed source module and unknown source token. Assert strict rejection of forged `customerId`, `customerIds` and `currency`; the resolver receives only the authorized deal's linked customers and currency, even when catalog search used a different browser context. Verify quantity/schema/amount limits, missing deal currency, mismatched resolver currency, pricing precedence, explicit response fields, no raw payload/customer IDs, no preview persistence and no version change.

Persist selected/negotiated snapshots through `POST /api/customers/deal-line-items` and `PUT /api/customers/deal-line-items`; verify source deletion or lost access between preview and save rejects the attachment, missing/stale parent expectation returns 428/409, and child conflicts/retries do not duplicate lines. A changed catalog price after preview does not invalidate a permitted negotiated snapshot or trigger repricing. Verify identical totals to manual lines, catalog updates never mutate saved snapshots, saved-line reads make no catalog calls, undo restores prior snapshot/authority, and execute/undo invalidate warm parent/KPI caches. Catalog-owned glue no-ops without customers. UI covers search → deal-owned preview → cancel/save, manual fallback, removed-product state, mode confirmation, locale display, mobile/keyboard and hydration. Clean fixtures in finally; no live provider or secrets. Base line CRUD remains covered by the prerequisite suite.

## Final Compliance Report — 2026-10-22

Design specifies catalog-owned optional glue, customers-owned host interface, scalar references plus local snapshots, established catalog price resolution, same-scope authorization and unchanged line arithmetic/concurrency/undo. No runtime tests are claimed. Implementation must validate actual catalog call sites against the target head and ship the complete source/picker integration matrix before enabling selection.

## Changelog

- 2026-10-22: Extracted concrete catalog resolver/picker/pricing behavior and former Phase 2 from the researched line-item design after scope review. Preserved optional dependency, source authorization, snapshot, negotiated-price, currency, rollback and test requirements. Added the deal-owned product-preview endpoint after independent review so pricing context is derived server-side; clarified that save checks authorization/existence and deal versions without claiming catalog source-version immutability.
- 2026-10-25: Reuse the manual-line currency preconditions, normalization and guarded recovery; catalog introduces no separate currency-selection dependency.

## 📋 Implementation Plan

### Phase 1 — Catalog adapter and source authorization

1. Add the narrow customers host contract, deal-owned `POST /api/customers/deals/{id}/product-preview` handler and catalog-owned resolver registration using existing pricing DI. Ship metadata/OpenAPI and exact endpoint/status tests; verify server-derived customer/currency context, forged-context rejection, scoped access, resolver precedence, bounds and no-peer behavior before enabling UI.

### Phase 2 — Selection experience and lifecycle coverage

1. Add the lazy catalog-owned picker to the existing line dialog, with explicit preview, negotiated-price state and guarded versioned save; manual lines remain usable during rollout.
2. Ship combined API/UI, absence/deletion, snapshot/no-autoreprice, retry/undo and cache tests. Publish extension documentation; enable selection only after the complete matrix passes.
