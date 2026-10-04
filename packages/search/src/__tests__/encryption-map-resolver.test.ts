jest.mock('../fulltext/drivers', () => ({
  createFulltextDriver: jest.fn(),
}))

import { createEncryptionMapResolver } from '../di'

type QueryResult = Array<Record<string, unknown>> | Error

function createDatabase(results: QueryResult[]) {
  const queue = [...results]
  const query: Record<string, jest.Mock> = {}
  for (const method of ['select', 'where', 'orderBy']) {
    query[method] = jest.fn(() => query)
  }
  query.execute = jest.fn(async () => {
    const result = queue.shift() ?? []
    if (result instanceof Error) throw result
    return result
  })
  return {
    db: { selectFrom: jest.fn(() => query) },
    query,
  }
}

describe('search encryption-map resolver', () => {
  it('deterministically unions legacy duplicate rows and completes a missing hash target', async () => {
    const { db } = createDatabase([[
      {
        id: 'b',
        tenant_id: 'tenant-1',
        organization_id: 'org-1',
        created_at: '2026-01-02T00:00:00.000Z',
        fields_json: [{ field: 'email', hashField: 'email_hash' }, { field: 'phone' }],
      },
      {
        id: 'a',
        tenant_id: 'tenant-1',
        organization_id: 'org-1',
        created_at: '2026-01-01T00:00:00.000Z',
        fields_json: [{ field: 'email' }, { field: 'display_name' }],
      },
    ]])

    await expect(createEncryptionMapResolver(db as never)('customers:person')).resolves.toEqual([
      { field: 'email', hashField: 'email_hash' },
      { field: 'display_name', hashField: null },
      { field: 'phone', hashField: null },
    ])
  })

  it('unions global, tenant-global, and organization-scoped declarations fail-safe', async () => {
    const { db, query } = createDatabase([[
      {
        id: 'org',
        tenant_id: 'tenant-1',
        organization_id: 'org-1',
        created_at: '2026-01-03T00:00:00.000Z',
        fields_json: [{ field: 'organization_secret' }],
      },
      {
        id: 'global',
        tenant_id: null,
        organization_id: null,
        created_at: '2026-01-01T00:00:00.000Z',
        fields_json: '[{"field":"global_secret"}]',
      },
      {
        id: 'tenant',
        tenant_id: 'tenant-1',
        organization_id: null,
        created_at: '2026-01-02T00:00:00.000Z',
        fields_json: [{ field: 'tenant_secret' }],
      },
    ]])

    await expect(createEncryptionMapResolver(db as never)('demo:item')).resolves.toEqual([
      { field: 'global_secret', hashField: null },
      { field: 'tenant_secret', hashField: null },
      { field: 'organization_secret', hashField: null },
    ])
    expect(query.where).toHaveBeenCalledWith('is_active', '=', true)
    expect(query.where).toHaveBeenCalledWith('deleted_at', 'is', null)
    expect(query.orderBy).toHaveBeenCalledTimes(4)
  })

  it('fails closed on lookup errors and retries instead of caching an empty policy', async () => {
    const { db, query } = createDatabase([
      new Error('database unavailable'),
      [{
        id: 'recovered',
        tenant_id: null,
        organization_id: null,
        created_at: '2026-01-01T00:00:00.000Z',
        fields_json: [{ field: 'secret' }],
      }],
    ])
    const resolveMap = createEncryptionMapResolver(db as never)

    await expect(resolveMap('demo:item')).rejects.toThrow('database unavailable')
    await expect(resolveMap('demo:item')).resolves.toEqual([{ field: 'secret', hashField: null }])
    expect(query.execute).toHaveBeenCalledTimes(2)
  })

  it('does not retain a successful empty lookup for five minutes', async () => {
    const { db, query } = createDatabase([
      [],
      [{
        id: 'created-later',
        tenant_id: 'tenant-1',
        organization_id: null,
        created_at: '2026-01-01T00:00:00.000Z',
        fields_json: [{ field: 'new_secret' }],
      }],
    ])
    const resolveMap = createEncryptionMapResolver(db as never)

    await expect(resolveMap('demo:item')).resolves.toEqual([])
    await expect(resolveMap('demo:item')).resolves.toEqual([{ field: 'new_secret', hashField: null }])
    await expect(resolveMap('demo:item')).resolves.toEqual([{ field: 'new_secret', hashField: null }])
    expect(query.execute).toHaveBeenCalledTimes(2)
  })
})
