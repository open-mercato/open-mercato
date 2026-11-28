import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'
import { Client } from 'pg'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { CatalogPriceHistoryEntry } from '../../data/entities'
import { createOmnibusOverflowObservations } from '../../__integration__/omnibusOverflowFixture'
import { fetchOmnibusCampaignIds, OMNIBUS_IN_WINDOW_LIMIT } from '../../lib/omnibusHistoryQueries'
import { omnibusConfigSchema } from '../../lib/omnibusTypes'
import { DefaultCatalogOmnibusService } from '../catalogOmnibusService'

const testWithPostgres = process.env.OM_OMNIBUS_PG_URL ? test : test.skip

testWithPostgres('an overflowed offer falls back within its own history scope', async () => {
  const databaseUrl = process.env.OM_OMNIBUS_PG_URL!
  const schema = `omnibus_overflow_${randomUUID().replaceAll('-', '')}`
  const admin = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, query_timeout: 5000 })
  const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const productId = randomUUID()
  const offerId = randomUUID()
  const channelId = randomUUID()
  const priceKindId = randomUUID()
  const priceId = randomUUID()
  const now = new Date('2026-06-10T12:00:00.000Z')
  const day = 24 * 60 * 60 * 1000
  let orm: MikroORM<PostgreSqlDriver> | undefined
  let created = false
  try {
    await admin.connect()
    await admin.query(`create schema "${schema}"`)
    created = true
    orm = await MikroORM.init({
      driver: PostgreSqlDriver, entities: [CatalogPriceHistoryEntry], clientUrl: databaseUrl, schema,
      driverOptions: { options: `-c search_path=${schema}` },
    })
    await orm.schema.create()
    const em = orm.em.fork()
    const base = {
      ...scope, priceId, productId, channelId, priceKindId, priceKindCode: 'retail', currencyCode: 'EUR',
      source: 'system' as const, isAnnounced: false, minQuantity: 1, taxRate: '23',
    }
    for (const [gross, days, campaign] of [['100', 40, false], ['90', 20, true], ['80', 16, true], ['70', 12, true]] as const) {
      em.persist(em.create(CatalogPriceHistoryEntry, {
        ...base, offerId: campaign ? offerId : null, unitPriceNet: gross, unitPriceGross: gross,
        recordedAt: new Date(now.getTime() - days * day), changeType: campaign ? 'update' : 'create',
      }))
    }
    await em.flush()
    const config = omnibusConfigSchema.parse({
      enabled: true, enabledCountryCodes: ['PL'], lookbackDays: 30,
      backfillCoverage: { [channelId]: { completedAt: now.toISOString(), lookbackDays: 30 } },
      channels: { [channelId]: { presentedPriceKindId: priceKindId, countryCode: 'PL', progressiveReductionRule: true, progressiveMaxGapDays: 7 } },
    })
    const service = new DefaultCatalogOmnibusService({ getValue: async () => config } as unknown as ModuleConfigService, null)
    const context = { ...scope, productId, channelId, priceKindId, currencyCode: 'EUR', now, omnibusExempt: false }
    const presented = { priceId, offerId, recordedAt: new Date(now.getTime() - 12 * day), changeType: 'update' as const, isAnnounced: true }
    expect(await service.resolveOmnibusBlock(orm.em.fork(), { ...context, offerId }, presented, true)).toMatchObject({
      applicabilityReason: 'progressive_reduction_frozen', lowestPriceGross: '100.0000',
    })
    for (const observation of createOmnibusOverflowObservations(now.getTime())) {
      em.persist(em.create(CatalogPriceHistoryEntry, { ...base, offerId, ...observation }))
    }
    await em.flush()
    const [campaign] = await fetchOmnibusCampaignIds(orm.em.fork(), [{
      ...scope, offerId, baselineScopeColumn: 'product_id', baselineScopeId: productId,
      priceKindId, currencyCode: 'EUR', channelId, asOf: now,
    }])
    expect(campaign.campaignIds).toHaveLength(OMNIBUS_IN_WINDOW_LIMIT + 1)
    expect(campaign.campaignTruncated).toBe(true)
    expect(await service.resolveOmnibusBlock(orm.em.fork(), context, presented, true)).toMatchObject({
      applicabilityReason: 'insufficient_history', lowestPriceGross: '100.0000',
    })
    expect(await service.resolveOmnibusBlock(orm.em.fork(), { ...context, offerId }, presented, true)).toMatchObject({
      applicabilityReason: 'no_history', lowestPriceGross: null, lowestPriceNet: null,
      promotionAnchorAt: new Date(now.getTime() - 20 * day).toISOString(),
    })
  } finally {
    await orm?.close(true)
    if (created) await admin.query(`drop schema "${schema}" cascade`)
    await admin.end()
  }
}, 60000)
