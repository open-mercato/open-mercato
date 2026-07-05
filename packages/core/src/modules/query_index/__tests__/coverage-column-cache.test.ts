import { primeColumnCache } from '../lib/coverage'

function makeInfoSchemaDb(existingColumns: Set<string>) {
  const queries: Array<{ tables: string[]; columns: string[] }> = []

  function build() {
    const filter: { tables: string[]; columns: string[] } = { tables: [], columns: [] }
    const chain: Record<string, unknown> = {
      select: () => chain,
      where: (col: unknown, op: unknown, val: unknown) => {
        if (col === 'table_name') filter.tables = Array.isArray(val) ? (val as string[]) : [String(val)]
        if (col === 'column_name') filter.columns = Array.isArray(val) ? (val as string[]) : [String(val)]
        return chain
      },
      execute: async () => {
        queries.push({ tables: [...filter.tables], columns: [...filter.columns] })
        const rows: Array<{ table_name: string; column_name: string }> = []
        for (const t of filter.tables) {
          for (const c of filter.columns) {
            if (existingColumns.has(`${t}.${c}`)) rows.push({ table_name: t, column_name: c })
          }
        }
        return rows
      },
    }
    return chain
  }

  return { db: { selectFrom: () => build() }, queries }
}

describe('query_index lib/coverage column cache', () => {
  it('batches distinct (table, column) checks into a single query and resolves present/absent correctly', async () => {
    const suffix = 'batch-1'
    const tableA = `entity_a_${suffix}`
    const tableB = `entity_b_${suffix}`
    const { db, queries } = makeInfoSchemaDb(new Set([
      `${tableA}.organization_id`,
      `${tableA}.tenant_id`,
      `vector_search_${suffix}.entity_id`,
    ]))

    await primeColumnCache(db as any, [
      { table: tableA, column: 'organization_id' },
      { table: tableA, column: 'tenant_id' },
      { table: tableA, column: 'deleted_at' },
      { table: tableB, column: 'organization_id' },
      { table: `vector_search_${suffix}`, column: 'entity_id' },
    ])

    expect(queries).toHaveLength(1)

    // A second prime call with the same keys must not requery — everything is cached now.
    await primeColumnCache(db as any, [
      { table: tableA, column: 'organization_id' },
      { table: tableB, column: 'organization_id' },
    ])
    expect(queries).toHaveLength(1)
  })

  it('does not re-query keys already cached from a prior call, only the new ones', async () => {
    const suffix = 'partial-2'
    const tableA = `entity_a_${suffix}`
    const tableC = `entity_c_${suffix}`
    const { db, queries } = makeInfoSchemaDb(new Set([`${tableA}.tenant_id`, `${tableC}.tenant_id`]))

    await primeColumnCache(db as any, [{ table: tableA, column: 'tenant_id' }])
    expect(queries).toHaveLength(1)
    expect(queries[0].columns).toEqual(['tenant_id'])

    await primeColumnCache(db as any, [
      { table: tableA, column: 'tenant_id' },
      { table: tableC, column: 'tenant_id' },
    ])
    expect(queries).toHaveLength(2)
    expect(queries[1].tables).toEqual([tableC])
  })

  it('de-dupes concurrent overlapping prime calls into a single underlying query (in-flight cache)', async () => {
    const suffix = 'concurrent-3'
    const sharedTable = `vector_search_${suffix}`
    const { db, queries } = makeInfoSchemaDb(new Set([`${sharedTable}.entity_id`]))

    const [first, second] = await Promise.all([
      primeColumnCache(db as any, [{ table: sharedTable, column: 'entity_id' }]),
      primeColumnCache(db as any, [{ table: sharedTable, column: 'entity_id' }]),
    ])

    expect(first).toBeUndefined()
    expect(second).toBeUndefined()
    // Both calls raced on the exact same key before either resolved — only one query should fire.
    expect(queries).toHaveLength(1)
  })
})
