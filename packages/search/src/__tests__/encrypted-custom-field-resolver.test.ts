import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
} from 'kysely'
import {
  createEncryptedCustomFieldKeysResolver,
  type CustomFieldDefinitionsDatabase,
} from '../lib/encrypted-custom-field-resolver'

function createDatabase(rows: Array<Record<string, unknown>>) {
  const queries: CompiledQuery[] = []
  const connection: DatabaseConnection = {
    executeQuery: async <R>(compiled: CompiledQuery) => {
      queries.push(compiled)
      return { rows: rows as R[] }
    },
    streamQuery: () => {
      throw new Error('[internal] streaming is not supported in this test')
    },
  }
  const driver: Driver = {
    init: async () => undefined,
    acquireConnection: async () => connection,
    beginTransaction: async () => undefined,
    commitTransaction: async () => undefined,
    rollbackTransaction: async () => undefined,
    releaseConnection: async () => undefined,
    destroy: async () => undefined,
  }
  const db = new Kysely<CustomFieldDefinitionsDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (instance) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
  return { db, queries }
}

describe('encrypted custom-field keys resolver', () => {
  it('returns the normalized keys of encrypted definitions', async () => {
    const { db } = createDatabase([
      { key: 'Tax_Number', config_json: { encrypted: true } },
      { key: 'national_id', config_json: '{"encrypted":true,"label":"National ID"}' },
      { key: 'tax_number', config_json: { encrypted: true } },
      { key: 'industry_note', config_json: { encrypted: false } },
      { key: 'priority', config_json: null },
      { key: '  ', config_json: { encrypted: true } },
    ])

    const keys = await createEncryptedCustomFieldKeysResolver(db)('customers:customer_company_profile', 'tenant-1')

    expect(Array.from(keys).sort()).toEqual(['national_id', 'tax_number'])
  })

  it('also returns the query engine alias form of a key with characters outside snake_case', async () => {
    const { db } = createDatabase([{ key: 'Order-Ref', config_json: { encrypted: true } }])

    const keys = await createEncryptedCustomFieldKeysResolver(db)('customers:customer_company_profile', 'tenant-1')

    expect(Array.from(keys).sort()).toEqual(['order-ref', 'order_ref'])
  })

  it('reads non-deleted encrypted-looking definitions of the entity for the tenant and global scope', async () => {
    const { db, queries } = createDatabase([])

    await createEncryptedCustomFieldKeysResolver(db)('customers:customer_company_profile', 'tenant-1')

    expect(queries).toHaveLength(1)
    expect(queries[0].sql).toBe(
      'select "key", "config_json" from "custom_field_defs" where "entity_id" = $1 and "deleted_at" is null'
        + ' and config_json::text like $2 and ("tenant_id" = $3 or "tenant_id" is null)',
    )
    expect(queries[0].parameters).toEqual(['customers:customer_company_profile', '%encrypted%', 'tenant-1'])
  })

  it('reads every tenant when no tenant is given', async () => {
    const { db, queries } = createDatabase([])

    await createEncryptedCustomFieldKeysResolver(db)('customers:customer_company_profile', null)

    expect(queries[0].sql).not.toContain('tenant_id')
    expect(queries[0].parameters).toEqual(['customers:customer_company_profile', '%encrypted%'])
  })
})
