import { describe, expect, jest, test } from '@jest/globals'
import { Migration20261026180000_customers_address_contact_encryption } from '../Migration20261026180000_customers_address_contact_encryption'
import { defaultEncryptionMaps } from '../../encryption'

function collectSql(direction: 'up' | 'down'): Promise<string[]> | string[] {
  const migration = Object.create(
    Migration20261026180000_customers_address_contact_encryption.prototype,
  ) as Migration20261026180000_customers_address_contact_encryption
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql)),
  })
  migration[direction]()
  return statements
}

const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim()

describe('Migration20261026180000_customers_address_contact_encryption', () => {
  test('backfills recipient_name and phone into existing customer_address maps', async () => {
    // Given an upgraded tenant whose customers:customer_address map predates the two new columns
    // When the migration runs
    const statements = (await collectSql('up')).map(normalize)

    // Then one idempotent statement inserts the map where missing and appends each missing rule
    expect(statements).toHaveLength(1)
    const sql = statements[0]
    expect(sql).toContain(`'customers:customer_address'`)
    expect(sql).toContain('not exists')
    expect(sql).toContain(`rule->>'field' = 'recipient_name'`)
    expect(sql).toContain(`rule->>'field' = 'phone'`)
    expect(sql).toContain(`update "encryption_maps" set "fields_json"`)
  })

  test('is forward-only: down() emits no SQL', async () => {
    expect(await collectSql('down')).toEqual([])
  })

  test('covers every address contact field declared in the default encryption map', () => {
    const declared = defaultEncryptionMaps
      .find((map) => map.entityId === 'customers:customer_address')!
      .fields.map((rule) => rule.field)
    expect(declared).toEqual(expect.arrayContaining(['recipient_name', 'phone']))
  })
})
