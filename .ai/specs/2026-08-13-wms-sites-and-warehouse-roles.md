# WMS Sites and Warehouse Roles

## TLDR

Add a minimal, WMS-owned `Site` representing a stable factory context inside one tenant and organization. A site is not a tenant, organization, warehouse, generic enterprise location hierarchy, or standalone `sites` module. `SiteWarehouseRole` assigns one or more existing WMS warehouses to a site under a fixed production role and identifies exactly one default warehouse per configured role. Sites are created inactive. Activation requires eligible defaults for `raw_material` and `finished_goods`.

Wave 0 stores only the current assignment state. Administrators change it directly; audit logs retain prior values, while future production definitions, orders, postings, and facts must snapshot the exact site and warehouse assignment they used. One warehouse may serve several roles, including both required defaults, but it may belong to only one active Site in the MVP. Scheduled/effective-dated assignments, shared warehouses across active Sites, site timezone/calendars, and advanced production number ranges are explicitly deferred.

The release provides command-backed CRUD APIs, backend management UI, ACL, events, migrations, optimistic locking, and self-contained integration coverage. `Site` supports create, read, update, activation, and deactivation, but not delete.

## Overview

**Status:** Design complete — parent-roadmap acceptance and readiness review pending for P1.2 implementation.

**Parent documents:**

- `2026-08-13-manufacturing-product-roadmap.md`, Wave 0 gate #1;
- `2026-08-13-manufacturing-phase-1-wave-0-execution-plan.md`, P1.2.

## Problem Statement

Open Mercato scopes WMS records by tenant and organization. Its `Warehouse` entity represents a physical stock location with locations, balances, lots, serials, reservations, and movements. It has no stable factory identity and cannot express which warehouses currently serve production purposes for a factory.

Using `Tenant` as a factory would confuse a data-isolation boundary with a physical plant. Using `Organization` would fragment inventory, permissions, reporting, and internal transfers when one organization operates several factories. Treating one `Warehouse` as the factory would bind manufacturing definitions and orders to a replaceable storage location.

The smallest useful foundation is therefore a WMS-owned site identity plus explicit current warehouse-role assignments. The model deliberately avoids scheduled changes, routing policy, calendars, and number allocation until their concrete production lifecycle is specified.

## Primary Use Cases

1. An administrator creates an inactive site, assigns active warehouses to the required roles, verifies defaults, and activates the site.
2. A larger plant assigns several raw-material warehouses and explicitly promotes one as the current default.
3. An administrator changes a role default; existing inventory is not moved and already-created production records retain their stored snapshots.
4. WMS shows an assignment whose warehouse was later deactivated, warns that it is ineligible, and requires an explicit replacement rather than silently choosing one.
5. WMS remains fully loadable and the site configuration remains manageable when Manufacturing is not installed.

## Scope and Non-Goals

### In scope

- `Site` create/read/update, activation, and deactivation within `wms`;
- assignment of one or more same-scope WMS warehouses to each fixed production role;
- exactly one default warehouse for every `(site, role)` that has at least one live assignment;
- a setup-once backend UI: minimal `DataTable` lists and `CrudForm`-based site/mapping forms;
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
- list search bars, advanced filters, column choosers, saved views/perspectives, exports, or bulk actions in the Phase 1 site/mapping UI;
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

A warehouse may serve multiple roles within one Site. It may also be assigned while several Sites are inactive, but it may belong to only one active Site at a time. A site may temporarily have no assignments while it is being configured. The first assignment for a `(site, role)` becomes the default automatically. Later assignments are non-default unless the request explicitly promotes them; promotion atomically demotes the previous default. Activation is an explicit readiness transition, not a create-time default.

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
| `is_active` | boolean | Required; defaults to `false`; controls operational eligibility, not configurability |
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
3. A site is created inactive and remains configurable while inactive. Operational consumers reject inactive sites.
4. Activation succeeds only when `raw_material` and `finished_goods` each have an active default warehouse. The same warehouse may satisfy both roles.
5. At activation time, every assigned warehouse must be absent from every other active Site. While a Site is active, mapping create/update and reactivation enforce the same rule transactionally. Every activation, deactivation, mapping create/update, and mapping undo that can change active-Site eligibility must load its affected warehouse IDs, lock the `Warehouse` rows with `PESSIMISTIC_WRITE` in ascending UUID order, re-query active-Site assignments within that transaction, and only then flush. Every writer uses that order; deactivation releases this active-Site exclusivity without deleting mappings.
6. Only an active warehouse can be newly assigned or selected by an update.
7. Later warehouse deactivation retains the assignment for audit/context, but makes the Site operationally ineligible until corrected; the assignment remains visible with a warning.
8. The first live assignment for `(site, role)` is automatically default.
9. Promoting an assignment atomically demotes the previous default and promotes the target. Follow the existing WMS primary-warehouse ordering: keep the target non-default, demote the sibling default, then promote the target. The partial unique default index remains the database backstop, and its named violation is translated to the same stable `409` contract.
10. A default cannot be demoted without promoting a replacement in the same transaction.
11. Deleting a default is blocked while sibling assignments remain. The administrator first promotes a successor; deleting the last assignment in a role is allowed only while the Site is inactive or when the role is not required for activation.
12. Creating, updating, deleting, promoting, activating, deactivating, and undoing assignments use `withAtomicFlush(..., { transaction: true })` where more than one row can change.
13. Preflight uniqueness/readiness checks provide field errors; named default-index violations and the ordered warehouse locks handle concurrent races and return the same translated contract.

