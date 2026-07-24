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

- 2026-06-19: Added upstream-safe QA findings covering decorated service responses, dictionary-backed currency selection, price display formatting, work-requirement layout, and human-readable service references.
- 2026-06-16: Initial implementation spec.
