import { describe, expect, jest, test } from '@jest/globals'
import { Migration20261002101500_marketing_watch_rotation } from '../Migration20261002101500_marketing_watch_rotation'

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(
    Migration20261002101500_marketing_watch_rotation.prototype,
  ) as Migration20261002101500_marketing_watch_rotation
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql)),
  })

  await migration[direction]()

  return statements
}

describe('Migration20261002101500_marketing_watch_rotation', () => {
  test('up() adds the rotation column and its index', async () => {
    const statements = await collectSql('up')
    expect(statements).toEqual([
      'alter table "marketing_product_watches" add column "last_scanned_at" timestamptz null;',
      'create index "mkt_watch_rotation_idx" on "marketing_product_watches" '
      + '("tenant_id", "organization_id", "last_scanned_at");',
    ])
  })

  test('down() drops the index before the column', async () => {
    const statements = await collectSql('down')
    expect(statements).toEqual([
      'drop index "mkt_watch_rotation_idx";',
      'alter table "marketing_product_watches" drop column "last_scanned_at";',
    ])
  })
})
