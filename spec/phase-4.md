# Phase 4: Package Publishability - Remove @/generated/ Imports

**Goal:** Remove all `@/generated/` imports from packages, making them fully independent and publishable to npm.

**Verification:** Packages work in isolation, can be tested without app-level generated files.

---

## Prerequisites

- [ ] Phase 0 completed (registration functions exist)
- [ ] Phase 3 completed (packages have proper exports)
- [ ] All tests passing
- [ ] Clean git state

---

## Overview

This phase removes the fallback imports from Phase 0 and makes packages throw clear errors when not properly initialized.

**Current state (after Phase 0):**
```typescript
export async function getOrm() {
  if (_entities) {
    return MikroORM.init({ entities: _entities })
  }
  // Fallback to old behavior - REMOVE THIS
  const { entities } = await import('@/generated/entities.generated')
  return MikroORM.init({ entities })
}
```

**Target state (Phase 4):**
```typescript
export async function getOrm() {
  if (!_entities) {
    throw new Error(
      'ORM entities not registered. Call registerOrmEntities() at app bootstrap.'
    )
  }
  return MikroORM.init({ entities: _entities })
}
```

---

## Tasks

### 4.1 Remove Fallback Imports from packages/shared

#### lib/db/mikro.ts

```typescript
let _entities: any[] | null = null

export function registerOrmEntities(entities: any[]) {
  _entities = entities
}

export async function getOrm() {
  if (!_entities) {
    throw new Error(
      'ORM entities not registered. Call registerOrmEntities() from @open-mercato/shared before using getOrm().'
    )
  }
  return MikroORM.init({ entities: _entities, /* other config */ })
}
```

#### lib/di/container.ts

```typescript
export type DiRegistrar = (container: AwilixContainer) => void

let _diRegistrars: DiRegistrar[] | null = null

export function registerDiRegistrars(registrars: DiRegistrar[]) {
  _diRegistrars = registrars
}

export async function createRequestContainer(
  options: { diRegistrars?: DiRegistrar[] } = {}
) {
  const registrars = options.diRegistrars || _diRegistrars
  if (!registrars) {
    throw new Error(
      'DI registrars not configured. Either pass diRegistrars option or call registerDiRegistrars() at bootstrap.'
    )
  }
  // ... rest of implementation
}
```

#### lib/i18n/server.ts

```typescript
let _modules: Module[] | null = null

export function registerModules(modules: Module[]) {
  _modules = modules
}

function getModules(): Module[] {
  if (!_modules) {
    throw new Error(
      'Modules not registered. Call registerModules() from @open-mercato/shared before using translation functions.'
    )
  }
  return _modules
}

export function resolveTranslations() {
  const modules = getModules()
  // ... existing logic
}
```

#### lib/query/engine.ts

```typescript
let _modules: Module[] | null = null

export function registerQueryModules(modules: Module[]) {
  _modules = modules
}

function getModules(): Module[] {
  if (!_modules) {
    throw new Error(
      'Query modules not registered. Call registerQueryModules() at app bootstrap.'
    )
  }
  return _modules
}
```

#### lib/encryption/entityIds.ts

```typescript
let _entityIds: Record<string, Record<string, string>> | null = null

export function registerEntityIds(E: Record<string, Record<string, string>>) {
  _entityIds = E
}

export function getEntityIds(): Record<string, Record<string, string>> {
  if (!_entityIds) {
    throw new Error(
      'Entity IDs not registered. Call registerEntityIds() with the E constant from generated files.'
    )
  }
  return _entityIds
}
```

---

### 4.2 Remove Fallback Imports from packages/core

Apply the same pattern to all 12 files listed in [publishable-packages.md](./publishable-packages.md).

Each file should:
1. Remove any `import ... from '@/generated/...'`
2. Remove fallback dynamic imports
3. Use registered values or throw if not registered

---

### 4.3 Remove Fallback Imports from packages/ui

#### backend/dashboard/widgetRegistry.ts

```typescript
let _dashboardWidgetEntries: ModuleDashboardWidgetEntry[] | null = null

export function registerDashboardWidgets(entries: ModuleDashboardWidgetEntry[]) {
  _dashboardWidgetEntries = entries
}

export function getDashboardWidgets(): ModuleDashboardWidgetEntry[] {
  if (!_dashboardWidgetEntries) {
    throw new Error(
      'Dashboard widgets not registered. Call registerDashboardWidgets() at app bootstrap.'
    )
  }
  return _dashboardWidgetEntries
}
```

#### backend/injection/widgetRegistry.ts

Same pattern as dashboard widgets.

---

### 4.4 Remove Fallback Imports from packages/cli

#### mercato.ts

```typescript
let _modules: Module[] | null = null

export function registerCliModules(modules: Module[]) {
  _modules = modules
}

function getModules(): Module[] {
  if (!_modules) {
    throw new Error(
      'CLI modules not registered. Ensure bootstrap() is called before CLI commands.'
    )
  }
  return _modules
}
```

---

### 4.5 Remove Fallback Imports from packages/vector

#### modules/vector/di.ts

```typescript
let _vectorModuleConfigs: VectorModuleConfig[] | null = null

export function registerVectorConfigs(configs: VectorModuleConfig[]) {
  _vectorModuleConfigs = configs
}

export function getVectorConfigs(): VectorModuleConfig[] {
  if (!_vectorModuleConfigs) {
    throw new Error(
      'Vector configs not registered. Call registerVectorConfigs() at app bootstrap.'
    )
  }
  return _vectorModuleConfigs
}
```

