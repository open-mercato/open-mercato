# WMS Sites and Warehouse Roles

## TLDR

Add a minimal, WMS-owned `Site` representing a stable operational context inside one tenant and organization. A site is not a tenant, organization, warehouse, generic enterprise location hierarchy, or standalone `sites` module. `SiteWarehouseRole` optionally assigns one or more existing WMS warehouses to a site under a fixed role and identifies exactly one default warehouse per configured role. New Sites are active by default; neither activation nor general WMS use requires any warehouse role.

Wave 0 stores only the current assignment state. Administrators change it directly; audit logs retain prior values, while future production definitions, orders, postings, and facts must snapshot the exact site and warehouse assignment they used. One warehouse may serve several roles, but it may belong to only one active Site in the MVP. Scheduled/effective-dated assignments, shared warehouses across active Sites, site timezone/calendars, and advanced production number ranges are explicitly deferred.

The release provides command-backed CRUD APIs, backend management UI, ACL, events, migrations, optimistic locking, and self-contained integration coverage. `Site` supports create, read, update, activation, and deactivation, but not delete.

## Overview

**Status:** Implemented — affected WMS/CLI/UI validation passes; the repository-wide local Windows test gate remains open on unrelated portability failures documented below.

**Parent documents:**

- `2026-08-13-manufacturing-product-roadmap.md`, Wave 0 gate #1;
- `2026-08-13-manufacturing-phase-1-wave-0-execution-plan.md`, P1.2.

## Problem Statement

Open Mercato scopes WMS records by tenant and organization. Its `Warehouse` entity represents a physical stock location with locations, balances, lots, serials, reservations, and movements. It has no stable factory identity and cannot express which warehouses currently serve production purposes for a factory.

Using `Tenant` as a factory would confuse a data-isolation boundary with a physical plant. Using `Organization` would fragment inventory, permissions, reporting, and internal transfers when one organization operates several factories. Treating one `Warehouse` as the factory would bind manufacturing definitions and orders to a replaceable storage location.

The smallest useful foundation is therefore a WMS-owned site identity plus explicit current warehouse-role assignments. The model deliberately avoids scheduled changes, routing policy, calendars, and number allocation until their concrete production lifecycle is specified.

## Primary Use Cases

1. An administrator creates an active site and may later assign active warehouses to the roles needed by that operation.
2. A larger plant assigns several raw-material warehouses and explicitly promotes one as the current default.
3. An administrator changes a role default; existing inventory is not moved and already-created production records retain their stored snapshots.
4. WMS shows an assignment whose warehouse was later deactivated, warns that it is ineligible, and requires an explicit replacement rather than silently choosing one.
5. WMS remains fully loadable and the site configuration remains manageable when Manufacturing is not installed.

## Scope and Non-Goals

### In scope

- `Site` create/read/update, activation, and deactivation within `wms`;
- assignment of one or more same-scope WMS warehouses to each fixed production role;
- exactly one default warehouse for every `(site, role)` that has at least one live assignment, while roles remain optional;
- a setup-once backend UI: responsive Sites list controls and `CrudForm`-based site/mapping forms;
- tenant-defined custom fields on `Site`, including create/update/read/undo and field-injection support;
- WMS ACL, commands, audit/undo, events, OpenAPI, query indexing, optimistic locking, migrations, and integration coverage;
- tenant, organization, site, warehouse-active, uniqueness, and default-selection invariants.

### Out of scope

- deleting a site or reusing its stable identity;
- effective-dated, scheduled, or historical-as-of warehouse assignments;
- site timezone, shifts, calendars, or mid-day warehouse switching;
- advanced production-order, batch, lot, or serial number formats, resets, generated identifiers, block reservations, or offline allocation;
- production orders, BOMs, routings, release status, work centers, or manufacturing execution;
- changing stock balances, reservations, movements, or warehouse/location topology;
- configurable/custom warehouse roles or automatic warehouse-selection rules;
- custom fields on `SiteWarehouseRole`;
- advanced filters, exports, or bulk actions in the Phase 1 site/mapping UI;
- changing Sales integration or making Sales optional for WMS; issue #5260 tracks that work;
- cross-organization sites, warehouses, or assignments;
- a standalone `sites` module or generic enterprise location/network hierarchy.

## Proposed Solution

```text
Organization
  |-- Site (WMS-owned stable factory context)
  |    |-- raw_material
  |    |     |-- Warehouse A (default)
  |    |     `-- Warehouse B
  |    |-- wip            --> Warehouse C (default)
  |    `-- finished_goods --> Warehouse D (default)
  `-- Warehouse ...
