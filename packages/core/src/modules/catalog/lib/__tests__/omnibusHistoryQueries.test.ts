import type { EntityManager } from '@mikro-orm/postgresql'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
} from 'kysely'
import {
  fetchOmnibusCampaignIds,
  fetchOmnibusFirstOfferIds,
  fetchOmnibusLatestPriceEntryIds,
  fetchOmnibusPrecedingIds,
  fetchOmnibusWindowIds,
  type OmnibusCampaignLookup,
  type OmnibusWindowLookup,
} from '../omnibusHistoryQueries'

type EmptyDatabase = Record<string, never>

const TOMBSTONE_EXCLUSION = /h\.change_type <> 'delete'\s+AND NOT \(h\.change_type = 'undo' AND h\.metadata->>'undoneCommand' = \$\d+\)/g
const CHANNEL_OR_NULL = /\(h\.channel_id = w\.channel_id OR h\.channel_id IS NULL\)/g

function recordingEm(): { em: EntityManager; queries: CompiledQuery[] } {
  const queries: CompiledQuery[] = []
  const db = new Kysely<EmptyDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<EmptyDatabase>) => new PostgresIntrospector(instance),
    },
    log: (event) => {
      queries.push(event.query)
    },
  })
  const em = { fork: () => ({ getKysely: () => db }) } as unknown as EntityManager
  return { em, queries }
}

function windowLookup(channelId: string | null): OmnibusWindowLookup {
  return {
    tenantId: '10000000-0000-4000-8000-000000000001',
    organizationId: '10000000-0000-4000-8000-000000000002',
    scopeColumn: 'product_id',
    scopeId: '20000000-0000-4000-8000-000000000001',
    priceKindId: '30000000-0000-4000-8000-000000000001',
    currencyCode: 'EUR',
    channelId,
    windowStart: new Date('2026-05-11T12:00:00.000Z'),
    windowEnd: new Date('2026-06-10T12:00:00.000Z'),
  }
}