## API Contracts

Both route files use `makeCrudRoute`, method-level `metadata`, scoped payload helpers, OpenAPI exports, query indexing, mutation guards, command writes, `pageSize <= 100`, and disabled list cache. API responses use the exact camelCase shapes below; no vague camel/snake compatibility requirement is introduced. Only the site route enables canonical custom-field decoration.

### Sites

Path: `/api/wms/sites`.

| Method | Feature | Request / behavior |
|---|---|---|
| `GET` | `wms.view` | `page`, `pageSize`, `search`, `ids`, `isActive`, `sortField`, `sortDir`, or detail by `id` |
| `POST` | `wms.manage_sites` | `{ code, name, ...customFieldValues }`; always creates inactive; returns `201 { id }` |
| `PUT` | `wms.manage_sites` | `{ id, code?, name?, isActive?, ...customFieldValues }`; activation enforces readiness and active-Site warehouse exclusivity; requires optimistic-lock header; returns `{ ok: true }` |

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
| Activation lacks a required eligible default | `422` | Stable translated readiness error identifying `raw_material` or `finished_goods` |
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
- `/backend/wms/sites/create` — guarded by `wms.manage_sites`; `CrudForm` for code, name, injected fields, and tenant-defined site custom fields; the result is always inactive;
- `/backend/wms/sites/[id]` — guarded by `wms.view`; editable site `CrudForm` for users with `wms.manage_sites`, including injected/custom fields, plus a secondary assignments `DataTable`;
- mapping create/edit uses one shared `CrudForm` dialog; there is no alternative page flow.

This is setup-once configuration, not an operational work queue. The Phase 1 tables intentionally omit search inputs, filter overlays, advanced filters, column choosers, perspectives/saved views, exports, row selection, and bulk actions. The sites table defaults to `code ASC`, paginates at 25 rows, offers refresh and stable `open`/`edit` row actions, and uses the shared `ListEmptyState`. The assignments table is always scoped to the current `siteId`, orders by `role ASC, isDefault DESC, warehouse.code ASC`, paginates at 25 rows, and offers stable `edit`/`delete` actions plus a scoped empty state. The underlying APIs retain narrow filters/search for integrations and bounded lookup use; omitting UI controls does not remove those API contracts.

Add `sitesTable` and `siteWarehouseRolesTable` through `dataTableExtensionHost` in `wms/extension-points.ts`, with stable table IDs `wms.sites.list` and `wms.site_warehouse_roles.list` bound to their real client components. Add `siteForm` and `siteWarehouseRoleForm` through `crudFormExtensionHost`, bound to the corresponding form components. These hosts expose the normal DataTable and CrudForm injection surfaces without enabling built-in controls prematurely. The base sites table does not pass custom-field `entityIds` and does not synthesize custom-field columns: custom fields remain editable record data, while injected modules may add purpose-built columns through the stable table host.

Site forms use stable entity/custom-field host `E.wms.site` (`wms:site`), pass `entityIds={[E.wms.site]}`, and preserve stable base field IDs `code`, `name`, `isActive` plus group IDs `general`, `status`, and `custom`. CrudForm normalizes the entity ID for the stable `crud-form:wms.site:fields` injection surface while loading custom fields under `wms:site`. The mapping form uses stable entity ID `E.wms.site_warehouse_role` and base IDs `role`, `warehouseId`, `isDefault`, but passes no custom-field entity IDs. All HTTP uses `apiCall` helpers; writes use `createCrud`/`updateCrud`, and mapping delete uses `deleteCrud`. Local validation throws `createCrudFormError`; success/error feedback uses translated `flash()` messages. Site update uses the site's `updatedAt`; mapping update/delete uses that mapping's `updatedAt`, never the parent version.

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
| `SitesTableClient.tsx` | Minimal DataTable paging, refresh, navigation, organization-scope refresh | Existing DataTable only | No search/filter/view/export state and no local full dataset |
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

