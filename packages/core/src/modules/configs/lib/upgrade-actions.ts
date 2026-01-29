import type { EntityManager } from '@mikro-orm/postgresql'
import * as semver from 'semver'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { Role, RoleAcl } from '@open-mercato/core/modules/auth/data/entities'
import { normalizeTenantId } from '@open-mercato/core/modules/auth/lib/tenantAccess'

export type UpgradeActionContext = {
  tenantId: string
  organizationId: string
  container: AppContainer
  em: EntityManager
}

export type UpgradeActionDefinition = {
  id: string
  version: string
  messageKey: string
  ctaKey: string
  successKey: string
  loadingKey?: string
  run: (ctx: UpgradeActionContext) => Promise<void>
}

/**
 * Compare two semantic version strings.
 * Uses the semver library for robust version comparison.
 * Returns negative if a < b, positive if a > b, 0 if equal.
 * Throws an error if either version string is invalid.
 */
export function compareVersions(a: string, b: string): number {
  const cleanA = semver.valid(semver.coerce(a))
  const cleanB = semver.valid(semver.coerce(b))
  if (!cleanA) {
    throw new Error(`Invalid version string: "${a}". Expected a valid semver format (e.g., "1.2.3").`)
  }
  if (!cleanB) {
    throw new Error(`Invalid version string: "${b}". Expected a valid semver format (e.g., "1.2.3").`)
  }
  return semver.compare(cleanA, cleanB)
}

type RoleName = 'superadmin' | 'admin' | 'employee'

function collectRoleFeatures(modules: Module[], moduleIds: string[]): Record<RoleName, string[]> {
  const result: Record<RoleName, string[]> = {
    superadmin: [],
    admin: [],
    employee: [],
  }
  const targetIds = new Set(moduleIds)
  for (const mod of modules) {
    if (!targetIds.has(mod.id)) continue
    const roleFeatures = mod.setup?.defaultRoleFeatures
    if (roleFeatures?.superadmin) result.superadmin.push(...roleFeatures.superadmin)
    if (roleFeatures?.admin) result.admin.push(...roleFeatures.admin)
    if (roleFeatures?.employee) result.employee.push(...roleFeatures.employee)
  }
  result.superadmin = Array.from(new Set(result.superadmin))
  result.admin = Array.from(new Set(result.admin))
  result.employee = Array.from(new Set(result.employee))
  return result
}

async function findRoleByName(
  em: EntityManager,
  name: string,
  tenantId: string | null,
): Promise<Role | null> {
  const normalizedTenant = normalizeTenantId(tenantId ?? null) ?? null
  let role = await em.findOne(Role, { name, tenantId: normalizedTenant })
  if (!role && normalizedTenant !== null) {
    role = await em.findOne(Role, { name, tenantId: null })
  }
  return role
}

async function ensureRoleAclFor(
  em: EntityManager,
  role: Role,
  tenantId: string,
  features: string[],
  options: { isSuperAdmin?: boolean } = {},
) {
  const existing = await em.findOne(RoleAcl, { role, tenantId })
  if (!existing) {
    const acl = em.create(RoleAcl, {
      role,
      tenantId,
      featuresJson: features,
      isSuperAdmin: !!options.isSuperAdmin,
      createdAt: new Date(),
    })
    await em.persistAndFlush(acl)
    return
  }
  const currentFeatures = Array.isArray(existing.featuresJson) ? existing.featuresJson : []
  const merged = Array.from(new Set([...currentFeatures, ...features]))
  const changed =
    merged.length !== currentFeatures.length ||
    merged.some((value, index) => value !== currentFeatures[index])
  if (changed) existing.featuresJson = merged
  if (options.isSuperAdmin && !existing.isSuperAdmin) {
    existing.isSuperAdmin = true
  }
  if (changed || options.isSuperAdmin) {
    await em.persistAndFlush(existing)
  }
}

async function ensureRoleAclsForModules(
  em: EntityManager,
  tenantId: string,
  moduleIds: string[],
) {
  const modules = getModules()
  const roleFeatures = collectRoleFeatures(modules, moduleIds)
  if (!roleFeatures.superadmin.length && !roleFeatures.admin.length && !roleFeatures.employee.length) {
    return
  }
  const normalizedTenant = normalizeTenantId(tenantId) ?? null
  const [superadminRole, adminRole, employeeRole] = await Promise.all([
    findRoleByName(em, 'superadmin', normalizedTenant),
    findRoleByName(em, 'admin', normalizedTenant),
    findRoleByName(em, 'employee', normalizedTenant),
  ])
  if (superadminRole && roleFeatures.superadmin.length) {
    await ensureRoleAclFor(em, superadminRole, tenantId, roleFeatures.superadmin, { isSuperAdmin: true })
  }
  if (adminRole && roleFeatures.admin.length) {
    await ensureRoleAclFor(em, adminRole, tenantId, roleFeatures.admin)
  }
  if (employeeRole && roleFeatures.employee.length) {
    await ensureRoleAclFor(em, employeeRole, tenantId, roleFeatures.employee)
  }
}

