import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/postgresql'
import { Kysely, PostgresDialect } from 'kysely'
import { Client, Pool } from 'pg'
import type { StartedTestContainer } from 'testcontainers'
import type { ModuleConfigService } from '../../../configs/lib/module-config-service'
import * as catalogEntities from '../../data/entities'
import { DefaultCatalogOmnibusService } from '../../services/catalogOmnibusService'
import { applyOmnibusSnapshotsToLines, type OmnibusSnapshotTarget } from '../../../sales/lib/omnibusSnapshot'
import { Migration20261015120000_sales_line_omnibus_snapshot } from '../../../sales/migrations/Migration20261015120000_sales_line_omnibus_snapshot'
import { Migration20261120010000_sales_omnibus_exact_decimal } from '../../../sales/migrations/Migration20261120010000_sales_omnibus_exact_decimal'

const postgresUrl = process.env.OM_OMNIBUS_PG_URL
const describeWithPostgres = postgresUrl || process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describeWithPostgres('sales snapshot SQL statement count', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM | undefined
  let database: Kysely<Record<string, never>> | undefined
  const queries: string[] = []
  const schema = `omnibus_snapshots_${randomUUID().replace(/-/g, '')}`

  beforeAll(async () => {
    if (!postgresUrl) {
      const { GenericContainer, Wait } = await import('testcontainers')
      postgres = await new GenericContainer('postgres:16')
        .withEnvironment({ POSTGRES_DB: 'snapshots', POSTGRES_USER: 'snapshots', POSTGRES_PASSWORD: 'snapshots' })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
        .start()
    }
    database = new Kysely<Record<string, never>>({
      dialect: new PostgresDialect({ pool: new Pool({
        ...(postgresUrl ? { connectionString: postgresUrl } : { database: 'snapshots', user: 'snapshots', password: 'snapshots', host: postgres!.getHost(), port: postgres!.getMappedPort(5432) }),
        options: `-c search_path=${schema}`,
      }) }),
      log: (event) => { queries.push(event.query.sql) },
    })
    await database.schema.createSchema(schema).execute()
    orm = await MikroORM.init({
      entities: Object.values(catalogEntities),
      dbName: postgresUrl ? new URL(postgresUrl).pathname.slice(1) : 'snapshots',
      user: 'snapshots', password: 'snapshots',
      schema,
      driverOptions: database,
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    try {
      try { await orm?.close(true) } finally { await database?.destroy() }
    } finally {
      if (postgresUrl || postgres) {
        const cleanup = new Pool(postgresUrl ? { connectionString: postgresUrl } : {
          database: 'snapshots', user: 'snapshots', password: 'snapshots', host: postgres!.getHost(), port: postgres!.getMappedPort(5432),
        })
        try { await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`) } finally { await cleanup.end() }
      }
      await postgres?.stop()
    }
  }, 30_000)

  it('persists exact references through both the initial and forward-widening migrations', async () => {
    const client = new Client(postgresUrl ? { connectionString: postgresUrl } : {
      database: 'snapshots', user: 'snapshots', password: 'snapshots', host: postgres!.getHost(), port: postgres!.getMappedPort(5432),
    })
    await client.connect()
    const migrationSchema = `omnibus_decimal_${randomUUID().replace(/-/g, '')}`
    try {
      await client.query('BEGIN')
      await client.query(`CREATE SCHEMA "${migrationSchema}"`)
      await client.query(`SET LOCAL search_path TO "${migrationSchema}"`)
      for (const table of ['sales_order_lines', 'sales_quote_lines']) await client.query(`CREATE TABLE "${table}" (id uuid PRIMARY KEY)`)
      const execute = async (migration: Migration20261015120000_sales_line_omnibus_snapshot | Migration20261120010000_sales_omnibus_exact_decimal, direction: 'up' | 'down') => {
        migration.reset()
        await migration[direction]()
        for (const query of migration.getQueries()) await client.query(String(query))
      }
      const initial = new Migration20261015120000_sales_line_omnibus_snapshot({} as never, {} as never)
      const forward = new Migration20261120010000_sales_omnibus_exact_decimal({} as never, {} as never)
      const assertExact = async () => {
        for (const table of ['sales_order_lines', 'sales_quote_lines']) {
          for (const reference of ['100000000000000', '123.1234567890123456789']) {
            const id = randomUUID()
            await client.query(`INSERT INTO "${table}" (id, omnibus_reference_net, omnibus_reference_gross) VALUES ($1, $2, $2)`, [id, reference])
            const persisted = await client.query<{ net: string; gross: string }>(`SELECT omnibus_reference_net::text AS net, omnibus_reference_gross::text AS gross FROM "${table}" WHERE id = $1`, [id])
            expect(persisted.rows[0]).toEqual({ net: reference, gross: reference })
            await client.query(`DELETE FROM "${table}" WHERE id = $1`, [id])
          }
        }
      }
      await execute(initial, 'up')
      await assertExact()
      for (const table of ['sales_order_lines', 'sales_quote_lines']) await client.query(`ALTER TABLE "${table}" ALTER COLUMN omnibus_reference_net TYPE numeric(18,4), ALTER COLUMN omnibus_reference_gross TYPE numeric(18,4)`)
      await execute(forward, 'up')
      await assertExact()
      await execute(forward, 'down')
      await assertExact()
      await execute(initial, 'down')
      await execute(initial, 'up')
      await assertExact()
    } finally {
      try { await client.query('ROLLBACK') } finally { await client.end() }
    }
  })

  it('keeps actual SQL reads constant for 1 versus 100 distinct prices and performs none when disabled', async () => {
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const productId = randomUUID()
    const priceKindId = randomUUID()
    const promotionAt = new Date('2026-05-01T00:00:00.000Z')
    const referenceAt = new Date('2026-04-11T00:00:00.000Z')
    const referenceGross = '100.1234567890123456789'
    const em = orm!.em.fork()
    const connection = em.getConnection()
    await connection.execute('insert into catalog_products (id, tenant_id, organization_id, title, created_at, updated_at) values (?, ?, ?, ?, now(), now())', [productId, tenantId, organizationId, 'Snapshot count'])
    await connection.execute('insert into catalog_price_kinds (id, tenant_id, organization_id, code, title, created_at, updated_at) values (?, ?, ?, ?, ?, now(), now())', [priceKindId, tenantId, organizationId, 'snapshot_count', 'Snapshot count'])
    const priceIds = Array.from({ length: 100 }, () => randomUUID())
    for (const priceId of priceIds) {
      await connection.execute('insert into catalog_product_variant_prices (id, tenant_id, organization_id, product_id, price_kind_id, currency_code, unit_price_gross, starts_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?, 80, ?, now(), now())', [priceId, tenantId, organizationId, productId, priceKindId, 'EUR', promotionAt])
      await connection.execute('insert into catalog_price_history_entries (id, tenant_id, organization_id, product_id, price_id, price_kind_id, price_kind_code, currency_code, unit_price_gross, recorded_at, change_type, source) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [randomUUID(), tenantId, organizationId, productId, priceId, priceKindId, 'snapshot_count', 'EUR', referenceGross, referenceAt, 'create', 'system'])
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
    expect(batch.lines.every(({ line }) => line.omnibusReferenceGross === referenceGross)).toBe(true)
    configRead.mockResolvedValue({ enabled: false })
    const disabled = await measure(100)
    expect(disabled.reads).toBe(0)
    expect(disabled.lines.every(({ line }) => line.omnibusReferenceGross === undefined)).toBe(true)
    process.stdout.write(`Omnibus SQL measurement: one=${single.reads}, hundred=${batch.reads}, disabled=${disabled.reads}; configuration reads=1 per call\n`)
  })
})
