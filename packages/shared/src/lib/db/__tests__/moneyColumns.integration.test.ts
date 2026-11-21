import { randomUUID } from 'node:crypto'
import { Embedded, Entity, PrimaryKey } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { moneyEquals, restoreMoney, type Money, type MoneySnapshot } from '../../money'
import { MoneyColumns, moneyFromColumns, moneyToColumns } from '../moneyColumns'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'money_columns_test'
const DATABASE_USER = 'money_columns'
const DATABASE_PASSWORD = 'money_columns'
const PROBE_TABLE = 'money_columns_integration_probes'
const CASE_TIMEOUT_MS = 20_000
const BEYOND_FLOAT_AMOUNT = '12345678901234567890.123456789012345678'
const NEGATIVE_AMOUNT = '-98765432109876543210.987654321098765432'

@Entity({ tableName: PROBE_TABLE })
class MoneyColumnsIntegrationProbe {
  @PrimaryKey({ type: 'uuid' })
  id!: string

  @Embedded(() => MoneyColumns, { prefix: 'price_' })
  price!: MoneyColumns

  @Embedded(() => MoneyColumns, { prefix: 'discount_', nullable: true })
  discount?: MoneyColumns | null
}

type RawProbeRow = {
  price_amount: string
  price_currency_code: string
  price_currency_decimal_places: number
  discount_amount: string | null
  discount_currency_code: string | null
  discount_currency_decimal_places: number | null
}

function money(amount: string, currencyCode = 'USD', currencyDecimalPlaces = 2): Money {
  const snapshot: MoneySnapshot = { amount, currencyCode, currencyDecimalPlaces }
  return restoreMoney(snapshot)
}

