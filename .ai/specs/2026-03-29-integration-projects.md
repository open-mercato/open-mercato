# Integration Projects — Multi-Configuration per Integration

| Field       | Value |
|------------|-------|
| **Status** | Draft |
| **Created** | 2026-03-29 |
| **Builds on** | SPEC-045 (Integration Marketplace), SPEC-045b (Data Sync Hub), SPEC-045c (Payment/Shipping Hubs) |
| **Extended by** | [Integration Commands & Events](./2026-03-29-integration-commands-events.md) (project-aware command execution), [Google Workspace](./2026-03-29-google-workspace-integration.md) (per-project OAuth tokens) |

## TLDR

Allow tenants to create **multiple named configurations ("projects")** per integration. Today, each integration supports exactly one set of credentials per tenant (`UNIQUE(integrationId, organizationId, tenantId)`). This spec introduces an `IntegrationProject` entity — a named configuration envelope holding its own credentials, state, health status, and logs. A system-created `default` project ensures full backward compatibility. Consumers (data sync, scheduled jobs, payment links, webhooks) gain the ability to target a specific project when multiple exist. For bundled integrations, projects are scoped at the **bundle level** — all child integrations in a bundle share the same set of projects and credentials.

Existing integrations and provider packages MUST continue to work **without any code changes** after this extension. Existing service signatures, existing route URLs, and existing provider setup/CLI flows continue to target the `default` project automatically. Provider updates to expose project selection are additive follow-up work, not a rollout requirement.

---

## Problem Statement

Today's integration model enforces **one configuration per integration per tenant**:

```
IntegrationCredentials: UNIQUE(integration_id, organization_id, tenant_id)
IntegrationState:       UNIQUE(integration_id, organization_id, tenant_id)
```

Real-world scenarios that require multiple configurations:
- **Two Akeneo instances** (staging + production, or regional catalogs)
- **Multiple Stripe accounts** (per-brand or per-region)
- **Separate webhook endpoints** for different environments
- **A/B testing** payment providers with different API keys

Without multi-config support, tenants resort to workarounds (manual credential swapping, custom code) that are error-prone and unauditable.

---

## User Stories

- **Tenant admin** wants to **connect two Akeneo instances (staging + production) to the same integration** so that **they can sync catalog data from both without swapping credentials manually**.
- **Tenant admin** wants to **configure separate Stripe accounts per region** so that **payments are routed to the correct regional account**.
- **Tenant admin** wants to **delete a decommissioned project** so that **stale credentials and state don't accumulate**, and the system **prevents deletion when active sync mappings or webhooks still reference it**.
- **Integration consumer (data sync / webhooks / payments)** wants to **select which project to use when triggering an operation** so that **the correct credentials and external ID mappings are resolved**.
- **Existing API consumer** wants to **continue calling integration endpoints without changes** so that **all existing workflows keep working via the auto-created default project**.

---

## Design Decisions

| # | Decision | Resolution | Rationale |
|---|----------|-----------|-----------|
| 1 | State per project vs per integration | **Per-project** | Each connection needs independent enable/disable, health, API version |
| 2 | Log scoping | **Per-project tag** | Essential for debugging specific connections |
| 3 | Bundle-level vs integration-level projects | **Per-bundle** | Bundles share credentials via fallthrough today; projects extend that pattern. DRY: one project list per bundle, not per child |
| 4 | External ID mapping scoping | **Add projectId** | Two Akeneo instances may map the same product to different external IDs |
| 5 | Project identifier | **UUID PK + name + slug** | UUID for FK references, name for display, slug for stable API references; slug immutable after creation |
| 6 | Single-project consumer UX | **Hidden selector** | Less noise — only show project picker when ≥2 projects exist |
| 7 | Undoability of project mutations | **Command pattern + soft-delete** | Project mutations still follow the platform command pattern. Delete becomes a guarded soft-delete, which preserves history and keeps undo technically possible if the platform requires it later. |

---

## Proposed Solution

### Overview

1. **New `IntegrationProject` entity** — named configuration container scoped by `(scopeId, organizationId, tenantId)` where `scopeId` is either an `integrationId` (standalone) or `bundleId` (bundled).

2. **Automatic `default` project** — migrated from existing data. All current credentials/state rows become the `default` project. API consumers that omit `project` implicitly use `default`. For fresh tenants or legacy provider setup flows, core services lazily create the `default` project on first write when needed.

3. **Project selector in integration settings UI** — combobox at the top of the integration detail page. Users can add, rename, and delete projects. The `default` project cannot be deleted.

4. **Consumer project selection** — data sync mappings, scheduled syncs, payment link creation, and webhook configs gain an optional `projectId` field. When only `default` exists → auto-selected, field hidden. When ≥2 exist → required selection via combobox.

5. **Backward-compatible API** — all existing endpoints continue to work unchanged. New optional `?project=<slug>` query parameter defaults to `default`.

### Bundle Project Scoping

For bundled integrations (integration definition has `bundleId`):
- Projects are owned by the **bundle**, not individual child integrations
- All children in the bundle share the same project list and credentials (extending the existing credential fallthrough pattern)
- Each child integration has its own `IntegrationState` per project (independent enable/disable, health, API version)
- This avoids duplicating project management across N child integrations

For standalone integrations (no `bundleId`):
- Projects are owned by the integration directly
- One-to-one mapping: project → credentials → state

### Credential Resolution (Updated)

Current flow:
```
resolve(integrationId, scope) →
  getRaw(integrationId) OR getRaw(bundleId)  // fallthrough
```

New flow:
```
resolve(integrationId, scope, projectSlug = 'default') →
  1. scopeId = definition.bundleId ?? integrationId
  2. project = findProject(scopeId, projectSlug, scope)
  3. credentials = getByProjectId(project.id)
  4. return decrypted credentials
```

The existing `resolve(integrationId, scope)` signature remains valid — omitting `projectSlug` defaults to `'default'`, preserving full backward compatibility.

### 100% Backward Compatibility for Existing Integrations and Providers

The rollout requirement is:

> **Stripe, Akeneo, existing custom providers, and any other integration package MUST keep working after this change even if their code is not updated.**

That is achieved by keeping the current contracts and default behavior intact:

- `integrationCredentialsService.resolve(integrationId, scope)` remains valid and resolves the `default` project.
- `integrationCredentialsService.save(integrationId, credentials, scope)` remains valid and writes to the `default` project.
- `integrationCredentialsService.saveField(integrationId, fieldKey, value, scope)` remains valid and writes to the `default` project.
- `integrationStateService.resolveState(integrationId, scope)`, `upsert(...)`, `resolveApiVersion(...)`, and `setReauthRequired(...)` remain valid and target the `default` project.
- `integrationHealthService.check(integrationId, scope)` remains valid and checks the `default` project.
- Existing integration API routes keep the same URLs and methods. Omitting a project selector means `default`.
- Existing provider-owned setup and CLI flows such as `packages/gateway-stripe/src/modules/gateway_stripe/setup.ts`, `packages/gateway-stripe/src/modules/gateway_stripe/cli.ts`, `packages/sync-akeneo/src/modules/sync_akeneo/setup.ts`, and `packages/sync-akeneo/src/modules/sync_akeneo/cli.ts` continue to work unchanged because they already call the stable core service signatures.

To guarantee this, the integrations module adds one internal invariant:

- `integrationProjectService.getOrCreateDefault(scopeId, scopeType, scope)` is used by credentials/state/health write paths and by migration fallbacks. If a default project is missing for a valid integration scope, the core service layer recreates it before persisting project-scoped state.

Provider updates are still desirable and in scope for this feature, but only as additive improvements:

- expose explicit project pickers in provider-owned UI where helpful
- add project-aware CLI flags in provider packages
- add provider integration tests that prove both unchanged default behavior and optional project-aware behavior

---

## Architecture

### Entity Relationships

```
IntegrationProject (NEW)
  ├── 1:1 IntegrationCredentials (per project)
  ├── 1:N IntegrationState (per child integration per project, for bundles)
  │   └── 1:1 for standalone integrations
  └── 1:N IntegrationLog (tagged with projectId)

Consumers reference projects via projectId (UUID FK):
  SyncRun ──→ IntegrationProject
  SyncCursor ──→ IntegrationProject
  SyncMapping ──→ IntegrationProject
  SyncSchedule ──→ IntegrationProject
  SyncExternalIdMapping ──→ IntegrationProject
  WebhookEntity ──→ IntegrationProject (nullable)
```

### Module Boundaries

All project logic lives in the **integrations** module (`packages/core/src/modules/integrations/`). Consumer modules (data_sync, webhooks, sales) reference projects only by `projectId` (UUID FK) — no direct ORM relationships.

### Service Changes

| Service | Change |
|---------|--------|
| `integrationCredentialsService` | `resolve()` gains optional `projectSlug` param (default: `'default'`). Internal lookup switches from `(integrationId, scope)` to `(projectId)`. Bundle fallthrough replaced by project scope resolution. |
| `integrationStateService` | `resolveState()` gains optional `projectSlug` param. Queries by `(integrationId, projectId, scope)`. |
| `integrationLogService` | `write()` accepts optional `projectId`. `query()` supports `projectId` filter. |
| `integrationHealthService` | `check()` gains optional `projectSlug`. Resolves credentials and updates state for the specific project. |
| **NEW** `integrationProjectService` | CRUD for projects. Enforces: slug uniqueness per scope+tenant, `default` project protection, slug immutability after creation. |

### Transaction Boundaries

