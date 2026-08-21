import { reindexEntity } from '../lib/reindexer'

function createTrackingKysely() {
  const selectedTables: string[] = []
  const chain: any = {
    select: () => chain,
    selectAll: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    groupBy: () => chain,
    execute: async () => [],
    executeTakeFirst: async () => undefined,
  }
  const db: any = {
    selectFrom: (table: any) => {
      selectedTables.push(String(table))
      return chain
    },
    deleteFrom: () => chain,
    insertInto: () => chain,
    updateTable: () => chain,
  }
  return { db, selectedTables }
}

function makeEm(metaByClass: Record<string, string>) {
  const { db, selectedTables } = createTrackingKysely()
  const all = Object.entries(metaByClass).map(([className, tableName]) => ({ className, tableName }))
  const em: any = {
    getKysely: () => db,
    getMetadata: () => ({
      find: (className: string) => {
        const tableName = metaByClass[className]
        return tableName ? { tableName } : undefined
      },
      getAll: () => all,
    }),
  }
  return { em, selectedTables }
}

describe('reindexEntity entity-type guard (issue #2705)', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('refuses to reindex an entity type that does not resolve to registered metadata', async () => {
    const { em, selectedTables } = makeEm({ Todo: 'todos' })

    const result = await reindexEntity(em, { entityType: 'foo:auth_user', tenantId: 't1', organizationId: 'o1' })

    expect(result).toEqual({ processed: 0, total: 0, tenantScopes: [], scopes: [] })
    // The attacker-derived table (`auth_users`) must never be read from.
    expect(selectedTables).toEqual([])
  })

  it('does not pluralize an arbitrary id into an existing system table', async () => {
    const { em, selectedTables } = makeEm({ Todo: 'todos' })

    const result = await reindexEntity(em, { entityType: 'foo:user', tenantId: 't1', organizationId: 'o1' })

    expect(result.processed).toBe(0)
    expect(selectedTables).toEqual([])
  })

  it('still rejects the search_tokens table guard for registered tokens', async () => {
    const { em, selectedTables } = makeEm({ SearchToken: 'search_tokens' })

    const result = await reindexEntity(em, { entityType: 'query_index:search_token', tenantId: 't1', organizationId: 'o1' })

    expect(result).toEqual({ processed: 0, total: 0, tenantScopes: [], scopes: [] })
    expect(selectedTables).toEqual([])
  })
})
