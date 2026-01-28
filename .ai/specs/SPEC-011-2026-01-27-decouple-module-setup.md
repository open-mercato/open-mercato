# SPEC-011: Decouple Module Setup from `setup-app.ts`

## Problem

The system has tight coupling between the auth/init orchestration layer and optional modules at three levels:

### Level 1: `setup-app.ts` (import-time crash)
`packages/core/src/modules/auth/lib/setup-app.ts`:
1. **Directly imports `SalesSettings` and `SalesDocumentSequence`** (lines 7-11) -- fails at import time if the sales module is disabled.
2. **Hardcodes `ensureSalesNumberingDefaults()`** (lines 508-588) -- sales-specific logic in auth.
3. **Hardcodes all module feature lists in `ensureDefaultRoleAcls()`** (lines 349-437) -- admin/employee role ACLs reference `catalog.*`, `sales.*`, `customers.*`, `staff.*`, `planner.*`, etc.

### Level 2: `mercato init` (runtime crash)
`packages/cli/src/mercato.ts` (lines 299-417) hardcodes ~15 `runModuleCommand()` calls to specific modules. `runModuleCommand` **throws** if the module is not found (line 54). This means disabling any referenced module crashes the init command.

The init flow has two categories of seeds:
- **Structural defaults** (always run): dictionaries, currencies, units, tax rates, statuses, shipping/payment methods, workflows, address types -- lines 299-363
- **Example data** (gated by `--no-examples`): catalog examples, customer examples, sales examples, staff examples, resource examples, planner examples -- lines 365-403

Both categories hardcode module names and break if any module is disabled.

### Level 3: Onboarding + Upgrade Actions
- `packages/onboarding/.../verify.ts` directly imports customer/currency seed functions.
- `packages/core/src/modules/configs/lib/upgrade-actions.ts` directly imports seeds from 7+ modules.

---

## Solution: `setup.ts` Convention + Three Lifecycle Hooks

Each module declares a `setup.ts` file with three optional hooks that map to the three phases of initialization:

```
┌─────────────────────────────────────────────────────────┐
│ mercato init                                            │
│                                                         │
│  1. auth setup ─► setupInitialTenant()                  │
│     └─► onTenantCreated()  (per enabled module)         │
│         Settings, sequences, lightweight config.        │
│         Always runs. Not gated by --no-examples.        │
│                                                         │
│  2. Structural seed loop                                │
│     └─► seedDefaults()     (per enabled module)         │
│         Dictionaries, tax rates, statuses, units.       │
│         Always runs. Not gated by --no-examples.        │
│                                                         │
│  3. Example seed loop (skipped with --no-examples)      │
│     └─► seedExamples()     (per enabled module)         │
│         Demo products, customers, orders, etc.          │
│         Only runs WITHOUT --no-examples.                │
│                                                         │
│  + defaultRoleFeatures     (declarative, merged)        │
│    Replaces hardcoded feature lists in role ACLs.       │
└─────────────────────────────────────────────────────────┘
```

---

## Step 1: Define the `ModuleSetupConfig` type

**File:** `packages/shared/src/modules/setup.ts` (new)

```typescript
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'

export type TenantSetupScope = {
  tenantId: string
  organizationId: string
}

export type TenantSetupContext = TenantSetupScope & {
  em: EntityManager
}

export type InitSetupContext = TenantSetupContext & {
  container: AwilixContainer
}

export type DefaultRoleFeatures = {
  superadmin?: string[]
  admin?: string[]
  employee?: string[]
}

export type ModuleSetupConfig = {
  /**
   * Called inside setupInitialTenant() right after the tenant/org is created.
   * For lightweight structural defaults: settings rows, numbering sequences, configs.
   * Must be idempotent. Always runs (not gated by --no-examples).
   */
  onTenantCreated?: (ctx: TenantSetupContext) => Promise<void>

  /**
   * Called during `mercato init` after tenant exists.
   * For reference/structural data: dictionaries, tax rates, statuses, units,
   * shipping/payment methods, etc.
   * Always runs (not gated by --no-examples).
   * Modules are called in dependency order (based on ModuleInfo.requires).
   */
  seedDefaults?: (ctx: InitSetupContext) => Promise<void>

  /**
   * Called during `mercato init` ONLY when --no-examples is NOT passed.
   * For demo/example data: sample products, customers, orders, etc.
   * Modules are called in dependency order (based on ModuleInfo.requires).
   */
  seedExamples?: (ctx: InitSetupContext) => Promise<void>

  /**
   * Declarative default role-feature assignments.
   * Merged into role ACLs during tenant setup.
   */
  defaultRoleFeatures?: DefaultRoleFeatures
}
```

---

## Step 2: Add `setup` field to `Module` type

