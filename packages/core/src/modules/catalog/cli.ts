import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  installExampleCatalogData,
  seedCatalogExamplesForScope,
  seedCatalogPriceKinds,
  seedCatalogUnits,
  type CatalogSeedScope,
} from './lib/seeds'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { OmnibusConfig } from './data/validators'
import type { CatalogOmnibusService } from './services/catalogOmnibusService'

function parseArgs(rest: string[]) {
  const args: Record<string, string> = {}
  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i]
    if (!part) continue
    if (part.startsWith('--')) {
      const [rawKey, rawValue] = part.slice(2).split('=')
      if (rawValue !== undefined) args[rawKey] = rawValue
      else if (rest[i + 1] && !rest[i + 1]!.startsWith('--')) {
        args[rawKey] = rest[i + 1]!
        i += 1
      }
    }
  }
  return args
}

const seedUnitsCommand: ModuleCli = {
  command: 'seed-units',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato catalog seed-units --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: CatalogSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedCatalogUnits(tem, scope)
      })
      console.log('📏 Unit dictionary seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedPriceKindsCommand: ModuleCli = {
  command: 'seed-price-kinds',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId) {
      console.error('Usage: mercato catalog seed-price-kinds --tenant <tenantId> [--org <organizationId>]')
      return
    }
    const container = await createRequestContainer()
    const scope = { tenantId, organizationId: organizationId || null }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedCatalogPriceKinds(tem, scope)
      })
      console.log(
        '🏷️ Price kinds seeded for tenant',
        tenantId,
        organizationId ? `(org: ${organizationId})` : '(org: shared)',
      )
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedExamplesCommand: ModuleCli = {
  command: 'seed-examples',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato catalog seed-examples --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: CatalogSeedScope = { tenantId, organizationId }
    let seeded = false
    try {
      const em = container.resolve<EntityManager>('em')
      seeded = await em.transactional(async (tem) =>
        seedCatalogExamplesForScope(tem, container, scope)
      )
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
    if (seeded) {
      console.log('Catalog example data seeded for organization', organizationId)
    } else {
      console.log('Catalog example data already present; skipping')
    }
  },
}

const installExamplesBundle: ModuleCli = {
  command: 'seed-examples-bundle',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato catalog seed-examples-bundle --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: CatalogSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      const { seededExamples } = await em.transactional(async (tem) =>
        installExampleCatalogData(container, scope, tem)
      )
      if (seededExamples) {
        console.log('Catalog example data seeded for organization', organizationId)
      } else {
        console.log('Catalog example data already present; skipping examples')
      }
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}


const omnibusBackfillCommand: ModuleCli = {
  command: 'omnibus:backfill',
  async run(rest) {
    const args = parseArgs(rest)
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const channelId = args.channelId ?? args.channel ?? null
    const batchSize = parseInt(args.batchSize ?? args['batch-size'] ?? '500', 10) || 500

    if (!organizationId || !tenantId) {
      console.error('Usage: mercato catalog omnibus:backfill --org <organizationId> --tenant <tenantId> [--channel-id <channelId>] [--batch-size 500]')
      return
    }

    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      const moduleConfigService = container.resolve<ModuleConfigService>('moduleConfigService')
      const omnibusService = container.resolve<CatalogOmnibusService>('catalogOmnibusService')
      const config = (await moduleConfigService.getValue<OmnibusConfig>('catalog', 'catalog.omnibus', { defaultValue: {} })) ?? {}

      if (channelId) {
        const lookbackDays = config.channels?.[channelId]?.lookbackDays ?? config.lookbackDays ?? 30
        console.log(`Running omnibus backfill for channel ${channelId}`)
        const { inserted, skipped } = await omnibusService.backfillChannel(em, { organizationId, tenantId, channelId, lookbackDays, batchSize })
        const backfillCoverage = { ...(config.backfillCoverage ?? {}), [channelId]: { completedAt: new Date().toISOString(), lookbackDays } }
        await moduleConfigService.setValue('catalog', 'catalog.omnibus', { ...config, backfillCoverage })
        console.log(`Omnibus backfill complete: ${inserted} entries inserted, ${skipped} skipped`)
      } else if (config.channels && Object.keys(config.channels).length > 0) {
        const configuredChannels = Object.entries(config.channels)
        console.log(`Running omnibus backfill for ${configuredChannels.length} configured channel(s)`)
        let totalInserted = 0
        let totalSkipped = 0
        let backfillCoverage = { ...(config.backfillCoverage ?? {}) }
        for (const [chId, chConfig] of configuredChannels) {
          const lookbackDays = chConfig.lookbackDays ?? config.lookbackDays ?? 30
          console.log(`Channel ${chId} (lookback: ${lookbackDays} days)`)
          const { inserted, skipped } = await omnibusService.backfillChannel(em, { organizationId, tenantId, channelId: chId, lookbackDays, batchSize })
          backfillCoverage = { ...backfillCoverage, [chId]: { completedAt: new Date().toISOString(), lookbackDays } }
          totalInserted += inserted
          totalSkipped += skipped
        }
        await moduleConfigService.setValue('catalog', 'catalog.omnibus', { ...config, backfillCoverage })
        console.log(`Omnibus backfill complete: ${totalInserted} entries inserted, ${totalSkipped} skipped`)
      } else {
        const lookbackDays = config.lookbackDays ?? 30
        console.log('Running omnibus backfill (no channel scope)')
        const { inserted, skipped } = await omnibusService.backfillChannel(em, { organizationId, tenantId, channelId: null, lookbackDays, batchSize })
        console.log(`Omnibus backfill complete: ${inserted} entries inserted, ${skipped} skipped`)
      }
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

export default [seedUnitsCommand, seedPriceKindsCommand, seedExamplesCommand, installExamplesBundle, omnibusBackfillCommand]
