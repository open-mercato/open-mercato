import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { installExampleCatalogData, type CatalogSeedScope } from '@open-mercato/core/modules/catalog/lib/seeds'
import { seedSalesExamples } from '@open-mercato/core/modules/sales/seed/examples'
import { reindexModules } from '@open-mercato/core/modules/configs/lib/reindex-helpers'
import type { VectorIndexService } from '@open-mercato/vector'

function resolveVectorService(container: AwilixContainer): VectorIndexService | null {
  try {
    return container.resolve<VectorIndexService>('vectorIndexService')
  } catch {
    return null
  }
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
    },
  },
]

export function actionsForVersion(version: string): UpgradeActionDefinition[] {
  return upgradeActions.filter((action) => action.version === version)
}

export function findUpgradeAction(actionId: string, version: string): UpgradeActionDefinition | undefined {
  return upgradeActions.find((action) => action.id === actionId && action.version === version)
}
