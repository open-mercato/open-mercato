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
- tenant, organization, site, warehouse-active, uniqueness, and default-selection invariants;
- a database-enforced active-site warehouse exclusivity invariant, with the internal membership relation and transaction-scoped locking that make it hold under concurrency.

### Out of scope

- deleting a site through a route, command, or UI action, or reusing a retired site's UUID for a different site; reversing an unchanged accidental creation through the audit undo path is not site deletion and stays in scope;
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

No route, OpenAPI operation, UI action, or forward command sets `deleted_at` on a site; the undo handler for `wms.sites.create` is the only writer of that column. Undoing site creation soft-deletes the created record and retains its ID in the audit snapshot so redo restores the same identity. Undoing a site update restores the previous editable snapshot subject to optimistic locking.

Required indexes:

- `(organization_id, tenant_id)` for scoped access;
- unique `(tenant_id, organization_id, lower(code)) WHERE deleted_at IS NULL` with a named expression index.

Because that index excludes soft-deleted rows, undoing a site creation returns the site code to the available pool without any additional schema or command step.

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

### `ActiveSiteWarehouse`

Table: `wms_active_site_warehouses`.

This relation materializes the active-site exclusivity invariant so the database, rather than a command preflight check, arbitrates concurrent activation. It holds exactly one row per `(site, warehouse)` pair while that site is active, regardless of how many roles inside the site map to that warehouse.

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `tenant_id`, `organization_id` | UUID | Required; copied from and validated against the owning site |
| `site_id` | UUID FK to `wms_sites` | Required same-module ORM relation |
| `warehouse_id` | UUID FK to `wms_warehouses` | Required same-module ORM relation |
| `created_at`, `updated_at` | timestamps | Standard lifecycle fields |

Required indexes and constraints:

- unique `(tenant_id, organization_id, warehouse_id)` — the enforceable exclusivity invariant; a warehouse cannot be held by two active sites;
- `(organization_id, tenant_id, site_id)` for scoped cleanup on deactivation.

The exclusivity constraint also rejects a duplicate membership for the same Site, so a second unique index on `(tenant_id, organization_id, site_id, warehouse_id)` would be unreachable and is intentionally omitted in Phase 1. If the future `manufacturing_network` capability relaxes cross-Site exclusivity, it must introduce the site-scoped uniqueness invariant as part of that deliberate constraint redesign rather than carrying a redundant index until then.

Rows are never soft-deleted: membership is current-state only, so deactivation and mapping removal delete the rows outright. Audit history for those transitions lives in the site and mapping command snapshots, not in this relation. The table is internal WMS state — it has no API route, OpenAPI operation, query-index entity, custom-field host, search configuration, or UI surface, and it is not a Manufacturing-facing contract.

Membership is maintained transactionally, in the same transaction as the change that causes it, by exactly four paths:

| Path | Effect on membership |
|---|---|
| Site activation | Insert one row per distinct warehouse across the site's live mappings |
| Site deactivation | Delete every row for the site, releasing its warehouses |
| Mapping create while the parent site is active | Insert the row when that warehouse is not already held by the site |
| Mapping update or delete while the parent site is active | On update, insert the newly selected warehouse only when that warehouse is not already held by the site; on update or delete, delete the previous warehouse only when no remaining live mapping in that site still uses it |

After taking invariant 14's site key and re-reading the Site state, all four paths apply one membership-set reconciliation rule: an active Site's desired membership is the distinct set of warehouse IDs in the resulting live-mapping state, including the validated mapping change being executed, while an inactive Site's desired membership is empty. The command determines that prospective set before persistence, acquires the warehouse keys required by the delta, inserts only desired rows the Site does not already hold, and deletes only held rows absent from the desired set in the same transaction as the triggering change. This makes same-Site convergence idempotent when several roles select one warehouse and leaves the warehouse-exclusivity constraint as the backstop for a genuine cross-Site conflict rather than as control flow for a same-Site duplicate.

Mapping changes while the parent site is inactive touch no membership rows, because an inactive site holds no exclusivity. That decision is still taken under the site lock of invariant 14 and from an `is_active` value re-read inside it — every mapping write locks the parent site regardless of its state, so "inactive, therefore no membership" can never be concluded from a value that another transaction is concurrently changing.

A site update undo that reverses `is_active` reuses the corresponding activation or deactivation path above, including readiness validation, membership maintenance, and warehouse-key acquisition. It is not a fifth membership algorithm.

