import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { installExampleCatalogData, type CatalogSeedScope } from '@open-mercato/core/modules/catalog/lib/seeds'
import { runWithCacheTenant } from '@open-mercato/cache'
import { collectCrudCacheStats, purgeCrudCacheSegment } from '@open-mercato/shared/lib/crud/cache-stats'
import { isCrudCacheEnabled, resolveCrudCache } from '@open-mercato/shared/lib/crud/cache'

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

function compareVersions(a: string, b: string): number {
  const parse = (value: string) => value.split('.').map((part) => Number(part) || 0)
  const [aMajor, aMinor, aPatch] = parse(a)
  const [bMajor, bMinor, bPatch] = parse(b)
  if (aMajor !== bMajor) return aMajor - bMajor
  if (aMinor !== bMinor) return aMinor - bMinor
  if (aPatch !== bPatch) return aPatch - bPatch
  return 0
}

async function purgeCatalogCrudCache(container: AwilixContainer, tenantId: string | null) {
  if (!isCrudCacheEnabled()) return
  const cache = resolveCrudCache(container)
  if (!cache) return
  await runWithCacheTenant(tenantId ?? null, async () => {
    try {
      const stats = await collectCrudCacheStats(cache)
      const catalogSegments = stats.segments.filter((segment) => segment.resource?.startsWith('catalog.'))
      if (!catalogSegments.length) return
      for (const segment of catalogSegments) {
        await purgeCrudCacheSegment(cache, segment.segment)
      }
    } catch (error) {
      console.warn('[upgrade-actions] failed to purge catalog cache segments', {
        tenantId,
        error,
      })
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
