import { runWithCacheTenant } from '@open-mercato/cache'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { Role, RoleAcl } from '@open-mercato/core/modules/auth/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { reindexModules } from '@open-mercato/core/modules/configs/lib/reindex-helpers'
import { installExampleCatalogData, type CatalogSeedScope } from '@open-mercato/core/modules/catalog/lib/seeds'
import { seedSalesExamples } from '@open-mercato/core/modules/sales/seed/examples'
import { seedExampleCurrencies } from '@open-mercato/core/modules/currencies/lib/seeds'
import { seedExampleWorkflows } from '@open-mercato/core/modules/workflows/lib/seeds'
import { seedPlannerAvailabilityRuleSetDefaults, seedPlannerUnavailabilityReasons } from '@open-mercato/core/modules/planner/lib/seeds'
import { seedResourcesAddressTypes, seedResourcesCapacityUnits, seedResourcesResourceExamples } from '@open-mercato/core/modules/resources/lib/seeds'
import { seedStaffTeamExamples } from '@open-mercato/core/modules/staff/lib/seeds'
import { collectCrudCacheStats, purgeCrudCacheSegment } from '@open-mercato/shared/lib/crud/cache-stats'
import { isCrudCacheEnabled, resolveCrudCache } from '@open-mercato/shared/lib/crud/cache'
import * as semver from 'semver'
import type { VectorIndexService } from '@open-mercato/search/vector'
import { EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'
import { DEFAULT_ENCRYPTION_MAPS } from '@open-mercato/core/modules/entities/lib/encryptionDefaults'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'

function resolveVectorService(container: AwilixContainer): VectorIndexService | null {
  try {
    return container.resolve<VectorIndexService>('vectorIndexService')
  } catch {
    return null
  }
}

function resolveEncryptionService(container: AwilixContainer): TenantDataEncryptionService | null {
  try {
    return container.resolve<TenantDataEncryptionService>('tenantEncryptionService')
  } catch {
    return null
  }
}

async function ensureVectorSearchEncryptionMap(
  em: EntityManager,
  tenantId: string,
  organizationId: string | null,
): Promise<boolean> {
  const spec = DEFAULT_ENCRYPTION_MAPS.find((entry) => entry.entityId === 'vector:vector_search')
  const required = spec?.fields ?? []
  if (!required.length) return false

  const repo = em.getRepository(EncryptionMap)
  const existing = await repo.findOne({
    entityId: 'vector:vector_search',
    tenantId,
    organizationId,
    deletedAt: null,
  })

  if (!existing) {
    em.persist(
      em.create(EncryptionMap, {
        entityId: 'vector:vector_search',
        tenantId,
        organizationId,
        fieldsJson: required,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
    await em.flush()
    return true
  }

  const existingFields = Array.isArray(existing.fieldsJson) ? existing.fieldsJson : []
  const byField = new Map<string, { field: string; hashField?: string | null }>()
  for (const item of existingFields) {
    if (!item?.field) continue
    byField.set(item.field, item)
  }
  for (const req of required) {
    if (!req?.field) continue
    if (byField.has(req.field)) continue
    byField.set(req.field, req)
  }

  const merged = Array.from(byField.values())
  const changed = merged.length !== existingFields.length
  if (!changed && existing.isActive) return false

  existing.fieldsJson = merged
  existing.isActive = true
  existing.updatedAt = new Date()
  await em.flush()
  return true
}

export type UpgradeActionContext = CatalogSeedScope & {
  container: AwilixContainer
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

async function purgeCatalogCrudCache(container: AwilixContainer, tenantId: string | null) {
  if (!isCrudCacheEnabled()) return
  const cache = resolveCrudCache(container)
  if (!cache) return
  await runWithCacheTenant(tenantId ?? null, async () => {
    const stats = await collectCrudCacheStats(cache)
    const catalogSegments = stats.segments.filter((segment) => segment.resource?.startsWith('catalog.'))
    if (!catalogSegments.length) return
    for (const segment of catalogSegments) {
      try {
        await purgeCrudCacheSegment(cache, segment.segment)
      } catch (error) {
        console.warn('[upgrade-actions] failed to purge catalog cache segment', {
          tenantId,
          segment: segment.segment,
          error,
        })
      }
    }
  })
}

export const upgradeActions: UpgradeActionDefinition[] = [
  {
    id: 'configs.upgrades.catalog.examples',
    version: '0.3.4',
    messageKey: 'upgrades.v034.message',
    ctaKey: 'upgrades.v034.cta',
    successKey: 'upgrades.v034.success',
    loadingKey: 'upgrades.v034.loading',
    async run({ container, em, tenantId, organizationId }) {
      await installExampleCatalogData(container, { tenantId, organizationId }, em)
      const vectorService = resolveVectorService(container)
      await reindexModules(em, ['catalog'], { tenantId, organizationId, vectorService })
    },
  },
  {
    id: 'configs.upgrades.auth.admin_business_rules_acl',
    version: '0.3.5',
    messageKey: 'upgrades.v035.message',
    ctaKey: 'upgrades.v035.cta',
    successKey: 'upgrades.v035.success',
    loadingKey: 'upgrades.v035.loading',
    async run({ container, em, tenantId }) {
      const normalizedTenantId = tenantId.trim()
      await em.transactional(async (tem) => {
        const adminRole = await tem.findOne(Role, { name: 'admin', tenantId: normalizedTenantId, deletedAt: null })
        if (!adminRole) return

        const roleAcls = await tem.find(RoleAcl, { role: adminRole, tenantId: normalizedTenantId, deletedAt: null })
        let touched = false
        if (!roleAcls.length) {
          tem.persist(
            tem.create(RoleAcl, {
              role: adminRole,
              tenantId: normalizedTenantId,
              featuresJson: ['business_rules.*'],
              isSuperAdmin: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            }),
          )
          touched = true
        }

        for (const acl of roleAcls) {
          const features = Array.isArray(acl.featuresJson) ? [...acl.featuresJson] : []
          if (features.includes('business_rules.*')) continue
          acl.featuresJson = [...features, 'business_rules.*']
          acl.updatedAt = new Date()
          touched = true
        }

        if (touched) {
          await tem.flush()
        }
      })

      const rbac = container.resolve<RbacService>('rbacService')
      await rbac.invalidateTenantCache(normalizedTenantId)
    },
  },
  {
    id: 'configs.upgrades.sales.examples',
    version: '0.3.6',
    messageKey: 'upgrades.v036.message',
    ctaKey: 'upgrades.v036.cta',
    successKey: 'upgrades.v036.success',
    loadingKey: 'upgrades.v036.loading',
    async run({ container, em, tenantId, organizationId }) {
      await em.transactional(async (tem) => {
        await seedSalesExamples(tem, container, { tenantId, organizationId })
      })
      const vectorService = resolveVectorService(container)
      await reindexModules(em, ['sales', 'catalog'], { tenantId, organizationId, vectorService })
      await purgeCatalogCrudCache(container, tenantId)
    },
  },
  {
    id: 'configs.upgrades.vector.encryption_vector_search',
    version: '0.3.6',
    messageKey: 'upgrades.v036_vector_encryption.message',
    ctaKey: 'upgrades.v036_vector_encryption.cta',
    successKey: 'upgrades.v036_vector_encryption.success',
    loadingKey: 'upgrades.v036_vector_encryption.loading',
    async run({ container, em, tenantId, organizationId }) {
      const normalizedTenantId = tenantId.trim()
      const normalizedOrgId = organizationId ?? null

      const encryptionService = resolveEncryptionService(container)
      if (!encryptionService?.isEnabled?.()) {
        return
      }

      const updated = await em.transactional(async (tem) => {
        return ensureVectorSearchEncryptionMap(tem, normalizedTenantId, normalizedOrgId)
      })

      if (updated) {
        await encryptionService.invalidateMap('vector:vector_search', normalizedTenantId, normalizedOrgId)
      }

      const vectorService = resolveVectorService(container)
      if (vectorService) {
        await vectorService.reindexAll({ tenantId: normalizedTenantId, organizationId: normalizedOrgId, purgeFirst: false })
      }
    },
  },
  {
    id: 'configs.upgrades.examples.currencies_workflows',
    version: '0.3.13',
    messageKey: 'upgrades.v0313.message',
    ctaKey: 'upgrades.v0313.cta',
    successKey: 'upgrades.v0313.success',
    loadingKey: 'upgrades.v0313.loading',
    async run({ container, em, tenantId, organizationId }) {
      const normalizedTenantId = tenantId.trim()
      const scope = { tenantId, organizationId }
      await em.transactional(async (tem) => {
        await seedExampleCurrencies(tem, scope)
        await seedExampleWorkflows(tem, scope)

        const adminRole = await tem.findOne(Role, { name: 'admin', tenantId: normalizedTenantId, deletedAt: null })
        if (!adminRole) return

        const roleAcls = await tem.find(RoleAcl, { role: adminRole, tenantId: normalizedTenantId, deletedAt: null })
        let touched = false
        if (!roleAcls.length) {
          tem.persist(
            tem.create(RoleAcl, {
              role: adminRole,
              tenantId: normalizedTenantId,
              featuresJson: ['search.*', 'feature_toggles.*', 'currencies.*'],
              isSuperAdmin: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            }),
          )
          touched = true
        }

        for (const acl of roleAcls) {
          const features = Array.isArray(acl.featuresJson) ? [...acl.featuresJson] : []
          const nextFeatures = new Set(features)
          nextFeatures.add('search.*')
          nextFeatures.add('feature_toggles.*')
          nextFeatures.add('currencies.*')
          if (nextFeatures.size === features.length) continue
          acl.featuresJson = Array.from(nextFeatures)
          acl.updatedAt = new Date()
          touched = true
        }

        if (touched) {
          await tem.flush()
        }
      })
      const rbac = container.resolve<RbacService>('rbacService')
      await rbac.invalidateTenantCache(normalizedTenantId)
    },
  },
  {
    id: 'configs.upgrades.examples.planner_staff_resources',
    version: '0.4.1',
    messageKey: 'upgrades.v041.message',
    ctaKey: 'upgrades.v041.cta',
    successKey: 'upgrades.v041.success',
    loadingKey: 'upgrades.v041.loading',
    async run({ container, em, tenantId, organizationId }) {
      const normalizedTenantId = tenantId.trim()
      const scope = { tenantId, organizationId }
      await em.transactional(async (tem) => {
        await seedPlannerAvailabilityRuleSetDefaults(tem, scope)
        await seedPlannerUnavailabilityReasons(tem, scope)
        await seedStaffTeamExamples(tem, scope)
        await seedResourcesCapacityUnits(tem, scope)
        await seedResourcesAddressTypes(tem, scope)
        await seedResourcesResourceExamples(tem, scope)

        const adminRole = await tem.findOne(Role, { name: 'admin', tenantId: normalizedTenantId, deletedAt: null })
        if (!adminRole) return

        const roleAcls = await tem.find(RoleAcl, { role: adminRole, tenantId: normalizedTenantId, deletedAt: null })
        const addedFeatures = [
          'staff.*',
          'staff.leave_requests.manage',
          'resources.*',
          'planner.*',
        ]
        let touched = false
        if (!roleAcls.length) {
          tem.persist(
            tem.create(RoleAcl, {
              role: adminRole,
              tenantId: normalizedTenantId,
              featuresJson: addedFeatures,
              isSuperAdmin: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            }),
          )
          touched = true
        }

        for (const acl of roleAcls) {
          const features = Array.isArray(acl.featuresJson) ? [...acl.featuresJson] : []
          const nextFeatures = new Set(features)
          for (const feature of addedFeatures) nextFeatures.add(feature)
          if (nextFeatures.size === features.length) continue
          acl.featuresJson = Array.from(nextFeatures)
          acl.updatedAt = new Date()
          touched = true
        }

        if (touched) {
          await tem.flush()
        }
      })

      const rbac = container.resolve<RbacService>('rbacService')
      await rbac.invalidateTenantCache(normalizedTenantId)

      const vectorService = resolveVectorService(container)
      await reindexModules(em, ['planner', 'staff', 'resources'], { tenantId, organizationId, vectorService })
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
