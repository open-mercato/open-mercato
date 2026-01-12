# Generated Files System

This document explains how the code generation system works in Open Mercato, including what files are generated, how they are created, and how they are consumed.

## Table of Contents

- [Overview](#overview)
- [Generated Files Location](#generated-files-location)
- [Module Configuration](#module-configuration)
- [Module Resolution](#module-resolution)
- [Generation Execution Order](#generation-execution-order)
- [Generator Details](#generator-details)
  - [generate-entity-ids.ts](#generate-entity-idsts)
  - [generate-module-registry.ts](#generate-module-registryts)
  - [generate-module-entities.ts](#generate-module-entitiests)
  - [generate-module-di.ts](#generate-module-dits)
- [Change Detection](#change-detection)
- [Cross-Package Generation Behavior](#cross-package-generation-behavior)
- [Import Patterns](#import-patterns)
- [Package Consumption Map](#package-consumption-map)
- [NPM Scripts](#npm-scripts)
- [Key Patterns](#key-patterns)

---

## Overview

The generation system automatically discovers and aggregates module components (routes, APIs, entities, translations, widgets, etc.) from a standardized directory structure. This enables:

- **Auto-discovery**: No manual registration of routes, APIs, or components
- **App overrides**: Local customizations take precedence over package defaults
- **Type safety**: Generated TypeScript constants for entity IDs and module references
- **Code splitting**: Lazy loading of widgets and components
- **Change detection**: Only regenerates when source files change

---

## Generated Files Location

| Location | File | Purpose |
|----------|------|---------|
| `/generated/` | `modules.generated.ts` | Master module registry (routes, APIs, pages, features) |
| `/generated/` | `entities.generated.ts` | All MikroORM entity classes |
| `/generated/` | `entities.ids.generated.ts` | Type-safe entity ID constants (`M`, `E`) |
| `/generated/` | `di.generated.ts` | DI registrar functions |
| `/generated/` | `dashboard-widgets.generated.ts` | Dashboard widget entries |
| `/generated/` | `injection-widgets.generated.ts` | Injection widget entries |
| `/generated/` | `injection-tables.generated.ts` | Injection table configurations |
| `/generated/` | `vector.generated.ts` | Vector search module configurations |
| `/generated/` | `entity-fields-registry.ts` | Static entity field registry (Turbopack compatible) |
| `/generated/entities/<entity>/` | `index.ts`, `<field>.ts` | Per-entity field exports |
| `/packages/*/generated/` | `entities.ids.generated.ts` | Per-package entity IDs |
| `/packages/ui/src/backend/fields/` | `registry.generated.ts` | Field component registry |
| `/packages/client/src/generated/` | `openapi.types.ts` | OpenAPI TypeScript types |

### Checksum Files

Each generated file has a corresponding `*.generated.checksum` file that stores MD5 hashes for change detection.

---

## Module Configuration

The generation system starts from **`src/modules.ts`** - the source of truth for enabled modules:

```typescript
// src/modules.ts
export type ModuleEntry = {
  id: string
  from?: '@open-mercato/core' | '@open-mercato/example' | '@app' | string
}

export const enabledModules: ModuleEntry[] = [
  { id: 'dashboards', from: '@open-mercato/core' },
  { id: 'auth', from: '@open-mercato/core' },
  { id: 'customers', from: '@open-mercato/core' },
  { id: 'example', from: '@open-mercato/example' },
  // ...
]
```

Each entry specifies:
- **`id`**: Module identifier (snake_case, plural; special cases: `auth`, `example`)
- **`from`**: Source package (`@open-mercato/core`, `@open-mercato/example`, `@app`, or custom)

---

## Module Resolution

The shared configuration (`scripts/shared/modules-config.ts`) provides three key functions used by all generators:

### `loadEnabledModules()`

```
1. Check if src/modules.ts exists
2. If yes → require() it and return enabledModules array
3. If no → fallback: scan src/modules/* directories and treat as @app modules
```

### `moduleFsRoots(entry)`

Returns filesystem paths for both locations:

```typescript
{
  appBase: 'src/modules/<id>',                    // App override location
  pkgBase: 'packages/<pkg>/src/modules/<id>'      // Package location
}
```

### `moduleImportBase(entry)`

Returns import aliases for generated code:

```typescript
{
  appBase: '@/modules/<id>',                      // App import alias
  pkgBase: '@open-mercato/<pkg>/modules/<id>'     // Package import alias
}
```

---

## Generation Execution Order

When you run `npm run modules:prepare`, the following scripts execute in sequence:

```
1. generate-entity-ids.ts      → entities.ids.generated.ts + field files
2. generate-module-registry.ts → modules.generated.ts + widgets + vector
3. generate-module-entities.ts → entities.generated.ts
4. generate-module-di.ts       → di.generated.ts
5. generate-api-client.ts      → openapi.types.ts
```

---

## Generator Details

### generate-entity-ids.ts

**Purpose:** Create type-safe entity ID constants and field mappings

**Location:** `scripts/generate-entity-ids.ts`

**Scanning Process:**

```
For each enabled module:
  1. Check entity file locations (in priority order):
     - src/modules/<id>/data/entities.override.ts  (app override)
     - src/modules/<id>/data/entities.ts           (app)
     - packages/<pkg>/src/modules/<id>/data/entities.ts
     - packages/<pkg>/src/modules/<id>/db/schema.ts

  2. Dynamic import the entities file

  3. Extract exported class names (functions)

  4. Convert class names to snake_case IDs:
     CustomerDeal → customer_deal

  5. Parse TypeScript AST to extract field names:
     - Read @Property/@ManyToOne decorators
     - Extract field name overrides from decorator arguments
     - Convert property names to snake_case
```

**Output Files:**

1. **`generated/entities.ids.generated.ts`** (consolidated):
```typescript
export const M = {
  "dashboards": "dashboards",
  "auth": "auth",
  "customers": "customers"
} as const

export const E = {
  "customers": {
    "customer": "customers:customer",
    "customer_deal": "customers:customer_deal"
  },
  "auth": {
    "user": "auth:user",
    "role": "auth:role"
  }
} as const

export type KnownModuleId = keyof typeof M
export type KnownEntities = typeof E
```

2. **`packages/<pkg>/generated/entities.ids.generated.ts`** (per-package):
   - Same structure but only includes entities from that package

3. **`generated/entities/<entity>/index.ts`** (per-entity fields):
```typescript
export const id = 'id'
export const name = 'name'
export const created_at = 'created_at'
```

4. **`generated/entities/<entity>/<field>.ts`** (individual field exports):
```typescript
export default 'id'
```

5. **`generated/entity-fields-registry.ts`** (static lookup):
```typescript
import * as customer from './entities/customer'
import * as user from './entities/user'

export const entityFieldsRegistry: Record<string, Record<string, string>> = {
  customer,
  user
}

export function getEntityFields(slug: string): Record<string, string> | undefined {
  return entityFieldsRegistry[slug]
}
```

---

### generate-module-registry.ts

**Purpose:** Master registry of all routes, APIs, pages, features, widgets, translations, and subscribers

**Location:** `scripts/generate-module-registry.ts`

**Scanning Process Per Module:**

#### 1. Module Metadata (`index.ts`)
```
- Check: src/modules/<id>/index.ts OR packages/<pkg>/src/modules/<id>/index.ts
- Extract: metadata.requires for dependency validation
- Generate: import * as I0_auth from '@open-mercato/core/modules/auth/index'
```

#### 2. Frontend Pages (`frontend/**/*.tsx`)
```
- Walk: src/modules/<id>/frontend/ + packages/<pkg>/src/modules/<id>/frontend/
- Find: page.tsx files OR direct *.tsx files
- Check metadata sources (in order):
  1. page.meta.ts (colocated)
  2. meta.ts (folder-level)
  3. export const metadata from page file
- Sort: Static routes before dynamic ([id]) routes
- Pattern: frontend/users/page.tsx → route "/users"
```

#### 3. Backend Pages (`backend/**/*.tsx`)
```
- Same walk pattern as frontend
- Pattern: backend/users/page.tsx → route "/backend/users"
- Special: backend/page.tsx → route "/backend/<moduleId>"
```

#### 4. APIs (`api/**/*.ts`)
Three patterns supported:

a) **Route aggregations** (`api/users/route.ts`):
   - Exports multiple handlers: `export { GET, POST, PUT, DELETE }`
   - Pattern: `api/users/route.ts` → `/api/<moduleId>/users`

b) **Direct files** (`api/users.ts`):
   - Single handler file
   - Pattern: `api/status.ts` → `/api/<moduleId>/status`

c) **Legacy per-method** (`api/get/users.ts`, `api/post/users.ts`):
   - Separate file per HTTP method
   - Pattern: `api/get/users.ts` → GET `/api/<moduleId>/users`

#### 5. CLI (`cli.ts`)
```
- Check: src/modules/<id>/cli.ts OR packages/<pkg>/src/modules/<id>/cli.ts
- Generate: import CLI_auth from '@open-mercato/core/modules/auth/cli'
```

#### 6. Translations (`i18n/*.json`)
```
- Merge: Package translations + App overrides
- App overrides win for duplicate keys
- Pattern: i18n/en.json → { 'en': { ...pkgTranslations, ...appOverrides } }
```

#### 7. Subscribers (`subscribers/*.ts`)
```
- Walk: src/modules/<id>/subscribers/ + packages/<pkg>/src/modules/<id>/subscribers/
- Extract from each file:
  - default export: handler function
  - metadata.event: event name to subscribe to
  - metadata.persistent: whether subscription persists
  - metadata.id: optional custom subscriber ID
- Generate: { id: 'auth:user-created', event: 'user.created', handler: fn }
```

#### 8. Entity Extensions (`data/extensions.ts`)
```
- Check: src/modules/<id>/data/extensions.ts OR packages/<pkg>/src/modules/<id>/data/extensions.ts
- Import and include as entityExtensions in module entry
```

#### 9. Features/ACL (`acl.ts`)
```
- Check: src/modules/<id>/acl.ts OR packages/<pkg>/src/modules/<id>/acl.ts
- Extract: features array for RBAC
- Example: ['users.view', 'users.create', 'users.edit', 'users.delete']
```

#### 10. Custom Entities (`ce.ts`)
```
- Check: src/modules/<id>/ce.ts OR packages/<pkg>/src/modules/<id>/ce.ts
- Extract: entities array for custom entity registration
```

#### 11. Custom Fields
```
Sources combined:
- data/fields.ts: fieldSets export
- ce.ts: entities[].fields arrays
Output: customFieldSets in module entry
```

#### 12. Dashboard Widgets (`widgets/dashboard/**/widget.tsx`)
```
- Walk: widgets/dashboard/ directory
- Find: widget.ts, widget.tsx, widget.js, widget.jsx files
- Generate lazy loaders: () => import('...').then(mod => mod.default ?? mod)
- Key format: "<moduleId>:<path>:widget"
```

#### 13. Injection Widgets (`widgets/injection/**/widget.tsx`)
```
- Same pattern as dashboard widgets
- Used for UI slot injection system
```

#### 14. Injection Table (`widgets/injection-table.ts`)
```
- Slot → widget mappings
- Defines which widgets appear in which UI slots
```

#### 15. Vector Config (`vector.ts`)
```
- Vector search configuration per module
- Included in vector.generated.ts
```

**Output Files:**

1. **`generated/modules.generated.ts`**:
```typescript
import type { Module } from '@open-mercato/shared/modules/registry'
// ... hundreds of imports ...

export const modules: Module[] = [
  {
    id: 'auth',
    info: I0_auth.metadata,
    frontendRoutes: [
      {
        pattern: '/login',
        Component: C1_auth_login,
        requireAuth: false,
        title: 'Login',
        titleKey: 'auth.login.title'
      }
    ],
    backendRoutes: [
      {
        pattern: '/backend/users',
        Component: B2_auth_users,
        requireAuth: true,
        requireFeatures: ['users.view'],
        group: 'Administration',
        icon: 'users'
      }
    ],
    apis: [
      {
        path: '/auth/login',
        handlers: R3_auth_login,
        metadata: { requireAuth: false },
        docs: R3_auth_login.openApi
      }
    ],
    cli: CLI_auth,
    translations: {
      'en': { 'auth.login.title': 'Login', ... },
      'de': { 'auth.login.title': 'Anmelden', ... }
    },
    subscribers: [
      { id: 'auth:welcome-email', event: 'user.created', handler: fn, persistent: true }
    ],
    entityExtensions: [...],
    customFieldSets: [...],
    features: ['users.view', 'users.create', 'users.edit', 'users.delete'],
    customEntities: [...],
    vector: {...},
    dashboardWidgets: [
      { moduleId: 'auth', key: 'auth:stats:widget', loader: () => import('...') }
    ]
  },
  // ... more modules
]

export const modulesInfo = modules.map(m => ({ id: m.id, ...(m.info || {}) }))
export default modules
```

2. **`generated/dashboard-widgets.generated.ts`**:
```typescript
import type { ModuleDashboardWidgetEntry } from '@open-mercato/shared/modules/registry'

export const dashboardWidgetEntries: ModuleDashboardWidgetEntry[] = [
  {
    moduleId: 'dashboards',
    key: 'dashboards:overview:widget',
    source: 'package',
    loader: () => import('@open-mercato/core/modules/dashboards/widgets/dashboard/overview/widget')
      .then((mod) => mod.default ?? mod)
  },
  // ...
]
```

3. **`generated/injection-widgets.generated.ts`**:
```typescript
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'

export const injectionWidgetEntries: ModuleInjectionWidgetEntry[] = [
  {
    moduleId: 'customers',
    key: 'customers:sidebar:widget',
    source: 'package',
    loader: () => import('...').then((mod) => mod.default ?? mod)
  },
  // ...
]
```

4. **`generated/injection-tables.generated.ts`**:
```typescript
import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import * as InjTable_customers_0 from '@open-mercato/core/modules/customers/widgets/injection-table'

export const injectionTables: Array<{ moduleId: string; table: ModuleInjectionTable }> = [
  { moduleId: 'customers', table: InjTable_customers_0.injectionTable }
]
```

5. **`generated/vector.generated.ts`**:
```typescript
import type { VectorModuleConfig } from '@open-mercato/shared/modules/vector'
import * as VECTOR_catalog_0 from '@open-mercato/core/modules/catalog/vector'

type VectorConfigEntry = { moduleId: string; config: VectorModuleConfig | null }

const entriesRaw: VectorConfigEntry[] = [
  { moduleId: 'catalog', config: VECTOR_catalog_0.config }
]

export const vectorModuleConfigEntries = entriesRaw.filter(e => e.config != null)
export const vectorModuleConfigs = vectorModuleConfigEntries.map(e => e.config)
```

---

### generate-module-entities.ts

**Purpose:** Aggregate all MikroORM entities for database initialization

**Location:** `scripts/generate-module-entities.ts`

**Scanning Process:**

```
For each enabled module:
  1. Find entity file (same priority as entity-ids):
     - data/entities.override.ts
     - data/entities.ts
     - db/schema.ts

  2. Generate import statement

  3. At runtime: Enhance entities with entityName property
```

**Output File:**

**`generated/entities.generated.ts`**:
```typescript
import * as E_auth_0 from '@open-mercato/core/modules/auth/data/entities'
import * as E_customers_1 from '@open-mercato/core/modules/customers/data/entities'

function enhanceEntities(namespace: Record<string, unknown>, moduleId: string): any[] {
  return Object.entries(namespace)
    .filter(([, value]) => typeof value === 'function')
    .map(([exportName, value]) => {
      const entity = value as { entityName?: string }
      if (entity && typeof entity === 'function' &&
          !Object.prototype.hasOwnProperty.call(entity, 'entityName')) {
        Object.defineProperty(entity, 'entityName', {
          value: `${moduleId}.${exportName}`,
          configurable: true,
          enumerable: false,
          writable: false,
        })
      }
      return entity
    })
}

export const entities = [
  ...enhanceEntities(E_auth_0, 'auth'),
  ...enhanceEntities(E_customers_1, 'customers')
]
```

The `entityName` property (e.g., `'auth.User'`, `'customers.Customer'`) is used by MikroORM for entity identification.

---

### generate-module-di.ts

**Purpose:** Collect all dependency injection registrars for Awilix container

**Location:** `scripts/generate-module-di.ts`

**Scanning Process:**

```
For each enabled module:
  1. Check: src/modules/<id>/di.ts (app override first)
  2. Check: packages/<pkg>/src/modules/<id>/di.ts
  3. If found: Import the register function
```

**Output File:**

**`generated/di.generated.ts`**:
```typescript
import * as D_auth_0 from '@open-mercato/core/modules/auth/di'
import * as D_customers_1 from '@open-mercato/core/modules/customers/di'

const diRegistrars = [
  D_auth_0.register,
  D_customers_1.register
].filter(Boolean) as (((c: any) => void) | undefined)[]

export { diRegistrars }
export default diRegistrars
```

Each module's `di.ts` exports a `register` function:
```typescript
// modules/auth/di.ts
import { asClass, asFunction } from 'awilix'
import { AuthService } from './services/AuthService'

export function register(container: AwilixContainer) {
  container.register({
    authService: asClass(AuthService).scoped(),
  })
}
```

---

## Change Detection

Each generator implements checksum-based caching to avoid unnecessary file writes:

### Content Checksum
```
1. Calculate MD5 hash of generated content
2. Compare with stored hash in *.generated.checksum
3. Only write if hash differs
```

### Structure Checksum (module-registry only)
```
1. Walk all module directories
2. Collect file paths, sizes, and modification times
3. Hash the combined structure info
4. Detect new/deleted files even if content unchanged
```

**Checksum File Format:**
```json
{"content":"a1b2c3d4e5f6...","structure":"f6e5d4c3b2a1..."}
```

---

## Cross-Package Generation Behavior

This section explains how generation works across multiple packages and whether one package can influence another's generated files.

### Package Isolation

Each package gets its own **isolated** generated files:

```
packages/core/generated/
├── entities.ids.generated.ts    # Only core modules
├── entity-fields-registry.ts    # Only core entities
└── entities/                    # Only core entity folders
    ├── user/
    ├── role/
    └── ...

packages/example/generated/
├── entities.ids.generated.ts    # Only example modules
├── entity-fields-registry.ts    # Only example entities
└── entities/                    # Only example entity folders
    └── example_item/

packages/onboarding/generated/
├── entities.ids.generated.ts    # Only onboarding modules
├── entity-fields-registry.ts    # Only onboarding entities
└── entities/
    └── onboarding_step/
```

The isolation is achieved by grouping modules by their `from` property:

```typescript
// In generate-entity-ids.ts
const group: GroupKey = (entry.from as GroupKey) || '@open-mercato/core'

// Each group gets separate dictionaries
grouped[group] = grouped[group] || {}
fieldsByGroup[group] = fieldsByGroup[group] || {}
```

### Consolidated Files (Shared)

The **root `generated/` directory** contains consolidated files that combine all packages:

```typescript
// generated/entities.ids.generated.ts (root - consolidated)
export const M = {
  "dashboards": "dashboards",     // from @open-mercato/core
  "auth": "auth",                 // from @open-mercato/core
  "example": "example",           // from @open-mercato/example
  "onboarding": "onboarding"      // from @open-mercato/onboarding
} as const

export const E = {
  "dashboards": { /* core entities */ },
  "auth": { /* core entities */ },
  "example": { /* example entities */ },
  "onboarding": { /* onboarding entities */ }
} as const
```

This consolidated file is used by app code that imports from `@/generated/...`.

### Cross-Package Influence Matrix

| Scenario | Affects Per-Package Files? | Affects Consolidated Files? |
|----------|---------------------------|----------------------------|
| Add module to core | No (only core's generated/) | Yes (added to root generated/) |
| Add module to example | No (only example's generated/) | Yes (added to root generated/) |
| Same module ID in two packages | No | **Yes - Conflict!** Later overwrites |
| Same entity name in different packages | No (isolated folders) | No (namespaced by module) |
| Same entity name in same package | **Yes - Fields merged** | Yes |

### Potential Conflicts

#### 1. Module ID Collision

If two packages define a module with the same ID:

```typescript
// src/modules.ts
export const enabledModules = [
  { id: 'example', from: '@open-mercato/core' },     // Module ID: example
  { id: 'example', from: '@open-mercato/example' },  // Module ID: example (CONFLICT!)
]
```

**Result:** In the consolidated file, the second entry overwrites the first. Per-package files remain isolated.

#### 2. Entity Name Collision Within Same Package

If two modules in the **same package** have entities with identical snake_case names:

```typescript
// packages/core/src/modules/auth/data/entities.ts
export class User { ... }  // → user

// packages/core/src/modules/customers/data/entities.ts
export class User { ... }  // → user (same snake_case name)
```

**Result:** Fields are **merged** into a single `packages/core/generated/entities/user/` folder:

```typescript
// In generate-entity-ids.ts
combined[entity] = Array.from(new Set([...(combined[entity] || []), ...fields]))
```

This is usually fine since both entities likely share common fields (`id`, `created_at`, etc.), but custom fields would be combined.

#### 3. Entity Name Collision Across Packages

If different packages have entities with the same name:

```typescript
// packages/core/src/modules/auth/data/entities.ts
export class Settings { ... }  // → packages/core/generated/entities/settings/

// packages/example/src/modules/example/data/entities.ts
export class Settings { ... }  // → packages/example/generated/entities/settings/
```

**Result:** No conflict - each package has its own isolated `entities/settings/` folder.

### Generation Order Independence

The generators process all enabled modules in a single pass:

```typescript
const entries = loadEnabledModules()  // All modules from all packages

for (const entry of entries) {
  const group = entry.from || '@open-mercato/core'
  // Process and group by package
}

// Write per-group outputs
for (const g of groups) {
  // Each package gets its own files
}
```

**Key Point:** Package A's generation does **not** depend on Package B's output. All packages are processed in one pass, and outputs are written per-group at the end.

### Summary

| Question | Answer |
|----------|--------|
| Can Package A affect Package B's `generated/` folder? | **No** - completely isolated |
| Can Package A affect the root `generated/` folder? | **Yes** - contributes to consolidated files |
| Is there a generation order dependency between packages? | **No** - all processed in single pass |
| Can two packages have the same module ID? | **Technically yes, but causes overwrite in consolidated file** |
| Can two modules in the same package have same entity name? | **Yes, but fields get merged** |

---

## Import Patterns

### From App Code (`src/`)

```typescript
// Module registry
import { modules } from '@/generated/modules.generated'

// Entity IDs (consolidated)
import { E, M } from '@/generated/entities.ids.generated'

// DI registrars
import diRegistrars from '@/generated/di.generated'

// Entities for ORM
import { entities } from '@/generated/entities.generated'

// Widgets
import { dashboardWidgetEntries } from '@/generated/dashboard-widgets.generated'
import { injectionWidgetEntries } from '@/generated/injection-widgets.generated'
```

### From Packages

```typescript
// Per-package entity IDs
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { E as ExampleEntities } from '@open-mercato/example/generated/entities.ids.generated'

// Entity fields
import { id, name } from '@/generated/entities/customer'
import { getEntityFields } from '@/generated/entity-fields-registry'
```

### Dynamic Imports

```typescript
// Lazy loading (used by widget loaders)
const mod = await import('@/generated/modules.generated')
const { entities } = await import('@/generated/entities.generated')
```

---

## Package Consumption Map

```
┌─────────────────────────────────────────────────────────────────┐
│  GENERATORS (scripts/)                                          │
└──────────────────────────────┬──────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  GENERATED FILES (generated/)                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  modules.generated.ts ─────┬─► src/app/* (routing)              │
│                            ├─► packages/core/* (nav, features)  │
│                            ├─► packages/shared/* (query, i18n)  │
│                            └─► packages/cli/* (CLI commands)    │
│                                                                 │
│  entities.generated.ts ────────► packages/shared/lib/db/mikro   │
│                                                                 │
│  entities.ids.generated.ts ────► packages/core/modules/*        │
│                                  (type-safe entity references)  │
│                                                                 │
│  di.generated.ts ──────────────► packages/shared/lib/di         │
│                                  (container initialization)     │
│                                                                 │
│  *-widgets.generated.ts ───────► packages/ui/backend/*          │
│                                  (widget registries)            │
│                                                                 │
│  openapi.types.ts ─────────────► packages/client/               │
│                                  (API client types)             │
└─────────────────────────────────────────────────────────────────┘
```

### Detailed Consumption

| Generated File | Consumed By | Purpose |
|----------------|-------------|---------|
| `modules.generated.ts` | `src/app/api/[...slug]/route.ts` | API routing/dispatch |
| `modules.generated.ts` | `src/app/(frontend)/[...slug]/page.tsx` | Frontend page routing |
| `modules.generated.ts` | `src/app/(backend)/backend/[...slug]/page.tsx` | Backend page routing |
| `modules.generated.ts` | `packages/core/modules/auth/api/admin/nav.ts` | Navigation building |
| `modules.generated.ts` | `packages/core/modules/auth/api/features.ts` | Feature enumeration |
| `modules.generated.ts` | `packages/shared/lib/i18n/server.ts` | Translation resolution |
| `modules.generated.ts` | `packages/shared/lib/query/engine.ts` | Query engine module access |
| `modules.generated.ts` | `packages/cli/src/mercato.ts` | CLI module commands |
| `entities.generated.ts` | `packages/shared/lib/db/mikro.ts` | MikroORM initialization |
| `entities.ids.generated.ts` | Various backend pages/APIs | Type-safe entity references |
| `di.generated.ts` | `packages/shared/lib/di/container.ts` | DI container setup |
| `dashboard-widgets.generated.ts` | `packages/ui/backend/dashboard/widgetRegistry.ts` | Widget discovery |
| `injection-widgets.generated.ts` | `packages/ui/backend/injection/widgetRegistry.ts` | UI slot injection |

---

## NPM Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `modules:ids` | `tsx scripts/generate-entity-ids.ts` | Generate entity ID constants |
| `modules:generate` | `tsx scripts/generate-module-registry.ts` | Generate module registry |
| `modules:entities` | `tsx scripts/generate-module-entities.ts` | Generate entity aggregation |
| `modules:di` | `tsx scripts/generate-module-di.ts` | Generate DI registrars |
| `client:generate` | `tsx scripts/generate-api-client.ts` | Generate OpenAPI types |
| `modules:prepare` | All 5 generators in sequence | Full generation (recommended) |
| `predev` | `npm run modules:prepare` | Auto-run before `npm run dev` |
| `prebuild` | `npm run modules:prepare` | Auto-run before `npm run build` |
| `premercato` | `npm run modules:prepare` | Auto-run before CLI commands |

---

## Key Patterns

### 1. App Override Priority

If a file exists in `src/modules/<id>/`, it takes precedence over the package version:

```
src/modules/auth/backend/users/page.tsx     ← WINS (app override)
packages/core/src/modules/auth/backend/users/page.tsx  ← fallback
```

### 2. Lazy Loading

Widgets use dynamic `import()` for code splitting:

```typescript
{
  loader: () => import('@open-mercato/core/modules/dashboards/widgets/dashboard/overview/widget')
    .then((mod) => mod.default ?? mod)
}
```

### 3. Metadata Colocation

Page metadata lives in `*.meta.ts` files next to pages:

```
frontend/users/
  page.tsx        ← Component
  page.meta.ts    ← Metadata (title, auth, features)
```

Or folder-level:
```
frontend/users/
  page.tsx
  meta.ts         ← Shared metadata for all pages in folder
```

### 4. Convention Over Configuration

File location determines behavior (Next.js-style routing):

```
frontend/users/page.tsx           → /users
frontend/users/[id]/page.tsx      → /users/:id
backend/settings/page.tsx         → /backend/settings
api/users/route.ts                → /api/<moduleId>/users
```

### 5. Checksum Caching

Only regenerates when files actually change:

```typescript
const newChecksum = calculateChecksum(output)
if (existingChecksum === newChecksum) {
  return // Skip write
}
fs.writeFileSync(outFile, output)
fs.writeFileSync(checksumFile, newChecksum)
```

### 6. Entity Name Enhancement

Entities get a `entityName` property at runtime for ORM identification:

```typescript
// Before: class User {}
// After: class User { static entityName = 'auth.User' }
```

### 7. Translation Merging

Package and app translations are deep-merged, with app overrides winning:

```typescript
translations: {
  'en': { ...packageTranslations, ...appOverrides }
}
```

---

## Visual Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  src/modules.ts (Configuration)                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ enabledModules = [                                           │   │
│  │   { id: 'auth', from: '@open-mercato/core' },               │   │
│  │   { id: 'example', from: '@open-mercato/example' },         │   │
│  │ ]                                                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  loadEnabledModules() → moduleFsRoots() → moduleImportBase()        │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ App Override    │   │ Package Core    │   │ Package Example │
│ src/modules/    │   │ packages/core/  │   │ packages/       │
│   auth/         │   │   src/modules/  │   │   example/      │
│   └─ backend/   │   │   auth/         │   │   src/modules/  │
│      page.tsx   │   │   ├─ frontend/  │   │   example/      │
│                 │   │   ├─ backend/   │   └─────────────────┘
│ (Wins if exists)│   │   ├─ api/       │
└─────────────────┘   │   ├─ data/      │
                      │   │  └─ entities│
                      │   ├─ i18n/      │
                      │   ├─ subscribers│
                      │   ├─ widgets/   │
                      │   ├─ acl.ts     │
                      │   ├─ cli.ts     │
                      │   ├─ di.ts      │
                      │   └─ index.ts   │
                      └─────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  GENERATORS (npm run modules:prepare)                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. generate-entity-ids.ts                                          │
│     Scan: data/entities.ts → Parse TS AST → Extract class names     │
│     Output: M = { auth: 'auth' }, E = { auth: { user: 'auth:user' }}│
│                                                                     │
│  2. generate-module-registry.ts                                     │
│     Scan: frontend/, backend/, api/, subscribers/, widgets/...      │
│     Output: modules array with routes, APIs, translations, etc.     │
│                                                                     │
│  3. generate-module-entities.ts                                     │
│     Scan: data/entities.ts → Import all entity classes              │
│     Output: entities = [...all ORM entities with entityName]        │
│                                                                     │
│  4. generate-module-di.ts                                           │
│     Scan: di.ts → Import register functions                         │
│     Output: diRegistrars = [register1, register2, ...]              │
│                                                                     │
│  5. generate-api-client.ts                                          │
│     Scan: modules.generated.ts → Build OpenAPI spec                 │
│     Output: openapi.types.ts (TypeScript types)                     │
│                                                                     │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  GENERATED FILES (generated/)                                       │
├─────────────────────────────────────────────────────────────────────┤
│  modules.generated.ts          → Used by routing, nav, CLI          │
│  entities.generated.ts         → Used by MikroORM                   │
│  entities.ids.generated.ts     → Used for type-safe entity refs     │
│  di.generated.ts               → Used by DI container               │
│  dashboard-widgets.generated.ts→ Used by widget registry            │
│  injection-widgets.generated.ts→ Used by injection system           │
│  injection-tables.generated.ts → Used by injection system           │
│  vector.generated.ts           → Used by vector search              │
│  entity-fields-registry.ts     → Used for field lookups             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Module Directory Structure Reference

A complete module can have the following structure:

```
packages/<pkg>/src/modules/<module>/
├── frontend/                    # Frontend pages
│   ├── page.tsx                 # Route: /
│   ├── page.meta.ts             # Metadata for page.tsx
│   ├── users/
│   │   ├── page.tsx             # Route: /users
│   │   └── [id]/
│   │       └── page.tsx         # Route: /users/:id
│   └── settings.tsx             # Route: /settings (legacy style)
│
├── backend/                     # Backend/admin pages
│   ├── page.tsx                 # Route: /backend/<module>
│   ├── page.meta.ts
│   ├── users/
│   │   ├── page.tsx             # Route: /backend/users
│   │   ├── page.meta.ts
│   │   └── [id]/
│   │       └── page.tsx         # Route: /backend/users/:id
│   └── meta.ts                  # Shared metadata for folder
│
├── api/                         # API endpoints
│   ├── route.ts                 # /api/<module> (all methods)
│   ├── users/
│   │   └── route.ts             # /api/<module>/users
│   ├── status.ts                # /api/<module>/status (single file)
│   └── get/                     # Legacy per-method style
│       └── health.ts            # GET /api/<module>/health
│
├── data/
│   ├── entities.ts              # MikroORM entity definitions
│   ├── entities.override.ts     # App override (highest priority)
│   ├── extensions.ts            # Entity extensions for other modules
│   ├── fields.ts                # Custom field definitions
│   └── validators.ts            # Zod validation schemas
│
├── subscribers/                 # Event subscribers
│   ├── on-user-created.ts       # Handles 'user.created' event
│   └── on-order-placed.ts       # Handles 'order.placed' event
│
├── widgets/
│   ├── dashboard/               # Dashboard widgets
│   │   └── stats/
│   │       └── widget.tsx
│   ├── injection/               # Injection widgets
│   │   └── sidebar/
│   │       └── widget.tsx
│   └── injection-table.ts       # Slot → widget mappings
│
├── i18n/                        # Translations
│   ├── en.json
│   ├── de.json
│   └── es.json
│
├── acl.ts                       # Feature definitions for RBAC
├── ce.ts                        # Custom entity definitions
├── cli.ts                       # CLI commands
├── di.ts                        # Dependency injection registration
├── index.ts                     # Module metadata
└── vector.ts                    # Vector search configuration
```

Each of these files/directories is optional. The generators will only process what exists.
