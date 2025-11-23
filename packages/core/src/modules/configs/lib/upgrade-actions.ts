import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
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
]

export function actionsForVersion(version: string): UpgradeActionDefinition[] {
  return upgradeActions.filter((action) => action.version === version)
}

export function findUpgradeAction(actionId: string, version: string): UpgradeActionDefinition | undefined {
  return upgradeActions.find((action) => action.id === actionId && action.version === version)
}
