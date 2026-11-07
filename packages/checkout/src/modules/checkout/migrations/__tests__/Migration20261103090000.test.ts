import { describe, expect, jest, test } from '@jest/globals'
import { Migration20261103090000 } from '../Migration20261103090000'

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(Migration20261103090000.prototype) as Migration20261103090000
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql.replace(/\s+/g, ' ').trim())),
  })
  await migration[direction]()
  return statements
}

describe('Migration20261103090000', () => {
  test('backfills the checkout_session encryption map for pre-existing tenant scopes', async () => {
    const statements = await collectSql('up')

    expect(statements).toHaveLength(1)
    expect(statements[0]).toContain(`'checkout:checkout_session'`)
    expect(statements[0]).toContain(
      `'[{"field":"email"},{"field":"phone"},{"field":"shipping_address"},{"field":"billing_address"}]'::jsonb`,
    )
    expect(statements[0]).toContain('where "is_active" = true and "deleted_at" is null')
  })

  test('is forward-only: down() never removes admin-edited encryption maps', async () => {
    await expect(collectSql('down')).resolves.toEqual([])
  })
})