| Operation | Transaction scope | Rationale |
|-----------|------------------|-----------|
| **Create project** | Single transaction: insert `IntegrationProject` | Credentials and state rows are created lazily on first write. Keeping project creation lightweight preserves backward compatibility and avoids storing empty encrypted blobs. |
| **Delete project** | Single transaction: soft-delete `IntegrationCredentials`, `IntegrationState`, and `IntegrationProject` | Soft-delete must be atomic — partial soft-deletion would leak active secrets/state and confuse health checks. Reference check (sync mappings, schedules, webhooks, active runs) runs **before** the transaction; if references exist, the request is rejected with 409 before any delete begins. |
| **Update project** | Single statement (name update only) | No cascading side effects — slug is immutable, only display name changes. |
| **Credential save** | Single transaction: upsert `IntegrationCredentials` + update `IntegrationProject.updated_at` | Ensures credential write is reflected in project's timestamp for UI freshness. |
| **Migration backfill** | One transaction per tenant | Keeps migration resumable per-tenant on failure without leaving partially migrated tenants. |

---

## Data Model

### New Entity: `IntegrationProject`

Table: `integration_projects`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | uuid | PK | Primary key |
| `scope_type` | enum(`'integration'`, `'bundle'`) | NOT NULL | Whether project belongs to a standalone integration or bundle |
| `scope_id` | text | NOT NULL | The `integrationId` or `bundleId` |
| `name` | text | NOT NULL | Display name (e.g., "Local Akeneo", "EU Stripe") |
| `slug` | text | NOT NULL | Stable reference (e.g., `local_akeneo`). Immutable after creation. |
| `is_default` | boolean | NOT NULL, DEFAULT false | True for the auto-created default project |
| `organization_id` | uuid | NOT NULL | Tenant isolation |
| `tenant_id` | uuid | NOT NULL | Tenant isolation |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |
| `deleted_at` | timestamptz | NULL | Soft-delete marker. Historical rows may continue to reference deleted projects for auditability. |

**Indices:**
- `UNIQUE(scope_id, slug, organization_id, tenant_id)` — one slug per scope per tenant
- `INDEX(scope_id, organization_id, tenant_id, deleted_at)` — list active projects for a scope

**Slug rules:**
- Lowercase alphanumeric + underscores, 1–60 chars
- Auto-generated from `name` at creation (kebab→snake conversion)
- Immutable after creation (API rejects updates to `slug`)
- Reserved slug: `default`
- Deleted project slugs remain reserved. Reusing a deleted slug is not allowed; this preserves audit references and deep-link stability.

### Modified Entity: `IntegrationCredentials`

| Change | Detail |
|--------|--------|
| **Add column** | `project_id` (uuid, FK → `integration_projects.id`, NOT NULL after migration) |
| **Drop unique index** | `UNIQUE(integration_id, organization_id, tenant_id)` |
| **Add unique index** | `UNIQUE(project_id)` — one credential set per project |
| **Keep column** | `integration_id` retained for query convenience and logging; for bundle projects, stores the `bundleId` |

### Modified Entity: `IntegrationState`

| Change | Detail |
|--------|--------|
| **Add column** | `project_id` (uuid, FK → `integration_projects.id`, NOT NULL after migration) |
| **Drop unique index** | `UNIQUE(integration_id, organization_id, tenant_id)` |
| **Add unique index** | `UNIQUE(integration_id, project_id, organization_id, tenant_id)` — per-integration state within each project (important for bundles: each child has own state per project) |

### Modified Entity: `IntegrationLog`

| Change | Detail |
|--------|--------|
| **Add column** | `project_id` (uuid, nullable) — nullable for backward compatibility with pre-existing log entries |
| **Add index** | `INDEX(integration_id, project_id, organization_id, tenant_id, created_at)` |

### Modified Entity: `SyncExternalIdMapping`

| Change | Detail |
|--------|--------|
| **Add column** | `project_id` (uuid, NOT NULL after migration) |
| **Update unique index** | `UNIQUE(integration_id, project_id, external_id, organization_id)` — same external ID can exist in different projects |
| **Update unique index** | `UNIQUE(internal_entity_type, internal_entity_id, project_id, organization_id)` — same internal entity can map to different external IDs per project |

### Modified Entity: `SyncRun`

| Change | Detail |
|--------|--------|
| **Add column** | `project_id` (uuid, NOT NULL after migration) |

### Modified Entity: `SyncCursor`

| Change | Detail |
|--------|--------|
| **Add column** | `project_id` (uuid, NOT NULL after migration) |
| **Update unique index** | `UNIQUE(integration_id, project_id, entity_type, direction, organization_id, tenant_id)` |

### Modified Entity: `SyncMapping`

| Change | Detail |
|--------|--------|
| **Add column** | `project_id` (uuid, NOT NULL after migration) |
| **Update unique index** | `UNIQUE(integration_id, project_id, entity_type, organization_id, tenant_id)` |

### Modified Entity: `SyncSchedule`

| Change | Detail |
|--------|--------|
| **Add column** | `project_id` (uuid, NOT NULL after migration) |

### Modified Entity: `WebhookEntity`

| Change | Detail |
|--------|--------|
| **Add column** | `project_id` (uuid, nullable) — webhooks may not be integration-bound |

---

## API Contracts

### New: Project CRUD

#### Route: `api/[id]/projects/route.ts` — `makeCrudRoute`

The project CRUD endpoints use the standard `makeCrudRoute` factory pattern. Route file lives at `packages/core/src/modules/integrations/api/[id]/projects/route.ts`.

```typescript
const querySchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.string().optional().default('name'),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
  name: z.string().optional(),
})

const createSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/).optional(),
  // slug auto-generated from name if omitted
})

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).trim(),
  // slug is immutable — not accepted on update
})

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET:    { requireAuth: true, requireFeatures: ['integrations.view'] },
    POST:   { requireAuth: true, requireFeatures: ['integrations.manage'] },
    PUT:    { requireAuth: true, requireFeatures: ['integrations.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['integrations.manage'] },
  },
  orm: {
    entity: IntegrationProject,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: querySchema,
    fields: ['id', 'scopeType', 'scopeId', 'name', 'slug', 'isDefault', 'createdAt', 'updatedAt'],
    sortFieldMap: { name: 'name', slug: 'slug', createdAt: 'createdAt' },
    buildFilters: async (q, ctx) => ({
      scopeId: resolveScopeId(ctx),  // from parent :id param
      ...(q.name && { name: { $ilike: `%${q.name}%` } }),
    }),
  },
  actions: {
    create: {
      commandId: 'integrations.project.create',
      schema: createSchema,
      mapInput: ({ parsed, ctx }) => ({
        ...parsed,
        scopeId: resolveScopeId(ctx),
        scopeType: resolveScopeType(ctx),
        slug: parsed.slug ?? generateSlug(parsed.name),
      }),
      response: ({ result }) => ({ id: result.id, slug: result.slug }),
      status: 201,
    },
    update: {
      commandId: 'integrations.project.update',
      schema: updateSchema,
      mapInput: ({ parsed }) => ({ id: parsed.id, name: parsed.name }),
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'integrations.project.delete',
      response: () => ({ ok: true }),
    },
  },
  hooks: {
    beforeCreate: async (input, ctx) => {
      // Reject reserved slug 'default'
      if (input.slug === 'default') throw createCrudFormError('Slug "default" is reserved')
      // Validate slug uniqueness within scope+tenant
      await assertSlugUnique(input.slug, input.scopeId, ctx)
      return input
    },
    beforeDelete: async (id, ctx) => {
      // Block deletion of the default project
      const project = await findProject(id, ctx)
      if (project.isDefault) throw createCrudFormError('Cannot delete the default project')
      // Block deletion if active references exist
      const refs = await findActiveReferences(id, ctx)
      if (refs.length > 0) throw createCrudFormError('Project is in use', { references: refs })
    },
  },
  events: { entityId: 'integrations.project' },
})
```

**Response shape (GET list):**

```json
{
  "items": [
    {
      "id": "uuid",
      "scopeType": "integration",
      "scopeId": "sync_akeneo",
      "name": "Default",
      "slug": "default",
      "isDefault": true,
      "createdAt": "2026-03-29T00:00:00Z",
      "updatedAt": "2026-03-29T00:00:00Z"
    },
    {
      "id": "uuid",
      "scopeType": "integration",
      "scopeId": "sync_akeneo",
      "name": "EU Production",
      "slug": "eu_production",
      "isDefault": false,
      "createdAt": "2026-03-29T00:00:00Z",
      "updatedAt": "2026-03-29T00:00:00Z"
    }
  ],
  "total": 2,
  "page": 1,
  "pageSize": 50,
  "totalPages": 1
}
```

**Delete guards:**
- Cannot delete the `default` project (400 via `beforeDelete` hook)
- Cannot delete a project referenced by active sync mappings, schedules, running sync runs, or active webhooks (409 Conflict — `beforeDelete` hook returns list of referencing entities)
- Historical rows alone do not block delete; they retain their `project_id` reference to the soft-deleted project

### Modified: Existing Integration Endpoints

All existing integration routes keep their current URLs and methods. Additive project support is introduced via optional query parameters and additive response fields only.

| Current Endpoint | Additive Change |
|----------|--------|
| `GET /api/integrations/:id?project=<slug>` | Resolve `hasCredentials`, state, and bundle-child state for the selected project. Default: `default`. |
| `GET /api/integrations/:id/credentials?project=<slug>` | Read credentials for a specific project. Default: `default`. |
| `PUT /api/integrations/:id/credentials?project=<slug>` | Save credentials for a specific project. Default: `default`. |
| `PUT /api/integrations/:id/state?project=<slug>` | Update enable/reauth state for a specific project. Default: `default`. |
| `PUT /api/integrations/:id/version?project=<slug>` | Change API version for a specific project. Default: `default`. |
| `POST /api/integrations/:id/health?project=<slug>` | Trigger health check for a specific project. Default: `default`. |
| `GET /api/integrations/logs?integrationId=<id>&project=<slug>` | Filter logs by project for a given integration. When `project` is omitted, return all logs for that integration. Historical logs with `project_id = null` remain visible only in the unscoped view. |

**Backward compatibility:** Existing clients keep calling the same URLs. Omitting `project` resolves to the `default` project, so all current integrations and admin pages continue to behave exactly as they do today.

### Modified: Existing Data Sync Endpoints

