---
name: module-scaffold
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

If the developer provides a brief description, infer reasonable defaults and confirm.

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
├── entities/
│   └── <Entity>.ts             # MikroORM entity class
├── data/
│   └── validators.ts           # Zod validation schemas
├── api/
│   ├── get/
│   │   └── <entities>.ts       # GET /api/<module>/<entities> (list + detail)
│   ├── post/
│   │   └── <entities>.ts       # POST /api/<module>/<entities>
│   ├── put/
│   │   └── <entities>.ts       # PUT /api/<module>/<entities>
│   └── delete/
│       └── <entities>.ts       # DELETE /api/<module>/<entities>
└── backend/
    ├── page.tsx                # List page → /backend/<module>
    ├── <entities>/
    │   ├── new.tsx             # Create page → /backend/<module>/<entities>/new
    │   └── [id].tsx            # Edit page → /backend/<module>/<entities>/<id>
```

---

## 3. Create Entity

**File**: `src/modules/<module_id>/entities/<Entity>.ts`

### Template

```typescript
import { Entity, Property, PrimaryKey, Index } from '@mikro-orm/core'
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
- MUST include `created_at`, `updated_at`, `deleted_at`, `is_active`
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

export const create<Entity>Schema = z.object({
  name: z.string().min(1).max(255),
  // Add domain fields matching entity
})

export const update<Entity>Schema = create<Entity>Schema.partial().extend({
  id: z.string().uuid(),
})

export type Create<Entity>Input = z.infer<typeof create<Entity>Schema>
export type Update<Entity>Input = z.infer<typeof update<Entity>Schema>
```

### Rules

- Derive TypeScript types from zod via `z.infer<typeof schema>` — never duplicate
- Create schema has all required fields; update schema is `.partial()` with required `id`
- Never include `organization_id`, `tenant_id`, `created_at`, `updated_at` — these are system-managed

---

## 5. Create API Routes

Use `makeCrudRoute` for standard CRUD. Each HTTP method lives in its own file.

### GET Route

**File**: `src/modules/<module_id>/api/get/<entities>.ts`

```typescript
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/make-crud-route'
import { <Entity> } from '../../entities/<Entity>'

const handler = makeCrudRoute({
  entity: <Entity>,
  entityId: '<module_id>.<entity>',
  operations: ['list', 'detail'],
  indexer: { entityType: '<module_id>.<entity>' },
})

export default handler

export const openApi = {
  summary: 'List and retrieve <entities>',
  tags: ['<Module Name>'],
}
```

### POST Route

**File**: `src/modules/<module_id>/api/post/<entities>.ts`

```typescript
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/make-crud-route'
import { <Entity> } from '../../entities/<Entity>'
import { create<Entity>Schema } from '../../data/validators'

const handler = makeCrudRoute({
  entity: <Entity>,
  entityId: '<module_id>.<entity>',
  operations: ['create'],
  schema: create<Entity>Schema,
})

export default handler

export const openApi = {
  summary: 'Create a <entity>',
  tags: ['<Module Name>'],
}
```

### PUT Route

**File**: `src/modules/<module_id>/api/put/<entities>.ts`

```typescript
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/make-crud-route'
import { <Entity> } from '../../entities/<Entity>'
import { update<Entity>Schema } from '../../data/validators'

const handler = makeCrudRoute({
  entity: <Entity>,
  entityId: '<module_id>.<entity>',
  operations: ['update'],
  schema: update<Entity>Schema,
})

export default handler

export const openApi = {
  summary: 'Update a <entity>',
  tags: ['<Module Name>'],
}
```

### DELETE Route

**File**: `src/modules/<module_id>/api/delete/<entities>.ts`

```typescript
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/make-crud-route'
import { <Entity> } from '../../entities/<Entity>'

const handler = makeCrudRoute({
  entity: <Entity>,
  entityId: '<module_id>.<entity>',
  operations: ['delete'],
})

export default handler

export const openApi = {
  summary: 'Delete a <entity>',
  tags: ['<Module Name>'],
}
```

### Rules

- Every API route MUST export `openApi` for documentation generation
- Use `makeCrudRoute` with `indexer: { entityType }` for query engine coverage
- Schema validation is automatic when `schema` is provided
- Auth guards are applied automatically by the framework

---

## 6. Create Backend Pages

Use `CrudForm` and `DataTable` from `@open-mercato/ui`. See the `backend-ui-design` skill for full component reference.

### List Page

**File**: `src/modules/<module_id>/backend/page.tsx`

```tsx
'use client'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function <Module>ListPage() {
  const t = useT()

  return (
    <DataTable
      entityId="<module_id>.<entity>"
      apiPath="<module_id>/<entities>"
      title={t('<module_id>.list.title')}
      createHref="/backend/<module_id>/<entities>/new"
      columns={[
        { id: 'name', header: t('<module_id>.fields.name'), accessorKey: 'name' },
        // Add more columns
      ]}
    />
  )
}

export const metadata = {
  title: '<Module Name>',
  requireAuth: true,
  features: ['<module_id>.view'],
}
```

### Create Page

**File**: `src/modules/<module_id>/backend/<entities>/new.tsx`

```tsx
'use client'
import { CrudForm } from '@open-mercato/ui/backend/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function Create<Entity>Page() {
  const t = useT()

  return (
    <CrudForm
      entityId="<module_id>.<entity>"
      apiPath="<module_id>/<entities>"
      mode="create"
      title={t('<module_id>.create.title')}
      fields={[
        { id: 'name', label: t('<module_id>.fields.name'), type: 'text', required: true },
        // Add more fields
      ]}
      backHref="/backend/<module_id>"
    />
  )
}

