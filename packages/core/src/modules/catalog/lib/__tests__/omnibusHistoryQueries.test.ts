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
  fetchOmnibusFirstOfferIds,
  fetchOmnibusLatestPriceEntryIds,
  fetchOmnibusWindowIds,
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
