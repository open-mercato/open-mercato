import type { Kysely } from 'kysely'
import { createEncryptedCustomFieldKeysResolver, type CustomFieldDefinitionsDatabase } from '../lib/encrypted-custom-field-resolver'

type Definition = { key: string; config_json: unknown }

function makeDatabase(definitions: Definition[]) {
  const predicates: Array<[string, string, unknown]> = []
  const query = {
    select: () => query,
    where: (field: string, operator: string, value: unknown) => { predicates.push([field, operator, value]); return query },
    execute: async () => definitions,
  }
  const database = { selectFrom: (table: string) => { expect(table).toBe('custom_field_defs'); return query } } as unknown as Kysely<CustomFieldDefinitionsDatabase>
  return { database, predicates }
}

describe('encrypted custom-field definitions', () => {
  it('unions encrypted keys across scopes, including sanitized query-engine aliases and JSON config', async () => {
    const { database, predicates } = makeDatabase([
      { key: ' Tax-Number ', config_json: { encrypted: true } },
      { key: 'private.code', config_json: '{"encrypted":true}' },
      { key: 'plain', config_json: { encrypted: false } },
      { key: '', config_json: { encrypted: true } },
    ])

    const keys = await createEncryptedCustomFieldKeysResolver(database)('example:todo')

    expect(keys).toEqual(new Set(['tax-number', 'tax_number', 'private.code', 'private_code']))
    expect(predicates).toEqual([['entity_id', '=', 'example:todo'], ['deleted_at', 'is', null]])
  })

  it('returns an explicit empty policy when the entity has no encrypted definitions', async () => {
    const { database } = makeDatabase([{ key: 'plain', config_json: {} }])

    await expect(createEncryptedCustomFieldKeysResolver(database)('example:todo')).resolves.toEqual(new Set())
  })

  it('propagates unreadable definitions so the indexer can deny all custom fields', async () => {
    const database = { selectFrom: () => { throw new Error('[internal] Database unavailable') } } as unknown as Kysely<CustomFieldDefinitionsDatabase>

    await expect(createEncryptedCustomFieldKeysResolver(database)('example:todo')).rejects.toThrow('Database unavailable')
  })
})