```

A warehouse may serve multiple roles within one Site. It may also be assigned while several Sites are inactive, but it may belong to only one active Site at a time. A site may have no assignments. The first assignment for a `(site, role)` becomes the default automatically; the role form selects the Default checkbox before submission when no default exists for the selected `(site, role)`. Later assignments are non-default unless the request explicitly promotes them; promotion atomically demotes the previous default. A Site's active state is independent of production readiness.

Assignments describe current configuration only. Changing a default does not move inventory, rewrite existing production records, or schedule a future switch. Future consumers must persist scalar `siteId` and immutable snapshots containing the concrete warehouse IDs and roles used by each release, order, posting, or fact.

## Architecture and Ownership

| Concept | Owner | Rule |
|---|---|---|
| Tenant and organization hierarchy | `directory` | Existing isolation and RBAC scope |
| Site identity and current site-to-warehouse roles | `wms` | Stable factory context backed by current inventory topology |
| Warehouse, location, stock, lots, serials, reservations, movements | `wms` | Existing physical inventory authority |
| Future definition/order references | `manufacturing` | Scalar `siteId` plus immutable site/warehouse-role snapshots; no cross-module ORM relation |
| Future scheduled assignments | Dedicated follow-up specification | Additive temporal layer; must not reinterpret stored production snapshots |
| Future timezone and calendars | `planner` plus a dedicated site/calendar contract | Added before a site is used by timezone-sensitive execution |
| Basic production identity | Future `manufacturing` capability | UUID remains canonical; a simple concurrency-safe Site-scoped order display number is sufficient for MVP |
| Advanced number ranges | Dedicated later capability | Formats, resets, generated lot/serial values, block reservation, and offline allocation are necessary future work, not a P1.2 or MVP gate |

WMS must not import, require, or resolve Manufacturing to provide this capability. The optional consumer owns future integration glue and must degrade safely when absent.

No new DI service is required for Phase 1; commands use the established WMS command registration and scoped ORM patterns. If a resolver service is later introduced, it must be a stable WMS DI contract specified before consumers depend on it.

## Data Models

### `Site`

Table: `wms_sites`.

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key; stable identity |
| `tenant_id` | UUID | Required |
| `organization_id` | UUID | Required |
| `code` | text | Required; trim, uppercase, 1-80 chars; case-insensitive unique among live sites in tenant + organization |
| `name` | text | Required; trim, 1-200 chars |
| `is_active` | boolean | Required; defaults to `true`; controls whether the Site is available to consumers, not whether its optional role configuration is valid |
| `metadata` | JSONB nullable | Inherited WMS storage detail; excluded from Phase 1 API, UI, search, audit change keys, and business semantics |
| `created_at`, `updated_at`, `deleted_at` | timestamps | Standard WMS lifecycle fields; `updated_at` provides optimistic locking |

No route or normal command sets `deleted_at` on a site. Undoing site creation deactivates the record instead of deleting it, preserving the stable ID. Undoing a site update restores the previous editable snapshot subject to optimistic locking.

Required indexes:

- `(organization_id, tenant_id)` for scoped access;
- unique `(tenant_id, organization_id, lower(code)) WHERE deleted_at IS NULL` with a named expression index.

Register `wms:site` in `wms/ce.ts` with `labelField: 'name'`, `showInSidebar: false`, `defaultEditor: false`, and no module-shipped default fields. This registration deliberately enables tenant-defined custom fields without adding another generic record editor. `SiteWarehouseRole` is not registered as a custom-field host: it is a constrained configuration assignment whose meaning must remain limited to site, warehouse, fixed role, and default status.

### `SiteWarehouseRole`

Table: `wms_site_warehouse_roles`.

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `tenant_id`, `organization_id` | UUID | Required; copied from and validated against both linked records |
| `site_id` | UUID FK to `wms_sites` | Required same-module ORM relation |
| `warehouse_id` | UUID FK to `wms_warehouses` | Required same-module ORM relation |
| `role` | text enum | `raw_material`, `line_side`, `wip`, `finished_goods`, `quarantine`, `shipping` |
| `is_default` | boolean | Required; exactly one live default when a `(site, role)` group is non-empty |
| `metadata` | JSONB nullable | Inherited storage detail; not exposed or assigned business semantics |
| `created_at`, `updated_at`, `deleted_at` | timestamps | Soft-delete plus optimistic-locking fields |

`site_id` and `role` are immutable after creation. Correcting either uses delete-and-create so the default invariant is evaluated explicitly. `warehouse_id` may be changed to another active, same-scope warehouse when uniqueness remains valid.

Required indexes and constraints:

- `(organization_id, tenant_id, site_id)` for the site detail table;
- `(organization_id, tenant_id, warehouse_id)` for warehouse eligibility/impact lookups;
- unique `(site_id, role, warehouse_id) WHERE deleted_at IS NULL`;
- unique `(site_id, role) WHERE is_default = true AND deleted_at IS NULL`.

The database enforces at most one default; commands enforce that a non-empty role group has at least one. Both named unique constraints must be translated to stable field/conflict errors, including concurrent races.

## Business Invariants and Transactions

All mutations validate Zod input before persistence and execute through registered WMS commands.

1. Site, warehouse, request, tenant, and organization scopes must match. Foreign-scope IDs fail closed without revealing the record.
2. Site codes are normalized to uppercase before uniqueness checks and persistence.
3. A site is created active by default and remains configurable whether active or inactive. Operational consumers reject inactive sites.
4. Roles are optional. A Site may be activated with no assignments; a future manufacturing consumer owns any production-readiness validation for its own operation.
5. When an active Site has assignments, every assigned warehouse must be absent from every other active Site. Mapping create/update and activation enforce the same rule transactionally. Every activation, deactivation, mapping create/update, and mapping undo that can change active-Site eligibility must load its affected warehouse IDs, lock the `Warehouse` rows with `PESSIMISTIC_WRITE` in ascending UUID order, re-query active-Site assignments within that transaction, and only then flush. Every writer uses that order; deactivation releases this active-Site exclusivity without deleting mappings.
6. Only an active warehouse can be newly assigned or selected by an update.
7. Later warehouse deactivation retains the assignment for audit/context and leaves the Site active; the assignment remains visible with a warning and is ineligible for future selection.
8. The first live assignment for `(site, role)` is automatically default.
9. Promoting an assignment atomically demotes the previous default and promotes the target. Follow the existing WMS primary-warehouse ordering: keep the target non-default, demote the sibling default, then promote the target. The partial unique default index remains the database backstop, and its named violation is translated to the same stable `409` contract.
10. A default cannot be demoted without promoting a replacement in the same transaction.
11. Deleting a default is blocked while sibling assignments remain. The administrator first promotes a successor; deleting the last assignment in a role is always allowed because roles are optional.
12. Creating, updating, deleting, promoting, activating, deactivating, and undoing assignments use `withAtomicFlush(..., { transaction: true })` where more than one row can change.
13. Preflight uniqueness/readiness checks provide field errors; named default-index violations and the ordered warehouse locks handle concurrent races and return the same translated contract.

## API Contracts

Both route files use `makeCrudRoute`, method-level `metadata`, scoped payload helpers, OpenAPI exports, query indexing, mutation guards, command writes, `pageSize <= 100`, and disabled list cache. API responses use the exact camelCase shapes below; no vague camel/snake compatibility requirement is introduced. Only the site route enables canonical custom-field decoration.

### Sites

Path: `/api/wms/sites`.

| Method | Feature | Request / behavior |
|---|---|---|
| `GET` | `wms.view` | `page`, `pageSize`, `search`, `ids`, `isActive`, `sortField`, `sortDir`, or detail by `id` |
| `POST` | `wms.manage_sites` | `{ code, name, isActive?, ...customFieldValues }`; defaults to active and returns `201 { id }` |
| `PUT` | `wms.manage_sites` | `{ id, code?, name?, isActive?, ...customFieldValues }`; activation enforces active-Site warehouse exclusivity for any existing assignments, but never role readiness; requires optimistic-lock header; returns `{ ok: true }` |

There is no `DELETE` export, OpenAPI operation, command, or UI action for a site.

Site list/detail item:

```typescript
{
  id: string
  code: string
  name: string
  isActive: boolean
  customValues: Record<string, unknown>
  customFields: Array<Record<string, unknown>>
  createdAt: string
  updatedAt: string
}
```

The site route configures `decorateCustomFields: { entityIds: [E.wms.site], stripPrefixedKeys: true }`. Prefixed `cf_`/`cf:` inputs are accepted only through the standard payload split/normalization helpers; responses expose the canonical `customValues` and `customFields` fields without duplicate prefixed top-level keys. Commands: `wms.sites.create`, `wms.sites.update`.

### Site warehouse roles

Path: `/api/wms/site-warehouse-roles`.

| Method | Feature | Request / behavior |
|---|---|---|
| `GET` | `wms.view` | `page`, `pageSize`, `siteId`, `warehouseId`, `role`, `isDefault`, `ids`, `sortField`, `sortDir`, or detail by `id` |
| `POST` | `wms.manage_sites` | `{ siteId, warehouseId, role, isDefault? }`; first role assignment becomes default; returns `201 { id }` |
| `PUT` | `wms.manage_sites` | `{ id, warehouseId?, isDefault? }`; `siteId` and `role` are immutable; requires the mapping's optimistic-lock header |
| `DELETE` | `wms.manage_sites` | `{ id }`; requires the mapping's optimistic-lock header and obeys the default-removal rule |

Mapping list/detail item:

```typescript
{
  id: string
  siteId: string
  warehouseId: string
  role: 'raw_material' | 'line_side' | 'wip' | 'finished_goods' | 'quarantine' | 'shipping'
  isDefault: boolean
  warehouse: { id: string; code: string; name: string; isActive: boolean }
  createdAt: string
  updatedAt: string
}
```

The warehouse presentation is loaded in one scoped batch for list results; it must not produce an N+1 query. Commands: `wms.site-warehouse-roles.create`, `wms.site-warehouse-roles.update`, `wms.site-warehouse-roles.delete`.

### Error contract

| Case | Status | Contract |
|---|---|---|
| Invalid body, role, filter, or blank fields | `400` | Translated validation response with `fieldErrors` where applicable |
| Foreign-scope or unknown site/warehouse/mapping ID | `404` | Non-disclosing not-found response |
| Duplicate site code, duplicate assignment, default race, or invalid default removal | `409` | Stable translated error; constraint names never leak |
| Stale site or mapping version | `409` | Standard optimistic-lock conflict body consumed by `surfaceRecordConflict` |
| Inactive warehouse selected | `422` | Translated `warehouseId` field error |
| Warehouse already belongs to another active Site | `409` | Stable non-disclosing active-Site assignment conflict |

Update schemas require at least one mutable field in addition to `id`; empty updates fail validation. ORM/query-engine parameters remain parameterized. Constraint translation matches named constraints and never interpolates user input into SQL or exposes database details.

Site commands follow the existing WMS configuration-command pipeline: `parseWithCustomFields()` validates and splits input; scalar Site changes use `withAtomicFlush(..., { transaction: true })`; `setCustomFieldsIfAny()` persists normalized tenant-defined values after the entity flush; and the command then marks CRUD side effects. This matches the established WMS and Sales custom-field lifecycle. Custom-field persistence is part of the same command outcome but is not a cross-storage atomic transaction. Form submissions collect custom values with `collectCustomFieldValues()`. Command snapshots store `snapshot.custom` before and after each site mutation and undo restores differences with `buildCustomFieldResetMap`. Mapping commands do not accept, persist, decorate, or restore custom fields.

## Security and Failure Handling

- Every API method exports metadata with `requireAuth: true` and the feature shown above. Every page has matching `page.meta.ts` guards.
- Every read and write query includes both `tenant_id` and `organization_id`; linked site and warehouse records are reloaded in the authenticated scope rather than trusted from request payloads.
- Foreign-scope IDs use the same non-disclosing not-found response as unknown IDs.
- `code` and `name` are plain text. UI renders them through normal escaped React text nodes; no HTML/Markdown input or unsafe raw rendering is accepted.
- Base fields accept no URL, file path, credential, secret, or executable content. `metadata` is not accepted or returned. Tenant-defined custom fields use the existing definition validation, scoped data engine, and encryption configuration; this module does not bypass or duplicate those controls.
- Logs and database errors contain stable internal identifiers and translated error keys, not raw SQL, constraint diagnostics, tokens, or request headers.
- A command failure or constraint race rolls back the full transaction. Events, audit completion, indexing, and response success occur only for the committed outcome.

## Events, Audit, Undo, Search, and Cache

Declare additive events through `createModuleEvents`:

- `wms.site.created`, `wms.site.updated`;
- `wms.site_warehouse_role.created`, `wms.site_warehouse_role.updated`, `wms.site_warehouse_role.deleted`.

Every payload contains `id`, `tenantId`, and `organizationId`, with optional `actorUserId`. Site events also contain `siteId`, `code`, `name`, and `isActive`. Mapping events contain `mappingId`, `siteId`, `warehouseId`, `role`, and `isDefault`. Both update events additionally contain a required `previous` object with the corresponding pre-update business fields. Published fields may not later be removed or narrowed.

Audit/undo rules:

- site create undo deactivates the site, clears/restores its custom-field contribution according to the canonical create-undo snapshot, and never deletes the stable identity;
- site update undo restores the editable scalar and custom-field snapshots;
- mapping create undo follows the same default-removal invariant as delete;
- mapping update/delete undo restores its snapshot only if uniqueness and default invariants remain valid;
- a conflicting undo fails with a translated `409` and an actionable audit entry; it never partially changes siblings.

`Site` receives a query-index entity ID and global search configuration for code/name. Tenant-defined custom fields are not automatically added to global search in Phase 1. `SiteWarehouseRole` receives the stable CRUD/DataTable entity ID required by `makeCrudRoute`, but no global search result configuration; its API filters serve programmatic callers and the scoped detail loader.

Both list APIs set `disableListCache: true`, matching current WMS configuration CRUD. No cache invalidation contract is required in Phase 1. If caching is introduced later, keys and tags must include tenant and organization, and mapping writes must invalidate the parent site projection.

## Backend UI and ACL

Add `wms.manage_sites` to `wms/acl.ts`, grant it to `admin` through `setup.ts`, preserve `wms.*` wildcard behavior, and run the existing ACL sync mechanism for installed tenants. `employee` retains read-only access through `wms.view`.

Backend routes:

- `/backend/wms/sites` — guarded by `wms.view`; minimal `DataTable` columns: code, name, active status;
- `/backend/wms/sites/create` — guarded by `wms.manage_sites`; `CrudForm` for code, name, active state, injected fields, and tenant-defined site custom fields; active is checked by default;
- `/backend/wms/sites/[id]` — guarded by `wms.view`; editable site `CrudForm` for users with `wms.manage_sites`, including injected/custom fields and its scoped warehouse-role assignments `DataTable` in the editor;
- mapping create/edit uses one shared `CrudForm` dialog; there is no alternative page flow.

Each Sites route declares explicit WMS breadcrumbs: `WMS → Sites` for the list, `WMS → Sites → Create site` for creation, and `WMS → Sites → Details` for the detail page. The list remains in the WMS navigation group with the Factory icon; create and detail pages are hidden from navigation.

This is setup-once configuration, not an operational work queue. The Sites list follows the established Catalog Categories visual baseline: a standard framed `DataTable` with a Factory icon in its title, name/code/status columns, search, a simple active-status filter, manual sorting, 10-row paging, stable `open`/`edit` actions, and the same action-capable `EmptyState` treatment when empty. Its built-in responsive layout stacks the toolbar on smaller screens and horizontally scrolls the data columns. It uses the standard DataTable perspective settings for user-resized, persisted column widths. Create and edit use the Warranty Claims editor shell: a titled `CrudForm` inside an outer framed card, with a left `Site details` card (code, name, active state) and a right custom-fields card that stacks beneath on smaller screens. The active checkbox is checked by default on creation. The Site form opts out of the default empty minimum content height, so its footer follows its actual content. On edit, a second left-column `Warehouse roles` card contains the assignments table, with the same group padding as the Warranty Claims positions section. The form provides Cancel, Create site, or Save changes actions as appropriate. The role dialog checks Default before submission when that `(site, role)` has no default, while the command remains authoritative under races and ensures a role never has more than one default. It intentionally omits advanced filters, exports, row selection, and bulk actions. The assignments table is scoped to the current `siteId`, requests `role ASC` from the API in 100-row pages, then orders each fetched page by role, default status, and the displayed warehouse label (name, then code, then ID). This is intentionally page-local ordering: a globally ordered result across pages is not required for setup configuration and is an accepted limitation. It offers stable `edit`/`delete` actions plus a scoped empty state. The underlying APIs retain narrow filters/search for integrations and bounded lookup use.

Add `sitesTable` and `siteWarehouseRolesTable` through `dataTableExtensionHost` in `wms/extension-points.ts`, with stable table IDs `wms.sites.list` and `wms.site_warehouse_roles.list` bound to their real client components. Add `siteForm` and `siteWarehouseRoleForm` through `crudFormExtensionHost`, bound to the corresponding form components. These hosts expose the normal DataTable and CrudForm injection surfaces without enabling built-in controls prematurely. The base sites table does not pass custom-field `entityIds` and does not synthesize custom-field columns: custom fields remain editable record data, while injected modules may add purpose-built columns through the stable table host.

Site forms use stable entity/custom-field host `E.wms.site` (`wms:site`), pass `entityIds={[E.wms.site]}`, and preserve stable base field IDs `code`, `name`, `isActive` plus group IDs `details`, `warehouseRoles`, and `custom` (`warehouseRoles` appears only for an existing Site). CrudForm normalizes the entity ID for the stable `crud-form:wms.site:fields` injection surface while loading custom fields under `wms:site`. The mapping form uses stable entity ID `E.wms.site_warehouse_role` and base IDs `role`, `warehouseId`, `isDefault`, but passes no custom-field entity IDs. All HTTP uses `apiCall` helpers; writes use `createCrud`/`updateCrud`, and mapping delete uses `deleteCrud`. Local validation throws `createCrudFormError`; success/error feedback uses translated `flash()` messages. Site update uses the site's `updatedAt`; mapping update/delete uses that mapping's `updatedAt`, never the parent version.

The mapping dialog:

- filters warehouse options to the current tenant and organization and to active warehouses;
- displays role, warehouse, and default state;
- makes role immutable while editing;
- explains that changing a default does not move inventory;
- supports `Cmd/Ctrl+Enter` submit and `Escape` cancel.

An assignment whose warehouse was later deactivated remains visible with a semantic warning `StatusBadge`/`Alert` and cannot be selected for a new assignment or update. All copy and errors use WMS locale keys; no hard-coded UI strings, status colors, arbitrary values, raw controls, or inline SVGs are permitted.

### Frontend architecture contract

#### Server/client boundary map

| Route | Server root | Client islands | Data owner |
|---|---|---|---|
| `/backend/wms/sites` | `backend/wms/sites/page.tsx` | `SitesTableClient` | `/api/wms/sites` |
| `/backend/wms/sites/create` | `backend/wms/sites/create/page.tsx` | `SiteFormClient` | `/api/wms/sites` |
| `/backend/wms/sites/[id]` | `backend/wms/sites/[id]/page.tsx` | `SiteFormClient`, `SiteWarehouseRolesClient`, `SiteWarehouseRoleDialog` | both scoped CRUD APIs |

Page roots remain server components and contain no `"use client"`. They own page composition and missing-record boundaries; client islands own only table/form/dialog state. Record-backed loading follows `loading -> notFound -> error -> ready` and uses `LoadingMessage`/`ErrorMessage`; forms and actions are not rendered for a missing site.

#### `"use client"` ledger

| Client file | Exact browser capability | Heavy dependencies | Guardrail / rejected alternative |
|---|---|---|---|
| `SitesTableClient.tsx` | Catalog Categories-aligned framed DataTable, search, active-status filter, sorting, paging, navigation, and standard persisted column-width settings | Existing DataTable only | No advanced filter/export state and no local full dataset |
| `SiteFormClient.tsx` | CrudForm state, custom-field collection, submit, conflict recovery | Existing CrudForm only | Shared field/group/schema builders for create/detail; no custom form framework |
| `SiteWarehouseRolesClient.tsx` | Child DataTable state and mapping dialog orchestration | Existing DataTable only | Split dialog into a leaf before either file exceeds 300 LOC |
| `SiteWarehouseRoleDialog.tsx` | Dialog open state, bounded warehouse search, keyboard submit/cancel | Existing CrudForm/dialog primitives only | No global provider and no preloaded warehouse catalogue |

#### Budgets, bootstrap, and evidence

| Budget | Spec value |
|---|---|
| New page-root `"use client"` directives | `0` |
| New/touched client files over 300 LOC | `0`; split before merge |
| New heavy browser libraries or page-root providers | `0` |
| Incremental first-load JS for each new route | no new heavy chunk and target <= 20 KiB gzip beyond reused WMS/UI chunks; any exception requires architecture approval |
| Hydration smoke tests | required for all three routes |
| Interaction tests | create/update site; create/promote/delete mapping; conflict retry; keyboard submit/cancel |
| Performance evidence | `yarn check:client-boundaries`, application build route output, and Playwright hydration/interaction results recorded in the PR |

No provider, bootstrap registry, global context, or app-shell import is added. Auto-discovered pages and generated registries are the only bootstrap changes. Warehouse options use bounded server/API search (`pageSize <= 100`), and no client island retains an unbounded warehouse dataset.

## Migration and Backward Compatibility

The original feature is additive: new tables, routes, commands, ACL, events, pages, and generated registrations. Existing warehouse semantics and APIs remain unchanged. The subsequent active-by-default revision changes only the default for newly created Sites; the follow-up migration changes the database column default to `true` and leaves all existing Site rows untouched. Callers may still explicitly create a Site with `isActive: false`.

The migration must:

1. create `wms_sites` and `wms_site_warehouse_roles` with standard WMS scope/lifecycle columns;
2. create the named indexes and foreign keys defined above;
3. use partial/expression indexes supported by the existing PostgreSQL deployment without installing a new extension;
4. update the WMS migration snapshot;
5. do not infer or reclassify a default Site or assignment from existing warehouses; during tenant initialization only, when all scoped WMS topology tables are empty, seed one active `MAIN` Site, one active primary `MAIN` Warehouse, and its default `finished_goods` assignment;
6. alter the Site `is_active` column default to `true` without updating existing rows.

Run `yarn db:generate` as a schema-diff probe, retain only intended WMS output, review SQL and snapshot, and rerun it as a no-op check. Do not apply the migration locally without explicit approval.

No existing warehouse is reclassified. New event, command, API, ACL, and entity IDs become frozen/stable contract surfaces once released.

## Implementation Phases

### Phase 1 — Data and invariants

1. Add entity types, validators, entities, named indexes, migration, and snapshot.
2. Register `wms:site` in `ce.ts`; add canonical site custom-field collection, command persistence, response decoration, snapshots, and undo.
3. Add transaction-safe commands, constraint translation, audit snapshots, and undo tests.
4. Result: scoped site and assignment operations work through commands without UI.

### Phase 2 — API and contracts

1. Add method metadata, CRUD routes, OpenAPI schemas, response transforms, site custom-field decoration, query indexes, and events.
2. Add concurrency, scope, custom-field roundtrip, N+1, and exact response-shape tests.
3. Result: complete public API with no site delete surface.

### Phase 3 — Backend UI and ACL

1. Add ACL/setup grants, locales, pages, minimalist stable DataTables, shared site CrudForm builders, native site custom fields, and the mapping dialog.
2. Add field injection, conflict handling, inactive-warehouse warning, keyboard behavior, empty/loading/error states, and route guards.
3. Result: administrators can configure sites and defaults end to end.

### Phase 4 — Integration and compatibility gate

1. Add self-contained API/UI fixtures and cleanup in `finally`.
2. Verify absent-Manufacturing composition, generator output, ACL sync behavior, migrations, and backward compatibility.
3. Result: P1.2 evidence is ready for Wave 0 review.

## Implementation Checklist

This is the remaining-work checklist for P1.2. Do not mark an item complete merely because a partial implementation exists; its stated completion evidence is required. Items in **Future Enhancements** are intentionally excluded from this checklist.

### 1. Blocking baseline

- [x] Update `wms setup role mappings` so its expected ACL feature list includes `wms.manage_sites`; the focused WMS setup and Site validator test run passes.

### 2. Transactional invariants and stable errors

- [x] Centralize active-Site warehouse locking so every affected Warehouse row is locked with `PESSIMISTIC_WRITE` in ascending UUID order before active-Site assignments are re-read.
- [x] Apply that ordered-lock helper to Site activation and deactivation, mapping create/update, and every mapping undo path that can change active-Site eligibility; preserve the rule that deactivation releases exclusivity without deleting mappings.
- [x] Translate named unique-index violations for duplicate Site code, duplicate mapping, and default-promotion races into the specified stable `409` error/field-error responses without exposing database details.
- [x] Keep default selection atomic: a default cannot be removed while siblings remain, first assignment becomes default, and concurrent promotion leaves exactly one default.

### 3. Audit, undo, events, and custom-field boundaries

- [x] Make Site create undo deactivate the stable Site **and** clear the custom-field values captured after creation.
- [x] Make Site update undo restore both scalar fields and the exact custom-field delta from the `before` and `after` snapshots, under the same scoped/concurrency rules as a normal update.
- [x] Implement mapping update and delete undo; create/update/delete undo must re-check the default and active-Site uniqueness invariants and fail as a translated `409` rather than partially changing data.
- [x] Reject prefixed `cf_`/`cf:` and other custom-field payload keys for `SiteWarehouseRole` on create/update; mappings remain a closed, non-custom-field entity.
- [x] Complete event payloads: Site events include `siteId`, `code`, `name`, and `isActive`; mapping events include `mappingId`, `siteId`, `warehouseId`, `role`, and `isDefault`; update events include the required `previous` business snapshot.

### 4. Backend UI completion

- [x] Split `WmsSitesPage.tsx` into focused client islands so every new or touched client file remains within the 300-line budget while preserving the server page roots.
- [x] Change the embedded warehouse-role table to server-backed 100-row pagination and preserve page-local role/default/warehouse-label ordering, stable row actions, scoped empty state, and extension host.
- [x] Verify the Site form and mapping dialog use their own `updatedAt` version for update/delete conflicts, including conflict recovery, `Cmd/Ctrl+Enter` submission, and `Escape` cancellation.

### 5. Required automated coverage

- [x] Add unit/command tests for code normalization and boundaries, all role values, scope and inactive-warehouse rejection, first/default promotion, duplicate/default races, activation/deactivation, ordered locking, undo, optimistic locking, and custom-field round trips.
- [x] Add `TC-WMS-SITES-001.spec.ts` with self-contained API fixtures and `finally` cleanup. Cover Site/mapping CRUD response shapes, no Site `DELETE`, ACL and scope denial, warehouse eligibility, concurrency outcomes, custom fields, and undo.
- [x] Add `TC-WMS-SITES-UI-001.spec.ts` with hydration and interaction evidence for all Site routes, list/create/edit, mapping dialog, inactive warning, keyboard behavior, excluded table controls, and conflict recovery.
- [x] Add `TC-WMS-SITES-COMPAT-001.spec.ts` proving the WMS Site APIs/routes and generated registrations work when Manufacturing is absent.

### 6. Release-readiness gate

- [x] Run `yarn db:generate` as a no-op schema-diff check; retain only the intended WMS migrations and verify the WMS snapshot.
- [x] Run `yarn generate` and verify generated registrations resolve without manual edits.
- [x] Backfill the additive `wms.manage_sites` ACL grant for existing WMS Supervisor roles with an idempotent data migration.
- [ ] Record passing results for `yarn workspace @open-mercato/core test`, `yarn workspace @open-mercato/core build`, `yarn test:integration`, `yarn typecheck`, and `yarn i18n:check-hardcoded` using one chosen local-or-Docker runner.

  Local runner evidence from 2026-08-29: generation, package/application builds, typecheck, lint, i18n checks, focused core/CLI tests, and all 15 required WMS Sites integration tests pass. The repository-wide gate remains unchecked because the full local Windows run still has unrelated path/locale portability failures in Attachments, Warranty Claims, and Queue; the two WMS failures it initially exposed were fixed and their targeted assertions pass.

### 7. Implementation-audit follow-up — 2026-08-28

The existing API, UI, and compatibility Playwright files establish smoke coverage only. They do not by themselves satisfy every acceptance item listed below, so their Phase 4 checklist items remain open until the required evidence is added and run.

- [x] Preserve `Site` custom-field payload keys during browser-form creation; regression coverage: `components/backend/__tests__/wmsSitesShared.test.ts`.
- [x] Request 100 warehouse-role assignments per server-backed page; regression coverage: `components/backend/__tests__/wmsSitesShared.test.ts`.
- [x] Make Site create undo deactivate through the ordered Warehouse-locking path; regression coverage: `commands/__tests__/sites.test.ts`.
- [x] Make Site update undo re-check active-Site warehouse exclusivity before restoring activation; regression coverage: `commands/__tests__/sites.test.ts`.
- [x] Add self-contained API coverage for Site custom-field create/update/read/undo, tenant and organization scope denial, inactive-warehouse rejection, role warehouse replacement, optimistic-lock conflicts, and active-Site conflict/race outcomes.
- [x] Add browser coverage for actual Site and mapping submits, inactive-warehouse warning, `Cmd/Ctrl+Enter`, loading/error/empty states, excluded table controls, and conflict recovery.
- [x] Prove the compatibility suite against a generated application composition where Manufacturing is absent, including the generated registrations and ACL/custom-field path.
- [x] Accept page-local assignment ordering as sufficient for this setup configuration. The API orders by `role ASC` in 100-row pages; the UI applies default status and displayed warehouse-label ordering only within the fetched page. A globally ordered result across pages is deliberately out of scope.

If a future operational view requires a global order across pages, implement it before pagination in the API/database rather than sorting rows in the browser. First decide whether the business key is warehouse `code` or displayed `name`; then either add a dedicated tenant- and organization-scoped mapping-list query that joins Warehouse, or extend the shared query mechanism to support ordered related fields. The query must preserve the current filters and return total/page metadata, and needs multi-page integration coverage proving `role`, default status, and the chosen Warehouse key stay ordered across the page boundary.

## Testing and Acceptance Criteria

### Unit and command coverage

- site code normalization, case-insensitive collision, blank values, and length boundaries;
- all six fixed roles accepted; custom/unknown roles rejected;
- scope mismatch and inactive-warehouse assignment fail closed;
- first mapping becomes default;
- concurrent default promotions leave exactly one default;
- duplicate assignment and database constraint races return translated errors;
- default deletion/demotion is blocked while siblings remain; deleting the last mapping in an optional role succeeds whether the Site is active or inactive;
- active and inactive Sites remain configurable;
- creation defaults to an active Site and activation succeeds without any warehouse role;
- activation, deactivation, and active-Site mapping changes lock affected warehouses in ascending UUID order and reject a warehouse used by another active Site, including concurrent races; deactivation releases that exclusivity;
- site create undo deactivates rather than deletes;
- mapping undo respects current uniqueness/default invariants;
- optimistic locking covers site update and mapping update/delete.
- site custom fields create/update/read correctly and scalar plus custom snapshots round-trip through undo;
- mapping validators reject prefixed/custom-field payload keys.

### Self-contained integration coverage

- create fixtures through APIs, never seeded/demo assumptions, and clean them in `finally`;
- GET/POST/PUT site paths return exact camelCase shapes including `updatedAt`; no site DELETE handler or OpenAPI operation exists;
- site custom fields appear in create/edit CrudForm, persist through the API, return only through canonical `customValues`/`customFields`, and field injection resolves at `crud-form:wms.site:fields`;
- GET/POST/PUT/DELETE mapping paths work for authorized users;
- several warehouses can share one role while exactly one is default;
- one warehouse can serve several roles inside one Site but cannot serve two active Sites;
- promotion is atomic and does not move stock;
- cross-tenant and cross-organization IDs cannot read or mutate assignments;
- a user with `wms.view` but without `wms.manage_sites` can read and cannot mutate;
- later warehouse deactivation leaves a visible warning and blocks new operational selection without automatically deactivating the Site;
- WMS loads with Manufacturing absent;
- UI covers list, create, edit, activation/deactivation, mapping dialog, keyboard behavior, and site/mapping optimistic conflicts;
- the Sites table renders Catalog Categories-aligned search, simple active-status filtering, sorting, empty-state action, and the standard persisted column-width settings; the assignments table omits advanced filters, column chooser, perspective, export, selection, and bulk-action controls while stable extension hosts still accept injected contributions;
- list enrichment performs a bounded batch warehouse query rather than one query per row.

### Required integration suites

All three suites use self-contained fixtures created through APIs and clean them in `finally`; they never depend on seeded or demo data.

| Suite | Runner surface | Required evidence |
|---|---|---|
| `TC-WMS-SITES-001.spec.ts` | Playwright `request` fixture | Site and mapping CRUD contracts; exact camelCase response shapes; absent Site `DELETE`; scope and ACL denial; first/default promotion and deletion rules; site activation/deactivation; warehouse eligibility; concurrent default and active-Site conflict outcomes; Site custom-field API round trip and undo. |
| `TC-WMS-SITES-UI-001.spec.ts` | Playwright `page` fixture | Hydration of all three Site routes; list, create, edit, mapping dialog, activation/deactivation, inactive-warehouse warning, `Cmd/Ctrl+Enter`, `Escape`, empty/loading/error states, absence of excluded table controls, and Site/mapping optimistic-lock conflict recovery. |
| `TC-WMS-SITES-COMPAT-001.spec.ts` | Playwright `request` fixture with Manufacturing absent | WMS Sites API and backend routes remain loadable without Manufacturing; generated registrations resolve; canonical Site custom-field decoration and WMS ACL setup remain available in that composition. |

Database-diff generation and static generated-artifact verification remain command gates rather than browser assertions. The compatibility suite runs after `yarn generate`; it verifies runtime composition, not migration SQL text.

### Validation commands

Choose local or Docker runner once for the gate and record it:

```bash
yarn db:generate
yarn generate
yarn workspace @open-mercato/core test
yarn workspace @open-mercato/core build
yarn test:integration
yarn typecheck
yarn i18n:check-hardcoded
```

## Future Enhancements

The following are separate capabilities, not unfinished work inside P1.2:

1. **Scheduled/effective-dated assignments:** allow an administrator to plan a default warehouse change for a future site-local date and query historical configuration as-of a date. The future design must define timezone, correction semantics, overlap constraints, migration from current assignments, and snapshot compatibility.
2. **Site timezone and production calendars:** add timezone only when calendar, shift, MES timestamp, or execution semantics require it. Existing sites must be migrated/configured before timezone-sensitive execution is enabled.
3. **Advanced production number ranges:** a later necessary capability defines configurable formats, resets, generated lot/serial identifiers, block reservation, and offline allocation. MVP may use UUID identity, a simple concurrency-safe Site-scoped order display number, and explicit lot/serial values validated by WMS.
4. **Shared warehouses across active Sites:** a future `manufacturing_network` capability may define allocation, ownership, contention, and reporting semantics. MVP fails closed instead of guessing them.
5. **Warehouse selection policy:** item-, operation-, capacity-, or routing-aware selection may extend explicit assignments later. Phase 1 provides only a deterministic default and explicit warehouse choice.

## Risks and Impact Review

| Risk | Severity | Detection | Mitigation | Residual risk |
|---|---|---|---|---|
| `Site` becomes a generic location master | Medium | New non-WMS consumers demand unrelated fields | Keep WMS ownership, namespace, and minimal fields; require a separate foundation decision for broader use | A future additive bridge may still be required |
| Current-only mappings are mistaken for historical truth | High | A report joins old records to the current default | Require immutable snapshots in every future release/order/posting/fact; document audit log as evidence, not an as-of resolver | Scheduled/as-of configuration remains unavailable until its follow-up |
| Concurrent writes produce zero or two defaults | High | Constraint/command test or production `409` metric | Transactional promotion, partial unique index, named error translation, concurrency tests | Operators may need to retry a raced update |
| Warehouse deactivation leaves an unusable default | High | Site UI warning and future operational eligibility checks | Preserve assignment, warn visibly, block operational use, require explicit replacement | Configuration remains degraded until an administrator acts |
| One warehouse is activated under two Sites | High | Activation/mapping concurrency tests and stable conflict telemetry | Every active-Site eligibility writer locks affected Warehouse rows in ascending UUID order, re-checks active mappings inside the transaction, and returns a stable conflict; one active Site per warehouse while allowing multiple roles in that Site | Shared-site operation requires the later production-network contract |
| Site identity is accidentally deleted through undo | High | Command regression tests and audit review | No DELETE command; create undo deactivates rather than deletes | Erroneous inactive records remain visible to administrators |
| Parent optimistic-lock version is reused for a mapping | Medium | UI conflict tests | Mapping forms carry their own `updatedAt` | Custom future UI must preserve the rule |
| Advanced numbering assumptions leak into P1.2 | Medium | Specification and API review | Keep UUID/basic order display numbering in `manufacturing`; defer formats, resets, generated lot/serial values, blocks, and offline allocation | Later capability must remain additive |
| Assignment enrichment becomes N+1 | Medium | Query-count integration test | One scoped batch warehouse lookup; no optional summary on site list | Very large assignment lists still require normal pagination |

## Final Compliance Report — 2026-08-13

### AGENTS.md files and guides reviewed

- root `AGENTS.md`;
- `.ai/specs/AGENTS.md`;
- `packages/core/AGENTS.md`;
- `packages/core/src/modules/customers/AGENTS.md` as CRUD reference;
- `packages/ui/AGENTS.md`;
- `packages/cli/AGENTS.md`;
- `BACKWARD_COMPATIBILITY.md`;
- `.ai/skills/om-spec-writing/SKILL.md` and its review checklist.

### Compliance matrix

| Requirement | Status | Notes |
|---|---|---|
| One independently deployable capability | Compliant | Site identity and its current warehouse-role assignments form one WMS configuration slice |
| Tenant and organization isolation | Compliant | Entity, command, route, index, error, and test rules are explicit |
| No cross-module ORM relation | Compliant | Future consumers store scalar IDs and snapshots |
| Zod, commands, transactions, mutation guards, OpenAPI | Compliant | Exact API and concurrency contracts are defined |
| Optimistic locking | Compliant | Site update and mapping update/delete expose and use their own `updatedAt` |
| Stable site identity | Compliant | No delete surface; creation undo deactivates |
| Sensitive data/encryption | Compliant | No PII field is introduced; untyped metadata is not exposed or assigned semantics |
| API/UI canonical mechanisms | Compliant | `makeCrudRoute`, `CrudForm`, `DataTable`, API helpers, conflict UI, and stable IDs are required |
| Custom fields | Compliant | Full canonical pipeline is required for `Site`; closed mapping assignments intentionally reject custom fields |
| Proportional list UX | Compliant | Setup-once tables retain native hosts, paging, states, actions, and refresh while omitting unjustified CRM-scale controls |
| Design system and i18n | Compliant | Semantic primitives/tokens, locale keys, keyboard behavior, and no raw controls are required |
| Cache and N+1 | Compliant | List cache disabled; warehouse presentation is batch-loaded |
| Migration/backward compatibility | Compliant | Additive tables/contracts; no existing warehouse is reclassified |
| Integration coverage | Compliant | Every affected API method and key UI flow has self-contained coverage |
| Future temporal/network/numbering features | Compliant | Explicitly separated without blocking the bounded MVP or leaking placeholder semantics into P1.2 |

### Internal consistency check

| Check | Status | Notes |
|---|---|---|
| Data model matches API | Pass | No temporal/timezone fields or site delete route remain |
| API matches UI | Pass | Site form and mapping dialog consume exact camelCase response fields |
| Default invariant is complete | Pass | First default, promotion, demotion, deletion, undo, and races are covered |
| Commands cover all mutations | Pass | Site create/update and mapping create/update/delete are defined |
| Risks cover critical writes | Pass | Identity, concurrency, eligibility, snapshots, numbering, and enrichment are included |

### Verdict

**Implemented; repository-wide release gate partially blocked outside this scope.** P1.2 now provides an active-by-default Site with optional warehouse roles and leaves production-readiness checks to future Manufacturing operations; it does not claim to deliver advanced production numbering or shared active-Site warehouse semantics.

## Changelog

- 2026-08-13: Created the implementation specification for the minimal WMS-owned `Site` and warehouse-role model, replacing a premature standalone `sites` module proposal.
- 2026-08-13: Review revision removed effective dating and timezone from Phase 1, made site identity non-deletable, allowed multiple warehouses per fixed role with one atomic default, normalized site codes, restricted assignments to active warehouses, removed business/API use of metadata, separated advanced number ranges into a follow-up capability, and completed API, transaction, undo, UI, testing, risk, and compliance contracts.
- 2026-08-13: Added the proportional native UI baseline: complete canonical custom fields and CrudForm field injection for `Site`; closed assignments without custom fields; minimalist paginated DataTables with stable extension hosts but without search/filter/view/export/selection/bulk controls.
- 2026-08-19: Introduced the earlier inactive-by-default, production-readiness activation rule; it was superseded on 2026-08-28 by active-by-default Sites with optional roles. The same revision allowed one warehouse to serve multiple roles in one Site while limiting it to one active Site, moved shared active-Site warehouses to future `manufacturing_network`, and made advanced number ranges non-blocking for the bounded MVP.
- 2026-08-19: Initially aligned future module references with a base/discrete split; later consolidated them into the single opt-in `manufacturing` module. The design remains pending parent-roadmap acceptance and its own readiness review.
- 2026-08-28: Aligned Site custom-field writes with the established WMS and Sales command lifecycle, without claiming cross-storage atomicity; specified ordered pessimistic Warehouse locks and re-validation for every mutation that changes active-Site eligibility; and aligned default promotion with the existing WMS primary-warehouse transaction and named-index conflict pattern.
- 2026-08-28: Defined mandatory API, browser UI, and Manufacturing-absent compatibility integration suites; mapped their evidence to Playwright `request` or `page` fixtures; and added `yarn test:integration` to the validation gate.
- 2026-08-28: Aligned the Sites list with the standard Catalog Categories DataTable layout: responsive framing, search, active-status filter, sorting, 10-row paging, the same empty-state action pattern, and standard persisted column-width settings.
- 2026-08-28: Added explicit WMS breadcrumbs to the Sites routes and hid create/detail routes from the WMS navigation menu.
- 2026-08-28: Placed the warehouse-role assignments table in the editor's left-column `Warehouse roles` card, with the standard Warranty Claims group padding and responsive behavior.
- 2026-08-28: Aligned Site create/edit with the Warranty Claims editor shell: titled outer form card and responsive `Site details`/custom-fields cards; added explicit Cancel, Create site, and Save changes form actions.
- 2026-08-28: Made Sites active by default and warehouse roles optional, removed production-role readiness from Site activation, and specified immediate Default selection for a role with no current default.
- 2026-08-28: Added an idempotent empty-topology initialization seed: `MAIN` Site, primary `MAIN` Warehouse, and its default `finished_goods` role assignment. Existing WMS topology is never inferred, changed, or supplemented by this seed.
- 2026-08-28: Accepted page-local ordering in the Site warehouse-role table as sufficient for setup configuration; documented the database-side approach required if a future operational view needs global ordering across pages.
- 2026-08-28: Increased the Site warehouse-role table page size from 25 to 100 while retaining server pagination and page-local ordering.
- 2026-08-29: Completed the implementation audit and autofix pass: hardened scoped lookups and lock ordering, completed undo and optimistic-lock behavior, preserved Site custom fields through list decoration, fixed UI mutation/error/conflict flows, added exact-path integration selection, and delivered the required API, browser, and Manufacturing-absent suites.
- 2026-08-29: Recorded local validation evidence. All affected WMS/CLI/UI tests and 15 required integration tests pass; the full repository gate remains open only for unrelated Windows-specific Attachments, Warranty Claims, and Queue failures.
- 2026-08-29: Closed the independent final-review findings: capture demoted defaults inside the locked transaction, preserve the exactly-one-default invariant when undo restores the only mapping, allow cleanup of assignments whose Warehouse was soft-deleted, preserve per-record organization scope through custom-field decoration without changing the JSON shape, and extend browser coverage for mapping promotion, conflict, deletion, and load errors.

### Review — 2026-08-13

- **Reviewer**: Agent with maintainer decisions
- **Security**: Passed; scoped lookups fail closed and no new sensitive field is exposed.
- **Performance**: Passed; indexes, pagination, disabled list cache, and batch enrichment are specified.
- **Cache**: Passed; Phase 1 explicitly disables list caching.
- **Commands**: Passed; all mutations, transaction boundaries, optimistic locking, default invariants, and undo outcomes are defined.
- **Risks**: Passed; current-only history, stable identity, warehouse eligibility, concurrency, N+1, and deferred numbering are covered.
- **Verdict**: Design complete, pending parent-roadmap acceptance and pre-implementation readiness evidence.