---

### 4.6 Update packages/onboarding

#### modules/onboarding/api/get/onboarding/verify.ts

This should already use `getEntityIds()` from shared:

```typescript
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

// Usage
const E = getEntityIds()
```

---

### 4.7 Ensure App Bootstrap is Complete

The `apps/mercato/src/bootstrap.ts` file should register everything:

```typescript
import { modules } from './generated/modules.generated'
import { entities } from './generated/entities.generated'
import { diRegistrars } from './generated/di.generated'
import { E } from './generated/entities.ids.generated'
import { dashboardWidgetEntries } from './generated/dashboard-widgets.generated'
import { injectionWidgetEntries } from './generated/injection-widgets.generated'
import { vectorModuleConfigs } from './generated/vector.generated'

import { registerOrmEntities } from '@open-mercato/shared/lib/db/mikro'
import { registerDiRegistrars } from '@open-mercato/shared/lib/di/container'
import { registerModules } from '@open-mercato/shared/lib/i18n/server'
import { registerQueryModules } from '@open-mercato/shared/lib/query/engine'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { registerDashboardWidgets } from '@open-mercato/ui/backend/dashboard/widgetRegistry'
import { registerInjectionWidgets } from '@open-mercato/ui/backend/injection/widgetRegistry'
import { registerVectorConfigs } from '@open-mercato/vector/modules/vector/di'
import { registerCliModules } from '@open-mercato/cli/mercato'

let _bootstrapped = false

export function bootstrap() {
  if (_bootstrapped) return
  _bootstrapped = true

  registerOrmEntities(entities)
  registerDiRegistrars(diRegistrars)
  registerModules(modules)
  registerQueryModules(modules)
  registerCliModules(modules)
  registerEntityIds(E)
  registerDashboardWidgets(dashboardWidgetEntries)
  registerInjectionWidgets(injectionWidgetEntries)
  registerVectorConfigs(vectorModuleConfigs)
}
```

---

### 4.8 Ensure Bootstrap is Called Early

Update entry points to call bootstrap:

**apps/mercato/src/app/layout.tsx:**
```typescript
import { bootstrap } from '../bootstrap'
bootstrap()

export default function RootLayout({ children }) {
  // ...
}
```

**apps/mercato/src/middleware.ts:**
```typescript
import { bootstrap } from './bootstrap'
bootstrap()

export function middleware(request: NextRequest) {
  // ...
}
```

**scripts/mercato.ts (CLI entry):**
```typescript
import { bootstrap } from '../apps/mercato/src/bootstrap'
bootstrap()

// CLI code...
```

---

### 4.9 Write Package Tests

Create tests that verify packages work in isolation with mock registrations:

**packages/shared/src/__tests__/mikro.test.ts:**
```typescript
import { registerOrmEntities, getOrm } from '../lib/db/mikro'

class MockEntity {}

describe('ORM Registration', () => {
  beforeEach(() => {
    // Reset state between tests
    registerOrmEntities([])
  })

  it('throws if entities not registered', async () => {
    // Clear registration
    registerOrmEntities(null as any)

    await expect(getOrm()).rejects.toThrow('ORM entities not registered')
  })

  it('works with registered entities', async () => {
    registerOrmEntities([MockEntity])

    // This will try to init MikroORM - mock as needed
    // const orm = await getOrm()
    // expect(orm).toBeDefined()
  })
})
```

---

## Verification Steps

```bash
# 1. Build all packages
yarn build

# 2. Verify no @/generated imports remain in packages
grep -r "@/generated" packages/*/src --include="*.ts" --include="*.tsx"
# Should return empty or only comments

# 3. TypeScript check
yarn typecheck

# 4. Run tests
yarn test

# 5. Dev mode - verify app works
yarn dev
# Test all major features:
# - Login
# - Backend pages
# - API calls
# - Widgets
# - Translations
# - CLI commands

# 6. Test CLI
mercato --help
mercato modules list
```

---

## Error Message Reference

After this phase, if bootstrap is not called, users will see clear error messages:

| Component | Error Message |
|-----------|---------------|
| ORM | "ORM entities not registered. Call registerOrmEntities() from @open-mercato/shared before using getOrm()." |
| DI | "DI registrars not configured. Either pass diRegistrars option or call registerDiRegistrars() at bootstrap." |
| i18n | "Modules not registered. Call registerModules() from @open-mercato/shared before using translation functions." |
| Query | "Query modules not registered. Call registerQueryModules() at app bootstrap." |
| Entity IDs | "Entity IDs not registered. Call registerEntityIds() with the E constant from generated files." |
| Widgets | "Dashboard widgets not registered. Call registerDashboardWidgets() at app bootstrap." |
| CLI | "CLI modules not registered. Ensure bootstrap() is called before CLI commands." |

---

## Success Criteria

- [ ] All `@/generated/` imports removed from packages
- [ ] No fallback dynamic imports in packages
- [ ] Clear error messages when not bootstrapped
- [ ] App works correctly with bootstrap
- [ ] Tests pass for isolated package usage
- [ ] All 22 files fully converted

---

## Next Phase

Once Phase 4 is complete, proceed to [Phase 5: App-Level Generation (.mercato)](./phase-5.md).
