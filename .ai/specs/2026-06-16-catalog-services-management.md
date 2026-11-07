# Catalog Services Management

## TLDR

Add first-class services to Catalog and allow Sales quote/order lines to reference them without treating services as product variants.

## Overview

This specification introduces services as sellable catalog records with description, delivery scope, media, category, default price/currency, and structured work requirements. Services are managed from a dedicated Catalog page and can be selected when adding service lines to Sales quotes and orders.

## Problem Statement

Catalog currently models service-like examples through products and custom fields. That forces product variant behavior into services even when the final quote/order price is negotiated later. Sales already supports `kind: "service"` lines, but those lines are not linked to a reusable catalog service.

## Proposed Solution

- Add a `catalog_services` CRUD slice in the Catalog module.
- Add service media and work-requirement rows owned by services.
- Add `serviceId` to Sales document line records as an additive field.
- Preserve existing product routes, product line behavior, product variants, and pricing resolver contracts.

## Architecture

- Catalog owns `CatalogService`, `CatalogServiceMedia`, and `CatalogServiceWorkRequirement`.
- Work requirements store decoupled `targetType`, `targetId`, and `labelSnapshot` values instead of direct ORM relationships to Staff, Resources, or Planner.
- Sales lines copy service title/description/scope/default price into the line payload and preserve a service snapshot in `catalogSnapshot`.
- UI uses Catalog Services list/create/edit pages and updates the Sales line dialog with Product/Service/Custom modes.

## Data Models

- `catalog_services`: standard scoped editable entity with `updated_at` for optimistic locking.
- `catalog_service_media`: service-owned media rows with sort order and default marker.
- `catalog_service_work_requirements`: service-owned structured requirements with `targetType` (`staff_team`, `staff_role`, `staff_member`, `resource`, `resource_type`, `generic`) and `allocationMode` (`ratio`, `fixed_hours`).
- Sales line tables add nullable `service_id` where line records already store product references.

## API Contracts

- `GET/POST/PUT/DELETE /api/catalog/services`
- Existing product and sales APIs remain backward compatible.
- Sales line request/response schemas add optional nullable `serviceId`.

## Integration Coverage

- Catalog integration: create service with category, default price, media, and work requirements; edit it; list/search it; delete it.
- Sales integration: create quote/order line with `kind: "service"` and `serviceId`; verify totals and Quote → Order conversion preserve the service reference and snapshot.
- E2E/manual QA: verify the Catalog service create/edit/list flow and the Sales quote-to-order service-line flow in an upstream-safe application environment before marking the PR ready.

## Migration & Backward Compatibility

- All schema changes are additive: new Catalog tables and nullable Sales line columns.
- No existing API URLs, event IDs, ACL IDs, import paths, or widget spot IDs are renamed or removed.
- New ACL feature IDs are additive and granted through Catalog setup defaults.
- Product variants remain product-only; services do not introduce variants.

## Risks & Impact Review

- **Risk: direct coupling to optional Staff module.** Mitigation: service requirements store decoupled target IDs and snapshots.
- **Risk: Sales conversion drops service metadata.** Mitigation: update command snapshots and conversion tests.
- **Risk: stale optimistic locking headers.** Mitigation: include `updatedAt` in service API responses and use `CrudForm`.
- **Risk: Services UI regresses after API persistence succeeds.** Mitigation: cover decorated list/detail API responses, form reloads, media rendering, work-requirement rendering, and service reference labels in component/API tests and manual QA.

## Changelog

