import { describe, expect, jest, test } from '@jest/globals'
import { Migration20261029114801_catalog } from '../Migration20261029114801_catalog'

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(Migration20261029114801_catalog.prototype) as Migration20261029114801_catalog
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql)),
  })
  await migration[direction]()
  return statements
}

describe('Migration20261029114801_catalog', () => {
  test('up() creates the table, its indexes and the product foreign key', async () => {
    const statements = await collectSql('up')

    expect(statements).toHaveLength(5)
    expect(statements[0]).toContain('create table "catalog_product_category_suggestions"')
    expect(statements[1]).toContain('catalog_product_category_suggestions_product_created_idx')
    expect(statements[2]).toContain('catalog_product_category_suggestions_scope_idx')
    expect(statements[3]).toContain('create unique index "catalog_product_category_suggestions_pending_unique"')
    expect(statements[3]).toContain(`where "status" = 'pending'`)
    expect(statements[4]).toContain('catalog_product_category_suggestions_product_id_foreign')
  })

  test('up() creates the partial unique index after the table so it is never applied to a missing relation', async () => {
    const statements = await collectSql('up')
    const createTable = statements.findIndex((sql) => sql.startsWith('create table "catalog_product_category_suggestions"'))
    const partialUnique = statements.findIndex((sql) => sql.includes('catalog_product_category_suggestions_pending_unique'))
    expect(createTable).toBeGreaterThanOrEqual(0)
    expect(createTable).toBeLessThan(partialUnique)
  })

  // Down must cleanly reverse the up migration with no leftover table, index
  // or constraint — `cascade` so the FK is dropped with the table.
  test('down() drops the table and everything that depends on it', async () => {
    const statements = await collectSql('down')

    expect(statements).toHaveLength(1)
    expect(statements[0]).toBe('drop table if exists "catalog_product_category_suggestions" cascade;')
  })
})
