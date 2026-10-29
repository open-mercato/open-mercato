import { describe, expect, jest, test } from '@jest/globals'
import { IMMUTABLE_UNACCENT_FUNCTION } from '@open-mercato/shared/lib/db/accentInsensitiveSearch'
import { CATALOG_PRODUCT_SEARCH_INDEX, Migration20260914120100 } from '../Migration20260914120100'
import { PRODUCT_SEARCH_EXPRESSION_SQL } from '../../lib/productSearch'

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(Migration20260914120100.prototype) as Migration20260914120100
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql)),
  })
  await migration[direction]()
  return statements
}

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim()

describe('Migration20260914120100', () => {
  // CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
  test('is not transactional', () => {
    const migration = Object.create(Migration20260914120100.prototype) as Migration20260914120100
    expect(migration.isTransactional()).toBe(false)
  })

  test('up() creates the function before the index that calls it', async () => {
    const statements = (await collectSql('up')).map(normalize)

    expect(statements).toHaveLength(3)
    expect(statements[0]).toContain(`create or replace function ${IMMUTABLE_UNACCENT_FUNCTION}(text)`)
    expect(statements[1]).toContain(`drop index concurrently if exists "${CATALOG_PRODUCT_SEARCH_INDEX}"`)
    expect(statements[2]).toContain(`create index concurrently "${CATALOG_PRODUCT_SEARCH_INDEX}"`)
  })

  // PostgreSQL only uses an expression index when the query repeats the
  // expression verbatim; a drift degrades to a sequential scan with no error.
  test('up() indexes exactly the expression the products route queries with', async () => {
    const statements = (await collectSql('up')).map(normalize)

    expect(statements[2]).toContain(
      `using gin (${normalize(PRODUCT_SEARCH_EXPRESSION_SQL)} gin_trgm_ops)`,
    )
  })

  // Retrying an interrupted concurrent build must remove PostgreSQL's INVALID
  // stub; `if not exists` alone would report success over an unusable index.
  test('up() drops the index before rebuilding it so a retried build is not skipped', async () => {
    const statements = (await collectSql('up')).map(normalize)

    const dropIndex = statements.findIndex((sql) => sql.startsWith('drop index concurrently'))
    const createIndex = statements.findIndex((sql) => sql.startsWith('create index concurrently'))
    expect(dropIndex).toBeGreaterThanOrEqual(0)
    expect(dropIndex).toBeLessThan(createIndex)
  })

  test('down() drops the index before the function it depends on', async () => {
    const statements = (await collectSql('down')).map(normalize)

    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain(`drop index concurrently if exists "${CATALOG_PRODUCT_SEARCH_INDEX}"`)
    expect(statements[1]).toContain(`drop function if exists ${IMMUTABLE_UNACCENT_FUNCTION}(text)`)
  })
})
