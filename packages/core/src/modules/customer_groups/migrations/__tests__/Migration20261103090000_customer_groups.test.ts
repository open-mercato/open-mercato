import { describe, expect, jest, test } from '@jest/globals'
import { Migration20261103090000_customer_groups } from '../Migration20261103090000_customer_groups'

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(
    Migration20261103090000_customer_groups.prototype,
  ) as Migration20261103090000_customer_groups
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql.replace(/\s+/g, ' ').trim())),
  })
  await migration[direction]()
  return statements
}

describe('Migration20261103090000_customer_groups', () => {
  test('backfills every declared encryption map for pre-existing tenant scopes', async () => {
    const statements = await collectSql('up')

    expect(statements).toHaveLength(3)
    expect(statements[0]).toContain(`'customer_groups:customer_credit_account'`)
    expect(statements[0]).toContain(`'[{"field":"hold_reason"}]'::jsonb`)
    expect(statements[1]).toContain(`'customer_groups:customer_credit_ledger_entry'`)
    expect(statements[1]).toContain(`'[{"field":"note"}]'::jsonb`)
    expect(statements[2]).toContain(`'customer_groups:customer_purchase_approval'`)
    expect(statements[2]).toContain(`'[{"field":"buyer_decision_note"},{"field":"merchant_decision_note"}]'::jsonb`)
    for (const statement of statements) {
      expect(statement).toContain('where "is_active" = true and "deleted_at" is null')
    }
  })

  test('is forward-only: down() never removes admin-edited encryption maps', async () => {
    await expect(collectSql('down')).resolves.toEqual([])
  })
})
