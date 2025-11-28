import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { Role, RoleAcl } from '@open-mercato/core/modules/auth/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { installExampleCatalogData, type CatalogSeedScope } from '@open-mercato/core/modules/catalog/lib/seeds'
import { runWithCacheTenant } from '@open-mercato/cache'
import { collectCrudCacheStats, purgeCrudCacheSegment } from '@open-mercato/shared/lib/crud/cache-stats'
import { isCrudCacheEnabled, resolveCrudCache } from '@open-mercato/shared/lib/crud/cache'
import * as semver from 'semver'

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
      await purgeCatalogCrudCache(container, tenantId)
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
