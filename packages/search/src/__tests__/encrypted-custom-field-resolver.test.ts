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

<<<<<<< HEAD
type Definition = CustomFieldDefinitionsDatabase['custom_field_defs']
type Predicate = (row: Definition) => boolean

function makeDatabase(definitions: Definition[]) {
  const predicates: Predicate[] = []
  const expression = Object.assign(
    (field: keyof Definition, operator: string, value: unknown): Predicate => (row) => row[field] === value,
    {
      and: (parts: Predicate[]): Predicate => (row) => parts.every((part) => part(row)),
      or: (parts: Predicate[]): Predicate => (row) => parts.some((part) => part(row)),
    },
  )
  const query = {
    select: () => query,
    where: (field: keyof Definition | ((builder: typeof expression) => Predicate), operator?: string, value?: unknown) => {
      predicates.push(typeof field === 'function' ? field(expression) : expression(field, operator ?? '=', value))
      return query
    },
    execute: async () => definitions.filter((row) => predicates.every((predicate) => predicate(row))),
  }
  return { selectFrom: () => query } as unknown as Kysely<CustomFieldDefinitionsDatabase>
}

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const definition = (key: string, tenantId: string | null, organizationId: string | null): Definition => ({
  key, tenant_id: tenantId, organization_id: organizationId,
  entity_id: 'example:todo', config_json: { encrypted: true }, deleted_at: null,
})

describe('encrypted custom-field definitions', () => {
  it('includes global and current-scope definitions without reading foreign policy', async () => {
    const database = makeDatabase([
      definition('global', null, null), definition('tenant', 'tenant-1', null),
      definition('private.code', 'tenant-1', 'org-1'), definition('foreign-tenant', 'tenant-2', null),
      definition('foreign-org', 'tenant-1', 'org-2'),
    ])
    await expect(createEncryptedCustomFieldKeysResolver(database)('example:todo', scope)).resolves.toEqual(
      new Set(['global', 'tenant', 'private.code', 'private_code']),
    )
  })

  it('excludes organization-specific definitions from a tenant-wide indexing operation', async () => {
    const database = makeDatabase([definition('tenant', 'tenant-1', null), definition('organization', 'tenant-1', 'org-1')])
    await expect(createEncryptedCustomFieldKeysResolver(database)('example:todo', { tenantId: 'tenant-1' })).resolves.toEqual(new Set(['tenant']))
  })

  it('returns an explicit empty policy when the scope has no encrypted definitions', async () => {
    await expect(createEncryptedCustomFieldKeysResolver(makeDatabase([]))('example:todo', scope)).resolves.toEqual(new Set())
  })

  it('rejects missing scope before querying definitions', async () => {
    const selectFrom = jest.fn()
    const database = { selectFrom } as unknown as Kysely<CustomFieldDefinitionsDatabase>
    await expect(createEncryptedCustomFieldKeysResolver(database)('example:todo')).rejects.toThrow('Trusted search scope is required')
    expect(selectFrom).not.toHaveBeenCalled()
  })

  it('propagates unreadable definitions so the indexer denies all custom fields', async () => {
    const database = { selectFrom: () => { throw new Error('[internal] Database unavailable') } } as unknown as Kysely<CustomFieldDefinitionsDatabase>
    await expect(createEncryptedCustomFieldKeysResolver(database)('example:todo', scope)).rejects.toThrow('Database unavailable')
=======
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
>>>>>>> 68902bd1cc (fix(search): keep encrypted custom fields out of search build contexts (#8410))
  })
})
