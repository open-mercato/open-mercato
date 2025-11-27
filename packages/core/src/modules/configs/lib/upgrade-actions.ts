import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { Role, RoleAcl } from '@open-mercato/core/modules/auth/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { installExampleCatalogData, type CatalogSeedScope } from '@open-mercato/core/modules/catalog/lib/seeds'

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

export function actionsForVersion(version: string): UpgradeActionDefinition[] {
  return upgradeActions.filter((action) => action.version === version)
}

export function findUpgradeAction(actionId: string, version: string): UpgradeActionDefinition | undefined {
  return upgradeActions.find((action) => action.id === actionId && action.version === version)
}