**File:** `packages/shared/src/modules/registry.ts`

Add to the `Module` interface:
```typescript
// Optional: module-specific tenant setup configuration (from setup.ts)
setup?: import('./setup').ModuleSetupConfig
```

---

## Step 3: Generator discovers `setup.ts`

**File:** `packages/cli/src/lib/generators/module-registry.ts`

Add a new discovery block (following the same pattern as `acl.ts`, `ce.ts`, `search.ts`):

1. Add a `setupImportName` variable alongside `featuresImportName`, etc.
2. Discover `setup.ts` at module root (app override or package).
3. Include in the module declaration: `setup: (SETUP_xxx.default ?? SETUP_xxx.setup) || undefined`

Example discovery block:
```typescript
// Module setup configuration: module root setup.ts
let setupImportName: string | null = null
{
  const appFile = path.join(roots.appBase, 'setup.ts')
  const pkgFile = path.join(roots.pkgBase, 'setup.ts')
  const hasApp = fs.existsSync(appFile)
  const hasPkg = fs.existsSync(pkgFile)
  if (hasApp || hasPkg) {
    const importName = `SETUP_${toVar(modId)}_${importId++}`
    const importPath = hasApp ? `${appImportBase}/setup` : `${imps.pkgBase}/setup`
    imports.push(`import * as ${importName} from '${importPath}'`)
    setupImportName = importName
  }
}
```

Module declaration addition (in `moduleDecls.push`):
```typescript
${setupImportName ? `setup: (${setupImportName}.default ?? ${setupImportName}.setup) || undefined,` : ''}
```

---

## Step 4: Create `setup.ts` for each module

Each module declares its hooks and role features. Modules are sorted by `ModuleInfo.requires` before calling hooks.

### `packages/core/src/modules/sales/setup.ts` (key example)
```typescript
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { SalesSettings, SalesDocumentSequence } from './data/entities'
import { DEFAULT_ORDER_NUMBER_FORMAT, DEFAULT_QUOTE_NUMBER_FORMAT } from './lib/documentNumberTokens'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['sales.*'],
    employee: ['sales.*'],
  },

  async onTenantCreated({ em, tenantId, organizationId }) {
    // Sales settings + numbering sequences (moved from setup-app.ts)
    const exists = await em.findOne(SalesSettings, { tenantId, organizationId })
    if (!exists) {
      em.persist(em.create(SalesSettings, {
        tenantId, organizationId,
        orderNumberFormat: DEFAULT_ORDER_NUMBER_FORMAT,
        quoteNumberFormat: DEFAULT_QUOTE_NUMBER_FORMAT,
        createdAt: new Date(), updatedAt: new Date(),
      }))
    }
    for (const kind of ['order', 'quote'] as const) {
      const seq = await em.findOne(SalesDocumentSequence, {
        tenantId, organizationId, documentKind: kind,
      })
      if (!seq) {
        em.persist(em.create(SalesDocumentSequence, {
          tenantId, organizationId, documentKind: kind, currentValue: 0,
          createdAt: new Date(), updatedAt: new Date(),
        }))
      }
    }
    await em.flush()
  },

  async seedDefaults({ em, tenantId, organizationId }) {
    // Tax rates, statuses, adjustment kinds, shipping/payment methods
    // (moved from hardcoded CLI calls in mercato.ts)
    const { seedTaxRates } = await import('./lib/seeds')
    const { seedStatuses } = await import('./lib/seeds')
    // ... etc, calling existing seed functions
    const scope = { tenantId, organizationId }
    await seedTaxRates(em, scope)
    await seedStatuses(em, scope)
    // ...
  },

  async seedExamples({ em, tenantId, organizationId, container }) {
    const { seedSalesExamples } = await import('./seed/examples')
    await seedSalesExamples(em, container, { tenantId, organizationId })
  },
}

export default setup
```

### Full module setup matrix

