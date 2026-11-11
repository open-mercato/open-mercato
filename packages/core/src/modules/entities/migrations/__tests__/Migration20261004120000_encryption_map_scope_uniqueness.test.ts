import { describe, expect, jest, test } from '@jest/globals'
import {
  ENCRYPTION_MAP_SCOPE_UNIQUE_INDEX,
  Migration20261004120000_encryption_map_scope_uniqueness,
} from '../Migration20261004120000_encryption_map_scope_uniqueness'

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(
    Migration20261004120000_encryption_map_scope_uniqueness.prototype,
  ) as Migration20261004120000_encryption_map_scope_uniqueness
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql.replace(/\s+/g, ' ').trim())),
  })
  await migration[direction]()
  return statements
}

describe('Migration20261004120000', () => {
  test('deduplicates before adding nullable-scope uniqueness', async () => {
    const statements = await collectSql('up')

    expect(statements).toHaveLength(3)
    expect(statements[0]).toContain('row_number() over')
    expect(statements[0]).toContain('order by map."created_at" asc, map."id" asc')
    expect(statements[0]).toContain('and (not live.any_active or live."is_active")')
    expect(statements[0]).toContain('(occurrence.hash_field is null) asc')
    expect(statements[0]).toContain('live.canonical_rank = 1')
    expect(statements[1]).toContain('order by map."created_at" asc, map."id" asc')
    expect(statements[1]).toContain('"deleted_at" = now()')
    expect(statements[1]).toContain('live.canonical_rank > 1')
    expect(statements[2]).toContain(`create unique index "${ENCRYPTION_MAP_SCOPE_UNIQUE_INDEX}"`)
    expect(statements[2]).toContain('nulls not distinct')
    expect(statements[2]).toContain('where "deleted_at" is null')
  })

  test('down removes only the invariant and never recreates ambiguous duplicates', async () => {
    await expect(collectSql('down')).resolves.toEqual([
      `drop index if exists "${ENCRYPTION_MAP_SCOPE_UNIQUE_INDEX}";`,
    ])
  })
})