Warehouse state changes do not maintain this relation. A warehouse that is later deactivated keeps its membership row: invariant 7 retains the assignment for audit and context, so the warehouse stays reserved against other active Sites until the owning Site releases it by deactivating or by removing the mapping. Reactivating that warehouse therefore restores operational eligibility without any membership repair.

## Business Invariants and Transactions

All mutations validate Zod input before persistence and execute through registered WMS commands.

1. Site, warehouse, request, tenant, and organization scopes must match. Foreign-scope IDs fail closed without revealing the record.
2. Site codes are normalized to uppercase before uniqueness checks and persistence.
3. A site is created inactive and remains configurable while inactive. Operational consumers reject inactive sites.
4. Activation succeeds only when `raw_material` and `finished_goods` each have an active default warehouse. The same warehouse may satisfy both roles.
5. At activation time, every assigned warehouse must be absent from every other active Site. While a Site is active, mapping create/update and reactivation enforce the same rule transactionally. Deactivation releases this active-Site exclusivity without deleting mappings. The invariant is enforced by the `wms_active_site_warehouses` unique constraint on `(tenant_id, organization_id, warehouse_id)`, not by a preflight read: the constraint is what makes the rule hold under concurrency, and a preflight check exists only to produce a friendlier field error on the uncontended path.
6. Only an active warehouse can be newly assigned or selected by an update.
7. Later warehouse deactivation retains the assignment for audit/context, but makes the Site operationally ineligible until corrected; the assignment remains visible with a warning.
8. The first live assignment for `(site, role)` is automatically default.
9. Promoting an assignment atomically demotes the previous default and promotes the target.
10. A default cannot be demoted without promoting a replacement in the same transaction.
11. Deleting a default is blocked while sibling assignments remain. The administrator first promotes a successor; deleting the last assignment in a role is allowed only while the Site is inactive or when the role is not required for activation.
12. Creating, updating, deleting, promoting, activating, deactivating, and undoing assignments use `withAtomicFlush(..., { transaction: true })` where more than one row can change.
13. Preflight uniqueness/readiness checks provide field errors; named constraint violations handle concurrent races and return the same translated contract.
14. Activation, deactivation, site create-undo, site update-undo, and every mapping create/update/delete — **regardless of the parent Site's current `is_active`** — acquire transaction-scoped advisory locks with the two-integer overload `pg_advisory_xact_lock(familyId, resourceHash)` before reading the state their decision depends on. `resourceHash` is PostgreSQL's signed 32-bit `hashtext` of the fully scoped resource identity. The repository-wide two-integer advisory-lock family registry at `packages/shared/src/lib/db/advisoryLockFamilies.ts` owns two distinct, stable `int4` constants — `WMS_SITE_LOCK_FAMILY_ID = 1464685313` and `WMS_WAREHOUSE_LOCK_FAMILY_ID = 1464685314`. WMS key planning and acquisition live in `packages/core/src/modules/wms/lib/activeSiteWarehouseLocks.ts` and import those constants; every future two-integer advisory-lock caller must reserve a distinct value in the shared registry before use. The families are used in this order:
    - **the site key** `(WMS_SITE_LOCK_FAMILY_ID, hashtext('{tenantId}:{organizationId}:{siteId}'))`, corresponding to the logical identity `wms:active-site:{tenantId}:{organizationId}:{siteId}`, is taken first by all of those paths and held through the full transaction. `is_active` and `deleted_at` are re-read from the database *inside* this lock, and no readiness, membership, or undo decision may rely on a value observed before it. Activation performs invariant 4's readiness check only after taking the key and holds it through the membership and Site-state writes. Site create-undo evaluates the current `is_active`, `deleted_at`, live-mapping count, and unchanged-since-creation predicate inside the key; site update-undo likewise re-reads the row there and uses the activation/deactivation path if it reverses `is_active`. Mapping commands re-read the parent there and refuse a soft-deleted Site. Because activation, deactivation, undo, and mapping writes contend on the same site key, an activation cannot miss a mapping added concurrently, a mapping write cannot insert membership for a Site that has just deactivated, and create-undo cannot soft-delete a Site while a mapping is being attached — the transactions serialize and the loser re-reads committed state before deciding. The Site's optimistic-lock version is not a substitute: a mapping write does not bump the Site's `updated_at`, so optimistic locking alone leaves the undo-versus-mapping interleaving untouched.
    - **the warehouse keys** `(WMS_WAREHOUSE_LOCK_FAMILY_ID, hashtext('{tenantId}:{organizationId}:{warehouseId}'))`, corresponding to `wms:active-site-warehouse:{tenantId}:{organizationId}:{warehouseId}`, are taken after the site key once the locked reads show membership must change. A command touching several warehouses computes the signed `resourceHash` values first, removes duplicate physical keys, and acquires the remaining `(familyId, resourceHash)` pairs in ascending numeric `resourceHash` order. Ordering logical warehouse IDs is insufficient because it need not match the physical lock order. Site create-undo takes no warehouse key because it refuses any live mapping; site update-undo acquires warehouse keys only through the existing activation/deactivation path.

    The distinct family IDs prevent a Site hash from aliasing a warehouse lock, so the mandatory site-first order cannot be inverted by a cross-family `hashtext` collision. Within one family, a collision only makes unrelated resources share a physical key: a command holds at most one Site key, while warehouse keys are deduplicated and sorted by their actual signed lock key, so collisions can over-serialize but cannot introduce a deadlock edge. The locks make the outcome deterministic — the loser observes committed state and returns the stable `409` — while the `wms_active_site_warehouses` unique constraint remains the authority for any path that fails to take them. The same advisory-lock primitive is already used elsewhere in the platform for tenant-scoped serialization.

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
| Foreign-scope or unknown site/warehouse/mapping ID, including a mapping command whose parent Site is soft-deleted | `404` | Non-disclosing not-found response |
| Duplicate site code, duplicate assignment, default race, or invalid default removal | `409` | Stable translated error; constraint names never leak |
| Stale site or mapping version | `409` | Standard optimistic-lock conflict body consumed by `surfaceRecordConflict` |
| Inactive warehouse selected | `422` | Translated `warehouseId` field error |
| Activation lacks a required eligible default | `422` | Stable translated readiness error identifying `raw_material` or `finished_goods` |
| Warehouse already belongs to another active Site | `409` | Stable non-disclosing active-Site assignment conflict |
| Create-undo refused because the site is active, already soft-deleted, carries live mappings, or was edited since creation | `409` | Stable translated undo-refusal error; constraint names never leak |

