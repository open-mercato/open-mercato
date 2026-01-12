# Phase 0: Prerequisites - Package Generation Isolation

**Goal:** Prepare packages for publishability by implementing dependency injection patterns and removing direct `@/generated/` imports from packages.

**Verification:** All tests pass, build succeeds, dev mode works with the new DI pattern.

---

## Overview

Before restructuring the monorepo, packages must be made independently functional. Currently, packages import directly from `@/generated/` which:
1. Uses an app-specific path alias (`@/`)
2. References files that won't exist in published packages
3. Creates circular dependencies: packages → generated → packages

This phase implements the DI registration pattern documented in [publishable-packages.md](./publishable-packages.md).

---

## Tasks

### 0.1 Entity Fields Optimization

Remove ~1,380 unused individual field files per [entity-fields-optimization.md](./entity-fields-optimization.md).

**File to modify:** `scripts/generate-entity-ids.ts`

**Change:** Remove the inner loop that generates individual field files:
```typescript
// REMOVE these lines (around line 112-114):
for (const f of fields) {
  fs.writeFileSync(path.join(entDir, `${f}.ts`), `export default '${f}'\n`)
}
```

**Verification:**
```bash
yarn modules:ids
# Count files - should be ~96 instead of ~1,474
find packages -path "*/generated/entities/*" -name "*.ts" | wc -l

# Verify no individual field files exist
find packages -path "*/generated/entities/*" -name "*.ts" ! -name "index.ts" | wc -l
# Should output: 0

yarn build
```

---

### 0.2 Add Registration Functions to Packages

For each package that imports from `@/generated/`, add registration functions and internal state.

#### 0.2.1 packages/shared (5 files)

**lib/db/mikro.ts:**
```typescript
// Add module-level state
let _entities: any[] | null = null

export function registerOrmEntities(entities: any[]) {
  _entities = entities
}

export async function getOrm() {
  if (_entities) {
    return MikroORM.init({ entities: _entities, /* ... */ })
  }
  // Fallback to old behavior (Phase 0 - backward compatible)
  const { entities } = await import('@/generated/entities.generated')
  return MikroORM.init({ entities, /* ... */ })
}
```

**lib/di/container.ts:**
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
    // Fallback to old behavior
    const { default: defaultRegistrars } = await import('@/generated/di.generated')
    return createWithRegistrars(defaultRegistrars)
  }
  return createWithRegistrars(registrars)
}
```

**lib/i18n/server.ts:**
```typescript
import type { Module } from '@open-mercato/shared/modules/registry'

let _modules: Module[] | null = null

export function registerModules(modules: Module[]) {
  _modules = modules
}

export async function resolveTranslations() {
  const modules = _modules || (await import('@/generated/modules.generated')).modules
  // ... existing logic using modules
}
```

**lib/query/engine.ts:**
```typescript
let _modules: Module[] | null = null

export function registerQueryModules(modules: Module[]) {
  _modules = modules
}

// Update any functions that use modules to check _modules first
```

**lib/encryption/entityIds.ts:**
```typescript
let _entityIds: Record<string, Record<string, string>> | null = null

export function registerEntityIds(E: Record<string, Record<string, string>>) {
  _entityIds = E
}

export function getEntityIds() {
  if (_entityIds) return _entityIds
  // This should throw in published context, fallback only for dev
  return require('@/generated/entities.ids.generated').E
}
```

#### 0.2.2 packages/core (12 files)

Apply similar pattern to all files listed in [publishable-packages.md](./publishable-packages.md#packagescore-12-files).

Key files:
- `bootstrap.ts` - modules array
- `modules/entities/api/entities.ts` - E entity IDs
- `modules/entities/lib/install-from-ce.ts` - modules + E
- `modules/auth/api/admin/nav.ts` - modules array
- `modules/auth/api/features.ts` - modules array
- `modules/query_index/subscribers/coverage_warmup.ts` - E
- `modules/query_index/api/status.ts` - E
- `modules/query_index/cli.ts` - E
- `modules/widgets/lib/injection.ts` - widget entries
- `modules/dashboards/lib/widgets.ts` - modules array
- `modules/attachments/lib/assignmentDetails.ts` - modules array

#### 0.2.3 packages/ui (2 files)

**backend/dashboard/widgetRegistry.ts:**
```typescript
let _dashboardWidgetEntries: ModuleDashboardWidgetEntry[] | null = null

export function registerDashboardWidgets(entries: ModuleDashboardWidgetEntry[]) {
  _dashboardWidgetEntries = entries
}