describeWithPostgres('MoneyColumns against real PostgreSQL', () => {
  let postgres: StartedTestContainer | null = null
  let orm: MikroORM | null = null
  const queries: string[] = []

  function freshEm(): EntityManager {
    if (!orm) throw new Error('[internal] MikroORM is not initialized')
    return orm.em.fork({ clear: true })
  }

  async function insertProbe(price: Money, discount: Money | null = null): Promise<string> {
    const em = freshEm()
    const id = randomUUID()
    em.persist(em.create(MoneyColumnsIntegrationProbe, {
      id,
      price: moneyToColumns(price),
      discount: discount ? moneyToColumns(discount) : null,
    }))
    await em.flush()
    return id
  }

  async function readRaw(id: string): Promise<RawProbeRow> {
    const rows = await freshEm().execute<RawProbeRow[]>(
      `select price_amount, price_currency_code, price_currency_decimal_places,
        discount_amount, discount_currency_code, discount_currency_decimal_places
        from ${PROBE_TABLE} where id = ?`,
      [id],
    )
    expect(rows).toHaveLength(1)
    return rows[0]
  }

  function countUpdates(): number {
    return queries.filter((query) => /\bupdate\b/i.test(query) && query.includes(PROBE_TABLE)).length
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({
        POSTGRES_DB: DATABASE_NAME,
        POSTGRES_USER: DATABASE_USER,
        POSTGRES_PASSWORD: DATABASE_PASSWORD,
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      entities: [MoneyColumnsIntegrationProbe],
      debug: ['query'],
      colors: false,
      logger: (message: string) => {
        queries.push(message)
      },
      pool: { min: 0, max: 2 },
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  }, 30_000)

  it('creates the prefixed physical columns', async () => {
    const rows = await freshEm().execute<Array<{ column_name: string; data_type: string; is_nullable: string }>>(
      `select column_name, data_type, is_nullable from information_schema.columns
        where table_name = ? order by column_name`,
      [PROBE_TABLE],
    )
    expect(rows).toEqual([
      { column_name: 'discount_amount', data_type: 'numeric', is_nullable: 'YES' },
      { column_name: 'discount_currency_code', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'discount_currency_decimal_places', data_type: 'integer', is_nullable: 'YES' },
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'price_amount', data_type: 'numeric', is_nullable: 'NO' },
      { column_name: 'price_currency_code', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'price_currency_decimal_places', data_type: 'integer', is_nullable: 'NO' },
    ])
  }, CASE_TIMEOUT_MS)

  it.each([
    ['beyond float precision', BEYOND_FLOAT_AMOUNT, 'USD', 2],
    ['negative beyond float precision', NEGATIVE_AMOUNT, 'BHD', 3],
  ])('round-trips a %s amount exactly', async (_label, amount, currencyCode, currencyDecimalPlaces) => {
    expect(String(Number(amount))).not.toBe(amount)
    const original = money(amount, currencyCode, currencyDecimalPlaces)
    const id = await insertProbe(original)

    const row = await freshEm().findOneOrFail(MoneyColumnsIntegrationProbe, { id })
    expect(row.price).toBeInstanceOf(MoneyColumns)
    expect(row.price.amount).toBe(amount)
    expect(row.discount).toBeNull()
    const restored = moneyFromColumns(row.price)
    expect(moneyEquals(restored, original)).toBe(true)
    expect(restored.amount.toFixed()).toBe(amount)

    expect(await readRaw(id)).toEqual({
      price_amount: amount,
      price_currency_code: currencyCode,
      price_currency_decimal_places: currencyDecimalPlaces,
      discount_amount: null,
      discount_currency_code: null,
      discount_currency_decimal_places: null,
    })
  }, CASE_TIMEOUT_MS)

  it('stores, restores and clears a nullable embedding', async () => {
    const id = await insertProbe(money('10'))

    const emptyEm = freshEm()
    const empty = await emptyEm.findOneOrFail(MoneyColumnsIntegrationProbe, { id })
    expect(empty.discount).toBeNull()
    const discount = money(BEYOND_FLOAT_AMOUNT, 'EUR', 2)
    empty.discount = moneyToColumns(discount)
    await emptyEm.flush()

    const setEm = freshEm()
    const withDiscount = await setEm.findOneOrFail(MoneyColumnsIntegrationProbe, { id })
    expect(withDiscount.discount).toBeInstanceOf(MoneyColumns)
    const restored = withDiscount.discount ? moneyFromColumns(withDiscount.discount) : null
    expect(restored && moneyEquals(restored, discount)).toBe(true)
    expect(await readRaw(id)).toMatchObject({
      discount_amount: BEYOND_FLOAT_AMOUNT,
      discount_currency_code: 'EUR',
      discount_currency_decimal_places: 2,
    })
    withDiscount.discount = null
    await setEm.flush()

    const cleared = await freshEm().findOneOrFail(MoneyColumnsIntegrationProbe, { id })
    expect(cleared.discount).toBeNull()
    expect(await readRaw(id)).toMatchObject({
      price_amount: '10',
      discount_amount: null,
      discount_currency_code: null,
      discount_currency_decimal_places: null,
    })
  }, CASE_TIMEOUT_MS)

  it('flushes an update that changes only trailing significant digits by replacing the embeddable', async () => {
    const id = await insertProbe(money('1.123456789012345678'))
    const em = freshEm()
    const row = await em.findOneOrFail(MoneyColumnsIntegrationProbe, { id })
    row.price = moneyToColumns(money('1.123456789012345679'))
    await em.flush()

    const reloaded = await freshEm().findOneOrFail(MoneyColumnsIntegrationProbe, { id })
    expect(reloaded.price.amount).toBe('1.123456789012345679')
    expect((await readRaw(id)).price_amount).toBe('1.123456789012345679')
  }, CASE_TIMEOUT_MS)

  it('flushes an update that changes only trailing significant digits by mutating the amount', async () => {
    const id = await insertProbe(money('1.123456789012345678'))
    const em = freshEm()
    const row = await em.findOneOrFail(MoneyColumnsIntegrationProbe, { id })
    row.price.amount = '1.123456789012345679'
    await em.flush()

    const reloaded = await freshEm().findOneOrFail(MoneyColumnsIntegrationProbe, { id })
    expect(reloaded.price.amount).toBe('1.123456789012345679')
    expect((await readRaw(id)).price_amount).toBe('1.123456789012345679')
  }, CASE_TIMEOUT_MS)

  it('does not update when the amount changes only its scale', async () => {
    const id = await insertProbe(money('40'))
    const em = freshEm()
    const row = await em.findOneOrFail(MoneyColumnsIntegrationProbe, { id })
    row.price.amount = '40.0000'
    const updatesBefore = countUpdates()
    await em.flush()
    expect(countUpdates()).toBe(updatesBefore)

    row.price.amount = '40.0001'
    await em.flush()
    expect(countUpdates()).toBe(updatesBefore + 1)
    expect((await readRaw(id)).price_amount).toBe('40.0001')
  }, CASE_TIMEOUT_MS)

  it('throws an internal error when a reloaded embedding has null currency columns', async () => {
    const id = await insertProbe(money('5'), money('1.5'))
    await freshEm().execute(
      `update ${PROBE_TABLE} set discount_currency_code = null, discount_currency_decimal_places = null where id = ?`,
      [id],
    )

    const row = await freshEm().findOneOrFail(MoneyColumnsIntegrationProbe, { id })
    expect(row.discount).toBeInstanceOf(MoneyColumns)
    expect(row.discount?.amount).toBe('1.5')
    expect(() => moneyFromColumns(row.discount as MoneyColumns)).toThrow('[internal]')
  }, CASE_TIMEOUT_MS)
})