Update schemas require at least one mutable field in addition to `id`; empty updates fail validation. ORM/query-engine parameters remain parameterized. Constraint translation matches named constraints and never interpolates user input into SQL or exposes database details.

Site command writes use `runCrudCommandWrite` (or the equivalent canonical helper if the implementation proves a module-local constraint requires it) so scalar changes, custom-field values, and CRUD side effects share one logical atomic flow. Form submissions collect custom values with `collectCustomFieldValues()`. Command snapshots store `snapshot.custom` before and after each site mutation and undo restores differences with `buildCustomFieldResetMap`. Mapping commands do not accept, persist, decorate, or restore custom fields.

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

- `wms.site.created`, `wms.site.updated`, `wms.site.deleted`;
- `wms.site_warehouse_role.created`, `wms.site_warehouse_role.updated`, `wms.site_warehouse_role.deleted`.

`wms.site.deleted` has exactly one emitter: the `wms.sites.create` undo handler reversing an unchanged accidental creation. No route, OpenAPI operation, forward command, or UI action emits it, and its presence does not introduce a site delete surface. It exists because subscribers, the query index, and search must learn that a site row is gone; omitting it would leave stale projections behind after an undo.

Every payload contains `id`, `tenantId`, and `organizationId`, with optional `actorUserId`. Site events also contain `siteId`, `code`, `name`, and `isActive`. Mapping events contain `mappingId`, `siteId`, `warehouseId`, `role`, and `isDefault`. Both update events additionally contain a required `previous` object with the corresponding pre-update business fields. Published fields may not later be removed or narrowed.

Audit/undo rules:

- site create undo soft-deletes the created site by setting `deleted_at`, clears its canonical custom-field contribution according to the create-undo snapshot, and emits the `deleted` CRUD side effect so the query index, search configuration, and caches drop the record; the site ID stays in the audit snapshot so redo restores the same identity rather than minting a new one. Because the site-code uniqueness index is partial on `deleted_at IS NULL`, the code is released for reuse. A site that is already active, already soft-deleted, already carries live mappings, or has been edited since creation is not an unchanged create: after taking invariant 14's site key, undo re-reads those conditions and fails with the translated `409` instead of removing the record. If create-undo commits first, a mapping create waiting on the same key re-reads `deleted_at` and fails, so no live mapping can be parented to the soft-deleted Site;
- site update undo takes invariant 14's site key, re-reads the Site row there, restores the editable scalar and custom-field snapshots, and routes an `is_active` reversal through the normal activation/deactivation readiness and membership path;
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
2. create `wms_active_site_warehouses` with its exclusivity unique constraint; the table starts empty because no site exists yet, so no backfill is required;
3. create the named indexes and foreign keys defined above;
4. use partial/expression indexes supported by the existing PostgreSQL deployment without installing a new extension; `pg_advisory_xact_lock` and `hashtext` are built-in PostgreSQL functions and likewise require no extension;
5. update the WMS migration snapshot;
6. create no default site or assignment because `Warehouse.isPrimary` cannot safely infer a factory or production role.

Run `yarn db:generate` as a schema-diff probe, retain only intended WMS output, review SQL and snapshot, and rerun it as a no-op check. Do not apply the migration locally without explicit approval.

No existing warehouse is reclassified. New event, command, API, ACL, and entity IDs become frozen/stable contract surfaces once released.

## Implementation Phases

### Phase 1 — Data and invariants

