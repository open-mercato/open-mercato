# Making Packages Publishable

This document outlines the refactoring needed to make Open Mercato packages independently publishable to npm by removing hard dependencies on the app-level `@/generated/` folder.

## Problem Statement

Currently, packages import directly from `@/generated/`:

```typescript
// packages/shared/src/lib/db/mikro.ts
import { entities } from '@/generated/entities.generated'
```

When packages are published to npm and installed in another project:
- The `@/` alias doesn't exist (it's app-specific)
- The `generated/` folder doesn't exist in the published package
- **Result: Import fails, package is unusable**

## Solution: Dependency Injection

Instead of packages importing generated content directly, the **consuming app** provides the generated content at bootstrap time.

```
BEFORE:
  Package ──imports──► @/generated/  (breaks when published)

AFTER:
  App ──imports──► @/generated/
   │
   └──provides via DI──► Package  (works when published)
```

---

## Files Requiring Refactoring

### packages/shared (5 files)

| File | Current Import | What It Needs |
|------|---------------|---------------|
| `lib/db/mikro.ts:12` | `@/generated/entities.generated` | `entities` array |
| `lib/di/container.ts:5` | `@/generated/di.generated` | `diRegistrars` array |
| `lib/i18n/server.ts:4` | `@/generated/modules.generated` | `modules` array |
| `lib/query/engine.ts:495` | `@/generated/modules.generated` | `modules` array |
| `lib/encryption/entityIds.ts:2` | `@/generated/entities.ids.generated` | `E` entity IDs |

### packages/core (12 files)

| File | Current Import | What It Needs |
|------|---------------|---------------|
| `bootstrap.ts:49` | `@/generated/modules.generated` | `modules` array |
| `modules/entities/api/entities.ts:6` | `@/generated/entities.ids.generated` | `E` entity IDs |
| `modules/entities/lib/install-from-ce.ts:6-7` | Both `modules` and `E` | `modules` + `E` |
| `modules/auth/api/admin/nav.ts:4` | `@/generated/modules.generated` | `modules` array |
| `modules/auth/api/features.ts:5` | `@/generated/modules.generated` | `modules` array |
| `modules/query_index/subscribers/coverage_warmup.ts:1` | `@/generated/entities.ids.generated` | `E` entity IDs |
| `modules/query_index/api/status.ts:4` | `@/generated/entities.ids.generated` | `E` entity IDs |
| `modules/query_index/cli.ts:400,648,862` | `@/generated/entities.ids.generated` | `E` entity IDs |
| `modules/widgets/lib/injection.ts:56,66` | `injection-widgets` + `injection-tables` | Widget entries |
| `modules/dashboards/lib/widgets.ts:20` | `@/generated/modules.generated` | `modules` array |
| `modules/attachments/lib/assignmentDetails.ts:85` | `@/generated/modules.generated` | `modules` array |

### packages/ui (2 files)

| File | Current Import | What It Needs |
|------|---------------|---------------|
| `backend/dashboard/widgetRegistry.ts:3` | `@/generated/dashboard-widgets.generated` | `dashboardWidgetEntries` |
| `backend/injection/widgetRegistry.ts:3` | `@/generated/injection-widgets.generated` | `injectionWidgetEntries` |

### packages/cli (1 file)

| File | Current Import | What It Needs |
|------|---------------|---------------|
| `mercato.ts:7,379,636` | `@/generated/modules.generated` | `modules` array |

### packages/vector (1 file)

| File | Current Import | What It Needs |
|------|---------------|---------------|
| `modules/vector/di.ts:4` | `@/generated/vector.generated` | `vectorModuleConfigs` |

### packages/onboarding (1 file)

| File | Current Import | What It Needs |
|------|---------------|---------------|
| `modules/onboarding/api/get/onboarding/verify.ts:100` | `@/generated/entities.ids.generated` | `E` entity IDs |

---

## Refactoring Patterns

### Pattern 1: Function Parameters (ORM Entities)

**Before:**
```typescript
// packages/shared/src/lib/db/mikro.ts
export async function getOrm() {
  const { entities } = await import('@/generated/entities.generated')
  return MikroORM.init({ entities, ... })
}
```

**After:**
```typescript
// packages/shared/src/lib/db/mikro.ts
let _entities: any[] | null = null

export function registerOrmEntities(entities: any[]) {
  _entities = entities
}

export async function getOrm() {
  if (!_entities) {
    throw new Error('ORM entities not registered. Call registerOrmEntities() first.')
  }
  return MikroORM.init({ entities: _entities, ... })
}
```

**App bootstrap:**
```typescript
// src/bootstrap.ts (app level)
import { entities } from '@/generated/entities.generated'
import { registerOrmEntities } from '@open-mercato/shared/lib/db/mikro'

registerOrmEntities(entities)
```