async function safeImport<T>(label: string, loader: () => Promise<T>): Promise<T | null> {
  try {
    return await loader()
  } catch (error) {
    console.warn(`[upgrade-actions] Skipping ${label} because module import failed.`, error)
    return null
  }
}

export const upgradeActions: UpgradeActionDefinition[] = [
  {
    id: 'configs.upgrades.catalog.examples',
    version: '0.3.4',
    messageKey: 'upgrades.v034.message',
    ctaKey: 'upgrades.v034.cta',
    successKey: 'upgrades.v034.success',
    loadingKey: 'upgrades.v034.loading',
    async run(ctx) {
      const catalogSeeds = await safeImport('catalog examples', () =>
        import('@open-mercato/core/modules/catalog/lib/seeds')
      )
      if (!catalogSeeds?.installExampleCatalogData) return
      await catalogSeeds.installExampleCatalogData(
        ctx.container,
        { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
        ctx.em,
      )
    },
  },
  {
    id: 'configs.upgrades.sales.examples',
    version: '0.3.6',
    messageKey: 'upgrades.v036.message',
    ctaKey: 'upgrades.v036.cta',
    successKey: 'upgrades.v036.success',
    loadingKey: 'upgrades.v036.loading',
    async run(ctx) {
      const salesSeeds = await safeImport('sales examples', () =>
        import('@open-mercato/core/modules/sales/seed/examples')
      )
      if (!salesSeeds?.seedSalesExamples) return
      await salesSeeds.seedSalesExamples(ctx.em, ctx.container, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })
    },
  },
  {
    id: 'configs.upgrades.examples.currencies_workflows',
    version: '0.3.13',
    messageKey: 'upgrades.v0313.message',
    ctaKey: 'upgrades.v0313.cta',
    successKey: 'upgrades.v0313.success',
    loadingKey: 'upgrades.v0313.loading',
    async run(ctx) {
      const currenciesSeeds = await safeImport('currencies examples', () =>
        import('@open-mercato/core/modules/currencies/lib/seeds')
      )
      const workflowsSeeds = await safeImport('workflows examples', () =>
        import('@open-mercato/core/modules/workflows/lib/seeds')
      )
      const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
      if (currenciesSeeds?.seedExampleCurrencies) {
        await currenciesSeeds.seedExampleCurrencies(ctx.em, scope)
      }
      if (workflowsSeeds?.seedExampleWorkflows) {
        await workflowsSeeds.seedExampleWorkflows(ctx.em, scope)
      }
      await ensureRoleAclsForModules(ctx.em, ctx.tenantId, ['currencies', 'workflows'])
    },
  },
  {
    id: 'configs.upgrades.examples.planner_staff_resources',
    version: '0.4.1',
    messageKey: 'upgrades.v041.message',
    ctaKey: 'upgrades.v041.cta',
    successKey: 'upgrades.v041.success',
    loadingKey: 'upgrades.v041.loading',
    async run(ctx) {
      const plannerSeeds = await safeImport('planner examples', () =>
        import('@open-mercato/core/modules/planner/lib/seeds')
      )
      const staffSeeds = await safeImport('staff examples', () =>
        import('@open-mercato/core/modules/staff/lib/seeds')
      )
      const resourcesSeeds = await safeImport('resources examples', () =>
        import('@open-mercato/core/modules/resources/lib/seeds')
      )
      const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
      if (plannerSeeds?.seedPlannerAvailabilityRuleSetDefaults) {
        await plannerSeeds.seedPlannerAvailabilityRuleSetDefaults(ctx.em, scope)
      }
      if (staffSeeds?.seedStaffTeamExamples) {
        await staffSeeds.seedStaffTeamExamples(ctx.em, scope)
      }
      if (resourcesSeeds?.seedResourcesResourceExamples) {
        await resourcesSeeds.seedResourcesResourceExamples(ctx.em, scope)
      }
      await ensureRoleAclsForModules(ctx.em, ctx.tenantId, ['planner', 'staff', 'resources'])
    },
  },
]

export function actionsUpToVersion(version: string): UpgradeActionDefinition[] {
  return upgradeActions
    .filter((action) => compareVersions(action.version, version) <= 0)
    .sort((a, b) => compareVersions(a.version, b.version) || a.id.localeCompare(b.id))
}

export function findUpgradeAction(actionId: string, maxVersion: string): UpgradeActionDefinition | undefined {
  const matches = actionsUpToVersion(maxVersion).filter((action) => action.id === actionId)
  if (!matches.length) return undefined
  return matches[matches.length - 1]
}
