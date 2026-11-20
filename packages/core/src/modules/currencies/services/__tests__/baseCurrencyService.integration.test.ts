import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { Currency } from '../../data/entities'
import { BaseCurrencyService } from '../baseCurrencyService'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'currencies_pg_test'
const DATABASE_USER = 'currencies_pg_test'
const DATABASE_PASSWORD = 'currencies_pg_test'

type CountRow = { count: string | number }

describeWithPostgres('BaseCurrencyService against PostgreSQL with a pool of one connection', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>> | undefined
  const tenantId = randomUUID()
  const organizationId = randomUUID()

  function rootEm(): EntityManager<PostgreSqlDriver> {
    if (!orm) throw new Error('[internal] ORM not started')
    return orm.em
  }

  async function countByCode(em: EntityManager, code: string): Promise<number> {
    const rows = await em.execute<CountRow[]>('SELECT count(*) AS count FROM currencies WHERE code = ?', [code])
    return Number(rows[0]?.count ?? 0)
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: DATABASE_NAME, POSTGRES_USER: DATABASE_USER, POSTGRES_PASSWORD: DATABASE_PASSWORD })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      entities: [Currency],
      debug: false,
      pool: { min: 0, max: 1 },
      driverOptions: { connectionTimeoutMillis: 1000 },
    })
    await orm.schema.create()
    await rootEm().fork().execute(
      'INSERT INTO currencies (organization_id, tenant_id, code, name, is_base, created_at, updated_at) VALUES (?, ?, ?, ?, true, now(), now())',
      [organizationId, tenantId, 'PLN', 'Polish zloty'],
    )
  }, 120_000)

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  }, 30_000)

  test('resolves on the transaction connection of the given em instead of a second pooled connection', async () => {
    const resolution = await rootEm().fork().transactional((tem) =>
      new BaseCurrencyService(tem).resolveBaseCurrency({ tenantId, organizationIds: [organizationId] }),
    )

    expect(resolution).toEqual({ status: 'resolved', code: 'PLN' })
  })

  test('resolves through a pooled connection when the given em carries no transaction', async () => {
    await expect(
      new BaseCurrencyService(rootEm().fork()).resolveBaseCurrency({ tenantId, organizationIds: [organizationId] }),
    ).resolves.toEqual({ status: 'resolved', code: 'PLN' })
  })

  test('a failed lookup rolls back only its savepoint and keeps the caller transaction usable', async () => {
    const code = `T${randomUUID().slice(0, 6)}`

    const resolution = await rootEm().fork().transactional(async (tem) => {
      await tem.execute(
        'INSERT INTO currencies (organization_id, tenant_id, code, name, created_at, updated_at) VALUES (?, ?, ?, ?, now(), now())',
        [organizationId, tenantId, code, 'Written before the lookup'],
      )
      const result = await new BaseCurrencyService(tem).resolveBaseCurrency({
        tenantId,
        organizationIds: ['not-a-uuid'],
      })
      expect(await countByCode(tem, code)).toBe(1)
      return result
    })

    expect(resolution).toEqual({ status: 'unavailable' })
    expect(await countByCode(rootEm().fork(), code)).toBe(1)
  })

  test('the savepoint does not flush entities the caller has persisted but not flushed', async () => {
    const code = `U${randomUUID().slice(0, 6)}`

    await rootEm().fork().transactional(async (tem) => {
      tem.persist(tem.create(Currency, { organizationId, tenantId, code, name: 'Pending in the caller unit of work' }))
      await expect(
        new BaseCurrencyService(tem).resolveBaseCurrency({ tenantId, organizationIds: [organizationId] }),
      ).resolves.toEqual({ status: 'resolved', code: 'PLN' })
      expect(await countByCode(tem, code)).toBe(0)
    })

    expect(await countByCode(rootEm().fork(), code)).toBe(1)
  })
})
