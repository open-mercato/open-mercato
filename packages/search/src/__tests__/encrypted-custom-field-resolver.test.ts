import { createEncryptedCustomFieldKeysResolver } from '../lib/encrypted-custom-field-resolver'

function createDatabase(rows: Array<Record<string, unknown>>) {
  const query: Record<string, jest.Mock> = {}
  for (const method of ['select', 'where']) {
    query[method] = jest.fn(() => query)
  }
  query.execute = jest.fn(async () => rows)
  return {
    db: { selectFrom: jest.fn(() => query) },
    query,
  }
}

describe('encrypted custom-field keys resolver', () => {
  it('returns the normalized keys of encrypted definitions across every scope', async () => {
    const { db } = createDatabase([
      { key: 'Tax_Number', config_json: { encrypted: true } },
      { key: 'national_id', config_json: '{"encrypted":true,"label":"National ID"}' },
      { key: 'tax_number', config_json: { encrypted: true } },
      { key: 'industry_note', config_json: { encrypted: false } },
      { key: 'priority', config_json: null },
      { key: '  ', config_json: { encrypted: true } },
    ])

    const keys = await createEncryptedCustomFieldKeysResolver(db as never)('customers:customer_company_profile')

    expect(Array.from(keys).sort()).toEqual(['national_id', 'tax_number'])
  })

  it('reads non-deleted definitions of the requested entity without a scope filter', async () => {
    const { db, query } = createDatabase([])

    await createEncryptedCustomFieldKeysResolver(db as never)('customers:customer_company_profile')

    expect(db.selectFrom).toHaveBeenCalledWith('custom_field_defs')
    expect(query.where).toHaveBeenCalledWith('entity_id', '=', 'customers:customer_company_profile')
    expect(query.where).toHaveBeenCalledWith('deleted_at', 'is', null)
    expect(query.where).toHaveBeenCalledTimes(2)
  })
})
