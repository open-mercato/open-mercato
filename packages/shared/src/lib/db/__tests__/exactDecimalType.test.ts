import { EntitySchema } from '@mikro-orm/core'
import { MikroORM } from '@mikro-orm/postgresql'
import { ExactDecimalType } from '../exactDecimalType'

describe('ExactDecimalType', () => {
  const type = new ExactDecimalType()

  it('detects changes beyond float precision', () => {
    expect(Number('1.123456789012345678')).toBe(Number('1.123456789012345679'))
    expect(type.compareValues('1.123456789012345678', '1.123456789012345679')).toBe(false)
  })

  it('treats the same value with different scale as unchanged', () => {
    expect(type.compareValues('40.0000', '40')).toBe(true)
    expect(type.compareValues('0.000000000000000001', '1e-18')).toBe(true)
  })

  it('compares missing values strictly', () => {
    expect(type.compareValues(null, null)).toBe(true)
    expect(type.compareValues(null, '0')).toBe(false)
  })

  it('maps to a string runtime type', () => {
    expect(type.compareAsType()).toBe('string')
  })
})

describe('ExactDecimalType schema generation', () => {
  let orm: MikroORM

  beforeAll(async () => {
    orm = await MikroORM.init({
      entities: [new EntitySchema({
        name: 'ExactDecimalSchemaProbe',
        tableName: 'exact_decimal_schema_probes',
        properties: {
          id: { type: 'uuid', primary: true },
          amount: { type: ExactDecimalType, columnType: 'numeric' },
          rate: { type: ExactDecimalType },
          percentage: { type: 'decimal', precision: 7, scale: 4 },
        },
      })],
      dbName: 'exact_decimal_schema_probe',
      connect: false,
    })
  })

  afterAll(async () => {
    await orm?.close(true)
  })

  it('discovers unconstrained numeric with and without an explicit column type', () => {
    const metadata = orm.getMetadata().get('ExactDecimalSchemaProbe')

    expect(metadata.properties.amount.columnTypes).toEqual(['numeric'])
    expect(metadata.properties.rate.columnTypes).toEqual(['numeric'])
  })

  it('keeps snapshot column types consistent with unconstrained numeric SQL', async () => {
    const table = orm.schema.getTargetSchema().getTable('exact_decimal_schema_probes')!

    for (const name of ['amount', 'rate']) {
      expect(table.getColumn(name)).toMatchObject({
        type: 'numeric',
        precision: undefined,
        scale: undefined,
      })
    }
    expect(table.getColumn('percentage').type).toBe('numeric(7,4)')
    expect(await orm.schema.getCreateSchemaSQL({ wrap: false })).toContain('"amount" numeric not null')
  })

  it('produces no migration when compared repeatedly with unconstrained numeric columns', async () => {
    const existingSchema = orm.schema.getTargetSchema()
    const table = existingSchema.getTable('exact_decimal_schema_probes')!

    for (const name of ['amount', 'rate']) {
      table.addColumn({ ...table.getColumn(name), type: 'numeric', precision: undefined, scale: undefined })
    }

    expect(await orm.schema.getUpdateSchemaMigrationSQL({ fromSchema: existingSchema, wrap: false }))
      .toEqual({ up: '', down: '' })
    expect(await orm.schema.getUpdateSchemaMigrationSQL({ fromSchema: existingSchema, wrap: false }))
      .toEqual({ up: '', down: '' })
  })
})
