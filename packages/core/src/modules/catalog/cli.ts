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
import { CatalogProductPrice, CatalogPriceHistoryEntry } from './data/entities'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { OmnibusConfig } from './data/validators'
import { buildHistoryEntry, MS_PER_DAY } from './lib/omnibus'
import type { PriceHistorySnapshot } from './lib/omnibus'

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
      const config = (await moduleConfigService.getValue<OmnibusConfig>('catalog', 'catalog.omnibus', { defaultValue: {} })) ?? {}

      const lookbackDays = channelId
        ? (config.channels?.[channelId]?.lookbackDays ?? config.lookbackDays ?? 30)
        : (config.lookbackDays ?? 30)

      const windowStart = new Date(Date.now() - lookbackDays * MS_PER_DAY)
      const recordedAt = new Date(windowStart.getTime() - 1)

      const priceFilters: Record<string, unknown> = { organization_id: organizationId, tenant_id: tenantId }
      if (channelId) {
        priceFilters.channel_id = channelId
      }

      const totalPrices = await em.count(CatalogProductPrice, priceFilters)
      console.log(`Found ${totalPrices} price rows to backfill (lookback: ${lookbackDays} days, window start: ${windowStart.toISOString()})`)

      let offset = 0
      let inserted = 0
      let skipped = 0

      while (offset < totalPrices) {
        const prices = await em.find(
          CatalogProductPrice,
          priceFilters,
          {
            populate: ['priceKind', 'product', 'variant', 'offer'],
            limit: batchSize,
            offset,
            orderBy: { id: 'ASC' },
          }
        )
        if (prices.length === 0) break

        for (const price of prices) {
          const priceKind = typeof price.priceKind === 'string' ? null : price.priceKind
          if (!priceKind) { skipped++; continue }
          const productId = price.product
            ? (typeof price.product === 'string' ? price.product : price.product.id)
            : price.variant
              ? (typeof price.variant === 'object' && price.variant?.product
                  ? (typeof price.variant.product === 'string' ? price.variant.product : price.variant.product.id)
                  : null)
              : null
          if (!productId) { skipped++; continue }

          const existingCount = await em.count(CatalogPriceHistoryEntry, {
            priceId: price.id,
            organizationId,
            tenantId,
          })
          if (existingCount > 0) { skipped++; continue }

          const snapshot: PriceHistorySnapshot = {
            id: price.id,
            tenantId: price.tenantId,
            organizationId: price.organizationId,
            productId,
            variantId: price.variant ? (typeof price.variant === 'string' ? price.variant : price.variant.id) : null,
            offerId: price.offer ? (typeof price.offer === 'string' ? price.offer : price.offer.id) : null,
            channelId: price.channelId ?? null,
            priceKindId: priceKind.id,
            priceKindCode: priceKind.code,
            currencyCode: price.currencyCode,
            unitPriceNet: price.unitPriceNet ?? null,
            unitPriceGross: price.unitPriceGross ?? null,
            taxRate: price.taxRate ?? null,
            taxAmount: price.taxAmount ?? null,
            minQuantity: price.minQuantity,
            maxQuantity: price.maxQuantity ?? null,
            startsAt: price.startsAt ? price.startsAt.toISOString() : null,
            endsAt: price.endsAt ? price.endsAt.toISOString() : null,
          }
          const fields = buildHistoryEntry({ snapshot, changeType: 'create', source: 'system' })
          const entry = em.create(CatalogPriceHistoryEntry, { ...fields, recordedAt, idempotencyKey: null })
          em.persist(entry)
          inserted++
        }

        await em.flush()
        offset += prices.length
        console.log(`Progress: ${Math.min(offset, totalPrices)}/${totalPrices} (inserted: ${inserted}, skipped: ${skipped})`)
      }

      if (channelId) {
        const backfillCoverage = { ...(config.backfillCoverage ?? {}), [channelId]: { completedAt: new Date().toISOString(), lookbackDays } }
        await moduleConfigService.setValue('catalog', 'catalog.omnibus', { ...config, backfillCoverage })
        console.log(`Updated backfillCoverage for channel ${channelId}`)
      }

      console.log(`Omnibus backfill complete: ${inserted} entries inserted, ${skipped} skipped`)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

export default [seedUnitsCommand, seedPriceKindsCommand, seedExamplesCommand, installExamplesBundle, omnibusBackfillCommand]
