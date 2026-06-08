---
name: om-module-scaffold
description: Scaffold a new module from scratch with all required files and conventions. Use when creating a new module, adding a new entity with CRUD, or bootstrapping module features (API routes, backend pages, DI, ACL, events, search). Triggers on "create module", "new module", "scaffold module", "add module", "bootstrap module", "generate module".
---

# Module Scaffold

Create a new module with all required files following Open Mercato conventions. This skill generates the full module structure, wires it into the app, and runs required generators.

## Table of Contents

1. [Gather Requirements](#1-gather-requirements)
2. [Scaffold Structure](#2-scaffold-structure)
3. [Create Entity](#3-create-entity)
4. [Create Validators](#4-create-validators)
5. [Create API Routes](#5-create-api-routes)
6. [Create Backend Pages](#6-create-backend-pages)
7. [Add Module Metadata](#7-add-module-metadata)
8. [Add ACL & Setup](#8-add-acl--setup)
9. [Add DI Registration](#9-add-di-registration)
10. [Add Events](#10-add-events)
11. [Optional Features](#11-optional-features)
12. [Wire & Verify](#12-wire--verify)

---

## 1. Gather Requirements

Before writing any code, ask the developer:

1. **Module name** — plural, snake_case (e.g., `tickets`, `fleet_vehicles`, `loyalty_points`)
2. **Primary entity name** — singular (e.g., `ticket`, `fleet_vehicle`, `loyalty_point`)
3. **Key fields** — beyond standard columns, what data does this entity store?
4. **Relationships** — does it reference entities from other modules? (FK IDs only, no ORM relations)
5. **Features needed**:
   - [ ] CRUD API (almost always yes)
   - [ ] Backend admin pages (almost always yes)
   - [ ] Frontend public pages
   - [ ] Search indexing
   - [ ] Event publishing
   - [ ] Background workers
   - [ ] CLI commands
   - [ ] Custom fields support
   - [ ] **Sensitive / GDPR-relevant fields** (PII, contact info, addresses, free-text notes about people, integration credentials, secrets) — if yes, an `encryption.ts` declaring `defaultEncryptionMaps` is mandatory; see section 11 → Encryption maps

If the developer provides a brief description, infer reasonable defaults and confirm. When key fields include names, emails, phones, addresses, free-text comments, or external API keys, treat the encryption checkbox as `yes` by default and confirm with the user rather than skipping it silently.

---

## 2. Scaffold Structure

Create the directory tree under `src/modules/<module_id>/`:

```
src/modules/<module_id>/
├── index.ts                    # Module metadata + feature exports
├── acl.ts                      # Feature-based permissions
├── setup.ts                    # Tenant init, role features
├── di.ts                       # Awilix DI registrations
├── events.ts                   # Typed event declarations (if needed)
├── encryption.ts               # Tenant data encryption maps (only if entity has sensitive/GDPR fields)
├── data/
│   ├── entities.ts             # MikroORM entity classes
│   └── validators.ts           # Zod validation schemas
├── api/
│   └── <entities>/
│       └── route.ts            # All HTTP methods in one file: GET, POST, PUT, DELETE
└── backend/
    ├── page.tsx                # List page → /backend/<module>
    ├── <entities>/
    │   ├── new.tsx             # Create page → /backend/<module>/<entities>/new
    │   └── [id].tsx            # Edit page → /backend/<module>/<entities>/<id>
```

---

## 3. Create Entity

**File**: `src/modules/<module_id>/data/entities.ts`

### Template

```typescript
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'
import { v4 } from 'uuid'

@Entity({ tableName: '<entities>' })  // plural, snake_case
export class <Entity> {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4()

  @Index()
  @Property({ type: 'uuid' })
  organization_id!: string

  @Index()
  @Property({ type: 'uuid' })
  tenant_id!: string

  // --- Domain fields ---

  @Property({ type: 'varchar', length: 255 })
  name!: string

  // Add domain-specific fields here
  // Use appropriate types: varchar, text, int, float, boolean, uuid, jsonb, date

  // --- Standard columns ---

  @Property({ type: 'boolean', default: true })
  is_active: boolean = true

  @Property({ type: 'timestamptz' })
  created_at: Date = new Date()

  @Property({ type: 'timestamptz', onUpdate: () => new Date() })
  updated_at: Date = new Date()

  @Property({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null = null
}
```

### Entity Rules

- Table name: **plural, snake_case** — matches module ID
- PK: always `uuid` with `v4()` default
- MUST include `organization_id` + `tenant_id` with `@Index()`
- MUST include `created_at`, `updated_at`, `deleted_at`, `is_active`. The `updated_at` column is what OSS **optimistic locking** (default ON) compares — keep it on every user-editable entity, and make your CRUD GET/list responses return `updatedAt` so the UI can send the expected version.
- Entity decorators MUST come from `@mikro-orm/decorators/legacy`
- Cross-module references: store FK as `uuid` field (e.g., `customer_id`) — never use ORM `@ManyToOne`
- Use `@Property({ type: 'jsonb' })` for flexible/nested data
- Use `@Property({ type: 'varchar', length: N })` for bounded strings
- Use `@Property({ type: 'text' })` for unbounded text

---

## 4. Create Validators

**File**: `src/modules/<module_id>/data/validators.ts`

### Template

```typescript
import { z } from 'zod'

export const list<Entity>Schema = z.object({
  search: z.string().optional(),
  id: z.string().uuid().optional(),
})

export const create<Entity>Schema = z.object({
  name: z.string().min(1).max(255),
  // Add domain fields matching entity
})

export const update<Entity>Schema = create<Entity>Schema.partial().extend({
  id: z.string().uuid(),
})

export type List<Entity>Query = z.infer<typeof list<Entity>Schema>
export type Create<Entity>Input = z.infer<typeof create<Entity>Schema>
export type Update<Entity>Input = z.infer<typeof update<Entity>Schema>
```

### Rules

- Derive TypeScript types from zod via `z.infer<typeof schema>` — never duplicate
- Create schema has all required fields; update schema is `.partial()` with required `id`
- Never include `organization_id`, `tenant_id`, `created_at`, `updated_at` — these are system-managed

---

## 5. Create API Routes

Use `makeCrudRoute` for standard CRUD. All HTTP methods live in a single `route.ts` file.

**File**: `src/modules/<module_id>/api/<entities>/route.ts`

```typescript
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { <Entity> } from '../../data/entities'
import {
  list<Entity>Schema,
  create<Entity>Schema,
  update<Entity>Schema,
} from '../../data/validators'

export const metadata = {
  GET:    { requireAuth: true, requireFeatures: ['<module_id>.<entity>.view'] },
  POST:   { requireAuth: true, requireFeatures: ['<module_id>.<entity>.manage'] },
  PUT:    { requireAuth: true, requireFeatures: ['<module_id>.<entity>.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['<module_id>.<entity>.manage'] },
}

const crud = makeCrudRoute({
  metadata,
  orm: {
    entity: <Entity>,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  indexer: { entityType: '<module_id>.<entity>' },
  list: {
    schema: list<Entity>Schema,
    entityId: '<module_id>.<entity>',
    fields: ['id', 'name', 'organization_id', 'tenant_id', 'created_at', 'updated_at'],
  },
  create: { schema: create<Entity>Schema },
  update: { schema: update<Entity>Schema },
  del: {},
})

export const { GET, POST, PUT, DELETE } = crud

export const openApi = {
  summary: '<Entity> CRUD',
  tags: ['<Module Name>'],
}
```

### Rules

- All HTTP methods MUST live in a single `api/<entities>/route.ts` file
- MUST export `metadata` — missing it silently breaks route-level auth guards
- MUST export `openApi` for documentation generation
- MUST use `makeCrudRoute` with `indexer: { entityType }` for query engine coverage
- Use `orm`, `list`, `create`, `update`, `del` keys — `entity`/`entityId`/`operations`/`schema` at root level are not valid

---

## 6. Create Backend Pages

Use `CrudForm` and `DataTable` from `@open-mercato/ui`. See the `om-backend-ui-design` skill for full component reference.

> **Optimistic locking (default ON).** `CrudForm` in edit mode auto-derives the expected-version header from `initialValues.updatedAt` and applies it to **both** save and delete — so pass the loaded record's `updatedAt` into `initialValues`. For custom (non-`CrudForm`) list-row deletes or dialog mutations, wrap the call with `withScopedApiRequestHeaders(buildOptimisticLockHeader(record.updatedAt), () => deleteCrud(...))` and surface the 409 with `surfaceRecordConflict(err, t)` from `@open-mercato/ui/backend/conflicts`. Never leave a mutating edit/delete UI without a version header — concurrent edits would silently overwrite.

### Page Metadata & Sidebar Navigation

**File**: `src/modules/<module_id>/backend/page.meta.ts`

Icons MUST use components from `lucide-react`. Never use inline `React.createElement('svg', ...)` — it breaks after `yarn generate`.

For full field reference, settings pages, and anti-patterns, see [references/navigation-patterns.md](references/navigation-patterns.md).

```tsx
import { Trophy } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['<module_id>.view'],
  pageTitle: '<Module Name>',
  pageTitleKey: '<module_id>.nav.title',
  pageGroup: '<Module Name>',                 // Sidebar section name
  pageGroupKey: '<module_id>.nav.group',      // i18n key — items with same key grouped together
  pageOrder: 100,                             // Sort within group (lower = higher)
  icon: <Trophy className="size-4" />,
  breadcrumb: [{ label: '<Module Name>', labelKey: '<module_id>.nav.title' }],
}
```

### List Page

**File**: `src/modules/<module_id>/backend/page.tsx`

```tsx
'use client'
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type <Entity> = { id: string; name: string; organizationId: string; tenantId: string }

type <Entity>ListResponse = {
  items: <Entity>[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const PAGE_SIZE = 20

export default function <Module>ListPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<<Entity>[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)

  const columns = React.useMemo<ColumnDef<<Entity>>[]>(() => [
    { accessorKey: 'name', header: t('<module_id>.list.columns.name') },
  ], [t])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', String(PAGE_SIZE))
        const fallback: <Entity>ListResponse = { items: [], total: 0, page, pageSize: PAGE_SIZE, totalPages: 1 }
        const call = await apiCall<<Entity>ListResponse>(
          `/api/<module_id>/<entities>?${params.toString()}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          flash(t('<module_id>.list.error.loadFailed'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          setRows(Array.isArray(payload.items) ? payload.items : [])
          setTotal(payload.total || 0)
          setTotalPages(payload.totalPages || 1)
        }
      } catch (err) {
        if (!cancelled) {
          flash(err instanceof Error ? err.message : t('<module_id>.list.error.loadFailed'), 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, scopeVersion, t])

  return (
    <Page>
      <PageBody>
        <DataTable<<Entity>>
          title={t('<module_id>.list.title')}
          columns={columns}
          data={rows}
          isLoading={isLoading}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
        />
      </PageBody>
    </Page>
  )
}

export const metadata = {
  requireAuth: true,
  requireFeatures: ['<module_id>.<entity>.view'],
  pageTitle: '<Module Name>',
  pageTitleKey: '<module_id>.nav.title',
  pageGroup: '<Module Name>',
  pageGroupKey: '<module_id>.nav.group',
  pageOrder: 100,
}
```

### Create Page

**File**: `src/modules/<module_id>/backend/<entities>/new.tsx`

```tsx
'use client'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type <Entity> = { id: string; name: string }

export default function Create<Entity>Page() {
  const t = useT()
  const router = useRouter()

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('<module_id>.create.title')}
          backHref="/backend/<module_id>"
          fields={[
            { id: 'name', label: t('<module_id>.fields.name'), type: 'text', required: true },
          ]}
          onSubmit={async (values) => {
            const { result } = await createCrud<<Entity>>('<module_id>/<entities>', values)
            router.push(`/backend/<module_id>/<entities>/${result.id}`)
          }}
        />
      </PageBody>
    </Page>
  )
}

export const metadata = {
  requireAuth: true,
  requireFeatures: ['<module_id>.<entity>.manage'],
  pageTitle: 'Create <Entity>',
  pageTitleKey: '<module_id>.create.title',
  pageGroup: '<Module Name>',
  pageGroupKey: '<module_id>.nav.group',
  navHidden: true,
}
```

### Edit Page

**File**: `src/modules/<module_id>/backend/<entities>/[id].tsx`

```tsx
'use client'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type <Entity> = { id: string; name: string }
type <Entity>DetailResponse = { items: <Entity>[]; total: number; page: number; pageSize: number; totalPages: number }

export default function Edit<Entity>Page({ params }: { params: { id: string } }) {
  const t = useT()
  const router = useRouter()
  const { data: response, isLoading } = useQuery({
    queryKey: ['<module_id>', '<entities>', params.id],
    queryFn: () => apiCall<<Entity>DetailResponse>(`<module_id>/<entities>?id=${params.id}`),
  })

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('<module_id>.edit.title')}
          backHref="/backend/<module_id>"
          fields={[
            { id: 'name', label: t('<module_id>.fields.name'), type: 'text', required: true },
          ]}
          isLoading={isLoading}
          initialValues={response?.items?.[0] ?? undefined}
          onSubmit={async (values) => {
            await updateCrud('<module_id>/<entities>', { id: params.id, ...values })
            router.push('/backend/<module_id>')
          }}
          onDelete={async () => {
            await deleteCrud('<module_id>/<entities>', params.id)
            router.push('/backend/<module_id>')
          }}
        />
      </PageBody>
    </Page>
  )
}

export const metadata = {
  requireAuth: true,
  requireFeatures: ['<module_id>.<entity>.manage'],
  pageTitle: 'Edit <Entity>',
  pageTitleKey: '<module_id>.edit.title',
  pageGroup: '<Module Name>',
  pageGroupKey: '<module_id>.nav.group',
  navHidden: true,
}
```

---

## 7. Add Module Metadata

**File**: `src/modules/<module_id>/index.ts`

```typescript
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: '<module_id>',
  title: '<Module Name>',
  version: '0.1.0',
  description: '<What this module does>',
}

export { features } from './acl'
```

---

## 8. Add ACL & Setup

### ACL Features

**File**: `src/modules/<module_id>/acl.ts`

```typescript
export const features = [
  { id: '<module_id>.<entity>.view',   title: 'View <entities>',   module: '<module_id>' },
  { id: '<module_id>.<entity>.manage', title: 'Manage <entities>', module: '<module_id>' },
]

export default features
```

### Setup (Tenant Init + Default Roles)

**File**: `src/modules/<module_id>/setup.ts`

```typescript
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['<module_id>.<entity>.view', '<module_id>.<entity>.manage'],
    admin:      ['<module_id>.<entity>.view', '<module_id>.<entity>.manage'],
    user:       ['<module_id>.<entity>.view'],
  },
}

export default setup
```

### Rules

- Feature IDs follow `<module_id>.<entity>.<action>` (view / manage per entity, not global create/update/delete)
- Add `export default features` — the generator reads `.default ?? .features` with an empty fallback, so the named export alone works, but adding the default export ensures both import styles resolve cleanly
- MUST declare `defaultRoleFeatures` for every feature in `acl.ts`
- Feature IDs are FROZEN once deployed — cannot rename without data migration
- After adding features run `yarn mercato auth sync-role-acls` so existing tenants receive the grants

---

## 9. Add DI Registration

**File**: `src/modules/<module_id>/di.ts`

```typescript
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

export function register(container: AppContainer): void {
  // Register module services here using Awilix
  // Example:
  // import { asFunction } from 'awilix'
  // container.register({
  //   <module_id>Service: asFunction(createService).scoped(),
  // })
}
```

---

## 10. Add Events

**File**: `src/modules/<module_id>/events.ts`

```typescript
import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: '<module_id>.<entity>.created', label: '<Entity> Created', entity: '<entity>', category: 'crud' as const },
  { id: '<module_id>.<entity>.updated', label: '<Entity> Updated', entity: '<entity>', category: 'crud' as const },
  { id: '<module_id>.<entity>.deleted', label: '<Entity> Deleted', entity: '<entity>', category: 'crud' as const },
] as const

export const eventsConfig = createModuleEvents({ moduleId: '<module_id>', events })
export const emit<Module>Event = eventsConfig.emit
export type <Module>EventId = typeof events[number]['id']
export default eventsConfig
```

### Event Rules

- `createModuleEvents` takes `{ moduleId, events }` — NOT a flat keyed object. Using the old keyed-object shape crashes `/login` at startup because the generated events registry cannot read the module
- Event IDs: `module.entity.action` (singular entity, past tense action, dots as separators)
- Declare `label`, `entity`, and `category` on each event — they populate the workflow trigger UI
- Add `clientBroadcast: true` to an event definition to bridge it to the browser via SSE
- Event ID contracts are FROZEN once deployed — adding new events is safe; renaming or removing is a breaking change

---

## 11. Optional Features

### Search Configuration

**File**: `src/modules/<module_id>/search.ts`

```typescript
import type { SearchModuleConfig } from '@open-mercato/shared/modules/search'

export const searchConfig: SearchModuleConfig = {
  entities: {
    '<module_id>.<entity>': {
      fields: ['name'],  // Fields to index for fulltext search
      // Additional search config as needed
    },
  },
}
```

### Translations

**File**: `src/modules/<module_id>/translations.ts`

```typescript
export const translatableFields = {
  '<entity>': ['name', 'description'],  // Fields that support i18n
}
```

### CLI Commands

**File**: `src/modules/<module_id>/cli.ts`

```typescript
export default function registerCli(program: any) {
  program
    .command('<module_id>:seed')
    .description('Seed sample <entities>')
    .action(async () => {
      // Implementation
    })
}
```

### Response Enrichers

Use enrichers to add computed fields to another module's API responses without coupling the modules.

**File**: `src/modules/<module_id>/data/enrichers.ts`

```typescript
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'

const <entity>Enricher: ResponseEnricher = {
  id: '<module_id>.<entity>-enricher',
  targetEntity: '<other_module>.<entity>',
  features: ['<module_id>.<entity>.view'],
  timeout: 2000,
  fallback: { _<module_id>: {} },
  async enrichOne(record, context) {
    return { ...record, _<module_id>: { /* computed fields */ } }
  },
  async enrichMany(records, context) {
    return records.map(r => ({ ...r, _<module_id>: { /* computed fields */ } }))
  },
}

export const enrichers: ResponseEnricher[] = [<entity>Enricher]
```

**Rules:**
- MUST implement `enrichOne` (required by the `ResponseEnricher` interface)
- MUST implement `enrichMany` for list endpoints to prevent N+1 queries
- Namespace enriched fields with `_<module_id>` prefix
- The target route must opt in: `makeCrudRoute({ ..., enrichers: { entityId: '<other_module>.<entity>' } })`
- Run `yarn generate` after adding `data/enrichers.ts`

---

### Encryption maps (sensitive / GDPR-relevant fields)

**Mandatory** when the entity stores PII, contact info, addresses, free-text notes about people, integration credentials, secrets, or anything subject to a data-processing agreement. Do NOT hand-roll AES, KMS calls, or "TODO encrypt later" stubs — the framework provides per-tenant DEKs and a declarative field-level map.

**File**: `src/modules/<module_id>/encryption.ts`

```typescript
import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: '<module_id>:<entity>',  // matches data/entities.ts table id, colon-separated
    fields: [
      { field: 'first_name' },
      { field: 'last_name' },
      { field: 'phone' },
      // Add a hashField for deterministic equality lookups (e.g. login by email):
      { field: 'email', hashField: 'email_hash' },
    ],
  },
]

export default defaultEncryptionMaps
```

**Read paths** — never `em.find` an encrypted column directly:

```typescript
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

// Signature: (em, entityName, where, options?, scope?) — MikroORM FindOptions in slot 4
// (pass `undefined` when none), decryption scope in slot 5.
const records = await findWithDecryption(em, '<Entity>', filter, undefined, { tenantId, organizationId })
const single  = await findOneWithDecryption(em, '<Entity>', { id }, undefined, { tenantId, organizationId })
```

**Apply to existing tenants** after declaring or updating maps:

```bash
yarn mercato entities seed-encryption --tenant <tenantId> [--organization <orgId>]
```

New tenants pick up `defaultEncryptionMaps` automatically during `auth:setup`. Toggling the **Encrypted** flag for a field only applies to data written **after** the change — historical plaintext rows stay as they were until backfilled via `yarn mercato entities rotate-encryption-key --tenant <tenantId> --org <organizationId>` (without `--old-key` the command only encrypts plaintext and skips already-encrypted fields). Use `yarn mercato entities decrypt-database` to roll back. For end-to-end usage and admin UI flows see <https://docs.open-mercato.dev/user-guide/encryption>.

> Tip: when `email` (or any other column) needs deterministic lookups while encrypted, declare a sibling `hashField` in the map and add a matching `varchar` column to the entity. The framework keeps the hash in sync on writes; queries can target the hash instead of the cleartext column.

---

## 12. Wire & Verify

### Step 1: Register in modules.ts

Add to `src/modules.ts`:

```typescript
{ id: '<module_id>', from: '@app' },
```

### Step 2: Run Generators

```bash
yarn generate          # Discover module files, update .mercato/generated/
yarn db:generate       # Probe/create migration for the new entity
```

### Step 3: Review Migration

Check the generated migration file in `src/modules/<module_id>/migrations/`. Verify:
- Table name is correct (plural, snake_case)
- All columns present with correct types
- Indexes on `organization_id`, `tenant_id`
- No unexpected changes
- `migrations/.snapshot-open-mercato.json` was updated to the post-change schema
- Unrelated generated migrations were deleted from the diff

### Step 4: Apply & Test

```bash
yarn db:migrate        # Apply migration only after explicit user confirmation
yarn dev               # Start dev server
```

### Step 5: Run Post-Scaffold Validation Gate

After every structural module change, run **in order** before committing:

```bash
# 1. Re-emit generated registries with the new module
yarn generate

# 2. Purge stale structural cache (nav, module-graph fingerprints)
yarn mercato configs cache structural --all-tenants

# 3. Grant ACL features declared in acl.ts to existing roles
yarn mercato auth sync-role-acls

# 4. Type-check all files — catches API mismatches before they reach runtime
yarn typecheck
```

> **Why this matters**: A malformed `events.ts` (for example, using the old keyed-object shape for `createModuleEvents`) will crash `/login` and every other page because generated registries import all active module files at startup. A bad scaffold can make the whole admin inaccessible. Running `yarn typecheck` after `yarn generate` catches this before it ships.

### Step 6: Verify

- [ ] Module appears in admin sidebar (if menu item added)
- [ ] List page loads at `/backend/<module_id>`
- [ ] Create form works at `/backend/<module_id>/<entities>/new`
- [ ] Edit form loads existing record
- [ ] Delete works from list page
- [ ] ACL features appear in role management
- [ ] `/login` still loads after structural changes

### Self-Review Checklist

- [ ] Module ID is plural, snake_case
- [ ] Entity class has `organization_id`, `tenant_id`, standard columns
- [ ] Validators use zod with `z.infer` for types
- [ ] API routes live in `api/<entities>/route.ts` (not `api/get/`, `api/post/`, etc.)
- [ ] `makeCrudRoute` uses `{ metadata, orm, list, create, update, del }` — not `{ entity, entityId, operations, schema }`
- [ ] API route exports `metadata`, named `{ GET, POST, PUT, DELETE }`, and `openApi`
- [ ] `DataTable` receives explicit `data`, `isLoading`, `error`, `pagination` — not `apiPath` or `createHref`
- [ ] `CrudForm` uses `onSubmit` with `createCrud`/`updateCrud` and `onDelete` with `deleteCrud` — not `apiPath`, `mode`, or `resourceId`
- [ ] `events.ts` uses `createModuleEvents({ moduleId, events: [...] })` array shape — not a keyed object
- [ ] `events.ts` has `export default eventsConfig`
- [ ] `acl.ts` exports `features` (named export is sufficient; default export is recommended for broad import compatibility)
- [ ] ACL feature IDs use `<module>.<entity>.view` / `<module>.<entity>.manage` pattern
- [ ] `setup.ts` grants every feature in `acl.ts` to at least `admin` and `superadmin`
- [ ] Sidebar icon uses `lucide-react` component (not inline SVG / `React.createElement`)
- [ ] `page.meta.ts` includes `pageGroup` + `pageGroupKey` for sidebar grouping
- [ ] `page.meta.ts` includes `pageOrder` for sort position
- [ ] All related pages share the same `pageGroupKey`
- [ ] Settings pages (if any) have `pageContext: 'settings' as const` and `navHidden: true`
- [ ] Module registered in `src/modules.ts` with `from: '@app'`
- [ ] Post-scaffold gate run: `yarn generate` → `yarn mercato configs cache structural --all-tenants` → `yarn mercato auth sync-role-acls` → `yarn typecheck`
- [ ] Migration SQL is scoped to this entity and `.snapshot-open-mercato.json` is updated
- [ ] No `any` types
- [ ] No hardcoded user-facing strings
- [ ] No direct ORM relationships to other modules
- [ ] `/login` still loads after all changes

---

## Rules

- **MUST** use plural, snake_case for module ID and folder name
- **MUST** include `organization_id` and `tenant_id` on all tenant-scoped entities
- **MUST** include standard columns (`id`, `created_at`, `updated_at`, `deleted_at`, `is_active`)
- **MUST** validate all inputs with zod schemas in `data/validators.ts`
- **MUST** place all HTTP method handlers in a single `api/<entities>/route.ts` — not separate `api/get/`, `api/post/` files
- **MUST** use `makeCrudRoute` with `{ metadata, orm, list, create, update, del }` — not `{ entity, entityId, operations, schema }`
- **MUST** export `metadata`, named method handlers `{ GET, POST, PUT, DELETE }`, and `openApi` from every route file
- **MUST** use `CrudForm` with explicit `onSubmit` / `onDelete` handlers — not `apiPath`, `mode`, or `resourceId` props
- **MUST** use `DataTable` with explicit `data`, `isLoading`, `error`, `pagination` — not `apiPath`, `createHref`, or `extensionTableId`
- **MUST** use `createModuleEvents({ moduleId, events: [...] })` array shape — NEVER the old keyed-object `{ 'id': { description, payload } }` shape
- **MUST** add `export default eventsConfig` in `events.ts`
- **MUST** export `features` from `acl.ts` (named export is sufficient; adding `export default features` is recommended for broad import compatibility)
- **MUST** use `<module>.<entity>.view` / `<module>.<entity>.manage` feature ID pattern
- **MUST** include `pageGroup` and `pageGroupKey` on list/root backend pages for sidebar grouping
- **MUST** use `as const` on `pageContext` values (e.g., `pageContext: 'settings' as const`)
- **MUST** declare ACL features and wire them in `setup.ts` `defaultRoleFeatures`
- **MUST** register module in `src/modules.ts` with `from: '@app'`
- **MUST** run the post-scaffold validation gate after creating module files: `yarn generate` → `yarn mercato configs cache structural --all-tenants` → `yarn mercato auth sync-role-acls` → `yarn typecheck`
- **MUST** verify `/login` still loads after every structural change
- **MUST** create or keep a scoped migration after creating/modifying entities and update `.snapshot-open-mercato.json`
- **MUST NOT** commit unrelated migrations emitted by `yarn db:generate`
- **MUST NOT** run `yarn db:migrate` without explicit user confirmation
- **MUST NOT** create ORM relationships (`@ManyToOne`, `@OneToMany`) to entities in other modules
- **MUST NOT** edit `.mercato/generated/*` files manually
- **MUST** declare `<module>/encryption.ts` exporting `defaultEncryptionMaps` whenever the entity stores sensitive / GDPR-relevant fields (PII, contact info, addresses, free-text notes about people, integration credentials, secrets) — and read those columns via `findWithDecryption` / `findOneWithDecryption`
- **MUST NOT** hand-roll AES/KMS calls or store "we'll encrypt this later" plaintext for sensitive columns — use the encryption-maps mechanism described in section 11 → Encryption maps
