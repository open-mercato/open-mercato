import { Embedded, Entity, PrimaryKey } from '@mikro-orm/decorators/legacy'
import { MikroORM } from '@mikro-orm/postgresql'
import { createMoney, moneyEquals } from '../../money/money'
import { InvalidMoneySnapshotError } from '../../money/errors'
import { currencyOf } from '../../money/__tests__/helpers'
import { MoneyColumns, moneyFromColumns, moneyToColumns } from '../moneyColumns'

@Entity({ tableName: 'money_columns_probes' })
class MoneyColumnsProbe {
  @PrimaryKey({ type: 'uuid' })
  id!: string

  @Embedded(() => MoneyColumns, { prefix: 'price_' })
  price!: MoneyColumns

  @Embedded(() => MoneyColumns, { prefix: 'discount_', nullable: true })
  discount?: MoneyColumns | null
}

describe('MoneyColumns schema', () => {
  let orm: MikroORM

  beforeAll(async () => {
    orm = await MikroORM.init({
      entities: [MoneyColumnsProbe],
      dbName: 'money_columns_probe',
      connect: false,
    })
  })

  afterAll(async () => {
    await orm?.close(true)
  })

  it('discovers the embeddable from the entity that embeds it', () => {
    expect(orm.getMetadata().find(MoneyColumns)?.embeddable).toBe(true)
    const metadata = orm.getMetadata().get(MoneyColumnsProbe)
    expect(metadata.properties.price.embeddable).toBe(MoneyColumns)
  })

  it('creates prefixed numeric, text and integer columns', () => {
    const table = orm.schema.getTargetSchema().getTable('money_columns_probes')!
    expect(table.getColumn('price_amount')).toMatchObject({ type: 'numeric', nullable: false })
    expect(table.getColumn('price_currency_code')).toMatchObject({ type: 'text', nullable: false })
    expect(table.getColumn('price_currency_decimal_places')).toMatchObject({ type: 'int', nullable: false })
    expect(table.getColumn('discount_amount')).toMatchObject({ type: 'numeric', nullable: true })
    expect(table.getColumn('discount_currency_code')).toMatchObject({ type: 'text', nullable: true })
    expect(table.getColumn('discount_currency_decimal_places')).toMatchObject({ type: 'int', nullable: true })
    expect(table.getColumns().map((column) => column.name).sort()).toEqual([
      'discount_amount',
      'discount_currency_code',
      'discount_currency_decimal_places',
      'id',
      'price_amount',
      'price_currency_code',
      'price_currency_decimal_places',
    ])
  })
})

describe('MoneyColumns conversion', () => {
  it('round-trips a Money with its precision', async () => {
    const money = createMoney('-1234.56789', await currencyOf('BHD'))
    const columns = moneyToColumns(money)
    expect(columns).toBeInstanceOf(MoneyColumns)
    expect({ ...columns }).toEqual({ amount: '-1234.56789', currencyCode: 'BHD', currencyDecimalPlaces: 3 })
    const restored = moneyFromColumns(columns)
    expect(moneyEquals(restored, money)).toBe(true)
    expect(restored.currency.symbol).toBeNull()
  })

  it('restores a database numeric with trailing zeros', () => {
    const columns = Object.assign(new MoneyColumns(), { amount: '12.3400', currencyCode: 'USD', currencyDecimalPlaces: 2 })
    expect(moneyFromColumns(columns).amount.toFixed()).toBe('12.34')
  })

  it('throws on a partially null or invalid row', () => {
    const partial = Object.assign(new MoneyColumns(), { amount: '1', currencyCode: null, currencyDecimalPlaces: 2 })
    expect(() => moneyFromColumns(partial as unknown as MoneyColumns)).toThrow(InvalidMoneySnapshotError)
    const forged = Object.assign(new MoneyColumns(), { amount: '1', currencyCode: 'USD', currencyDecimalPlaces: 99 })
    expect(() => moneyFromColumns(forged)).toThrow(InvalidMoneySnapshotError)
  })
})