---

### Pattern 2: DI Container Registration

**Before:**
```typescript
// packages/shared/src/lib/i18n/server.ts
import { modules } from '@/generated/modules.generated'

export function resolveTranslations() {
  const translations = modules.flatMap(m => m.translations || {})
  // ...
}
```

**After:**
```typescript
// packages/shared/src/lib/i18n/server.ts
export function resolveTranslations(container: AwilixContainer) {
  const modules = container.resolve<Module[]>('modules')
  const translations = modules.flatMap(m => m.translations || {})
  // ...
}

// OR with a module-level fallback
let _modules: Module[] = []

export function registerModules(modules: Module[]) {
  _modules = modules
}

export function resolveTranslations() {
  const translations = _modules.flatMap(m => m.translations || {})
  // ...
}
```

---

### Pattern 3: DI Registrars (Bootstrap Problem)

The `di.generated.ts` file is special - it's used to SET UP the DI container itself.

**Before:**
```typescript
// packages/shared/src/lib/di/container.ts
import diRegistrarsDefault from '@/generated/di.generated'

export async function createRequestContainer() {
  const container = createContainer()
  for (const reg of diRegistrarsDefault) {
    reg?.(container)
  }
  return container
}
```

**After:**
```typescript
// packages/shared/src/lib/di/container.ts
export type DiRegistrar = (container: AwilixContainer) => void

export async function createRequestContainer(
  options: {
    diRegistrars?: DiRegistrar[]
  } = {}
) {
  const container = createContainer()
  for (const reg of options.diRegistrars || []) {
    reg?.(container)
  }
  return container
}
```

**App bootstrap:**
```typescript
// src/lib/di/container.ts (app level)
import { createRequestContainer as createBase } from '@open-mercato/shared/lib/di/container'
import { diRegistrars } from '@/generated/di.generated'

export async function createRequestContainer() {
  return createBase({ diRegistrars })
}
```

---

### Pattern 4: Lazy Resolution with Fallback

For code that currently uses dynamic imports:

**Before:**
```typescript
// packages/core/src/modules/dashboards/lib/widgets.ts
async function loadWidgetEntries() {
  const registry = await import('@/generated/modules.generated')
  return registry.modules.flatMap(m => m.dashboardWidgets || [])
}
```

**After:**
```typescript
// packages/core/src/modules/dashboards/lib/widgets.ts
let _widgetEntriesProvider: (() => Promise<WidgetEntry[]>) | null = null

export function registerWidgetEntriesProvider(provider: () => Promise<WidgetEntry[]>) {
  _widgetEntriesProvider = provider
}

async function loadWidgetEntries() {
  if (!_widgetEntriesProvider) {
    throw new Error('Widget entries provider not registered')
  }
  return _widgetEntriesProvider()
}
```

---

## App-Level Bootstrap

The consuming app is responsible for wiring everything together:

```typescript
// src/bootstrap.ts
import { modules } from '@/generated/modules.generated'
import { entities } from '@/generated/entities.generated'
import { diRegistrars } from '@/generated/di.generated'
import { E } from '@/generated/entities.ids.generated'
import { dashboardWidgetEntries } from '@/generated/dashboard-widgets.generated'
import { injectionWidgetEntries } from '@/generated/injection-widgets.generated'
import { vectorModuleConfigs } from '@/generated/vector.generated'

// Register with shared package
import { registerOrmEntities } from '@open-mercato/shared/lib/db/mikro'
import { registerModules } from '@open-mercato/shared/lib/i18n/server'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

// Register with core package
import { registerWidgetEntriesProvider } from '@open-mercato/core/modules/dashboards/lib/widgets'

export async function bootstrap() {
  // ORM entities
  registerOrmEntities(entities)

  // Module registry
  registerModules(modules)

  // Entity IDs
  registerEntityIds(E)

  // Widget entries
  registerWidgetEntriesProvider(async () =>
    modules.flatMap(m => m.dashboardWidgets || [])
  )

  // ... etc
}
```

---

## DI Container Integration

For a cleaner approach, register everything in the DI container:

```typescript
// src/bootstrap.ts
import { modules } from '@/generated/modules.generated'
import { entities } from '@/generated/entities.generated'
import { E } from '@/generated/entities.ids.generated'
// ... other imports

export function registerGeneratedContent(container: AwilixContainer) {
  container.register({
    // Module registry
    modules: asValue(modules),

    // Entity IDs
    entityIds: asValue(E),

    // Widget entries
    dashboardWidgetEntries: asValue(dashboardWidgetEntries),
    injectionWidgetEntries: asValue(injectionWidgetEntries),

    // Vector configs
    vectorModuleConfigs: asValue(vectorModuleConfigs),
  })
}
```