- 2026-11-07: Eleventh review follow-ups. `UPGRADE_NOTES.md` lists every widened line input type (`quantityUnit`, `productId`, `productVariantId`, `catalogSnapshot` nullable; new `serviceId`, and `kind` on credit memo lines). A command-level test covers a carried unit whose default-unit fallback is rejected too (400, line unchanged).
- 2026-11-07: Tenth review follow-ups. The carried-unit fallback also covers products without any units (`uom.default_unit_missing`). Command-level tests cover carried units kept, rejected and absent, and the absence of cross-product price conversion. `UPGRADE_NOTES.md` documents the widened `quantityUnit` input type and the recomputed normalization of product-less lines.
- 2026-11-07: Ninth review follow-ups. When an API update changes a line's product without naming a unit, the stored unit is carried over if the new product can resolve it and falls back to that product's default unit otherwise; prices are never converted across products or on lines without a product. Line upserts accept `quantityUnit: null` as an explicit clear (the dialog sends it for an emptied unit on an existing line), and clearing the unit of a shipped line is refused like any other unit change (409). Korean helper text mentions services.
- 2026-11-06: Eighth review follow-ups. Line unit data is inherited per product (not per variant), and unit-price conversion runs only when the caller sends a unit for the same product, so variant-only API updates no longer change the unit or price. Lines without a product recompute their normalized quantity from the quantity. The dialog applies one `kind` rule to saved and draft lines: switching into Product or Service writes that kind, leaving Service for Custom writes `product`, and any other switch or an unchanged type keeps the stored kind. The unit helpers live in `sales/lib/lineUomInput.ts`.
- 2026-11-06: Seventh review follow-ups. Shipment create-redo and update-undo refuse (409) to restore items on lines that now reference a catalog service, like delete-undo. Line upserts inherit the stored unit, normalized quantity and unit snapshot only while the product/variant is unchanged, so a product line turned into a service or custom line gets fresh unit data. A draft line keeps its stored `kind` only while its type is unchanged. A warranty replacement whose eligible lines all reference unavailable services returns a dedicated error.
- 2026-11-06: Sixth review follow-ups. Line records carry an optional `kind` (and `serviceId` is optional on `SalesLineRecord`); editing a draft line without changing its type re-sends its stored kind, references and snapshot, so InboxOps-prefilled drafts keep `kind: 'service'`. Warranty replacement orders skip claim lines whose catalog service is archived or out of scope and report them (`unavailableServiceLines` in the API response, a flash on the claim page) instead of failing. Restoring a deleted shipment is refused (409) when one of its lines now references a catalog service. Document history records `kind` and `serviceId` changes; switching to Service hides the deleted-product notice.
- 2026-11-06: Fifth review follow-ups. Draft order lines (`onDraftSaved`) are full writes, so the dialog always sends `kind` for them; switching a line's type clears a stale `catalogSnapshot` (sales line schemas accept `catalogSnapshot: null`, and upserts treat an explicit `null` as a clear). The service edit page renders read-only without `catalog.services.manage`. Warranty replacement orders and credit memos copy the source line's `serviceId` (and `kind` for credit memos); a replacement for a service archived since the original order is rejected by order create rather than silently dropping the reference.
- 2026-11-06: Fourth review follow-ups. The line dialog writes `kind` only for a new line or when the user moves an existing line into or out of Service mode, so InboxOps/API service-kind lines that carry a matched product keep their kind when edited in Product mode. New or changed `serviceId` references on quotes/orders must point at a live service in the caller's organization (invoice/credit memo creation also accepts services archived since the order). The dialog's service search lists only active services; service search results open the edit page, which now requires `catalog.services.view` like products (writes still require `catalog.services.manage`).
- 2026-11-06: Third review follow-ups. The line rule now only rejects a `serviceId` on a non-service line or a `serviceId` combined with a product/variant, so InboxOps and API service-kind lines that carry a matched product keep working. Shipped order lines cannot change `kind` or catalog references (409); switching a service line to Custom resets it to a product line. The sales dialog's service lookup no longer triggers forbidden redirects. Service list decoration scopes to the returned rows' organizations; default media follows explicit id → flagged row → stored default → first row and keeps row flags consistent; typed decimals use `parseLocaleNumber`; the manage gate uses `hasFeature`. `UPGRADE_NOTES.md` documents the ACL sync and new line rules.
- 2026-11-06: Second review follow-ups. Service create supports redo (restores the original id, children and custom fields); create/update run through `runCrudCommandWrite`; replacing media re-points a stale default; command errors are translated. The list filters categories on `category_id`, searches with QueryEngine `$ilike` filters, and decorates rows across every visible organization. The work-requirements editor only loads staff/resources references the user may read (`staff.view`, `resources.view`) and never triggers forbidden redirects; it uses the `Select`/`Input` primitives. List deletes go through `useGuardedMutation` and surface record conflicts. Sales: the line dialog leaves `kind` and references untouched for custom lines unless the user switched modes; invoice and credit memo creation enforce the kind/reference rule; credit memo and invoice undo default legacy `kind`/`serviceId`; shipments reject order lines that carry a catalog `serviceId`.
- 2026-11-06: Review follow-ups. Service custom fields are persisted and restored on undo; services are indexed under `catalog:catalog_service` and search results require `catalog.services.view`; draft media is moved onto the created service. Sales line upserts treat an explicit `null` reference as a clear, reject a `serviceId` on non-service lines and a product/variant on service lines (400), and the document currency is aligned only server-side, in the same transaction as the first line. Catalog service lines are hidden from the shipment line picker. Coverage: `TC-CAT-046-services-crud.spec.ts`, `TC-SALES-050-service-lines.spec.ts`, plus command/unit tests for services, service lines, conversion and invoice/credit memo lines.
- 2026-11-06: Reapplied the closed PR #3417 onto current `main`: migrations re-timestamped after existing module migrations, service default-price currencies read from the currencies module (catalog must not import customers), service lines use a free-text unit input, and `CatalogService` registered in the optimistic-lock and record-locks coverage guards.
- 2026-06-19: Added upstream-safe QA findings covering decorated service responses, dictionary-backed currency selection, price display formatting, work-requirement layout, and human-readable service references.
- 2026-06-16: Initial implementation spec.