1. Add entity types, validators, entities, named indexes, migration, and snapshot, including `wms_active_site_warehouses` and its exclusivity constraint.
2. Register `wms:site` in `ce.ts`; add canonical site custom-field collection, command persistence, response decoration, snapshots, and undo.
3. Add transaction-safe commands, the shared two-integer family registry at `packages/shared/src/lib/db/advisoryLockFamilies.ts`, and WMS key planning/acquisition at `packages/core/src/modules/wms/lib/activeSiteWarehouseLocks.ts`. Implement invariant 14's reserved Site family first, then deduplicated warehouse-family keys in ascending signed `resourceHash` order, with activation readiness and the Site's `is_active`/`deleted_at` state re-read inside the site lock, set-based membership reconciliation across the four paths, constraint translation, audit snapshots, and undo tests.
4. Add the overlapping-transaction tests — two Sites activating on a shared warehouse, deliberate advisory-key collisions, activation racing a mapping create on the same Site, deactivation racing a mapping create on the same Site, and site create-undo racing a mapping create on the same Site — together with the active-Site same-warehouse mapping convergence case and the soft-delete create-undo/redo tests, before any API surface exists, so the invariant is proven at the command layer.
5. Result: scoped site and assignment operations work through commands without UI.

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
- activation and active-Site mapping changes reject a warehouse used by another active Site; deactivation releases that exclusivity by removing the site's membership rows;
- two truly overlapping transactions activating different Sites that share a warehouse resolve to exactly one winner: both open before either commits, exactly one membership row survives on `(tenant_id, organization_id, warehouse_id)`, and the loser receives the stable translated `409` rather than a leaked constraint name or a deadlock error. The test must exercise concurrent transactions, not sequential preflight checks, so it fails if the unique constraint or the advisory lock is removed;
- the advisory-key planner and database acquisition path are tested with deliberate collisions rather than relying on chance UUID hashes: fixtures make Site and warehouse resource identities reuse and invert the same signed `resourceHash` values across two contenders, and make two distinct warehouses alias within the warehouse family. The planned keys must retain distinct family IDs, collapse duplicate warehouse physical keys, and sort the remaining warehouse hashes numerically. Two genuinely overlapping transactions must complete without PostgreSQL `40P01`; when the contenders share a warehouse membership, exactly one commits and the other receives the stable translated `409`;
- a single Site activating with one warehouse serving two roles inserts exactly one membership row, and deactivation removes it;
- on an already-active Site with different warehouses serving `raw_material` and `finished_goods`, updating one mapping to the warehouse already held through the other role succeeds, leaves exactly one membership row for that `(site, warehouse)`, and does not return the cross-Site exclusivity `409`;
- activation racing a mapping create on the *same* Site, in two overlapping transactions, leaves membership consistent with the committed mappings: whichever commits second observes the other's committed state under the site lock, and the activated Site ends with a membership row for every warehouse it maps. The test must fail if the site-scoped lock is removed, because without it the activating transaction cannot see the uncommitted mapping and the mapping transaction still reads `is_active = false`, leaving the warehouse unreserved;
- deactivation racing a mapping create on the same Site leaves no orphan membership row: the mapping transaction re-reads `is_active` under the site lock and inserts nothing once deactivation has committed, so no warehouse stays reserved by an inactive Site;
- site create undo soft-deletes the site: it disappears from list results, its code becomes available for a new site, and redo restores the same site ID;
- site create undo is refused with a translated `409` when the site is already active, already soft-deleted, already carries live mappings, or was edited since creation;
- site create undo racing a mapping create on the same Site uses two genuinely overlapping transactions and proves both commit orders: if mapping create wins the site key, undo re-reads the live-mapping count and returns the translated `409` without deleting the Site; if undo wins, mapping create re-reads `deleted_at` and fails without inserting the mapping. Both operations must never commit together, and no live mapping may reference a soft-deleted Site;
- site update undo takes the same site key, and an undo that reverses `is_active` follows the normal activation/deactivation readiness and membership path;
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
| One warehouse is activated under two Sites, or advisory-key collisions invert physical lock order | High | Shared-warehouse and deliberate-collision overlapping-transaction tests, including an assertion that no PostgreSQL `40P01` escapes, plus stable conflict telemetry | `wms_active_site_warehouses` unique `(tenant_id, organization_id, warehouse_id)` as the enforceable invariant; two-argument advisory locks reserve distinct Site/warehouse family IDs, and deduplicated warehouse keys are sorted by the actual signed `resourceHash`, producing deterministic `409`s without a collision-induced deadlock; multiple roles inside one Site still share a warehouse | Hash collisions may reduce throughput by serializing unrelated resources, but cannot weaken exclusivity or create a cross-family lock edge; shared warehouses across active Sites require the later production-network capability |
| Membership drifts from the mappings it materializes | Medium | Overlapping-transaction tests for activation-vs-mapping-create and deactivation-vs-mapping-create on the same Site, the active-Site same-warehouse mapping-convergence test, plus the activation/deactivation and mapping command tests | All four maintenance paths write membership inside the same transaction as the change that causes it; every one of them — including mapping writes on an inactive Site — takes the invariant 14 site lock first, re-reads `is_active`, derives the distinct desired warehouse set, and reconciles stored rows to it. Neither the missing-row case (activation not seeing a concurrent mapping create), the orphan-row case (a mapping create landing membership for a Site that has just deactivated), nor a duplicate insert when two roles converge on one warehouse can escape that reconciliation | A future scheduled-assignment capability must extend the same reconciliation rule and take the same site lock rather than bypass them |
| Create undo removes a Site that is no longer unchanged or races a new mapping | High | Command regression tests, the overlapping create-undo-vs-mapping-create test, and audit review | No DELETE route or command; create undo takes the invariant 14 site key and evaluates `is_active`, `deleted_at`, the live-mapping count, and the unchanged-since-creation predicate inside it. If a concurrent mapping create wins, undo returns `409`; if undo wins, the mapping command observes the soft-delete and fails | An accidental create is reversible, so the site code returns to the pool instead of being reserved forever |
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
| Stable site identity | Compliant | No delete route, command, or UI action; create undo serializes with mapping writes, soft-deletes only an unchanged, inactive, mapping-free site, and preserves its ID for redo |
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
- 2026-08-23: Resolved the two High findings from the PR #5449 review. Site create undo now soft-deletes the created record and preserves its ID for redo instead of deactivating an already-inactive row, releasing the site code through the existing partial uniqueness index and refusing with a `409` once the site is active or carries mappings. Active-site warehouse exclusivity gained an enforceable seam: the new `wms_active_site_warehouses` relation carries a unique `(tenant_id, organization_id, warehouse_id)` constraint as the invariant, maintained transactionally by activation, deactivation, and active-site mapping create/update/delete, with ordered `pg_advisory_xact_lock` acquisition making concurrent activation deterministic. Tests, risks, migration steps, and Phase 1 were updated to match; shared warehouses across active Sites remain a deliberately deferred capability that will redesign this constraint.
- 2026-08-24: Resolved the Medium finding from the PR #5449 re-review. The membership lock was keyed only by warehouse while `is_active` — the state that decides whether membership should exist — was covered by no serialization point, so activation racing a same-Site mapping create could leave a warehouse unreserved and deactivation racing a mapping create could strand an orphan row. Invariant 14 now specifies a site-scoped key taken first by activation, deactivation, and every mapping write regardless of the Site's state, with `is_active` re-read inside it; the warehouse keys follow in ascending order. The membership-drift risk row names both interleavings, the test list gains the two same-Site overlapping-transaction cases, the error contract gains the create-undo refusal `409` that was previously only forward-referenced, and the compliance matrix's stale "creation undo deactivates" row now matches the soft-delete contract. Warehouse-deactivation membership behavior was stated explicitly; the later 2026-08-28 local review corrects the original collision treatment.
- 2026-08-28: Resolved the remaining Medium finding from the PR #5449 second re-review. Site create/update undo now take the same site key as activation and mapping writes; create-undo evaluates `is_active`, `deleted_at`, the live-mapping count, and its unchanged-record guard inside that lock, while a mapping create that loses the race refuses the soft-deleted parent. Activation readiness is explicitly inside the same lock, the test and risk sections cover both undo-versus-mapping commit orders, and site update undo reuses activation/deactivation membership semantics when reversing `is_active`. The redundant site-scoped unique index on `wms_active_site_warehouses` was removed from Phase 1, with its possible future ownership recorded for `manufacturing_network`.
- 2026-08-28: Resolved the advisory-lock collision finding from the local candidate self-review. Site and warehouse locks now use distinct reserved family IDs with PostgreSQL's two-integer advisory-lock overload, and multi-warehouse commands deduplicate and sort the signed physical hash keys rather than logical UUIDs. A deliberate-collision overlapping-transaction test and the risk analysis now prove that collisions can only over-serialize and cannot invert the site-before-warehouse order or leak a deadlock abort.
- 2026-08-28: Resolved the PR #5729 membership-idempotency finding and both accompanying nits. Active-Site membership maintenance is now defined as reconciliation to the distinct warehouse set, so updating a second role onto a warehouse the same Site already holds cannot surface a false cross-Site `409`; the command test plan covers that convergence path. The lock-key helper and repository-wide family registry have explicit implementation paths, the Phase 7 execution rows identify their landing commit, and the existing non-disclosing `404` contract now explicitly covers mapping writes whose parent Site is soft-deleted.

