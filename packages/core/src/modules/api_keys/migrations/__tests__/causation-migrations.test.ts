import { describe, expect, jest, test } from '@jest/globals'
import { Migration20261008080137_api_keys } from '../Migration20261008080137_api_keys'

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(Migration20261008080137_api_keys.prototype) as Migration20261008080137_api_keys
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql)),
  })
  await migration[direction]()
  return statements
}

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim()

describe('Migration20261008080137_api_keys', () => {
  test('stays transactional so set local lock_timeout applies to the column change', () => {
    const migration = Object.create(Migration20261008080137_api_keys.prototype) as Migration20261008080137_api_keys
    expect(migration.isTransactional()).toBe(true)
  })

  test('up() bounds the lock wait before adding the nullable causation column', async () => {
    const statements = (await collectSql('up')).map(normalize)

    expect(statements).toEqual([
      `set local lock_timeout = '5s';`,
      'alter table "api_keys" add "causation_json" jsonb null;',
    ])
  })

  test('down() drops the causation column', async () => {
    const statements = (await collectSql('down')).map(normalize)

    expect(statements).toEqual(['alter table "api_keys" drop column "causation_json";'])
  })
})
