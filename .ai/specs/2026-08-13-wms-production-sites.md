# WMS Production Sites and Warehouse Roles

## TLDR

Add a minimal, WMS-owned production-site model. A `ProductionSite` represents the factory context used by future Manufacturing definitions and orders; it is not a tenant, organization, warehouse, or a new standalone `sites` module. A `ProductionSiteWarehouseRole` maps a site to an existing WMS warehouse for an effective period and one of the roles `raw_material`, `line_side`, `wip`, `finished_goods`, `quarantine`, or `shipping`.

The first release provides CRUD APIs, backend management UI, ACL, commands, events, migrations, and integration coverage. It does not add production orders, BOM/routing release, stock-affecting production postings, WMS numbering ranges, or a generic enterprise location hierarchy.

## Overview

**Status:** Proposed implementation specification for Wave 0 P1.2. Implementation is not approved until this spec completes the standard pre-implementation review.

**Parent documents:**

- `2026-08-13-production-module-architecture-roadmap.md`, Wave 0 gate #1;
- `2026-08-13-manufacturing-phase-1-wave-0-execution-plan.md`, P1.2.

## Problem Statement

Open Mercato scopes WMS records by tenant and organization. Its `Warehouse` entity represents a physical stock location, with locations, balances, lots, serials, reservations, and movements. It has no manufacturing-site identity and no way to state that a warehouse serves a particular production purpose for a factory.

Using `Tenant` as a factory is incorrect because it is the customer/data-isolation boundary. Using `Organization` as a factory is also incorrect: it is the business-unit and RBAC scope, and splitting one organization into factories would fragment inventory, permissions, reporting, and internal transfers. Treating a `Warehouse` itself as the factory would force manufacturing definitions and orders to depend on one physical warehouse rather than a stable production context.

The smallest useful solution is a WMS-owned site identity plus a mapping from that identity to warehouses by role. WMS is the correct initial home because the only current purpose of a site is to resolve physical inventory locations for future Manufacturing execution. This decision avoids a premature generic `sites` module.

## Scope and Non-Goals

### In scope

- `ProductionSite` CRUD within `wms`;
- effective-dated mapping of a site to existing WMS warehouses by production role;
- backend list, create/edit, and detail management screens using `DataTable` and `CrudForm`;
- WMS ACL features, commands, audit/undo behaviour, CRUD events, OpenAPI, query indexing, optimistic locking, and integration coverage;
- tenant, organization, and site-scope validation.

### Out of scope

- a standalone `sites` module or a general location/network hierarchy;
- number ranges for production orders, batches, lots, or serials;
- production orders, BOMs, routings, release status, work centers, or manufacturing execution;
- changing stock balances, reservations, movements, or warehouse/location topology;
- changing Sales integration or making Sales optional for WMS; that is tracked separately by issue #5260;
- cross-organization sites, warehouses, or mappings.

## Proposed Solution

Add two WMS entities and expose them through the existing command-backed CRUD pattern.

```text
Organization
  ├─ ProductionSite (WMS-owned context; e.g. Warsaw factory)
  │    ├─ raw_material   → Warehouse A
  │    ├─ wip            → Warehouse B
  │    └─ finished_goods → Warehouse C
  └─ Warehouse …
```

One warehouse may serve multiple roles for one site and may be shared by several sites. A site may exist without a role mapping during configuration. Future released definitions and orders may not use a site until their detailed specification defines the required role set for the operation.

The mapping is valid-time data. Its effective interval is half-open: `[effectiveFrom, effectiveTo)`. `effectiveTo = null` means no scheduled end. For each `(site, role)`, intervals must not overlap; this gives a deterministic role-to-warehouse resolution for every date.

## Architecture and Ownership

| Concept | Owner | Reason |
|---|---|---|
| Tenant and organization hierarchy | `directory` | Existing data isolation and RBAC scope |
| Production-site identity and site-to-warehouse role mapping | `wms` | Initial consumer is inventory topology for production |
| Warehouse, location, stock, lots, serials, reservations, and movements | `wms` | Existing physical inventory authority |
| Future definition/order references | `manufacturing` / `production` | They store scalar `siteId` plus historical snapshots; no cross-module ORM relation |
| Future number ranges | Detailed `production`/kernel specification | Defer until order/batch/lot lifecycle needs them |

This does not make a warehouse a site. `ProductionSite` is an independent WMS entity, and `ProductionSiteWarehouseRole` is the explicit bridge to a warehouse.

## Data Models

### `ProductionSite`

Table: `wms_production_sites`.

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Required, tenant-scoped |
| `organization_id` | UUID | Required, organization-scoped |
| `code` | text | Required, trim, 1–80 chars; unique among non-deleted sites in an organization |
| `name` | text | Required, trim, 1–200 chars |
| `timezone` | text | Required IANA timezone, 1–120 chars |
| `is_active` | boolean | Required; defaults to `true` |
| `metadata` | JSONB nullable | Existing WMS metadata convention; no production semantics in Phase 1 |
| `created_at`, `updated_at`, `deleted_at` | timestamps | Standard WMS soft-delete and optimistic-locking fields |