### Review — 2026-08-13

- **Reviewer**: Agent with maintainer decisions
- **Security**: Passed; scoped lookups fail closed and no new sensitive field is exposed.
- **Performance**: Passed; indexes, pagination, disabled list cache, and batch enrichment are specified.
- **Cache**: Passed; Phase 1 explicitly disables list caching.
- **Commands**: Passed; all mutations, transaction boundaries, optimistic locking, default invariants, and undo outcomes are defined.
- **Risks**: Passed; current-only history, stable identity, warehouse eligibility, concurrency, N+1, and deferred numbering are covered.
- **Verdict**: Design complete, pending parent-roadmap acceptance and pre-implementation readiness evidence.

### Review — 2026-08-23

- **Reviewer**: PR #5449 code review, with maintainer decisions on both findings.
- **Finding 1 — site create-undo was a no-op**: Accepted. Undo now soft-deletes the created site and preserves its ID for redo. The maintainer chose this over declaring create non-undoable, because it matches the platform's existing create-undo command contract and returns the site code to the pool.
- **Finding 2 — exclusivity was unenforceable under concurrency**: Accepted. The maintainer chose a materialized membership relation with a unique database constraint *plus* an ordered advisory lock, over an advisory lock alone, preferring a guarantee that holds even when an application path forgets the lock. The added table and its four maintenance points are an accepted cost in P1.2.
- **Why a partial unique index was insufficient**: The spec deliberately allows one warehouse to serve several roles inside one Site, and `is_active` lives on the site row, so the invariant is cross-row and cannot be expressed as a unique index over `wms_site_warehouse_roles` alone.
- **Deferred capability unchanged**: Shared warehouses across active Sites stay out of the first core. That later capability is expected to redesign this constraint deliberately rather than relax it in place.
- **Verdict**: Both findings resolved in the design. Readiness review and parent-roadmap acceptance still pending.

### Review — 2026-08-24