The `data_sync` module keeps its current underscore route naming. No route is renamed.

| Current Endpoint | Additive Change |
|----------|--------|
| `GET /api/data_sync/options` | Response shape stays compatible. UI may continue fetching project lists separately from integrations project APIs. Optional additive fields like `projectCount` may be added later but are not required for phase 1. |
| `POST /api/data_sync/validate` | Add optional `projectId` in body. When omitted, validates against the `default` project. |
| `POST /api/data_sync/run` | Add optional `projectId` in body. When omitted, starts the run against the `default` project. |
| `GET /api/data_sync/runs` | Add optional `projectId` filter. Response rows gain additive `projectId` and `projectSlug` fields. |
| `GET /api/data_sync/runs/:id` | Response gains additive `projectId` and `projectSlug` fields. |
| `POST /api/data_sync/runs/:id/retry` | No new field required. Retries inherit the original run's `projectId`; `fromBeginning` semantics are unchanged. |
| `GET /api/data_sync/mappings` | Add optional `projectId` query filter. |
| `POST /api/data_sync/mappings` | Add optional `projectId` in body. Omitted means `default`. Upsert uniqueness becomes `(integrationId, projectId, entityType, organizationId, tenantId)`. |
| `GET /api/data_sync/schedules` | Add optional `projectId` query filter. |
| `POST /api/data_sync/schedules` | Add optional `projectId` in body. Omitted means `default`. |
| `GET /api/data_sync/schedules/:id` | Response gains additive `projectId` and `projectSlug` fields. |
| `PUT /api/data_sync/schedules/:id` | Add optional `projectId` in body; omitted preserves the current project's value. |

### Modified: Existing Webhook Endpoints

The webhooks package keeps its current CRUD routes and adds additive project support:

| Current Endpoint | Additive Change |
|----------|--------|
| `GET /api/webhooks/webhooks` | Response gains additive `projectId` and `projectSlug` for integration-bound webhooks. |
| `POST /api/webhooks/webhooks` | Add optional nullable `projectId` in body. Required only when `integrationId` points to an integration with multiple projects. |
| `PUT /api/webhooks/webhooks` | Add optional nullable `projectId` in body with the same rules as create. |

**OpenAPI:** Every modified route updates its existing `openApi` export. No public route aliases are removed.

### Security

