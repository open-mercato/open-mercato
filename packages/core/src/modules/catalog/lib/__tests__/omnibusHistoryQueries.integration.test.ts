import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import type { StartedTestContainer } from 'testcontainers'
import { fetchOmnibusWindowIds, type OmnibusWindowLookup } from '../omnibusHistoryQueries'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describeWithPostgres('Omnibus create-undo history against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let pool: Pool
  let database: Kysely<Record<string, never>> | undefined
  let em: EntityManager
  let lookup: OmnibusWindowLookup

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'omnibus_test', POSTGRES_USER: 'omnibus_test', POSTGRES_PASSWORD: 'omnibus_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    pool = new Pool({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      database: 'omnibus_test',
      user: 'omnibus_test',
      password: 'omnibus_test',
    })
    database = new Kysely<Record<string, never>>({ dialect: new PostgresDialect({ pool }) })
    em = { fork: () => ({ getKysely: () => database }) } as unknown as EntityManager
    await pool.query(`CREATE TABLE catalog_price_history_entries (
      id uuid PRIMARY KEY, tenant_id uuid, organization_id uuid, product_id uuid,
      variant_id uuid, offer_id uuid, channel_id uuid, price_id uuid, price_kind_id uuid,
      currency_code text, change_type text, recorded_at timestamptz, metadata jsonb,
      unit_price_gross numeric
    )`)
  }, 120_000)

  beforeEach(async () => {
    await pool.query('TRUNCATE catalog_price_history_entries')
    lookup = {
      tenantId: randomUUID(),
      organizationId: randomUUID(),
      scopeColumn: 'product_id',
      scopeId: randomUUID(),
      priceKindId: randomUUID(),
      currencyCode: 'EUR',
      channelId: null,
      windowStart: new Date('2026-05-11T00:00:00.000Z'),
      windowEnd: new Date('2026-06-10T00:00:00.000Z'),
    }
  })

  afterAll(async () => {
    try {
      await database?.destroy()
    } finally {
      await postgres?.stop()
    }
  }, 30_000)

  async function insertHistory(input: {
    priceId: string
    changeType?: string
    recordedAt?: string
    gross?: number
    undoneCommand?: string
    redoneCommand?: string
    tenantId?: string
    organizationId?: string
  }): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO catalog_price_history_entries
        (id, tenant_id, organization_id, product_id, price_id, price_kind_id,
         currency_code, change_type, recorded_at, metadata, unit_price_gross)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        input.tenantId ?? lookup.tenantId,
        input.organizationId ?? lookup.organizationId,
        lookup.scopeId,
        input.priceId,
        lookup.priceKindId,
        lookup.currencyCode,
        input.changeType ?? 'create',
        input.recordedAt ?? '2026-06-01T00:00:00.000Z',
        input.undoneCommand
          ? { undoneCommand: input.undoneCommand }
          : input.redoneCommand ? { redoneCommand: input.redoneCommand } : null,
        input.gross ?? 5,
      ],
    )
    return id
  }

  async function lowestPrice(): Promise<number> {
    const [result] = await fetchOmnibusWindowIds(em, [lookup])
    const ids = [...(result.baselineId ? [result.baselineId] : []), ...result.inWindowIds]
    const prices = await pool.query<{ lowest: string }>(
      'SELECT min(unit_price_gross) AS lowest FROM catalog_price_history_entries WHERE id = ANY($1::uuid[])',
      [ids],
    )
    return Number(prices.rows[0].lowest)
  }

  it('keeps the real 100 price as reference after a mistaken 5 price is create-undone before a promotion', async () => {
    const mistakenPriceId = randomUUID()
    await insertHistory({ priceId: mistakenPriceId })
    await insertHistory({
      priceId: mistakenPriceId,
      changeType: 'undo',
      undoneCommand: 'catalog.prices.create',
      recordedAt: '2026-06-02T00:00:00.000Z',
    })
    await insertHistory({ priceId: randomUUID(), gross: 100, recordedAt: '2026-06-03T00:00:00.000Z' })
    expect(await lowestPrice()).toBe(100)
  })

  it('falls back to the valid baseline when a newer baseline is create-undone within the window', async () => {
    const validBaseline = await insertHistory({ priceId: randomUUID(), gross: 100, recordedAt: '2026-05-01' })
    const mistakenPriceId = randomUUID()
    await insertHistory({ priceId: mistakenPriceId, recordedAt: '2026-05-05' })
    await insertHistory({
      priceId: mistakenPriceId,
      changeType: 'undo',
      undoneCommand: 'catalog.prices.create',
      recordedAt: '2026-06-02',
    })
    const [result] = await fetchOmnibusWindowIds(em, [lookup])
    expect(result.baselineId).toBe(validBaseline)
    expect(await lowestPrice()).toBe(100)
  })

  it.each<[string, number]>([
    ['2026-06-10T00:00:00.000Z', 100],
    ['2026-06-10T00:00:00.001Z', 5],
  ])('respects the historical cutoff for an undo recorded at %s', async (recordedAt, expected) => {
    const priceId = randomUUID()
    await insertHistory({ priceId })
    await insertHistory({ priceId, changeType: 'undo', undoneCommand: 'catalog.prices.create', recordedAt })
    await insertHistory({ priceId: randomUUID(), gross: 100 })
    expect(await lowestPrice()).toBe(expected)
  })

  it.each<[string, string | undefined]>([
    ['delete', undefined],
    ['undo', 'catalog.prices.update'],
    ['undo', 'catalog.prices.delete'],
  ])('retains genuinely applied history after %s (%s)', async (changeType, undoneCommand) => {
    const priceId = randomUUID()
    await insertHistory({ priceId })
    await insertHistory({ priceId, changeType, undoneCommand, recordedAt: '2026-06-02', gross: 100 })
    await insertHistory({ priceId: randomUUID(), gross: 100 })
    expect(await lowestPrice()).toBe(5)
  })

  it('retains restored observations recorded after a create-undo', async () => {
    const priceId = randomUUID()
    const originalId = await insertHistory({ priceId })
    await insertHistory({ priceId, changeType: 'undo', undoneCommand: 'catalog.prices.create', recordedAt: '2026-06-02' })
    const restoredId = await insertHistory({ priceId, gross: 80, recordedAt: '2026-06-03' })
    const [result] = await fetchOmnibusWindowIds(em, [lookup])
    expect(result.inWindowIds).toEqual([restoredId])
    expect(result.inWindowIds).not.toContain(originalId)
    expect(await lowestPrice()).toBe(80)
  })


  it.each(['2026-05-05T00:00:00.000Z', '2026-06-01T00:00:00.000Z'])(
    'excludes an original create undone at the same timestamp (%s)',
    async (recordedAt) => {
      const priceId = randomUUID()
      await insertHistory({ priceId, recordedAt })
      await insertHistory({ priceId, changeType: 'undo', undoneCommand: 'catalog.prices.create', recordedAt })
      await insertHistory({ priceId: randomUUID(), gross: 100, recordedAt: '2026-06-03' })
      expect(await lowestPrice()).toBe(100)
    },
  )

  it.each(['2026-05-05T00:00:00.000Z', '2026-06-02T00:00:00.000Z'])(
    'retains a redo sharing the create-undo timestamp (%s)',
    async (recordedAt) => {
      const priceId = randomUUID()
      await insertHistory({ priceId, recordedAt: '2026-05-01' })
      await insertHistory({ priceId, changeType: 'undo', undoneCommand: 'catalog.prices.create', recordedAt })
      const restoredId = await insertHistory({ priceId, redoneCommand: 'catalog.prices.create', gross: 80, recordedAt })
      const [result] = await fetchOmnibusWindowIds(em, [lookup])
      expect([result.baselineId, ...result.inWindowIds]).toContain(restoredId)
      expect(await lowestPrice()).toBe(80)
    },
  )

  it('excludes both lifecycles after a create is undone, redone, and undone again', async () => {
    const priceId = randomUUID()
    await insertHistory({ priceId })
    await insertHistory({ priceId, changeType: 'undo', undoneCommand: 'catalog.prices.create', recordedAt: '2026-06-02' })
    await insertHistory({ priceId, redoneCommand: 'catalog.prices.create', gross: 80, recordedAt: '2026-06-03' })
    await insertHistory({ priceId, changeType: 'undo', undoneCommand: 'catalog.prices.create', recordedAt: '2026-06-04' })
    await insertHistory({ priceId: randomUUID(), gross: 100, recordedAt: '2026-06-05' })
    expect(await lowestPrice()).toBe(100)
  })

  it.each(['tenantId', 'organizationId'] as const)('ignores a foreign %s create-undo', async (scopeKey) => {
    const priceId = randomUUID()
    await insertHistory({ priceId })
    await insertHistory({
      priceId,
      changeType: 'undo',
      undoneCommand: 'catalog.prices.create',
      recordedAt: '2026-06-02',
      [scopeKey]: randomUUID(),
    })
    expect(await lowestPrice()).toBe(5)
  })
})