export function getDashboardWidgets() {
  if (_dashboardWidgetEntries) return _dashboardWidgetEntries
  return require('@/generated/dashboard-widgets.generated').dashboardWidgetEntries
}
```

**backend/injection/widgetRegistry.ts:**
```typescript
let _injectionWidgetEntries: ModuleInjectionWidgetEntry[] | null = null

export function registerInjectionWidgets(entries: ModuleInjectionWidgetEntry[]) {
  _injectionWidgetEntries = entries
}

export function getInjectionWidgets() {
  if (_injectionWidgetEntries) return _injectionWidgetEntries
  return require('@/generated/injection-widgets.generated').injectionWidgetEntries
}
```

#### 0.2.4 packages/cli (1 file)

**mercato.ts:**
```typescript
let _modules: Module[] | null = null

export function registerCliModules(modules: Module[]) {
  _modules = modules
}

// Update module usage to check _modules first
```

#### 0.2.5 packages/vector (1 file)

**modules/vector/di.ts:**
```typescript
let _vectorModuleConfigs: VectorModuleConfig[] | null = null

export function registerVectorConfigs(configs: VectorModuleConfig[]) {
  _vectorModuleConfigs = configs
}
```

#### 0.2.6 packages/onboarding (1 file)

**modules/onboarding/api/get/onboarding/verify.ts:**
```typescript
// Use shared getEntityIds() helper from packages/shared
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

const E = getEntityIds()
```

---

### 0.3 Create App-Level Bootstrap

Create a centralized bootstrap file that registers all generated content.

**File:** `src/bootstrap.ts`

```typescript
// Generated imports
import { modules } from '@/generated/modules.generated'
import { entities } from '@/generated/entities.generated'
import { diRegistrars } from '@/generated/di.generated'
import { E } from '@/generated/entities.ids.generated'
import { dashboardWidgetEntries } from '@/generated/dashboard-widgets.generated'
import { injectionWidgetEntries } from '@/generated/injection-widgets.generated'
import { vectorModuleConfigs } from '@/generated/vector.generated'

// Registration functions from packages
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

  // Register ORM entities
  registerOrmEntities(entities)

  // Register DI registrars
  registerDiRegistrars(diRegistrars)

  // Register modules for various subsystems
  registerModules(modules)
  registerQueryModules(modules)
  registerCliModules(modules)

  // Register entity IDs
  registerEntityIds(E)

  // Register widgets
  registerDashboardWidgets(dashboardWidgetEntries)
  registerInjectionWidgets(injectionWidgetEntries)

  // Register vector configs
  registerVectorConfigs(vectorModuleConfigs)
}
```

---

### 0.4 Update Entry Points to Call Bootstrap

Ensure bootstrap is called before any package code that depends on registered values.

**Files to update:**
- `src/app/layout.tsx` or root layout
- `src/middleware.ts`
- `scripts/mercato.ts` (CLI entry)
- Any test setup files

Example:
```typescript
// src/app/layout.tsx
import { bootstrap } from '@/bootstrap'

bootstrap() // Call at module level

export default function RootLayout({ children }) {
  // ...
}
```

---

### 0.5 Export Registration Functions from Package Entry Points

Ensure registration functions are properly exported from package entry points.

**packages/shared/src/index.ts (or appropriate entry):**
```typescript
export { registerOrmEntities } from './lib/db/mikro'
export { registerDiRegistrars, type DiRegistrar } from './lib/di/container'
export { registerModules } from './lib/i18n/server'
export { registerQueryModules } from './lib/query/engine'
export { registerEntityIds, getEntityIds } from './lib/encryption/entityIds'
```

---

## Verification Steps

After completing all tasks:

```bash
# 1. Regenerate all files
yarn modules:prepare

# 2. TypeScript check
yarn typecheck

# 3. Run tests
yarn test

# 4. Build
yarn build

# 5. Dev mode test
yarn dev
# Manually verify:
# - App loads correctly
# - Backend pages work
# - API calls succeed
# - Widgets render
# - Translations load

# 6. CLI test
yarn mercato --help
```

---

## Rollback Plan

If issues arise:
1. Revert all changes via git
2. The fallback imports ensure backward compatibility during development
3. Registration functions are additive - existing code paths still work

---

## Success Criteria

- [ ] All 22 files updated with registration pattern
- [ ] Bootstrap file created and called at app entry
- [ ] No breaking changes to existing functionality
- [ ] Tests pass
- [ ] Build succeeds
- [ ] Dev mode works
- [ ] Entity field file count reduced from ~1,474 to ~96

---

## Next Phase

Once Phase 0 is complete, proceed to [Phase 1: Scripts to CLI Migration](./phase-1.md).
