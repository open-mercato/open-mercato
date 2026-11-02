import type { Kysely } from 'kysely'
import { createEncryptedCustomFieldKeysResolver, type CustomFieldDefinitionsDatabase } from '../lib/encrypted-custom-field-resolver'

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
  })
})