- **Reviewer**: PR #5449 re-review, confirming both 2026-08-23 High findings resolved and raising one Medium.
- **Finding — the membership lock did not cover the state that decides membership**: Accepted. The warehouse key alone serializes two activations but not an activation against a concurrent mapping create on the same Site, and mapping writes on an inactive Site took no lock at all. A site-scoped key is now acquired first by activation, deactivation, and every mapping create/update/delete regardless of `is_active`, with `is_active` re-read inside it and the membership decision made from that read.
- **Why a site key rather than `SELECT ... FOR UPDATE` on the site row**: Both were offered by the review. The advisory key was chosen because activation already holds advisory locks, so one primitive and one documented acquisition order (site key, then warehouse keys ascending) covers every path; a row lock would have mixed two locking disciplines whose interaction order would then also need specifying.
- **Why the unique constraint could not catch this alone**: The failure mode is a *missing* membership row, not a conflicting one, so no uniqueness constraint can observe it. Serialization on the Site is the only place the decision can be made correctly.
- **Documentation corrections**: The create-undo refusal `409` gained an error-contract row, and the Final Compliance Report's stable-identity row was corrected from the superseded "creation undo deactivates" wording.
- **Verdict**: Re-review findings resolved in the design. Readiness review and parent-roadmap acceptance still pending.

### Review — 2026-08-28

- **Reviewer**: PR #5449 second re-review, confirming the 2026-08-24 Medium and both nits resolved and raising one narrower Medium plus one nit.
- **Finding — site create-undo did not share the site serialization point**: Accepted. Site create/update undo now acquire the invariant 14 site key. Create-undo evaluates its current-state refusal guard inside the lock, and mapping create re-reads `deleted_at` there, so exactly one side can commit when they overlap.
- **Consistency corrections**: Activation readiness is explicitly performed while the site key is held; the decision brief's maintenance enumeration includes mapping delete; site update undo that reverses `is_active` reuses the activation/deactivation membership path.
- **Redundant-index nit**: Accepted. Phase 1 keeps only the enforceable warehouse-exclusivity constraint; a site-scoped uniqueness invariant belongs to the future capability that relaxes cross-Site exclusivity rather than to today's write path as an unreachable second index.
- **Verdict**: Re-review findings resolved in the design. Readiness review and parent-roadmap acceptance still pending.

### Local candidate self-review — 2026-08-28

- **Reviewer**: `om-auto-review-pr` / `om-code-review` specification-only route, against the local candidate branch because the contributor PR head was not writable.
- **Finding — one-argument hashed lock keys did not preserve the documented lock order under collisions**: Accepted. `hashtext` is a 32-bit physical key; Site and warehouse strings could alias in the same advisory-lock namespace, and lexicographic UUID order did not guarantee physical warehouse-lock order. The design now uses reserved family IDs in the two-integer overload, then deduplicates and numerically sorts actual warehouse hashes.
- **Evidence required**: The command test suite uses deliberate colliding key fixtures in two overlapping transactions, asserts that no `40P01` escapes, and retains the one-winner/stable-`409` assertion when warehouse membership conflicts.
- **Verdict before correction**: Changes requested (Medium). A fresh local candidate review is required after this correction.

### Review — 2026-08-28 (PR #5729)

- **Reviewer**: PR #5729 specification review, confirming the prior remediation and collision correction and raising one Medium plus two nits.
- **Finding — removing the site-scoped unique index also removed the same-Site duplicate-insert conflict target**: Accepted. Membership maintenance now reconciles the active Site to the distinct warehouse set under the invariant 14 site key. Mapping update inserts a newly selected warehouse only when the Site does not already hold it, so two roles may converge on one warehouse without a false cross-Site conflict.
- **Regression coverage**: The command test plan now reaches the dual-role state by updating an already-active Site, asserting one membership row and no cross-Site `409`, rather than covering that state only through activation.
- **Lock-family ownership nit**: Accepted. The WMS helper path is `packages/core/src/modules/wms/lib/activeSiteWarehouseLocks.ts`; the repository-wide reservation lives in `packages/shared/src/lib/db/advisoryLockFamilies.ts`, where every future two-integer family must be assigned a distinct value.
- **Execution-record nit**: Accepted. Phase 7 progress rows now carry the landing SHA required by their own convention.
- **Error-contract clarification**: The mapping-command refusal for a soft-deleted parent Site is now explicitly assigned to the existing non-disclosing `404` contract rather than left implicit in the unknown-ID row.
- **Verdict after correction**: Findings resolved in the design; fresh `om-auto-review-pr --autofix` review pending.
