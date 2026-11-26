import { describe, expect, jest, test } from '@jest/globals'
import { Migration20261002120000_marketing_breaker_reset } from '../Migration20261002120000_marketing_breaker_reset'

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(
    Migration20261002120000_marketing_breaker_reset.prototype,
  ) as Migration20261002120000_marketing_breaker_reset
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql)),
  })

  await migration[direction]()

  return statements
}

describe('Migration20261002120000_marketing_breaker_reset', () => {
  test('up() adds a nullable breaker_reset_at column', async () => {
    const statements = await collectSql('up')
    expect(statements).toEqual([
      'alter table "marketing_campaigns" add column "breaker_reset_at" timestamptz null;',
    ])
  })

  test('down() drops the column', async () => {
    const statements = await collectSql('down')
    expect(statements).toEqual([
      'alter table "marketing_campaigns" drop column "breaker_reset_at";',
    ])
  })
})