- **Authentication & authorization:** All project endpoints require `requireAuth`. Mutations require `requireFeatures('integrations.manage')`; reads require `requireFeatures('integrations.view')`.
- **Tenant isolation:** Every query filters by `organization_id` + `tenant_id`. Project slug lookups always include tenant scope — a valid slug from tenant A cannot resolve in tenant B.
- **Credential exposure:** Project list and detail responses never include credential values. Credentials are only returned via the dedicated `GET /api/integrations/:id/credentials?project=<slug>` endpoint, which applies its own ACL. No other route exposes credential payloads.
- **Input validation:** All project inputs validated with zod before persistence — `name` (1–100 chars, trimmed), `slug` (1–60 chars, `^[a-z0-9_]+$`), `projectId` (UUID format). Invalid slugs and UUIDs rejected at the validation layer before reaching the database.
- **Secrets in logs/errors:** `projectId` may appear in log entries and error messages (it's a UUID, not sensitive). Credential values are never logged — existing `integrationLogService` policy applies unchanged.
- **Slug enumeration:** Project slugs are tenant-scoped and only visible to authenticated users with `integrations.view`. No public endpoint exposes project existence.

---

## Events

### New Events

| Event ID | Payload | Broadcast |
|----------|---------|-----------|
| `integrations.project.created` | `{ integrationId, projectId, slug, name, scopeType, scopeId }` | `clientBroadcast: true` |
| `integrations.project.updated` | `{ integrationId, projectId, slug, changes }` | `clientBroadcast: true` |
| `integrations.project.deleted` | `{ integrationId, projectId, slug }` | `clientBroadcast: true` |

### Modified Event Payloads (Additive)

All existing integration events gain an optional `projectId` field:

| Event ID | Added field |
|----------|-------------|
| `integrations.credentials.updated` | `projectId?: string` |
| `integrations.state.updated` | `projectId?: string` |
| `integrations.version.changed` | `projectId?: string` |
| `integrations.log.created` | `projectId?: string` |

**Backward compatibility:** `projectId` is optional in the payload type. Existing subscribers that don't destructure `projectId` continue to work.

---

## UI Design

### 1. Integration Detail Page — Single Project (Default Only)

When the integration has only the auto-created `default` project, the project selector is **hidden**. A subtle `[+ Add Project]` link appears in the page header area so the user can opt into multi-project mode.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back to Integrations                                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────┐  Akeneo                                                  │
│  │ LOGO │  Data Sync · Enabled ✓              [+ Add Project]      │
│  └──────┘                                                          │
│                                                                     │
│  ┌─────────────┬──────────┬──────────┬────────┬──────────────────┐  │
│  │ Credentials │ Version  │  Health  │  Logs  │ (provider tabs)  │  │
│  ╞═════════════╧══════════╧══════════╧════════╧══════════════════╡  │
│  │                                                               │  │
│  │  API URL         [ https://akeneo.example.com/api       ]     │  │
│  │  Client ID       [ my-client-id                         ]     │  │
│  │  Client Secret   [ ••••••••••••                         ]     │  │
│  │  Username         [ admin                                ]     │  │
│  │  Password         [ ••••••••••••                         ]     │  │
│  │                                                               │  │
│  │                                    [ Save Credentials ]       │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Notes:**
- This is the **current UX** — zero visual change for users who don't need multi-project.
- The `[+ Add Project]` link is the only addition. Placed right-aligned in the header row, styled as a secondary/text button (not prominent).
- All tab content reads from the `default` project implicitly.

---

### 2. Integration Detail Page — Multiple Projects

When ≥2 projects exist, a project selector combobox appears between the header and the tabs. The selected project scopes **all** tab content below it.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back to Integrations                                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────┐  Akeneo                                                  │
│  │ LOGO │  Data Sync · Enabled ✓                                   │
│  └──────┘                                                          │
│                                                                     │
│  ┌─ Project ────────────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │  [ ▼ EU Production              ]  [+ New]  [✎]  [🗑]      │   │
│  │                                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────┬──────────┬──────────┬────────┬──────────────────┐  │
│  │ Credentials │ Version  │  Health  │  Logs  │ (provider tabs)  │  │
│  ╞═════════════╧══════════╧══════════╧════════╧══════════════════╡  │
│  │                                                               │  │
│  │  API URL         [ https://eu.akeneo.example.com/api    ]     │  │
│  │  Client ID       [ eu-client-id                         ]     │  │
│  │  Client Secret   [ ••••••••••••                         ]     │  │
│  │                                                               │  │
│  │                                    [ Save Credentials ]       │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Project bar elements:**
- **Combobox** — lists all projects by name. Selected project slug stored in URL `?project=eu_production` for deep-linking/refresh persistence.
- **[+ New]** — opens the Create Project dialog (see mockup 4).
- **[✎] (Edit)** — opens the Edit Project dialog (see mockup 5). Disabled for `default` project name editing if desired, or allowed (only slug is immutable).
- **[🗑] (Delete)** — opens the Delete Confirmation dialog (see mockup 6). Hidden/disabled for the `default` project.

---

### 3. Project Combobox — Open Dropdown

When the user clicks the project combobox, it expands to show all projects with status indicators.

```
  [ ▼ EU Production              ]  [+ New]  [✎]  [🗑]
  ┌──────────────────────────────────┐
  │  ● Default                       │  ← green dot = healthy
  │  ◉ EU Production                 │  ← selected, highlighted
  │  ○ US Staging                    │  ← gray dot = no health check yet
  │  ◗ Asia Pacific                  │  ← yellow dot = degraded
  ├──────────────────────────────────┤
  │  + Create new project...         │
  └──────────────────────────────────┘
```

**Status dots** reflect the project's `lastHealthStatus`:
- `●` Green = healthy
- `◗` Yellow = degraded
- `○` Gray = unknown / never checked
- `●` Red = unhealthy

The `+ Create new project...` option at the bottom is a convenience shortcut (same as the `[+ New]` button).

---

### 4. Create New Project Dialog — `CrudForm`

Opened via `[+ New]` button or dropdown shortcut. Uses `CrudForm` embedded in a dialog with `embedded: true` to suppress outer chrome.

```
  ┌──────────────────────────────────────────────────┐
  │  Create New Project                         [✕]  │
  ├──────────────────────────────────────────────────┤
  │                                                  │
  │  ┌─ CrudForm (embedded) ─────────────────────┐   │
  │  │                                           │   │
  │  │  Name *                                   │   │
  │  │  [ EU Production                    ]     │   │
  │  │                                           │   │
  │  │  Slug                                     │   │
  │  │  [ eu_production                    ]     │   │
  │  │  ↳ Auto-generated from name. Cannot be    │   │
  │  │    changed after creation.                │   │
  │  │                                           │   │
  │  └───────────────────────────────────────────┘   │
  │                                                  │
  │  ┌────────────────────────────────────────────┐  │
  │  │ ℹ The new project will start with empty    │  │
  │  │   credentials. Configure them after        │  │
  │  │   creation in the Credentials tab.         │  │
  │  └────────────────────────────────────────────┘  │
  │                                                  │
  │              [ Cancel ]  [ Create Project ]       │
  │                          ↑ Cmd+Enter              │
  └──────────────────────────────────────────────────┘
```

**CrudForm wiring:**

```typescript
const fields = React.useMemo<CrudField[]>(() => [
  {
    id: 'name',
    label: t('integrations.projects.form.name'),
    type: 'text',
    required: true,
    placeholder: t('integrations.projects.form.name.placeholder'),
  },
  {
    id: 'slug',
    label: t('integrations.projects.form.slug'),
    type: 'text',
    required: false,
    description: t('integrations.projects.form.slug.description'),
    // auto-populated via onFieldChange; user can override
  },
], [t])

<CrudForm
  embedded
  fields={fields}
  schema={createProjectSchema}
  submitLabel={t('integrations.projects.form.create.submit')}
  onSubmit={async (vals) => {
    const result = await createCrud(
      `integrations/${integrationId}/projects`,
      vals
    )
    onCreated(result.data)  // auto-select new project in combobox
  }}
/>
```

**Behavior:**
- **Name** — required, free text, 1–100 chars. As user types, slug auto-updates in real time (via a custom field or `onFieldChange` handler).
- **Slug** — auto-generated from name (`toLowerCase`, replace spaces/hyphens with `_`, strip non-alphanumeric). Editable before creation (user can override). Shown with a hint that it becomes immutable.
- **Validation errors** — inline below the field via `CrudForm` error handling (e.g., "Slug already exists" from `raiseCrudError`).
- **Submit** — `Cmd/Ctrl+Enter` or click `[Create Project]`.
- **Cancel** — `Escape` or click `[Cancel]`.
- After creation, the combobox auto-selects the new project and the Credentials tab is shown.

---

### 5. Edit Project Dialog — `CrudForm`

Opened via `[✎]` button. Uses `CrudForm` with `initialValues` loaded from the selected project.

```
  ┌──────────────────────────────────────────────────┐
  │  Edit Project                               [✕]  │
  ├──────────────────────────────────────────────────┤
  │                                                  │
  │  ┌─ CrudForm (embedded) ─────────────────────┐   │
  │  │                                           │   │
  │  │  Name *                                   │   │
  │  │  [ EU Production (Legacy)           ]     │   │
  │  │                                           │   │
  │  │  Slug                                     │   │
  │  │  ┌───────────────────────────────────┐    │   │
  │  │  │  eu_production                    │    │   │
  │  │  └───────────────────────────────────┘    │   │
  │  │  ↳ Read-only. Used in API references and  │   │
  │  │    sync configurations.                   │   │
  │  │                                           │   │
  │  │  Created: 2026-03-15 14:30                │   │
  │  │                                           │   │
  │  └───────────────────────────────────────────┘   │
  │                                                  │
  │              [ Cancel ]  [ Save Changes ]         │
  │                          ↑ Cmd+Enter              │
  └──────────────────────────────────────────────────┘
```

**CrudForm wiring:**

```typescript
const fields = React.useMemo<CrudField[]>(() => [
  {
    id: 'name',
    label: t('integrations.projects.form.name'),
    type: 'text',
    required: true,
  },
  {
    id: 'slug',
    label: t('integrations.projects.form.slug'),
    type: 'text',
    readOnly: true,
    description: t('integrations.projects.form.slug.readOnly'),
  },
], [t])

<CrudForm
  embedded
  fields={fields}
  schema={updateProjectSchema}
  initialValues={{ id: project.id, name: project.name, slug: project.slug }}
  submitLabel={t('integrations.projects.form.edit.submit')}
  onSubmit={async (vals) => {
    await updateCrud(`integrations/${integrationId}/projects`, {
      id: project.id,
      name: vals.name,
    })
    onUpdated()
  }}
  onDelete={!project.isDefault ? async () => {
    await deleteCrud(`integrations/${integrationId}/projects`, project.id)
    onDeleted()
  } : undefined}
/>
```

**Behavior:**
- **Name** — editable. The only mutable field.
- **Slug** — `CrudField` with `readOnly: true`. Muted styling. Description text: "Cannot be changed after creation to preserve API and sync references."
- **Delete** — rendered by `CrudForm`'s built-in delete button. Only shown when `onDelete` is provided (i.e., not the `default` project). Triggers the delete confirmation dialog (mockup 6).
- `default` project: name is editable (user might want to rename "Default" to "Main Production"). `isDefault` flag is not exposed in UI.

---

### 6. Delete Project — Confirmation Dialog

Opened via `[🗑]` button. Shows impact analysis before confirming.

**6a. No active references — safe to delete:**

```
  ┌──────────────────────────────────────────────────┐
  │  Delete Project                             [✕]  │
  ├──────────────────────────────────────────────────┤
  │                                                  │
  │  ⚠ Are you sure you want to delete the project   │
  │  "US Staging" (us_staging)?                      │
  │                                                  │
  │  This will permanently remove:                   │
  │  • Stored credentials for this project           │
  │  • Integration state (enabled/disabled, health)  │
  │                                                  │
  │  Historical sync runs and logs will be retained  │
  │  for auditing.                                   │
  │                                                  │
  │              [ Cancel ]  [ Delete Project ]       │
  │                           ↑ destructive/red      │
  └──────────────────────────────────────────────────┘
```

**6b. Active references exist — deletion blocked:**

```
  ┌──────────────────────────────────────────────────┐
  │  Cannot Delete Project                      [✕]  │
  ├──────────────────────────────────────────────────┤
  │                                                  │
  │  ⛔ The project "EU Production" (eu_production)   │
  │  is actively used by:                            │
  │                                                  │
  │  ┌────────────────────────────────────────────┐  │
  │  │  Data Sync                                 │  │
  │  │  • Products import mapping                 │  │
  │  │  • Categories import mapping               │  │
  │  │                                            │  │
  │  │  Scheduled Syncs                           │  │
  │  │  • Daily product sync (every 6h)           │  │
  │  │                                            │  │
  │  │  Webhooks                                  │  │
  │  │  • order.created → EU endpoint             │  │
  │  └────────────────────────────────────────────┘  │
  │                                                  │
  │  Remove or reassign these references before      │
  │  deleting the project.                           │
  │                                                  │
  │                                    [ Close ]      │
  └──────────────────────────────────────────────────┘
```

**Behavior:**
- DELETE API returns `409 Conflict` with the list of referencing entities.
- UI renders the reference list in a scrollable box grouped by consumer type.
- No delete button shown when blocked — only `[Close]`.

---

### 7. Integration Marketplace — Project Count Badge

The integration marketplace listing page shows a subtle project count when an integration has more than one project.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Integration Marketplace                            [ Search... ]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  DATA SYNC                                                          │
│  ┌───────────────────────┐  ┌───────────────────────┐               │
│  │  ┌──────┐             │  │  ┌──────┐             │               │
│  │  │ LOGO │  Akeneo     │  │  │ LOGO │  Shopify    │               │
│  │  └──────┘             │  │  └──────┘             │               │
│  │  Enabled · 3 projects │  │  Enabled              │               │
│  │  ● Healthy            │  │  ● Healthy            │               │
│  └───────────────────────┘  └───────────────────────┘               │
│                                                                     │
│  PAYMENT GATEWAYS                                                   │
│  ┌───────────────────────┐  ┌───────────────────────┐               │
│  │  ┌──────┐             │  │  ┌──────┐             │               │
│  │  │ LOGO │  Stripe     │  │  │ LOGO │  PayPal     │               │
│  │  └──────┘             │  │  └──────┘             │               │
│  │  Enabled · 2 projects │  │  Not configured       │               │
│  │  ● Healthy            │  │                       │               │
│  └───────────────────────┘  └───────────────────────┘               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Notes:**
- Project count only shown when > 1 (e.g., "3 projects"). Single-project integrations just show "Enabled" as today.
- Health dot reflects the **worst** health status across all projects (e.g., if one project is unhealthy, the card shows unhealthy).

---

### 8. Data Sync — Run Configuration with Project Selector

When starting a manual sync run or configuring a sync mapping, the project selector appears after the integration choice.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Start Import Run                                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Integration *                                                      │
│  [ ▼ Akeneo                                                   ]    │
│                                                                     │
│  Project *                                                          │
│  [ ▼ EU Production                                             ]    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Default                                                     │   │
│  │  ◉ EU Production                                             │   │
│  │  US Staging                                                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Entity Type *                                                      │
│  [ ▼ Products                                                  ]    │
│                                                                     │
│  Direction *                                                        │
│  [ ▼ Import                                                    ]    │
│                                                                     │
│  ☐ From beginning (ignore cursor)                                   │
│                                                                     │
│                                      [ Cancel ]  [ Start Run ]      │
└─────────────────────────────────────────────────────────────────────┘
```

**When integration has 1 project:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  Start Import Run                                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Integration *                                                      │
│  [ ▼ Akeneo                                                   ]    │
│                                                                     │
│  Entity Type *                    ← project field hidden entirely   │
│  [ ▼ Products                                                  ]    │
│                                                                     │
│  Direction *                                                        │
│  [ ▼ Import                                                    ]    │
│                                                                     │
│  ☐ From beginning (ignore cursor)                                   │
│                                                                     │
│                                      [ Cancel ]  [ Start Run ]      │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 9. Data Sync — Run History with Project Column

The sync run history table gains a "Project" column when any integration in the list has multiple projects.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Sync Runs                                              [ Filters ▼ ]      │
├──────────┬───────────────┬──────────┬──────────┬───────────┬───────────────┤
│  Status  │  Integration  │  Project │  Entity  │  Records  │  Started      │
├──────────┼───────────────┼──────────┼──────────┼───────────┼───────────────┤
│  ✓ Done  │  Akeneo       │  EU Prod │ Products │  1,204    │  10 min ago   │
│  ✓ Done  │  Akeneo       │  US Stg  │ Products │    856    │  25 min ago   │
│  ⟳ Running│  Akeneo      │  EU Prod │ Categs   │    --     │  2 min ago    │
│  ✗ Failed │  Shopify     │  —       │ Products │    0      │  1 hour ago   │
│  ✓ Done  │  Stripe       │  EU      │ Payments │  3,401    │  2 hours ago  │
├──────────┴───────────────┴──────────┴──────────┴───────────┴───────────────┤
│  Showing 1-5 of 23                              [ ← Prev ] [ Next → ]      │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Notes:**
- **Project column** shows the project name. Shows "—" for legacy runs with no project (pre-migration) or single-project integrations.
- Column is **hidden** if no integration in the current view has multiple projects (keeps the table compact for simple setups).
- The `[ Filters ]` dropdown gains a "Project" filter option.

---

### 10. Data Sync — Mappings per Project

The data sync mappings page is scoped by integration **and** project. Each project has its own independent field mappings, cursors, and external ID mappings.

**Multiple projects — mappings table shows project column:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Sync Mappings                                          [ + New Mapping ]   │
├──────────┬───────────────┬──────────────┬───────────┬───────────────────────┤
│  Entity  │  Integration  │  Project     │ Direction │  Fields Mapped        │
├──────────┼───────────────┼──────────────┼───────────┼───────────────────────┤
│ Products │  Akeneo       │  EU Prod     │  Import   │  12 / 24              │
│ Products │  Akeneo       │  US Staging  │  Import   │   8 / 24              │
│ Categs   │  Akeneo       │  EU Prod     │  Import   │   4 / 6               │
│ Products │  Shopify      │  —           │  Export   │  18 / 24              │
├──────────┴───────────────┴──────────────┴───────────┴───────────────────────┤
│  Showing 1-4 of 4                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Mapping detail / edit page — project shown as read-only context:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  Edit Mapping: Products Import                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Integration     Akeneo                                             │
│  Project         EU Production (eu_production)                      │
│  Entity Type     Products                                           │
│  Direction       Import                                             │
│                                                                     │
│  ┌─ Field Mappings ─────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │  Source (Akeneo)          →    Target (Mercato)              │   │
│  │  ──────────────────────────────────────────────────          │   │
│  │  values.name              →    title                        │   │
│  │  values.description       →    description                  │   │
│  │  values.sku               →    sku                          │   │
│  │  values.price.amount      →    price                        │   │
│  │  values.ean               →    barcode                      │   │
│  │  ...                                                         │   │
│  │                                                              │   │
│  │                                       [ + Add Field ]        │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│                                  [ Cancel ]  [ Save Mapping ]       │
└─────────────────────────────────────────────────────────────────────┘
```

**Notes:**
- Integration + Project are shown as **read-only context** on the mapping detail page (set at creation time, not changeable — changing project means creating a new mapping).
- Each project has completely independent mappings. "EU Prod" may map 12 fields while "US Staging" maps only 8 for the same entity type.
- Cursors are also per-project: a sync run for "EU Prod" does not advance "US Staging"'s cursor.
- External ID mappings are per-project: the same internal product can have different external IDs in each Akeneo instance.

---

### 11. Data Sync — Schedules per Project

Scheduled syncs are scoped per project. The schedules list shows which project each schedule targets.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Sync Schedules                                        [ + New Schedule ]   │
├──────────────┬───────────────┬──────────────┬───────────┬───────┬──────────┤
│  Name        │  Integration  │  Project     │  Entity   │ Freq  │ Status   │
├──────────────┼───────────────┼──────────────┼───────────┼───────┼──────────┤
│ EU Products  │  Akeneo       │  EU Prod     │ Products  │  6h   │ Active   │
│ EU Categs    │  Akeneo       │  EU Prod     │ Categs    │  24h  │ Active   │
│ US Products  │  Akeneo       │  US Staging  │ Products  │  12h  │ Paused   │
│ Shopify Sync │  Shopify      │  —           │ Products  │  1h   │ Active   │
├──────────────┴───────────────┴──────────────┴───────────┴───────┴──────────┤
│  Showing 1-4 of 4                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Create schedule form — project selector:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  Create Sync Schedule                                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Name *                                                             │
│  [ EU Products Daily Sync                                      ]    │
│                                                                     │
│  Integration *                                                      │
│  [ ▼ Akeneo                                                   ]    │
│                                                                     │
│  Project *                                                          │
│  [ ▼ EU Production                                             ]    │
│                                                                     │
│  Entity Type *                                                      │
│  [ ▼ Products                                                  ]    │
│                                                                     │
│  Direction *           Frequency *                                  │
│  [ ▼ Import       ]   [ ▼ Every 6 hours                       ]    │
│                                                                     │
│                              [ Cancel ]  [ Create Schedule ]        │
└─────────────────────────────────────────────────────────────────────┘
```

**Notes:**
- Project selector follows the same visibility rules: hidden when integration has 1 project, required when ≥2.
- Each schedule runs against a specific project's credentials and advances that project's cursor independently.
- Pausing/resuming a schedule only affects that project — other projects' schedules are unaffected.

---

### 12. Payment Link / Payment Method — Project Selector

When creating a payment link or configuring a payment method with a gateway that has multiple projects:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Create Payment Link                                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Amount *            Currency *                                     │
│  [ 99.00         ]   [ ▼ EUR                ]                       │
│                                                                     │
│  Payment Provider *                                                 │
│  [ ▼ Stripe                                                   ]    │
│                                                                     │
│  Stripe Account *                                                   │
│  [ ▼ EU Production                                             ]    │
│  ↳ Select which Stripe account to use for this payment link.       │
│                                                                     │
│  Description                                                        │
│  [ Invoice #2026-0342                                          ]    │
│                                                                     │
│  Expiration                                                         │
│  [ ▼ 7 days                                                   ]    │
│                                                                     │
│                                  [ Cancel ]  [ Create Link ]        │
└─────────────────────────────────────────────────────────────────────┘
```

**Notes:**
- The label says **"Stripe Account"** (not "Project") — context-sensitive labeling using the integration name for clarity.
- When Stripe has only the `default` project → field hidden entirely; payment link uses the sole configuration.
- The help text below the selector provides context for non-technical users.

---

### 13. Webhook Configuration — Project Selector

When configuring an outbound webhook tied to an integration:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Configure Webhook                                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Event *                                                            │
│  [ ▼ order.created                                             ]    │
│                                                                     │
│  Integration (optional)                                             │
│  [ ▼ Akeneo                                                   ]    │
│                                                                     │
│  Project *                                                          │
│  [ ▼ EU Production                                             ]    │
│  ↳ Webhook will use this project's credentials for signing.        │
│                                                                     │
│  Endpoint URL *                                                     │
│  [ https://eu.webhook.example.com/orders                       ]    │
│                                                                     │
│  ☑ Active                                                           │
│                                                                     │
│                                  [ Cancel ]  [ Save Webhook ]       │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 14. Bundle Integration Page — Project Management

For bundled integrations, the project management happens at the bundle level. The bundle config page shows projects and per-child enable/disable toggles within the selected project.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back to Integrations                                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────┐  MedusaJS Bundle                                        │
│  │ LOGO │  5 integrations                                          │
│  └──────┘                                                          │
│                                                                     │
│  ┌─ Project ────────────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │  [ ▼ EU Production              ]  [+ New]  [✎]  [🗑]      │   │
│  │                                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────┬──────────┬──────────────────────────────────────┐  │
│  │ Credentials │  Health  │  Child Integrations                  │  │
│  ╞═════════════╧══════════╧══════════════════════════════════════╡  │
│  │                                                               │  │
│  │  Shared credentials for "EU Production":                      │  │
│  │                                                               │  │
│  │  API Key        [ ••••••••••••                          ]     │  │
│  │  API Secret     [ ••••••••••••                          ]     │  │
│  │  API URL        [ https://eu.medusa.example.com         ]     │  │
│  │                                                               │  │
│  │                                    [ Save Credentials ]       │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Child Integrations (within "EU Production"):                       │
│  ┌───────────────────────────────┬──────────┬────────────────────┐  │
│  │  Integration                  │  Status  │  Health            │  │
│  ├───────────────────────────────┼──────────┼────────────────────┤  │
│  │  MedusaJS Products            │  [✓ On]  │  ● Healthy         │  │
│  │  MedusaJS Orders              │  [✓ On]  │  ● Healthy         │  │
│  │  MedusaJS Customers           │  [  Off] │  ○ Not checked     │  │
│  │  MedusaJS Inventory           │  [✓ On]  │  ◗ Degraded        │  │
│  │  MedusaJS Payments            │  [✓ On]  │  ● Healthy         │  │
│  └───────────────────────────────┴──────────┴────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Notes:**
- Credentials are shared across all child integrations in the project (bundle-level).
- Each child has its own enable/disable toggle and health status **per project**.
- Switching projects in the combobox refreshes both credentials and the child integration table.
- The "Child Integrations" tab shows the per-child state for the selected project.

---

### UI Component Summary

| Component | Location | Visibility Rule |
|-----------|----------|----------------|
| `[+ Add Project]` link | Integration detail header | Only when 1 project (default) |
| `ProjectSelector` combobox | Integration detail, between header and tabs | Only when ≥2 projects |
| `[+ New]` button | Next to ProjectSelector | Always when ≥2 projects |
| `[✎]` edit button | Next to ProjectSelector | Always when ≥2 projects |
| `[🗑]` delete button | Next to ProjectSelector | When selected project is not default |
| `CreateProjectDialog` | Modal | On `[+ Add Project]` or `[+ New]` click |
| `EditProjectDialog` | Modal | On `[✎]` click |
| `DeleteProjectDialog` | Modal | On `[🗑]` click |
| `ConsumerProjectSelector` | Data sync / payment / webhook forms | Only when selected integration has ≥2 projects |
| Project column in DataTable | Sync run history, webhook list | Only when any row has a non-default project |
| Project count badge | Marketplace cards | Only when integration has ≥2 projects |

### URL Deep-Linking

Project selection is persisted in the URL query parameter for bookmark/share support:

| Page | URL Pattern |
|------|------------|
| Integration detail | `/backend/integrations/[id]?project=eu_production` |
| Bundle detail | `/backend/integrations/bundle/[id]?project=eu_production` |
| Sync runs (filtered) | `/backend/data-sync/runs?integrationId=sync_akeneo&project=eu_production` |

When `?project` is omitted, the UI defaults to the first project (typically `default`). When the slug in URL doesn't match any project, the UI falls back to `default` and shows a transient flash message: "Project not found, showing default."

---

## Migration & Backward Compatibility

### Data Migration Strategy

**Step 1 — Create `integration_projects` table** (empty).

**Step 2 — Add `project_id` columns** (nullable) to all affected tables and add `deleted_at` to `integration_projects`.

**Step 3 — Seed default projects from the union of all integration-scoped records.** For each distinct `(integration_id, organization_id, tenant_id)` appearing in:

- `IntegrationCredentials`
- `IntegrationState`
- `SyncRun`
- `SyncCursor`
- `SyncMapping`
- `SyncSchedule`
- `SyncExternalIdMapping`
- `WebhookEntity` where `integration_id IS NOT NULL`

create or reuse one default project for the resolved scope:

1. Determine `scopeType`: if integration definition has `bundleId` → `'bundle'`, scopeId = `bundleId`; else → `'integration'`, scopeId = `integrationId`
2. Create `IntegrationProject` with `name: 'Default'`, `slug: 'default'`, `isDefault: true`
3. Deduplicate: if multiple children in a bundle, create only ONE bundle-scoped default project

**Step 4 — Backfill `project_id`** in all existing rows:
- `IntegrationCredentials.project_id` = matching default project
- `IntegrationState.project_id` = matching default project
- `SyncRun.project_id`, `SyncCursor.project_id`, `SyncMapping.project_id`, `SyncSchedule.project_id`, `SyncExternalIdMapping.project_id` = matching default project (resolved via `integrationId` → project lookup)
- `WebhookEntity.project_id` = matching default project when `integration_id IS NOT NULL`; remains `NULL` for webhooks that are not integration-bound
- `IntegrationLog.project_id` remains `NULL` for pre-existing rows; new writes after rollout always populate it when a concrete project is known

**Step 5 — Make `project_id` NOT NULL** on all columns except `IntegrationLog.project_id` and `WebhookEntity.project_id`.

**Step 6 — Update unique indices** (drop old, create new).

**Step 7 — Add lazy default-project creation in core services.** If a valid integration scope receives a legacy-style write with no explicit project and no `default` row exists yet, the core service layer creates the `default` project before writing. This guarantees compatibility for provider setup hooks, CLI commands, and future packages that still use the legacy signatures.

### Backward Compatibility Surface Checklist

| # | BC Surface | Impact | Mitigation |
|---|-----------|--------|------------|
| 1 | Auto-discovery conventions | NONE | No changes to module file conventions |
| 2 | Type definitions | ADDITIVE | `projectId` added as optional field to existing types |
| 3 | Function signatures | COMPATIBLE | New optional `projectSlug` param at end of existing signatures |
| 4 | Import paths | NONE | No moved modules |
| 5 | Event IDs | ADDITIVE | 3 new events; existing payloads gain optional `projectId` |
| 6 | Widget injection spot IDs | ADDITIVE | New spot `integrations.detail:projects` for project selector area |
| 7 | API route URLs | COMPATIBLE | Existing route URLs and methods stay unchanged; additive query/body params and additive response fields only |
| 8 | Database schema | ADDITIVE | New table + new columns + soft-delete marker; existing column names preserved; unique-index replacement done only after backfill |
| 9 | DI service names | ADDITIVE | New `integrationProjectService` registration |
| 10 | ACL feature IDs | NONE | Reuses existing `integrations.view` and `integrations.manage` |
| 11 | Notification type IDs | NONE | No new notification types |
| 12 | CLI commands | NONE | No CLI changes |
| 13 | Generated file contracts | NONE | No changes to generated file shapes |

---

## Risks & Impact Review

### Data Integrity Failures

#### Migration fails mid-way on large tenant

- **Scenario**: Migration step 3–4 (seed default projects, backfill `project_id`) crashes or times out partway through a tenant with hundreds of integrations.
- **Severity**: High
- **Affected area**: All integration functionality for the partially migrated tenant — credential resolution, state lookups, health checks.
- **Mitigation**: Migration runs one transaction per tenant (see Transaction Boundaries). If a tenant's transaction fails, no rows are committed for that tenant — the migration can be rerun. Steps are idempotent (INSERT … ON CONFLICT DO NOTHING for default projects, UPDATE … WHERE project_id IS NULL for backfill). Test on a snapshot of production data before deploy.
- **Residual risk**: Low after testing. Extremely large tenants (>10k integrations) may need extended lock timeout — monitor migration duration.

#### Race between project deletion and credential resolution

- **Scenario**: User deletes a project while a sync run is in-flight and resolving credentials for that project.
- **Severity**: Medium
- **Affected area**: Active sync runs, payment transactions mid-flight.
- **Mitigation**: DELETE checks for active references (sync runs in `running`/`pending` state) and returns 409. Credential resolution that finds no project returns a clear error (`ProjectNotFoundError`) rather than falling back silently. The deletion transaction does not begin until the reference check passes.
- **Residual risk**: Low — a narrow race window remains if a sync run starts between reference check and delete commit. Acceptable because the sync run will fail with a clear error on its next credential fetch and can be retried.

### Cascading Failures & Side Effects

#### Consumer resolves wrong credentials after multi-project setup

- **Scenario**: Consumer code calls `credentialsService.resolve(integrationId, scope)` without `projectSlug` after a tenant creates multiple projects. The consumer silently uses `default` credentials instead of the intended project.
- **Severity**: Medium
- **Affected area**: All integration consumers (data sync, payments, webhooks).
- **Mitigation**: Omitting `projectSlug` always resolves to `default` — this matches current behavior exactly. No consumer gets different credentials than before. For multi-project awareness, consumer UIs show the project selector when ≥2 projects exist, making explicit selection required.
- **Residual risk**: Low — matches current behavior. Consumers that never adopt the `projectSlug` param simply always use `default`.

#### Event subscriber failure on project.deleted

- **Scenario**: A third-party subscriber listening to `integrations.project.deleted` throws an error (e.g., cleanup logic fails).
- **Severity**: Low
- **Affected area**: Subscriber's own cleanup logic; project deletion itself is already committed.
- **Mitigation**: Project events use the standard event bus — subscriber failures do not block the emitting operation. Failed subscribers are retried per the event bus retry policy. The project deletion transaction is independent of event delivery.
- **Residual risk**: Negligible — subscriber failure is isolated from the mutation.

### Tenant & Data Isolation Risks

#### Cross-tenant project slug resolution

- **Scenario**: A bug in slug lookup omits `organization_id` / `tenant_id`, allowing tenant A to resolve tenant B's project by slug.
- **Severity**: Critical (if it occurred)
- **Affected area**: Credential leakage across tenants.
- **Mitigation**: All `projectService` queries include `organization_id` + `tenant_id` in the WHERE clause. The unique index `(scope_id, slug, organization_id, tenant_id)` enforces isolation at the database level — even if application code is buggy, the DB cannot return a cross-tenant row for a scoped lookup.
- **Residual risk**: Negligible — defense in depth (application + database).

### Migration & Deployment Risks

#### Backfill duration on large datasets

- **Scenario**: Step 4 (backfill `project_id` across 6 consumer tables) takes too long on tenants with millions of sync runs / external ID mappings, causing extended downtime or lock contention.
- **Severity**: Medium
- **Affected area**: Database availability during migration.
- **Mitigation**: Per-tenant transactions limit lock scope. Backfill uses UPDATE … WHERE project_id IS NULL (index-friendly). Consumer tables (SyncRun, SyncExternalIdMapping) are the largest — monitor per-table timing. If any table exceeds 60s per tenant, switch to batched updates (1000 rows per batch) with short pauses.
- **Residual risk**: Low — per-tenant scoping and NULL-filtering keep row counts manageable.

### Operational Risks

#### Project deletion orphans referencing data

- **Scenario**: User deletes a project that has dangling references in consumer tables not covered by the reference check.
- **Severity**: Medium
- **Affected area**: Data sync, webhooks.
- **Mitigation**: Reference check scans all active persistent consumer tables (`SyncRun` in active states, `SyncMapping`, `SyncSchedule`, `WebhookEntity`, `IntegrationState`). Historical rows (`SyncCursor`, completed/failed `SyncRun`, `IntegrationLog`, `SyncExternalIdMapping`) do not block delete and keep their `project_id` for audit. The check list is maintained alongside the entity — adding a new persistent consumer table requires adding it to the reference check.
- **Residual risk**: Low — new persistent consumer tables added in future phases must remember to register with the reference check. Documented in implementation notes.

#### Additive event payload breaks strict subscribers

- **Scenario**: Third-party subscriber destructures event payloads with strict schema validation and rejects the new optional `projectId` field.
- **Severity**: Low
- **Affected area**: Third-party event consumers.
- **Mitigation**: TypeScript types declare `projectId` as optional. JSON payloads are additive — well-written consumers ignore unknown fields. This is the standard backward-compatibility contract for events (BC surface #5).
- **Residual risk**: Negligible.

#### Existing provider setup/CLI flows stop working

- **Scenario**: Existing provider setup hooks or CLI commands (`gateway_stripe`, `sync_akeneo`, custom packages) keep calling the old core service signatures and fail because projects are now required.
- **Severity**: High
- **Affected area**: Tenant bootstrap, provider preconfiguration, operator CLI workflows.
- **Mitigation**: Core service signatures remain stable and implicitly target `default`. The service layer lazily creates the `default` project if it does not exist. Regression tests cover unchanged provider setup and CLI flows without any provider code changes.
- **Residual risk**: Low after route/service regression coverage.

---

## Implementation Plan

### Phase 1: Foundation — IntegrationProject Entity & Services

**Goal:** Introduce the `IntegrationProject` entity, update core services to be project-aware, and migrate existing data — all while maintaining 100% backward compatibility for existing API consumers.

#### Step 1.1: IntegrationProject Entity & Migration

- Create `IntegrationProject` entity in `packages/core/src/modules/integrations/data/entities.ts`
- Add zod validator in `data/validators.ts`
- Run `yarn db:generate` to create migration
- Write data migration logic (seed default projects, backfill `project_id` columns)
- Update unique indices on all affected entities

**Testable:** Migration runs cleanly on empty DB and on DB with existing integration data. Default projects created for all existing integrations.

#### Step 1.2: IntegrationProjectService

- Create `packages/core/src/modules/integrations/lib/project-service.ts`
- Implement: `list(integrationId, scope)`, `getBySlug(integrationId, slug, scope)`, `getById(projectId, scope)`, `create(integrationId, input, scope)`, `update(projectId, input, scope)`, `remove(projectId, scope)`
- Add `getOrCreateDefault(scopeId, scopeType, scope)` for migration fallbacks and legacy write compatibility
- Slug generation from name, uniqueness validation, default project protection, soft-delete semantics
- Reference check on delete (scan consumer tables for `project_id` usage)
- Register in DI (`di.ts`)

**Testable:** Unit tests for CRUD operations, slug generation, default protection, lazy default creation, and reference-check guard.

#### Step 1.3: Update Credential Resolution

- Update `credentialsService.resolve(integrationId, scope, projectSlug?)` — add optional third parameter
- Internal: resolve project via `projectService.getBySlug()`, then fetch credentials by `project_id`
- Bundle fallthrough replaced by project scope resolution (`scopeId = bundleId ?? integrationId`)
- `save()` and `saveField()` keep their current signatures and write to `default` when no project is specified
- Optional project-aware overloads/helpers may be added, but the legacy signatures remain the primary BC surface
- Existing callers (no `projectSlug` arg) → default to `'default'`

**Testable:** Existing credential tests still pass. New tests cover multi-project isolation and unchanged legacy save/resolve behavior.

#### Step 1.4: Update State & Health Services

- Update `stateService.resolveState(integrationId, scope, projectSlug?)` — resolve by `(integrationId, projectId)`
- Keep `upsert(...)`, `resolveApiVersion(...)`, and `setReauthRequired(...)` BC-safe: when no project is provided they target `default`
- Update `healthService.check(integrationId, scope, projectSlug?)` — resolve project, check, update project-scoped state
- Update `logService.write(input)` — accept optional `projectId`; `query()` supports `projectId` filter

**Testable:** State resolution per project. Health check updates correct project's state.

#### Step 1.5: Project CRUD API Routes via `makeCrudRoute`

- Create route file at `api/[id]/projects/route.ts` using `makeCrudRoute` factory (see API Contracts section for full config)
- Wire command IDs: `integrations.project.create`, `integrations.project.update`, `integrations.project.delete`
- Commands capture before/after snapshots for auditability; delete uses soft-delete semantics
- `beforeCreate` hook: validate slug uniqueness, reject reserved `default` slug
- `beforeDelete` hook: block default project deletion, check active references (409 Conflict)
- Export `openApi` with list/create/update/delete schemas
- ACL: `integrations.view` for GET, `integrations.manage` for mutations

**Testable:** API integration tests for full CRUD lifecycle via standard `makeCrudRoute` response shape (`{ items, total, page }`). 409 on delete with references.

#### Step 1.6: Update Existing Integration API Routes

- Add optional `?project=<slug>` query param to the current integration routes:
  - `GET /api/integrations/:id`
  - `GET /api/integrations/:id/credentials`
  - `PUT /api/integrations/:id/credentials`
  - `PUT /api/integrations/:id/state`
  - `PUT /api/integrations/:id/version`
  - `POST /api/integrations/:id/health`
  - `GET /api/integrations/logs`
- Keep current route URLs and methods exactly as they are today
- Default to `'default'` when omitted
- Update existing `openApi` exports with additive params and additive response fields only

**Testable:** Existing API calls without `project` still work identically. Calls with `project=<slug>` target the correct project.

#### Step 1.7: Events

- Declare 3 new events in `events.ts`: `integrations.project.created`, `integrations.project.updated`, `integrations.project.deleted`
- Add optional `projectId` to existing event payloads (additive)
- Emit project events from `projectService` mutations

**Testable:** Event payloads include `projectId`. Existing subscribers not broken.

---

### Phase 2: Integration Settings UI

**Goal:** Add project management UI to the integration detail page.

#### Step 2.1: Project Selector Component

- Create `ProjectSelector` component: combobox with project list, `[+ New]` button
- Fetch projects via `GET /api/integrations/:id/projects`
- Store selected project slug in URL query param (`?project=<slug>`) for deep-linking
- Hidden when only `default` project exists; shows `[+ New Project]` button only

**Testable:** Component renders, switches projects, URL updates.

#### Step 2.2: Project Create/Edit/Delete Dialogs via `CrudForm`

- **Create dialog:** Embedded `CrudForm` with `name` (text, required) and `slug` (text, auto-generated) fields. `onSubmit` calls `createCrud('integrations/:id/projects', vals)`. `Cmd+Enter` to submit, `Escape` to cancel.
- **Edit dialog:** Embedded `CrudForm` with `name` (text, editable) and `slug` (text, `readOnly: true`) fields. `onSubmit` calls `updateCrud(...)`. `onDelete` wired for non-default projects, calls `deleteCrud(...)`.
- **Delete confirmation:** Triggered by `CrudForm`'s built-in delete button. Shows list of referencing consumers from 409 response. Blocked if references exist (user must reassign first).
- Both dialogs use `embedded: true` on `CrudForm` to suppress outer page chrome.

**Testable:** Full CRUD flow in UI via standard `CrudForm` patterns (`createCrud`/`updateCrud`/`deleteCrud`). Delete blocked with active references.

#### Step 2.3: Per-Project Tab Content

- Credentials, Version, Health, and Logs tabs all scope their data to the selected project
- Pass `project` slug to all API calls from tabs
- Logs tab: add project filter dropdown (or scope automatically to selected project)

**Testable:** Switching projects in combobox refreshes all tab content.

#### Step 2.4: Bundle Project UI

- For bundled integrations, show project selector at bundle config page (`/backend/integrations/bundle/:id`)
- Child integration detail pages inherit the project context from the bundle
- Per-child enable/disable toggle works within the selected project

**Testable:** Bundle page shows projects, child pages respect bundle project context.

---

### Phase 3: Data Sync Consumer Integration

**Goal:** Data sync fully supports multi-project integrations.

#### Step 3.1: Entity Updates

- Add `project_id` (uuid) to `SyncRun`, `SyncCursor`, `SyncMapping`, `SyncSchedule`, `SyncExternalIdMapping`
- Update unique indices (as specified in Data Model section)
- Migration: backfill from `integration_id` → default project lookup

**Testable:** Migration runs. Existing sync data preserved with default project reference.

#### Step 3.2: Sync Engine Updates

- `sync-engine.ts`: resolve credentials via `credentialsService.resolve(integrationId, scope, projectSlug)`
- `SyncRun` creation: include `projectId`
- Cursor management: scope by `projectId`
- External ID mapping: scope by `projectId`

**Testable:** Two projects for same integration can run independent syncs with isolated cursors and mappings.

#### Step 3.3: Data Sync API Updates

- Keep existing route URLs and methods:
  - `POST /api/data_sync/validate`
  - `POST /api/data_sync/run`
  - `GET /api/data_sync/runs`
  - `GET /api/data_sync/runs/:id`
  - `POST /api/data_sync/runs/:id/retry`
  - `GET /api/data_sync/mappings`
  - `POST /api/data_sync/mappings`
  - `GET /api/data_sync/schedules`
  - `POST /api/data_sync/schedules`
  - `GET /api/data_sync/schedules/:id`
  - `PUT /api/data_sync/schedules/:id`
- Add optional `projectId` where configuration or execution needs explicit project selection
- Default to the `default` project when omitted
- Retries inherit the original run's `projectId`
- Update `openApi` exports with additive params and additive response fields only

**Testable:** API accepts `projectId`, routes to correct project credentials, and existing callers that omit it continue to work against `default`.

#### Step 3.4: Data Sync UI — Per-Project Scoping

- **Run config form:** Add project selector combobox after integration selector (mockup 8). Hidden when integration has only `default` project. Required when ≥2 projects exist. Changing integration resets project selection.
- **Mappings table:** Add "Project" column (mockup 10). Each row is scoped to a specific project — the same entity type can have different mappings per project. Mapping create form includes project selector.
- **Mapping detail/edit page:** Integration + Project shown as read-only context (set at creation, not changeable). Field mappings are per-project.
- **Schedules table:** Add "Project" column (mockup 11). Schedule create form includes project selector. Each schedule runs independently against its project's credentials and cursor.
- **Run history table:** Add "Project" column (mockup 9). Filterable by project.
- **Cursors:** Fully isolated per project — a sync run for "EU Prod" does not advance "US Staging"'s cursor.
- **External ID mappings:** Isolated per project — the same internal product can have different external IDs in each project's external system.

**Testable:** Two projects for the same integration have fully independent mappings, schedules, cursors, run history, and external ID mappings. UI shows/hides project selector correctly.

---

### Phase 4: Other Consumer Integration

**Goal:** All remaining integration consumers support project selection while preserving unchanged behavior for existing providers.

#### Step 4.0: Provider Compatibility Foundation

- Treat provider compatibility as a release blocker: no provider package update is required for correctness
- Core services preserve the current signatures used by provider packages
- `gateway_stripe`, `sync_akeneo`, and all existing/custom providers continue to read and write the `default` project automatically
- Provider package updates to expose explicit project selection are additive follow-up work

**Testable:** Existing Stripe and Akeneo setup/CLI flows work unchanged and populate the `default` project.

#### Step 4.1: Payment Provider Integration

- Update current payment gateway consumers explicitly:
  - `payment_gateways/lib/gateway-service.ts`
  - `payment_gateways/lib/descriptor-service.ts`
  - payment gateway session/status/capture/refund/webhook routes that resolve credentials or state
- Preserve unchanged behavior when no project is specified: payment operations continue using the `default` project
- Additive enhancement: payment method configuration and payment-session creation may accept optional `projectId` where persistent selection is stored
- When selecting a payment gateway integration with multiple projects in admin UI, show a project selector
- Resolve payment credentials via `credentialsService.resolve(integrationId, scope, projectSlug)`

**Testable:** Payment operations use correct project credentials when selected and continue to work unchanged against `default` otherwise.

#### Step 4.2: Shipping Carrier Integration

- Update current shipping carrier consumers explicitly:
  - `shipping_carriers/lib/shipping-service.ts`
  - provider webhook and polling flows that resolve carrier credentials
- Preserve unchanged behavior when no project is specified: shipping operations continue using the `default` project
- Optional additive enhancement: persistent shipment/carrier settings may store `projectId` later if a concrete use case requires it

**Testable:** Shipping calculations and shipment creation continue to work unchanged against `default` and can opt into explicit project routing later.

#### Step 4.3: Webhook Integration

- `WebhookEntity`: add nullable `project_id` column
- Update webhook CRUD validators, CRUD routes, serializers, and admin UI in `packages/webhooks`
- Backfill integration-bound webhooks to the `default` project during migration
- Webhook config UI: add optional project selector when `integrationId` is selected and that integration exposes multiple projects
- Outbound delivery and integration settings resolution continue to work unchanged against `default` when `projectId` is not set

**Testable:** Webhook delivery uses project-specific credentials when configured and continues to work unchanged for legacy webhooks.

#### Step 4.4: Provider Packages and Remaining Consumers

- Audit and optionally enhance current provider packages:
  - `packages/gateway-stripe`
  - `packages/sync-akeneo`
  - any other package calling `integrationCredentialsService`, `integrationStateService`, or `integrationLogService`
- Preserve unchanged behavior for setup hooks, CLI `configure-from-env`, and env preset application
- Add explicit project-aware support only where it materially improves operator workflows
- Ensure all remaining consumers default to `'default'` when no project is specified

**Testable:** Full regression — no credential resolution breaks for any existing provider or consumer, and provider-specific project support remains additive.

---

## Integration Test Coverage

All integration tests for this feature MUST be self-contained and MUST NOT require real third-party credentials. Use fake integrations, fake adapters, mocked env presets, and in-process provider stubs only.

### Core Integration API Coverage

1. `GET /api/integrations/:id/credentials` without `project` returns the `default` project credentials after migration.
2. `PUT /api/integrations/:id/credentials?project=<slug>` writes isolated credentials for the selected project and does not affect `default`.
3. `GET /api/integrations/:id?project=<slug>` returns selected-project `hasCredentials` and state while preserving current response shape.
4. `GET /api/integrations/logs?integrationId=<id>&project=<slug>` filters only project-scoped logs; omitting `project` returns all logs including historical rows with `project_id = null`.
5. Project CRUD lifecycle: create, rename, soft-delete, and delete-guard behavior for `default`, active references, and historical-only references.

### Migration & Backward Compatibility Coverage

1. Migration from a legacy tenant with only `IntegrationCredentials` and `IntegrationState` creates one `default` project and backfills all new `project_id` columns.
2. Migration from a legacy tenant with `SyncSchedule` or `SyncMapping` but no credentials/state still creates the required `default` project and backfills correctly.
3. Migration backfills integration-bound `WebhookEntity` rows to `default` and leaves non-integration webhooks with `project_id = null`.
4. Legacy provider-style service calls (`save`, `saveField`, `resolve`, `upsert`, `resolveState`, `resolveApiVersion`) continue to work without an explicit project parameter.
5. Soft-deleted projects remain referenced by historical runs/logs after active references are removed.

### Data Sync Coverage

1. `POST /api/data_sync/run` without `projectId` starts a run against `default`.
2. `POST /api/data_sync/run` with `projectId` starts a run against the selected project and writes `SyncRun.project_id`.
3. `POST /api/data_sync/validate` validates against the selected project when `projectId` is present.
4. `POST /api/data_sync/mappings` and `POST /api/data_sync/schedules` support two rows for the same integration/entity when the projects differ.
5. `POST /api/data_sync/runs/:id/retry` preserves the original run's project.

### Webhook Coverage

1. Webhook CRUD create/update supports nullable `projectId` and enforces project selection only when the chosen integration has multiple projects.
2. Legacy webhook records without `projectId` continue to resolve integration settings and deliveries against `default`.
3. Project-scoped webhooks resolve credentials from the selected project.

### Provider Compatibility Coverage

1. `gateway_stripe` env preset tests prove `setup.ts` and `configure-from-env` still populate the `default` project using the unchanged core service signatures.
2. `sync_akeneo` env preset tests prove `setup.ts` and `configure-from-env` still populate the `default` project using the unchanged core service signatures.
3. Payment gateway descriptor and gateway service tests prove the absence of an explicit project keeps existing `default` behavior.
4. Shipping carrier service tests prove the absence of an explicit project keeps existing `default` behavior.

### UI Coverage

1. Integration detail page hides the project selector when only `default` exists and shows it when 2 or more projects exist.
2. Switching the selected project updates credentials/version/health/log tabs without changing route structure.
3. Data sync configuration UI shows project selection only when the chosen integration has multiple projects.
4. Webhook create/edit UI shows project selection only for integration-bound webhooks with multiple projects.

---

## Final Compliance Report

### AGENTS.md Files Reviewed

- Root `AGENTS.md` — task router, conventions, critical rules
- `packages/core/AGENTS.md` — module development, entities, API routes, events, setup
- `packages/core/src/modules/integrations/AGENTS.md` — integration-specific patterns
- `packages/core/src/modules/data_sync/AGENTS.md` — data sync entities, adapters
- `packages/webhooks/AGENTS.md` — webhook CRUD/admin/API rules
- `packages/shared/AGENTS.md` — shared utilities, types
- `packages/ui/AGENTS.md` — UI components, forms, data tables
- `BACKWARD_COMPATIBILITY.md` — 13 contract surfaces

### Current Contracts Audited

- `packages/core/src/modules/payment_gateways/lib/gateway-service.ts`
- `packages/core/src/modules/payment_gateways/lib/descriptor-service.ts`
- `packages/core/src/modules/shipping_carriers/lib/shipping-service.ts`
- `packages/gateway-stripe/src/modules/gateway_stripe/setup.ts`
- `packages/gateway-stripe/src/modules/gateway_stripe/cli.ts`
- `packages/sync-akeneo/src/modules/sync_akeneo/setup.ts`
- `packages/sync-akeneo/src/modules/sync_akeneo/cli.ts`
- `packages/webhooks/src/modules/webhooks/data/entities.ts`
- `packages/webhooks/src/modules/webhooks/data/validators.ts`
- `packages/webhooks/src/modules/webhooks/api/webhooks/route.ts`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|------------|------|--------|-------|
| Root AGENTS | No direct ORM relationships between modules | ✅ PASS | Consumer modules reference projects by UUID FK only |
| Root AGENTS | Always filter by organization_id | ✅ PASS | All entities include organization_id + tenant_id |
| Root AGENTS | Validate all inputs with zod | ✅ PASS | Validators specified for project CRUD |
| Root AGENTS | Use findWithDecryption for encrypted data | ✅ PASS | Credential resolution continues to use encrypted storage |
| Root AGENTS | API routes MUST export openApi | ✅ PASS | All new and modified routes update openApi |
| Root AGENTS | Event IDs: module.entity.action (singular) | ✅ PASS | `integrations.project.created` etc. |
| Root AGENTS | Feature naming: module.action | ✅ PASS | Reuses existing `integrations.manage` |
| Root AGENTS | UUID PKs, explicit FKs | ✅ PASS | IntegrationProject uses UUID PK, all FKs explicit |
| Root AGENTS | Command pattern for write operations | ✅ PASS | Project CRUD via commands |
| Root AGENTS | Every dialog: Cmd+Enter submit, Escape cancel | ✅ PASS | Specified for create/edit dialogs |
| Root AGENTS | Existing providers must remain stable across contract changes | ✅ PASS | Legacy core service signatures and current routes remain valid; `default` project is automatic |
| BC Contract | Auto-discovery conventions FROZEN | ✅ PASS | No changes |
| BC Contract | Event IDs FROZEN | ✅ PASS | No renamed/removed events; 3 new events; existing payloads additive only |
| BC Contract | Widget injection spot IDs FROZEN | ✅ PASS | No renamed/removed spots; 1 new spot |
| BC Contract | API route URLs STABLE | ✅ PASS | No renamed/removed routes; existing URLs/methods preserved exactly; additive params only |
| BC Contract | Database schema ADDITIVE-ONLY | ✅ PASS | New table + new columns + soft-delete marker; existing column names preserved |
| BC Contract | Function signatures STABLE | ✅ PASS | New optional params only; no removed/reordered params |
| BC Contract | CLI commands STABLE | ✅ PASS | Existing provider CLI commands stay unchanged and continue to target `default` |
| BC Contract | DI service names STABLE | ✅ PASS | New service added; no renames |

### Internal Consistency Check

- **Data ↔ API:** All entity fields exposed through API contracts ✅
- **API ↔ UI:** All API params consumed by UI components ✅
- **Risks coverage:** All high-severity scenarios have mitigations ✅
- **Commands:** Write operations use command pattern ✅
- **Events:** All mutations emit events ✅
- **Provider BC:** Stripe, Akeneo, and existing/custom integrations keep working without code changes ✅

### Non-Compliant Items

None.

### Verdict

**Compliant after this revision** — ready for implementation with 100% backward compatibility as a release requirement.

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-03-29 | AI | Initial skeleton with open questions |
| 2026-03-29 | AI | Full spec after Q&A resolution: architecture, data model, API contracts, UI design, migration strategy, 4-phase implementation plan, compliance review |
| 2026-03-29 | AI | Filled spec gaps: exact current-route contracts, migration/backfill fixes, soft-delete semantics, provider BC strategy for Stripe/Akeneo/custom integrations, and explicit no-real-credentials integration test coverage |