| Module | `onTenantCreated` | `seedDefaults` | `seedExamples` | Admin Features | Employee Features |
|--------|-------------------|----------------|----------------|---------------|-------------------|
| **sales** | Settings + sequences | Tax rates, statuses, adjustment kinds, shipping/payment methods | Orders, quotes, shipments | `sales.*` | `sales.*` |
| **catalog** | -- | Units, price kinds | Products, variants | `catalog.*`, `catalog.variants.manage`, `catalog.pricing.manage` | same |
| **customers** | -- | Dictionaries, currency dictionary | People, companies, deals | `customers.*` + sub-features | view/manage subset |
| **currencies** | -- | Currency list | -- | `currencies.*` | -- |
| **staff** | -- | Address types | Teams, roles, members | `staff.*`, `staff.leave_requests.manage` | leave/availability features |
| **resources** | -- | Address types, capacity units | Resource examples | `resources.*` | -- |
| **planner** | -- | Unavailability reasons | Availability rulesets | `planner.*` | `planner.view` |
| **workflows** | -- | Workflow definitions | -- | `workflows.*` | -- |
| **example** | -- | -- | Todos | `example.*` | `example.*`, `example.widgets.*` |
| **auth** | -- | -- | -- | `auth.*` | -- |
| **entities** | -- | -- | -- | `entities.*` | -- |
| **attachments** | -- | -- | -- | `attachments.*`, `attachments.view`, `attachments.manage` | -- |
| **query_index** | -- | -- | -- | `query_index.*` | -- |
| **feature_toggles** | -- | -- | -- | `feature_toggles.*` | -- |
| **configs** | -- | -- | -- | `configs.system_status.view`, `configs.cache.*`, `configs.manage` | -- |
| **audit_logs** | -- | -- | -- | `audit_logs.*` | `audit_logs.undo_self` |
| **directory** | -- | -- | -- | `directory.organizations.view/manage` | -- |
| **dictionaries** | -- | -- | -- | `dictionaries.view/manage` | `dictionaries.view` |
| **dashboards** | -- | -- | -- | `dashboards.*`, `dashboards.admin.assign-widgets` | `dashboards.view/configure` |
| **api_keys** | -- | -- | -- | `api_keys.*` | -- |
| **perspectives** | -- | -- | -- | `perspectives.use/role_defaults` | `perspectives.use` |
| **business_rules** | -- | -- | -- | `business_rules.*` | -- |
| **search** | -- | -- | -- | `search.*` | `vector.*` |

---

## Step 5: Refactor `setup-app.ts`

**File:** `packages/core/src/modules/auth/lib/setup-app.ts`

### 5a. Remove direct sales imports (lines 7-11)
Delete the `SalesSettings`, `SalesDocumentSequence`, and `DEFAULT_*_FORMAT` imports.

### 5b. Delete `ensureSalesNumberingDefaults()` function (lines 508-588)
This logic moves into `sales/setup.ts` `onTenantCreated`.

### 5c. Accept modules in `setupInitialTenant()`
```typescript
export async function setupInitialTenant(
  em: EntityManager,
  options: SetupInitialTenantOptions,
  modules?: Module[],  // optional, falls back to runtime registry
): Promise<SetupInitialTenantResult>
```

### 5d. Refactor `ensureDefaultRoleAcls()`
Replace hardcoded feature arrays with a merge loop over `mod.setup.defaultRoleFeatures`.

### 5e. Call module `onTenantCreated` hooks
Replace `ensureSalesNumberingDefaults(em, { tenantId, organizationId })` with:
```typescript
for (const mod of resolvedModules) {
  if (mod.setup?.onTenantCreated) {
    await mod.setup.onTenantCreated({ em, tenantId, organizationId })
  }
}
```

### 5f. Provide fallback for modules
```typescript
import { getModules } from '@open-mercato/shared/modules/runtime'
const resolvedModules = modules ?? getModules?.() ?? []
```

---

## Step 6: Refactor `mercato init` command

**File:** `packages/cli/src/mercato.ts`

### 6a. Add topological sort helper
Sort modules by `ModuleInfo.requires` so dependencies seed before dependents:
```typescript
function sortByDependencies(modules: Module[]): Module[] {
  // Topological sort using module.info.requires
  // e.g., sales (requires: [catalog, customers]) runs after catalog + customers
}
```

### 6b. Replace hardcoded structural seeds (lines 299-363)
Replace ~15 `runModuleCommand` calls with:
```typescript
const sorted = sortByDependencies(allModules)
for (const mod of sorted) {
  if (mod.setup?.seedDefaults) {
    console.log(`📦 Seeding ${mod.info?.title ?? mod.id} defaults...`)
    await mod.setup.seedDefaults({ em, tenantId, organizationId, container })
    console.log(`✅ ${mod.info?.title ?? mod.id} defaults seeded\n`)
  }
}
```

### 6c. Replace hardcoded example seeds (lines 365-403)
```typescript
if (skipExamples) {
  console.log('🚫 Example data seeding skipped (--no-examples)\n')
} else {
  for (const mod of sorted) {
    if (mod.setup?.seedExamples) {
      console.log(`🎨 Seeding ${mod.info?.title ?? mod.id} examples...`)
      await mod.setup.seedExamples({ em, tenantId, organizationId, container })
      console.log(`✅ ${mod.info?.title ?? mod.id} examples seeded\n`)
    }
  }
}
```

### 6d. Keep non-module-specific steps
These remain in `mercato.ts` as they are cross-cutting concerns:
- Feature toggle defaults (`feature_toggles seed-defaults`)
- Encryption defaults (`entities seed-encryption`)
- Dashboard widget defaults (`dashboards seed-defaults`)
- Search reindex
- Query index rebuild
- Custom field reinstall (on `--reinstall`)