The change is additive: new tables, routes, commands, ACL, events, pages, and generated registrations. Existing warehouse semantics and APIs remain unchanged.

The migration must:

1. create `wms_sites` and `wms_site_warehouse_roles` with standard WMS scope/lifecycle columns;
2. create the named indexes and foreign keys defined above;
3. use partial/expression indexes supported by the existing PostgreSQL deployment without installing a new extension;
4. update the WMS migration snapshot;
5. create no default site or assignment because `Warehouse.isPrimary` cannot safely infer a factory or production role.

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

## Testing and Acceptance Criteria

### Unit and command coverage

- site code normalization, case-insensitive collision, blank values, and length boundaries;
- all six fixed roles accepted; custom/unknown roles rejected;
- scope mismatch and inactive-warehouse assignment fail closed;
- first mapping becomes default;
- concurrent default promotions leave exactly one default;
- duplicate assignment and database constraint races return translated errors;
- default deletion/demotion is blocked while siblings remain; deleting the last required-role mapping is blocked for an active Site and succeeds after deactivation;
- inactive site remains configurable;
- creation always yields an inactive Site; premature activation reports the missing required defaults;
- activation succeeds with eligible `raw_material` and `finished_goods` defaults, including when one warehouse serves both roles;
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
- later warehouse deactivation leaves a visible warning and blocks new operational selection;
- WMS loads with Manufacturing absent;
- UI covers list, create, edit, activation/deactivation, mapping dialog, keyboard behavior, and site/mapping optimistic conflicts;
- the base tables render no search, filter, column-chooser, perspective, export, selection, or bulk-action controls while their stable extension hosts still accept injected contributions;
- list enrichment performs a bounded batch warehouse query rather than one query per row.

### Validation commands

Choose local or Docker runner once for the gate and record it:

```bash
yarn db:generate
yarn generate
yarn workspace @open-mercato/core test
yarn workspace @open-mercato/core build
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

**Design complete — readiness review pending.** The revised specification is internally coherent for P1.2. It enables an inactive-by-default Site with a narrow activation contract and does not claim to deliver advanced production numbering or shared active-Site warehouse semantics.

## Changelog

- 2026-08-13: Created the implementation specification for the minimal WMS-owned `Site` and warehouse-role model, replacing a premature standalone `sites` module proposal.
- 2026-08-13: Review revision removed effective dating and timezone from Phase 1, made site identity non-deletable, allowed multiple warehouses per fixed role with one atomic default, normalized site codes, restricted assignments to active warehouses, removed business/API use of metadata, separated advanced number ranges into a follow-up capability, and completed API, transaction, undo, UI, testing, risk, and compliance contracts.
- 2026-08-13: Added the proportional native UI baseline: complete canonical custom fields and CrudForm field injection for `Site`; closed assignments without custom fields; minimalist paginated DataTables with stable extension hosts but without search/filter/view/export/selection/bulk controls.
- 2026-08-19: Made Sites inactive by default; required eligible `raw_material` and `finished_goods` defaults for activation; allowed one warehouse to serve multiple roles in one Site while limiting it to one active Site; moved shared active-Site warehouses to future `manufacturing_network`; and made advanced number ranges non-blocking for the bounded MVP.
- 2026-08-19: Initially aligned future module references with a base/discrete split; later consolidated them into the single opt-in `manufacturing` module. The design remains pending parent-roadmap acceptance and its own readiness review.
- 2026-08-28: Aligned Site custom-field writes with the established WMS and Sales command lifecycle, without claiming cross-storage atomicity; specified ordered pessimistic Warehouse locks and re-validation for every mutation that changes active-Site eligibility; and aligned default promotion with the existing WMS primary-warehouse transaction and named-index conflict pattern.

### Review — 2026-08-13

- **Reviewer**: Agent with maintainer decisions
- **Security**: Passed; scoped lookups fail closed and no new sensitive field is exposed.
- **Performance**: Passed; indexes, pagination, disabled list cache, and batch enrichment are specified.
- **Cache**: Passed; Phase 1 explicitly disables list caching.
- **Commands**: Passed; all mutations, transaction boundaries, optimistic locking, default invariants, and undo outcomes are defined.
- **Risks**: Passed; current-only history, stable identity, warehouse eligibility, concurrency, N+1, and deferred numbering are covered.
- **Verdict**: Design complete, pending parent-roadmap acceptance and pre-implementation readiness evidence.
