import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import {
  installExampleCatalogData,
  seedCatalogExamplesForScope,
  seedCatalogPriceKinds,
  seedCatalogUnits,
  type CatalogSeedScope,
} from './lib/seeds'
import {
  CATALOG_SETTINGS_MODULE_ID,
  OMNIBUS_CONFIG_KEY,
  OMNIBUS_DEFAULT_LOOKBACK_DAYS,
} from './lib/settings'
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

const OMNIBUS_BACKFILL_USAGE =
  'Usage: mercato catalog omnibus:backfill --org <organizationId> --tenant <tenantId> (--channel-id <channelId> | --all-channels) [--batch-size <n>]'

const OMNIBUS_UNSCOPED_COVERAGE_KEY = ''

type OmnibusBackfillCoverage = NonNullable<OmnibusConfig['backfillCoverage']>

type OmnibusBackfillSummary = {
  label: string
  lookbackDays: number
  inserted: number
  skipped: number
}

function resolveOmnibusBatchSize(raw: string | undefined): number {
  if (raw === undefined) return 500
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --batch-size "${raw}": expected a positive integer.`)
  }
  return parsed
}

const omnibusBackfillCommand: ModuleCli = {
  command: 'omnibus:backfill',
  async run(rest: string[]) {
    const args = parseArgs(rest)
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const channelId = String(args.channelId ?? args['channel-id'] ?? args.channel ?? '')
    const allChannels =
      rest.includes('--all-channels') ||
      parseBooleanWithDefault(args['all-channels'] ?? args.allChannels, false)
    const batchSize = resolveOmnibusBatchSize(args.batchSize ?? args['batch-size'])

    if (!organizationId || !tenantId) {
      console.error(OMNIBUS_BACKFILL_USAGE)
      throw new Error('Both --org and --tenant are required.')
    }
    if (!channelId && !allChannels) {
      console.error(OMNIBUS_BACKFILL_USAGE)
      throw new Error('Provide either --channel-id <channelId> or --all-channels.')
    }
    if (channelId && allChannels) {
      console.error(OMNIBUS_BACKFILL_USAGE)
      throw new Error('--channel-id and --all-channels are mutually exclusive.')
    }

    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      const moduleConfigService = container.resolve<ModuleConfigService>('moduleConfigService')
      const omnibusService = container.resolve<CatalogOmnibusService>('catalogOmnibusService')

      const config = await omnibusService.getConfig({ tenantId })
      const defaultLookbackDays = config.lookbackDays ?? OMNIBUS_DEFAULT_LOOKBACK_DAYS
      const coverage: OmnibusBackfillCoverage = { ...(config.backfillCoverage ?? {}) }
      const summaries: OmnibusBackfillSummary[] = []

      const runFor = async (
        label: string,
        coverageKey: string,
        scopedChannelId: string | null,
        lookbackDays: number,
      ) => {
        const { inserted, skipped } = await omnibusService.backfillChannel(em, {
          organizationId,
          tenantId,
          channelId: scopedChannelId,
          lookbackDays,
          batchSize,
        })
        coverage[coverageKey] = { completedAt: new Date().toISOString(), lookbackDays }
        summaries.push({ label, lookbackDays, inserted, skipped })
      }

      if (channelId) {
        const lookbackDays = config.channels?.[channelId]?.lookbackDays ?? defaultLookbackDays
        await runFor(`channel=${channelId}`, channelId, channelId, lookbackDays)
      } else {
        const enabledCountryCodes = config.enabledCountryCodes ?? []
        const euChannels = Object.entries(config.channels ?? {}).filter(([, channelConfig]) => {
          const countryCode = channelConfig.countryCode
          return typeof countryCode === 'string' && enabledCountryCodes.includes(countryCode)
        })
        if (euChannels.length === 0) {
          console.log(
            'No channel is mapped to an enabled EU country code; backfilling unscoped prices only.',
          )
        }
        const lookbackValues: number[] = []
        for (const [euChannelId, channelConfig] of euChannels) {
          const lookbackDays = channelConfig.lookbackDays ?? defaultLookbackDays
          lookbackValues.push(lookbackDays)
          await runFor(`channel=${euChannelId}`, euChannelId, euChannelId, lookbackDays)
        }
        const unscopedLookbackDays = lookbackValues.length
          ? Math.max(...lookbackValues)
          : defaultLookbackDays
        await runFor(
          'channel=<unscoped>',
          OMNIBUS_UNSCOPED_COVERAGE_KEY,
          null,
          unscopedLookbackDays,
        )
      }

      await moduleConfigService.setValue(
        CATALOG_SETTINGS_MODULE_ID,
        OMNIBUS_CONFIG_KEY,
        { ...config, backfillCoverage: coverage },
        { tenantId },
      )

      let totalInserted = 0
      let totalSkipped = 0
      for (const summary of summaries) {
        totalInserted += summary.inserted
        totalSkipped += summary.skipped
        console.log(
          `${summary.label} lookbackDays=${summary.lookbackDays} inserted=${summary.inserted} skipped=${summary.skipped}`,
        )
      }
      console.log(
        `omnibus:backfill done scopes=${summaries.length} inserted=${totalInserted} skipped=${totalSkipped}`,
      )
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

export default [
  seedUnitsCommand,
  seedPriceKindsCommand,
  seedExamplesCommand,
  installExamplesBundle,
  omnibusBackfillCommand,
]
