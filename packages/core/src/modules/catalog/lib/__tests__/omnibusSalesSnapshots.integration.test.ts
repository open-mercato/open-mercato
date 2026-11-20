import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/postgresql'
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import type { StartedTestContainer } from 'testcontainers'
import type { ModuleConfigService } from '../../../configs/lib/module-config-service'
import * as catalogEntities from '../../data/entities'
import { DefaultCatalogOmnibusService } from '../../services/catalogOmnibusService'
import { applyOmnibusSnapshotsToLines, type OmnibusSnapshotTarget } from '../../../sales/lib/omnibusSnapshot'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describeWithPostgres('sales snapshot SQL statement count', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM | undefined
  let database: Kysely<Record<string, never>> | undefined
  const queries: string[] = []

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'snapshots', POSTGRES_USER: 'snapshots', POSTGRES_PASSWORD: 'snapshots' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    database = new Kysely<Record<string, never>>({
      dialect: new PostgresDialect({ pool: new Pool({ database: 'snapshots', user: 'snapshots', password: 'snapshots', host: postgres.getHost(), port: postgres.getMappedPort(5432) }) }),
      log: (event) => { queries.push(event.query.sql) },
    })
    orm = await MikroORM.init({
      entities: Object.values(catalogEntities),
      dbName: 'snapshots', user: 'snapshots', password: 'snapshots',
      host: postgres.getHost(), port: postgres.getMappedPort(5432),
      driverOptions: database,
    })
    await orm.schema.createSchema()
  }, 120_000)

  afterAll(async () => {
    try {
      if (orm) await orm.close(true)
      else await database?.destroy()
    } finally { await postgres?.stop() }
  }, 30_000)

  it('keeps actual SQL reads constant for 1 versus 100 distinct prices and performs none when disabled', async () => {
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const productId = randomUUID()
    const priceKindId = randomUUID()
    const promotionAt = new Date('2026-05-01T00:00:00.000Z')
    const referenceAt = new Date('2026-04-11T00:00:00.000Z')
    const em = orm!.em.fork()
    const connection = em.getConnection()
    await connection.execute('insert into catalog_products (id, tenant_id, organization_id, title, created_at, updated_at) values (?, ?, ?, ?, now(), now())', [productId, tenantId, organizationId, 'Snapshot count'])
    await connection.execute('insert into catalog_price_kinds (id, tenant_id, organization_id, code, title, created_at, updated_at) values (?, ?, ?, ?, ?, now(), now())', [priceKindId, tenantId, organizationId, 'snapshot_count', 'Snapshot count'])
    const priceIds = Array.from({ length: 100 }, () => randomUUID())
    for (const priceId of priceIds) {
      await connection.execute('insert into catalog_product_variant_prices (id, tenant_id, organization_id, product_id, price_kind_id, currency_code, unit_price_gross, starts_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?, 80, ?, now(), now())', [priceId, tenantId, organizationId, productId, priceKindId, 'EUR', promotionAt])
      await connection.execute('insert into catalog_price_history_entries (id, tenant_id, organization_id, product_id, price_id, price_kind_id, price_kind_code, currency_code, unit_price_gross, recorded_at, change_type, source) values (?, ?, ?, ?, ?, ?, ?, ?, 100, ?, ?, ?)', [randomUUID(), tenantId, organizationId, productId, priceId, priceKindId, 'snapshot_count', 'EUR', referenceAt, 'create', 'system'])
      await connection.execute('insert into catalog_price_history_entries (id, tenant_id, organization_id, product_id, price_id, price_kind_id, price_kind_code, currency_code, unit_price_gross, starts_at, recorded_at, change_type, source) values (?, ?, ?, ?, ?, ?, ?, ?, 80, ?, ?, ?, ?)', [randomUUID(), tenantId, organizationId, productId, priceId, priceKindId, 'snapshot_count', 'EUR', promotionAt, promotionAt, 'update', 'system'])
    }
    const configRead = jest.fn().mockResolvedValue({ enabled: true, enabledCountryCodes: ['PL'], defaultPresentedPriceKindId: priceKindId })
    const service = new DefaultCatalogOmnibusService({ getValue: configRead } as unknown as ModuleConfigService, null)
    const measure = async (count: number) => {
      queries.length = 0
      configRead.mockClear()
      const lines = priceIds.slice(0, count).map((priceId) => ({ line: {} as OmnibusSnapshotTarget, sourceLine: { productId, priceId } }))
      await applyOmnibusSnapshotsToLines({ em: em.fork(), service, lines, document: { tenantId, organizationId, currencyCode: 'EUR' }, documentKind: 'order' })
      expect(configRead).toHaveBeenCalledTimes(1)
      return { reads: queries.filter((query) => /\b(select|with)\b/i.test(query)).length, lines }
    }
    const single = await measure(1)
    const batch = await measure(100)
    expect(single.reads).toBeGreaterThan(0)
    expect(batch.reads).toBe(single.reads)
    expect(batch.lines.every(({ line }) => line.omnibusReferenceGross === '100.0000')).toBe(true)
    configRead.mockResolvedValue({ enabled: false })
    const disabled = await measure(100)
    expect(disabled.reads).toBe(0)
    expect(disabled.lines.every(({ line }) => line.omnibusReferenceGross === undefined)).toBe(true)
    process.stdout.write(`Omnibus SQL measurement: one=${single.reads}, hundred=${batch.reads}, disabled=${disabled.reads}; configuration reads=1 per call\n`)
  })
})