describe('fetchOmnibusWindowIds SQL', () => {
  it('excludes tombstones from both the baseline and the in-window candidates', async () => {
    const { em, queries } = recordingEm()
    await fetchOmnibusWindowIds(em, [windowLookup(null)])
    expect(queries).toHaveLength(1)
    expect(queries[0].sql.match(TOMBSTONE_EXCLUSION)).toHaveLength(2)
    expect(queries[0].parameters).toContain('catalog.prices.create')
  })

  it('matches channel-less prices for a channel-specific lookup', async () => {
    const { em, queries } = recordingEm()
    await fetchOmnibusWindowIds(em, [windowLookup('40000000-0000-4000-8000-000000000001')])
    expect(queries[0].sql.match(CHANNEL_OR_NULL)).toHaveLength(2)
    expect(queries[0].sql).not.toMatch(/AND h\.channel_id = w\.channel_id\s/)
  })

  it('does not filter by channel when the lookup has no channel', async () => {
    const { em, queries } = recordingEm()
    await fetchOmnibusWindowIds(em, [windowLookup(null)])
    expect(queries[0].sql).not.toContain('h.channel_id')
  })

  it('keeps variant rows out of a product-level lookup', async () => {
    const { em, queries } = recordingEm()
    await fetchOmnibusWindowIds(em, [windowLookup(null)])
    expect(queries[0].sql.match(/AND h\.variant_id IS NULL/g)).toHaveLength(2)
  })

  it('does not narrow a variant-level lookup by level', async () => {
    const { em, queries } = recordingEm()
    await fetchOmnibusWindowIds(em, [{ ...windowLookup(null), scopeColumn: 'variant_id' }])
    expect(queries[0].sql).not.toContain('h.variant_id IS NULL')
    expect(queries[0].sql).toContain('"h"."variant_id" = w.scope_id')
  })

  it('drops a baseline whose price ended before the window starts', async () => {
    const { em, queries } = recordingEm()
    await fetchOmnibusWindowIds(em, [windowLookup(null)])
    const sql = queries[0].sql
    const [baselinePart, windowPart] = sql.split('UNION ALL')
    expect(baselinePart).toMatch(/AND NOT EXISTS \(\s+SELECT 1 FROM catalog_price_history_entries ended/)
    expect(baselinePart).toMatch(/ended\.price_id = h\.price_id/)
    expect(baselinePart).toMatch(/ended\.recorded_at > h\.recorded_at\s+AND ended\.recorded_at <= w\.window_start/)
    expect(baselinePart).toMatch(/ended\.change_type = 'delete'/)
    expect(windowPart).not.toContain('ended.')
  })
})

describe('fetchOmnibusFirstOfferIds SQL', () => {
  it('excludes tombstones and matches channel-less prices', async () => {
    const { em, queries } = recordingEm()
    await fetchOmnibusFirstOfferIds(em, [
      {
        tenantId: '10000000-0000-4000-8000-000000000001',
        organizationId: '10000000-0000-4000-8000-000000000002',
        offerId: '50000000-0000-4000-8000-000000000001',
        priceKindId: '30000000-0000-4000-8000-000000000001',
        currencyCode: 'EUR',
        channelId: '40000000-0000-4000-8000-000000000001',
      },
    ])
    expect(queries[0].sql.match(TOMBSTONE_EXCLUSION)).toHaveLength(1)
    expect(queries[0].sql.match(CHANNEL_OR_NULL)).toHaveLength(1)
  })
})

describe('fetchOmnibusLatestPriceEntryIds SQL', () => {
  it('keeps the presented-entry lookup unfiltered', async () => {
    const { em, queries } = recordingEm()
    await fetchOmnibusLatestPriceEntryIds(em, [
      {
        tenantId: '10000000-0000-4000-8000-000000000001',
        organizationId: '10000000-0000-4000-8000-000000000002',
        priceId: '60000000-0000-4000-8000-000000000001',
      },
    ])
    expect(queries[0].sql).not.toMatch(TOMBSTONE_EXCLUSION)
  })
})

describe('fetchOmnibusPrecedingIds SQL', () => {
  it('reads the newest observations strictly before the bound, grouped by scope and channel', async () => {
    const { em, queries } = recordingEm()
    const lookup = {
      ...windowLookup('40000000-0000-4000-8000-000000000001'),
      before: new Date('2026-06-05T00:00:00.000Z'),
    }
    const result = await fetchOmnibusPrecedingIds(em, [lookup, { ...lookup, channelId: null }])
    expect(result).toEqual([[], []])
    expect(queries).toHaveLength(2)
    expect(queries[0].sql.match(TOMBSTONE_EXCLUSION)).toHaveLength(1)
    expect(queries[0].sql.match(CHANNEL_OR_NULL)).toHaveLength(1)
    expect(queries[0].sql).toMatch(/h\.recorded_at < w\.before_at/)
    expect(queries[0].sql).toMatch(/ended\.recorded_at > h\.recorded_at\s+AND ended\.recorded_at < w\.before_at/)
    expect(queries[0].sql).toMatch(/ORDER BY h\.recorded_at DESC, h\.id DESC/)
    expect(queries[1].sql).not.toContain('h.channel_id')
  })
})

describe('fetchOmnibusCampaignIds SQL', () => {
  function campaignLookup(overrides: Partial<OmnibusCampaignLookup> = {}): OmnibusCampaignLookup {
    return {
      tenantId: '10000000-0000-4000-8000-000000000001',
      organizationId: '10000000-0000-4000-8000-000000000002',
      offerId: '50000000-0000-4000-8000-000000000001',
      baselineScopeColumn: 'variant_id',
      baselineScopeId: '20000000-0000-4000-8000-000000000003',
      priceKindId: '30000000-0000-4000-8000-000000000001',
      currencyCode: 'EUR',
      channelId: '40000000-0000-4000-8000-000000000001',
      ...overrides,
    }
  }

  it('reads the offer in recording order and the non-offer price live before its first entry', async () => {
    const { em, queries } = recordingEm()
    await fetchOmnibusCampaignIds(em, [campaignLookup()])
    expect(queries).toHaveLength(1)
    const sql = queries[0].sql
    const [campaignPart, baselinePart] = sql.split('UNION ALL')
    expect(campaignPart).toMatch(/h\.offer_id = w\.offer_id/)
    expect(campaignPart).toMatch(/ORDER BY h\.recorded_at ASC, h\.id ASC/)
    expect(baselinePart).toMatch(/AND h\.offer_id IS NULL/)
    expect(baselinePart).toMatch(/h\.recorded_at < cs\.started_at/)
    expect(baselinePart).toMatch(/ended\.recorded_at < cs\.started_at/)
    expect(baselinePart).toContain('"h"."variant_id" = w.scope_id')
    expect(sql.match(TOMBSTONE_EXCLUSION)).toHaveLength(2)
    expect(sql.match(CHANNEL_OR_NULL)).toHaveLength(2)
  })

  it('keeps variant rows out of a product-level baseline and splits lookups by scope', async () => {
    const { em, queries } = recordingEm()
    await fetchOmnibusCampaignIds(em, [
      campaignLookup({ baselineScopeColumn: 'product_id', baselineScopeId: '20000000-0000-4000-8000-000000000001' }),
      campaignLookup(),
    ])
    expect(queries).toHaveLength(2)
    expect(queries[0].sql).toMatch(/AND h\.variant_id IS NULL/)
    expect(queries[1].sql).not.toContain('h.variant_id IS NULL')
  })
})
