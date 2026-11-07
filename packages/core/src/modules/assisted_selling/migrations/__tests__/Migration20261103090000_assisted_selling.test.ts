import { describe, expect, jest, test } from '@jest/globals'
import { Migration20261103090000_assisted_selling } from '../Migration20261103090000_assisted_selling'

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(
    Migration20261103090000_assisted_selling.prototype,
  ) as Migration20261103090000_assisted_selling
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql.replace(/\s+/g, ' ').trim())),
  })
  await migration[direction]()
  return statements
}

describe('Migration20261103090000_assisted_selling', () => {
  test('backfills every declared encryption map for pre-existing tenant scopes', async () => {
    const statements = await collectSql('up')

    expect(statements).toHaveLength(3)
    expect(statements[0]).toContain(`'assisted_selling:assisted_selling_message'`)
    expect(statements[0]).toContain(`'[{"field":"body"}]'::jsonb`)
    expect(statements[1]).toContain(`'assisted_selling:assisted_selling_participant'`)
    expect(statements[1]).toContain(`'[{"field":"displayName"}]'::jsonb`)
    expect(statements[2]).toContain(`'assisted_selling:assisted_selling_proposal'`)
    expect(statements[2]).toContain(`'[{"field":"rejectionReason"}]'::jsonb`)
    for (const statement of statements) {
      expect(statement).toContain('where "is_active" = true and "deleted_at" is null')
    }
  })

  test('is forward-only: down() never removes admin-edited encryption maps', async () => {
    await expect(collectSql('down')).resolves.toEqual([])
  })
})