`timezone` is explicit even when a warehouse also stores one: one site can use several warehouses, and the site is the future source of production-calendar and fact timezone interpretation.

### `ProductionSiteWarehouseRole`

Table: `wms_production_site_warehouse_roles`.

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `tenant_id`, `organization_id` | UUID | Required; copied and validated against both linked records |
| `production_site_id` | UUID FK to `wms_production_sites` | Same-module ORM relation; required |
| `warehouse_id` | UUID FK to `wms_warehouses` | Same-module ORM relation; required |
| `role` | text enum | `raw_material`, `line_side`, `wip`, `finished_goods`, `quarantine`, `shipping` |
| `effective_from` | date | Required; inclusive |
| `effective_to` | date nullable | Exclusive; if present, must be later than `effective_from` |
| `created_at`, `updated_at`, `deleted_at` | timestamps | Standard soft-delete and optimistic-locking fields |

Database enforcement must prevent overlapping non-deleted effective intervals for the same `(production_site_id, role)`. The migration may use PostgreSQL `btree_gist` plus an exclusion constraint over the half-open `daterange`; the implementation must document the exact generated SQL and ensure the constraint has a descriptive name.

The command layer must additionally validate:

1. site and warehouse have the same `tenantId` and `organizationId` as the request;
2. the warehouse is active when creating or updating a currently effective mapping;
3. `effectiveTo` is later than `effectiveFrom`;
4. no overlapping mapping exists, returning a translated field error rather than a raw database error.

An inactive site cannot receive a new mapping. Deactivating a site does not delete role history; future production execution will reject inactive sites in its own contract.

## API Contracts

All APIs use `makeCrudRoute`, canonical command handlers, organization/tenant scoping, Zod validation, OpenAPI, query indexing, mutation guards, and default optimistic locking.

### Production sites

| Method | Path | Required feature | Behaviour |
|---|---|---|---|
| `GET` | `/api/wms/production-sites` | `wms.view` | Paginated list/detail by `id`; filters `search`, `ids`, `isActive`; returns `updated_at` |
| `POST` | `/api/wms/production-sites` | `wms.manage_production_sites` | Creates a site in the authenticated organization scope |
| `PUT` | `/api/wms/production-sites` | `wms.manage_production_sites` | Updates a site using the optimistic-lock header derived from `updatedAt` |
| `DELETE` | `/api/wms/production-sites` | `wms.manage_production_sites` | Soft-deletes only when no currently effective mapping remains; otherwise returns translated conflict/validation error |

Commands: `wms.production-sites.create`, `wms.production-sites.update`, `wms.production-sites.delete`.

### Site warehouse roles

| Method | Path | Required feature | Behaviour |
|---|---|---|---|
| `GET` | `/api/wms/production-site-warehouse-roles` | `wms.view` | Paginated list/detail; filters `productionSiteId`, `warehouseId`, `role`, `effectiveAt`, `ids`; returns `updated_at` |
| `POST` | `/api/wms/production-site-warehouse-roles` | `wms.manage_production_sites` | Creates a valid-time mapping |
| `PUT` | `/api/wms/production-site-warehouse-roles` | `wms.manage_production_sites` | Edits role, warehouse, or effective interval with optimistic locking |
| `DELETE` | `/api/wms/production-site-warehouse-roles` | `wms.manage_production_sites` | Soft-deletes a mapping; this is configuration removal, not a production-history change |

Commands: `wms.production-site-warehouse-roles.create`, `wms.production-site-warehouse-roles.update`, `wms.production-site-warehouse-roles.delete`.

All list/detail response schemas expose camel/snake compatibility according to the existing CRUD factory conventions and must include `updatedAt` for edit forms. The dedicated implementation spec may add an additive, read-only role-summary field to the site response only if it is batch-enriched and does not create an N+1 query.

## Events, Audit, Undo, and Search

Declare WMS CRUD events through `createModuleEvents`:

- `wms.production_site.created`, `wms.production_site.updated`, `wms.production_site.deleted`;
- `wms.production_site_warehouse_role.created`, `wms.production_site_warehouse_role.updated`, `wms.production_site_warehouse_role.deleted`.

Each command is audited and undoable using the current WMS command conventions. Undo must restore the record only when doing so would not violate the effective-interval exclusion constraint; otherwise it must fail safely with an actionable internal/audited error rather than corrupt role history.

Both entities receive query-index entity IDs and standard search configuration sufficient for list search by site code/name and role mapping filters. No cross-module search index is required.

## Backend UI and ACL

Add `wms.manage_production_sites` to `wms/acl.ts` and grant it to default WMS administrators in `setup.ts`; preserve wildcard ACL behavior.

Backend routes:

- `/backend/wms/production-sites` — `DataTable` list with code, name, timezone, active status, and count/summary of current mappings where batch data is available;
- `/backend/wms/production-sites/create` — `CrudForm` for a production site;
- `/backend/wms/production-sites/[id]` — `CrudForm` edit/detail with a secondary `DataTable` of warehouse-role mappings;
- mapping create/edit uses `CrudForm` in a shared dialog or page pattern, with `Cmd/Ctrl+Enter` submit and `Escape` cancel.