export const metadata = {
  title: 'Create <Entity>',
  requireAuth: true,
  features: ['<module_id>.create'],
}
```

### Edit Page

**File**: `src/modules/<module_id>/backend/<entities>/[id].tsx`

```tsx
'use client'
import { CrudForm } from '@open-mercato/ui/backend/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function Edit<Entity>Page({ params }: { params: { id: string } }) {
  const t = useT()

  return (
    <CrudForm
      entityId="<module_id>.<entity>"
      apiPath="<module_id>/<entities>"
      mode="edit"
      resourceId={params.id}
      title={t('<module_id>.edit.title')}
      fields={[
        { id: 'name', label: t('<module_id>.fields.name'), type: 'text', required: true },
        // Add more fields
      ]}
      backHref="/backend/<module_id>"
    />
  )
}

export const metadata = {
  title: 'Edit <Entity>',
  requireAuth: true,
  features: ['<module_id>.update'],
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
  { id: '<module_id>.view', title: 'View <entities>', module: '<module_id>' },
  { id: '<module_id>.create', title: 'Create <entities>', module: '<module_id>' },
  { id: '<module_id>.update', title: 'Update <entities>', module: '<module_id>' },
  { id: '<module_id>.delete', title: 'Delete <entities>', module: '<module_id>' },
]
```

### Setup (Tenant Init + Default Roles)

**File**: `src/modules/<module_id>/setup.ts`

```typescript
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['<module_id>.view', '<module_id>.create', '<module_id>.update', '<module_id>.delete'],
    admin: ['<module_id>.view', '<module_id>.create', '<module_id>.update', '<module_id>.delete'],
    user: ['<module_id>.view'],
  },
}

export default setup
```

### Rules

- Feature IDs follow `<module_id>.<action>` pattern
- MUST declare `defaultRoleFeatures` for every feature in `acl.ts`
- Feature IDs are FROZEN once deployed — cannot rename without data migration

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

export const eventsConfig = createModuleEvents({
  '<module_id>.<entity>.created': {
    description: '<Entity> was created',
    payload: { resourceId: 'string', name: 'string' },
  },
  '<module_id>.<entity>.updated': {
    description: '<Entity> was updated',
    payload: { resourceId: 'string' },
  },
  '<module_id>.<entity>.deleted': {
    description: '<Entity> was deleted',
    payload: { resourceId: 'string' },
  },
} as const)
```

### Event Rules

- Event IDs: `module.entity.action` (singular entity, past tense action)
- Use dots as separators
- Payload fields are additive-only (FROZEN contract)
- Add `clientBroadcast: true` to bridge events to browser via SSE

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
yarn db:generate       # Create migration for new entity
```

### Step 3: Review Migration

Check the generated migration file in `src/modules/<module_id>/migrations/`. Verify:
- Table name is correct (plural, snake_case)
- All columns present with correct types
- Indexes on `organization_id`, `tenant_id`
- No unexpected changes

### Step 4: Apply & Test

```bash
yarn db:migrate        # Apply migration (confirm with user first)
yarn dev               # Start dev server
```

### Step 5: Verify

- [ ] Module appears in admin sidebar (if menu item added)
- [ ] List page loads at `/backend/<module_id>`
- [ ] Create form works at `/backend/<module_id>/<entities>/new`
- [ ] Edit form loads existing record
- [ ] Delete works from list page
- [ ] ACL features appear in role management

### Self-Review Checklist

- [ ] Module ID is plural, snake_case
- [ ] Entity class has `organization_id`, `tenant_id`, standard columns
- [ ] Validators use zod with `z.infer` for types
- [ ] All API routes export `openApi`
- [ ] Backend pages use `CrudForm` and `DataTable`
- [ ] ACL features declared and wired in `setup.ts`
- [ ] Module registered in `src/modules.ts` with `from: '@app'`
- [ ] `yarn generate` run after creating files
- [ ] `yarn db:generate` run after creating entity
- [ ] No `any` types
- [ ] No hardcoded user-facing strings
- [ ] No direct ORM relationships to other modules

---

## Rules

- **MUST** use plural, snake_case for module ID and folder name
- **MUST** include `organization_id` and `tenant_id` on all tenant-scoped entities
- **MUST** include standard columns (`id`, `created_at`, `updated_at`, `deleted_at`, `is_active`)
- **MUST** validate all inputs with zod schemas in `data/validators.ts`
- **MUST** export `openApi` from every API route
- **MUST** use `CrudForm` for forms and `DataTable` for tables
- **MUST** declare ACL features and wire them in `setup.ts` `defaultRoleFeatures`
- **MUST** register module in `src/modules.ts` with `from: '@app'`
- **MUST** run `yarn generate` after creating module files
- **MUST** run `yarn db:generate` after creating/modifying entities
- **MUST NOT** create ORM relationships (`@ManyToOne`, `@OneToMany`) to entities in other modules
- **MUST NOT** edit `.mercato/generated/*` files manually