---

## Step 7: Update callers of `setupInitialTenant`

### `packages/core/src/modules/auth/cli.ts`
Pass modules registry to `setupInitialTenant`.

### `packages/onboarding/.../verify.ts`
- Remove direct imports of `seedCustomerDictionaries`, `seedCustomerExamples`, `seedCurrencyDictionary`.
- Rely on `onTenantCreated` hooks for structural setup.
- For onboarding-specific seeding (customer examples for new tenants), iterate enabled modules' `seedDefaults` + `seedExamples`.

---

## Step 8: Update `upgrade-actions.ts` (phase 2, separate PR)

The upgrade actions file has similar coupling but is architecturally different (versioned, one-time). Options:
- **Short-term**: Wrap each import in a dynamic `import()` with try/catch so missing modules don't crash.
- **Long-term**: Add an `upgrades.ts` convention per module, auto-discovered like `setup.ts`.

Out of scope for the initial PR.

---

## Behavior with `--no-examples`

After this refactor, `yarn initialize -- --no-examples` works as follows:

```
1. modules:prepare         → generator discovers all setup.ts files
2. db:migrate              → migrations run
3. bootstrap               → modules registered in DI

4. auth setup              → setupInitialTenant()
   ├── Creates tenant, org, users
   ├── ensureDefaultRoleAcls()  ← merges defaultRoleFeatures from ALL enabled modules
   └── onTenantCreated()        ← called for each enabled module (structural settings)
       ├── sales:    SalesSettings + sequences    (only if sales enabled)
       ├── catalog:  (nothing)
       └── ...

5. seedDefaults loop       ← always runs, iterates enabled modules
   ├── customers:  dictionaries
   ├── currencies: currency list
   ├── catalog:    units, price kinds
   ├── sales:      tax rates, statuses, methods     (only if sales enabled)
   ├── staff:      address types
   ├── resources:  address types
   ├── planner:    unavailability reasons
   └── workflows:  workflow definitions

6. seedExamples loop       ← SKIPPED (--no-examples)
   (would have seeded: catalog products, customers, orders, staff, resources, planner)

7. Cross-cutting:          ← always runs
   ├── feature_toggles seed-defaults
   ├── entities seed-encryption
   ├── dashboards seed-defaults
   ├── search reindex
   └── query_index reindex
```

If a module like `sales` is **not enabled**, its `setup.ts` is never discovered by the generator, so it's simply absent from the module registry. No import errors, no runtime crashes. The init proceeds with whichever modules are enabled.

---

## Files to Create

| File | Purpose |
|------|---------|
| `packages/shared/src/modules/setup.ts` | `ModuleSetupConfig` type definition |
| ~22 `setup.ts` files (one per module) | See matrix in Step 4 |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/shared/src/modules/registry.ts` | Add `setup?: ModuleSetupConfig` to `Module` type |
| `packages/cli/src/lib/generators/module-registry.ts` | Add `setup.ts` discovery block + include in module decl |
| `packages/core/src/modules/auth/lib/setup-app.ts` | Remove sales imports, delete `ensureSalesNumberingDefaults`, refactor `ensureDefaultRoleAcls`, add `onTenantCreated` loop |
| `packages/core/src/modules/auth/cli.ts` | Pass modules to `setupInitialTenant` |
| `packages/cli/src/mercato.ts` | Replace hardcoded `runModuleCommand` calls with `seedDefaults`/`seedExamples` loops |
| `packages/onboarding/.../verify.ts` | Remove direct seed imports, use hooks |

---

## Verification

1. **Build check**: `npm run build` -- no broken imports.
2. **Generator check**: `npm run modules:prepare` -- `setup.ts` files discovered in `modules.generated.ts`.
3. **Feature parity test**: Verify merged `defaultRoleFeatures` across all modules produces the same admin/employee feature set as the current hardcoded lists.
4. **Init with examples**: `yarn initialize` -- all structural + example data seeded, same as before.
5. **Init without examples**: `yarn initialize -- --no-examples` -- structural data seeded, example data skipped, no errors.
6. **Disabled module**: Remove `sales` from enabled modules, run `yarn initialize` -- no compile/runtime errors, everything except sales data seeds correctly.
7. **Onboarding flow**: Self-service onboarding creates tenant with correct structural defaults for enabled modules.

---

## Changelog

### 2026-01-27
- Initial specification
- Added `--no-examples` analysis: three lifecycle hooks (`onTenantCreated`, `seedDefaults`, `seedExamples`)
- Added `mercato init` decoupling (Step 6) with dependency-ordered seed loops
- Added behavior flowchart for `--no-examples`