Then packages resolve from container:

```typescript
// packages/shared/src/lib/i18n/server.ts
export function resolveTranslations(container: AwilixContainer) {
  const modules = container.resolve<Module[]>('modules')
  // ...
}
```

---

## Migration Strategy

### Phase 1: Add Registration Functions (Non-Breaking)

Add registration functions to packages without removing existing imports:

```typescript
// packages/shared/src/lib/db/mikro.ts
let _entities: any[] | null = null

export function registerOrmEntities(entities: any[]) {
  _entities = entities
}

export async function getOrm() {
  if (_entities) {
    return MikroORM.init({ entities: _entities, ... })
  }
  // Fallback to old behavior (for backward compatibility)
  const { entities } = await import('@/generated/entities.generated')
  return MikroORM.init({ entities, ... })
}
```

### Phase 2: Update App Bootstrap

Create app-level bootstrap that registers all generated content:

```typescript
// src/bootstrap.ts
import { registerOrmEntities } from '@open-mercato/shared/lib/db/mikro'
import { entities } from '@/generated/entities.generated'

registerOrmEntities(entities)
```

### Phase 3: Remove Fallback Imports

Once app bootstrap is in place, remove the `@/generated/` fallbacks from packages:

```typescript
// packages/shared/src/lib/db/mikro.ts
export async function getOrm() {
  if (!_entities) {
    throw new Error('ORM entities not registered. Call registerOrmEntities() first.')
  }
  return MikroORM.init({ entities: _entities, ... })
}
```

### Phase 4: Publish Packages

Packages can now be published independently.

---

## Type Safety Considerations

### Entity IDs Type Definitions

The `E` constant provides compile-time type safety:

```typescript
E.customers.customer  // TypeScript knows this is 'customers:customer'
```

To preserve this when using DI:

**Option A: Type-only package export**

```typescript
// packages/shared/src/types/entity-ids.d.ts
export interface EntityIds {
  customers: {
    customer: 'customers:customer'
    customer_deal: 'customers:customer_deal'
    // ...
  }
  // ...
}
```

**Option B: Generic container resolution**

```typescript
// packages/shared/src/lib/entities/ids.ts
import type { EntityIds } from '../types/entity-ids'

export function getEntityIds(container: AwilixContainer): EntityIds {
  return container.resolve('entityIds')
}
```

**Option C: Accept type loosening**

For truly dynamic scenarios, accept `Record<string, Record<string, string>>`:

```typescript
const E = container.resolve<Record<string, Record<string, string>>>('entityIds')
const customerId = E.customers?.customer  // string | undefined
```

---

## Testing Packages in Isolation

After refactoring, packages can be tested without app-level generated files:

```typescript
// packages/shared/src/lib/db/__tests__/mikro.test.ts
import { registerOrmEntities, getOrm } from '../mikro'

// Mock entities
const mockEntities = [MockUser, MockRole]

beforeEach(() => {
  registerOrmEntities(mockEntities)
})

test('getOrm initializes with registered entities', async () => {
  const orm = await getOrm()
  expect(orm.getMetadata().getAll()).toHaveLength(2)
})
```

---

## Summary

| Current State | After Refactoring |
|--------------|-------------------|
| Packages import `@/generated/*` | Packages receive via DI/registration |
| `@/` alias required | No app-specific aliases needed |
| Cannot publish to npm | Can publish independently |
| Circular: generated → packages → generated | Linear: app → packages |

### Files Changed

| Package | Files to Modify | Complexity |
|---------|-----------------|------------|
| `@open-mercato/shared` | 5 | Medium |
| `@open-mercato/core` | 12 | High |
| `@open-mercato/ui` | 2 | Low |
| `@open-mercato/cli` | 1 | Medium |
| `@open-mercato/vector` | 1 | Low |
| `@open-mercato/onboarding` | 1 | Low |
| **Total** | **22 files** | |

### New App-Level Files

| File | Purpose |
|------|---------|
| `src/bootstrap.ts` | Register all generated content |
| `src/lib/di/container.ts` | App-level container wrapper |

---

## Feasibility Assessment

**Can this work? YES**

The refactoring is straightforward:
1. Replace static imports with registration functions
2. Add app-level bootstrap
3. Packages resolve from DI or registered values

**Challenges:**
1. **Type safety for `E`** - Requires type definitions or accepting looser types
2. **Bootstrap order** - Must ensure registration happens before usage
3. **Testing** - Tests need to register mock data

**Benefits:**
1. Packages become independently publishable
2. Cleaner dependency graph
3. Better testability
4. Explicit dependencies (no magic `@/` imports)