The role form selects only warehouses in the current tenant/organization. It displays role, warehouse, effective-from and effective-to dates. User-facing copy and validation errors use WMS locale keys; no hard-coded UI strings or status colors are permitted.

The site form must receive `updatedAt` from the API so `CrudForm` supplies the normal update/delete optimistic-lock header. The mapping form has its own `updatedAt`; it must not reuse the parent site version when mutating a mapping.

## Failure Handling and Security

| Case | Expected behaviour |
|---|---|
| Cross-tenant or cross-organization site/warehouse ID | Fail closed as not found/forbidden according to the canonical scoped command pattern; never reveal the foreign record |
| Unknown timezone or invalid date interval | Zod/translatable field validation error |
| Overlapping role interval | Validation conflict on the effective interval; no partial write |
| Site deleted with current mappings | Reject deletion and direct the user to retire/remove mappings first |
| Concurrent site or mapping update/delete | HTTP 409 optimistic-lock conflict; standard conflict UI is shown |
| Warehouse later deactivated | Existing mapping history remains; future production execution validates operational eligibility before posting |
| Optional Manufacturing absent | WMS production sites remain manageable; no hard dependency on Manufacturing is added |

## Migration and Backward Compatibility

This change is additive: new tables, routes, commands, ACL feature IDs, events, pages, and generated registrations are introduced. Existing WMS APIs, entities, warehouse semantics, and inventory movements do not change.

The migration must:

1. create both WMS-prefixed tables, indexes, foreign keys, and soft-delete/optimistic-lock columns;
2. create the effective-interval non-overlap enforcement and any required PostgreSQL extension safely and idempotently;
3. update the WMS migration snapshot;
4. create no default production site or warehouse-role mapping automatically, because there is no safe way to infer a plant or role from an existing `isPrimary` warehouse.

No existing warehouse is reclassified. Administrators configure sites explicitly after upgrade.

## Testing and Acceptance Criteria

### Unit and command tests

- validators accept each role and reject invalid roles, invalid timezones, blank codes/names, and invalid intervals;
- commands reject tenant/organization mismatches, inactive-site mapping creation, and currently inactive warehouses;
- overlapping date intervals are rejected before persistence and database enforcement is covered as defense in depth;
- create/update/delete and undo preserve audit/undo semantics;
- optimistic locking covers both site and mapping update/delete.

### Integration tests

- a WMS administrator can create, list, edit, and soft-delete a site with `updatedAt` returned by GET;
- a same-scope warehouse can be mapped to each role; the same warehouse can support multiple roles;
- a second effective interval may start exactly when the previous interval ends, but an overlap is rejected;
- a site cannot be deleted while it has a current mapping;
- cross-tenant and cross-organization IDs never create, read, update, or delete mappings;
- a user without `wms.manage_production_sites` can view but cannot mutate;
- WMS loads with Manufacturing absent, proving the new site model introduces no production dependency;
- backend UI covers list, create, edit, conflict, and mapping dialog keyboard behaviour.

### Validation commands

Run the smallest relevant set in one chosen runner mode:

```bash
yarn db:generate
yarn generate
yarn workspace @open-mercato/core test
yarn workspace @open-mercato/core build
yarn typecheck
```

## Risks and Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| `ProductionSite` is later overloaded into a generic enterprise location master | Medium | Keep its WMS-specific name, scope, and minimal fields; introduce a separate foundation only when a non-WMS consumer has a proven need | Future migration may still require an additive general-site bridge |
| Mapping history becomes ambiguous through overlapping dates | High | Half-open date intervals and database exclusion constraint | Operational staff must enter dates correctly |
| Existing primary warehouse is assumed to be a production site | Medium | No automatic migration/backfill; explicit admin configuration | Initial setup requires an administrator action |
| Child mapping update applies parent optimistic-lock version | Medium | Separate mapping entity/version and `CrudForm` initial values | Custom UI code must preserve this rule |
| New site causes hidden Manufacturing dependency in WMS | High | No imports, `ModuleInfo.requires`, or runtime resolves of Manufacturing; disabled-module test | Future callers must remain optional consumers until they declare a hard need |

## Final Compliance Report

| Requirement | Status | Notes |
|---|---|---|
| Tenant and organization isolation | Planned | Required in entity, validators, commands, routes, and tests |
| No cross-module ORM relation | Planned | All future Manufacturing references are scalar IDs |
| Zod, command writes, mutation guards, OpenAPI | Planned | Uses established WMS CRUD pattern |
| Optimistic locking | Planned | Both user-editable entities expose `updatedAt` |
| API/UI integration tests | Planned | Listed in acceptance criteria |
| Backward compatibility | Planned | Additive only; no reclassification of existing warehouses |
| `yarn generate` after discovered files | Planned | Required during implementation |

## Changelog

- 2026-08-13: Created implementation specification for the minimal WMS-owned production-site and warehouse-role model, replacing the premature standalone `sites` module proposal in Phase 1 planning.
