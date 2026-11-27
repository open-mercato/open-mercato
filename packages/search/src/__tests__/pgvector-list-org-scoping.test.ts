import { createPgVectorDriver, type PgPool } from '../vector/drivers/pgvector'

type QueryCall = { text: string; params?: unknown[] }

function createPool(calls: QueryCall[]): PgPool {
  const run = async (text: string, params?: unknown[]) => {
    calls.push({ text, params })
    if (/pg_available_extensions/.test(text)) {
      return { rows: [{ installed: true, installable: true }] }
    }
    return { rows: [] }
  }
  return {
    connect: async () => ({ query: run as PgPool['query'], release: () => {} }),
    query: run as PgPool['query'],
    end: async () => {},
  }
}

function listCall(calls: QueryCall[]): QueryCall | undefined {
  return calls.find((call) => /SELECT[\s\S]*FROM[\s\S]*ORDER BY[\s\S]*LIMIT/.test(call.text) && !/pg_available_extensions/.test(call.text))
}

describe('pgvector list organization scoping', () => {
  it('filters by an organization set in one query so LIMIT/OFFSET page the whole set', async () => {
    const calls: QueryCall[] = []
    const driver = createPgVectorDriver({ pool: createPool(calls) })

    await driver.list!({ tenantId: 'tenant-1', organizationIds: ['org-a', 'org-b', 'org-a'], limit: 50, offset: 200 })

    const call = listCall(calls)
    expect(call).toBeDefined()
    expect(call!.text).toMatch(/organization_id = ANY\(\$3::uuid\[\]\)/)
    expect(call!.params).toEqual(['pgvector', 'tenant-1', ['org-a', 'org-b'], 50, 200])
  })

  it('returns nothing without querying when the organization set is empty', async () => {
    const calls: QueryCall[] = []
    const driver = createPgVectorDriver({ pool: createPool(calls) })

    expect(await driver.list!({ tenantId: 'tenant-1', organizationIds: [] })).toEqual([])
    expect(listCall(calls)).toBeUndefined()
  })

  it('prefers a single organization over the set', async () => {
    const calls: QueryCall[] = []
    const driver = createPgVectorDriver({ pool: createPool(calls) })

    await driver.list!({ tenantId: 'tenant-1', organizationId: 'org-a', organizationIds: ['org-b'] })

    const call = listCall(calls)
    expect(call!.text).toMatch(/organization_id = \$3::uuid/)
    expect(call!.text).not.toMatch(/ANY/)
    expect(call!.params?.[2]).toBe('org-a')
  })

  it('keeps a tenant-wide list when no organization filter is given', async () => {
    const calls: QueryCall[] = []
    const driver = createPgVectorDriver({ pool: createPool(calls) })

    await driver.list!({ tenantId: 'tenant-1' })

    const call = listCall(calls)
    expect(call!.text).not.toMatch(/organization_id =/)
  })

  it('applies matched organization and entity scopes before pagination', async () => {
    const calls: QueryCall[] = []
    const driver = createPgVectorDriver({ pool: createPool(calls) })
    const entityAccess = [
      { organizationId: 'org-a', entityIds: ['demo:allowed'] },
      { organizationId: 'org-b', entityIds: ['demo:other'] },
    ]

    await driver.list!({ tenantId: 'tenant-1', entityAccess, limit: 25, offset: 10 })

    const call = listCall(calls)
    expect(call?.text).toMatch(/jsonb_to_recordset\(\$3::jsonb\)/)
    expect(call?.text).toMatch(/access\."organizationId" = organization_id[\s\S]*entity_id = ANY\(access\."entityIds"\)[\s\S]*LIMIT \$4 OFFSET \$5/)
    expect(call?.params).toEqual(['pgvector', 'tenant-1', JSON.stringify(entityAccess), 25, 10])
  })

  it('returns no entries when the entity scope is explicitly empty', async () => {
    const calls: QueryCall[] = []
    const driver = createPgVectorDriver({ pool: createPool(calls) })

    expect(await driver.list!({ tenantId: 'tenant-1', entityAccess: [] })).toEqual([])
    expect(listCall(calls)).toBeUndefined()
  })

})
