const mockGetAuthFromRequest = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

const mockCreateRequestContainer = jest.fn()
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

const mockGetEntityIds = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/entityIds', () => ({
  getEntityIds: (...args: unknown[]) => mockGetEntityIds(...args),
}))

const mockFlattenSystemEntityIds = jest.fn()
jest.mock('@open-mercato/shared/lib/entities/system-entities', () => ({
  flattenSystemEntityIds: (...args: unknown[]) => mockFlattenSystemEntityIds(...args),
}))

const mockResolveOrganizationScopeForRequest = jest.fn()
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveOrganizationScopeForRequest(...args),
}))

const mockReadCoverageSnapshot = jest.fn()
const mockReadCoverageSnapshots = jest.fn()
const mockRefreshCoverageSnapshot = jest.fn()
jest.mock('../lib/coverage', () => ({
  readCoverageSnapshot: (...args: unknown[]) => mockReadCoverageSnapshot(...args),
  readCoverageSnapshots: (...args: unknown[]) => mockReadCoverageSnapshots(...args),
  refreshCoverageSnapshot: (...args: unknown[]) => mockRefreshCoverageSnapshot(...args),
}))

import { GET } from '../api/status'

const ENTITY_A = 'catalog:catalog_product'
const ENTITY_B = 'customers:person'

function staleSnapshot() {
  const refreshedAt = new Date(Date.now() - 5 * 60_000)
  return {
    base_count: 5,
    indexed_count: 5,
    vector_indexed_count: 0,
    refreshed_at: refreshedAt,
    baseCount: 5,
    indexedCount: 5,
    vectorIndexedCount: 0,
  }
}

function snapshotWithRefreshedAt(refreshedAt: Date) {
  return {
    ...staleSnapshot(),
    refreshed_at: refreshedAt,
  }
}

type FakeRow = Record<string, unknown>
type FakePredicate = (row: FakeRow) => boolean

function makeComparison(column: unknown, operator: unknown, value: unknown): FakePredicate {
  const key = String(column)
  if (operator === '=') return (row) => row[key] === value
  if (operator === 'in') return (row) => Array.isArray(value) && value.includes(row[key])
  if (operator === 'is') return (row) => value == null ? row[key] == null : row[key] === value
  return () => true
}

function makeFakeDb(tableRows: Record<string, FakeRow[]>) {
  const build = (table: string) => {
    const rows = tableRows[String(table)] ?? []
    const predicates: FakePredicate[] = []
    const chain: Record<string, unknown> = {}
    const passthrough = () => chain
    for (const method of ['select', 'selectAll', 'distinct', 'orderBy', 'limit']) {
      chain[method] = passthrough
    }
    chain.where = (...args: unknown[]) => {
      if (typeof args[0] === 'function') {
        const eb = ((column: unknown, operator: unknown, value: unknown) =>
          makeComparison(column, operator, value)) as typeof makeComparison & { or: (items: FakePredicate[]) => FakePredicate }
        eb.or = (items: FakePredicate[]) => (row: FakeRow) => items.some((item) => item(row))
        const predicate = args[0](eb)
        if (typeof predicate === 'function') predicates.push(predicate)
      } else if (typeof args[0] === 'string') {
        predicates.push(makeComparison(args[0], args[1], args[2]))
      }
      return chain
    }
    const execute = async () => rows.filter((row) => predicates.every((predicate) => predicate(row)))
    chain.execute = execute
    chain.executeTakeFirst = async () => (await execute())[0]
    return chain
  }
  return { selectFrom: (table: string) => build(table) }
}

function makeRequest(query = '') {
  return new Request(`http://localhost/api/query_index/status${query}`)
}

describe('query_index status route — coverage waterfall (#3285)', () => {
  const emitEvent = jest.fn(async () => undefined)

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ tenantId: 'tenant-1', orgId: 'org-1', sub: 'user-1' })
    mockGetEntityIds.mockReturnValue({ catalog: { product: ENTITY_A }, customers: { person: ENTITY_B } })
    mockFlattenSystemEntityIds.mockReturnValue([ENTITY_A, ENTITY_B])
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: 'org-1',
      filterIds: ['org-1'],
      allowedIds: ['org-1'],
      tenantId: 'tenant-1',
    })
    mockReadCoverageSnapshot.mockResolvedValue(staleSnapshot())
    mockReadCoverageSnapshots.mockImplementation(async (_db: unknown, batch: { entityTypes: string[] }) => {
      const map = new Map<string, unknown>()
      for (const entityType of batch.entityTypes) map.set(entityType, staleSnapshot())
      return map
    })
    mockRefreshCoverageSnapshot.mockResolvedValue(undefined)

    const db = makeFakeDb({
      custom_field_defs: [
        { entity_id: ENTITY_A, is_active: true, tenant_id: null, organization_id: null },
        { entity_id: ENTITY_B, is_active: true, tenant_id: null, organization_id: null },
      ],
      entity_index_jobs: [],
      indexer_error_logs: [],
      indexer_status_logs: [],
    })
    const em = { getKysely: () => db }
    mockCreateRequestContainer.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'eventBus') return { emitEvent }
        if (name === 'searchModuleConfigs') return []
        if (name === 'searchStrategies') return []
        throw new Error(`Unexpected token: ${name}`)
      },
    })
  })

  it('stays read-cheap on a normal poll: no inline coverage refresh', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(mockRefreshCoverageSnapshot).not.toHaveBeenCalled()
  })

  it('reads every entity snapshot via a single batched query', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(mockReadCoverageSnapshots).toHaveBeenCalledTimes(1)
    expect(mockReadCoverageSnapshots).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityTypes: expect.arrayContaining([ENTITY_A, ENTITY_B]) }),
    )
    // The per-entity serial read must not be used by the polling path.
    expect(mockReadCoverageSnapshot).not.toHaveBeenCalled()
  })

  it('queues stale entities for the async coverage.refresh event path', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const refreshEvents = emitEvent.mock.calls.filter(([eventId]) => eventId === 'query_index.coverage.refresh')
    const refreshedEntities = refreshEvents.map(([, payload]) => (payload as { entityType: string }).entityType)
    expect(refreshedEntities).toEqual(expect.arrayContaining([ENTITY_A, ENTITY_B]))
    expect(mockRefreshCoverageSnapshot).not.toHaveBeenCalled()
  })

  it('throttles repeated explicit refresh recomputes within the same tenant scope', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    let persistedRefreshedAt: Date | null = null
    mockReadCoverageSnapshots.mockImplementation(async (_db: unknown, batch: { entityTypes: string[] }) => {
      const map = new Map<string, unknown>()
      for (const entityType of batch.entityTypes) {
        map.set(entityType, persistedRefreshedAt ? snapshotWithRefreshedAt(persistedRefreshedAt) : staleSnapshot())
      }
      return map
    })
    try {
      const first = await GET(makeRequest('?refresh=1'))
      expect(first.status).toBe(200)
      expect(mockRefreshCoverageSnapshot).toHaveBeenCalledTimes(2)
      const refreshedScopes = mockRefreshCoverageSnapshot.mock.calls.map(([, scope]) => (scope as { entityType: string }).entityType)
      expect(refreshedScopes).toEqual(expect.arrayContaining([ENTITY_A, ENTITY_B]))

      mockRefreshCoverageSnapshot.mockClear()
      persistedRefreshedAt = new Date(1_000_000)
      nowSpy.mockReturnValue(1_001_000)
      const immediateSecond = await GET(makeRequest('?refresh=1'))
      expect(immediateSecond.status).toBe(200)
      expect(mockRefreshCoverageSnapshot).not.toHaveBeenCalled()

      nowSpy.mockReturnValue(1_061_000)
      const afterCooldown = await GET(makeRequest('?refresh=1'))
      expect(afterCooldown.status).toBe(200)
      expect(mockRefreshCoverageSnapshot).toHaveBeenCalledTimes(2)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('uses fresh persisted coverage snapshots instead of recomputing explicit refreshes', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(2_000_000)
    try {
      mockReadCoverageSnapshots.mockImplementation(async (_db: unknown, batch: { entityTypes: string[] }) => {
        const map = new Map<string, unknown>()
        for (const entityType of batch.entityTypes) {
          map.set(entityType, snapshotWithRefreshedAt(new Date(1_999_000)))
        }
        return map
      })

      const res = await GET(makeRequest('?refresh=1'))
      expect(res.status).toBe(200)
      expect(mockRefreshCoverageSnapshot).not.toHaveBeenCalled()
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('does not raise a partial-index warning when coverage is not yet computed', async () => {
    mockReadCoverageSnapshots.mockResolvedValue(new Map())
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(res.headers.get('x-om-partial-index')).toBeNull()
  })

  it('still raises a partial-index warning when base and index counts diverge', async () => {
    mockReadCoverageSnapshots.mockImplementation(async (_db: unknown, batch: { entityTypes: string[] }) => {
      const map = new Map<string, unknown>()
      for (const entityType of batch.entityTypes) {
        map.set(entityType, { ...staleSnapshot(), base_count: 10, indexed_count: 3, baseCount: 10, indexedCount: 3 })
      }
      return map
    })
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const header = res.headers.get('x-om-partial-index')
    expect(header).toBeTruthy()
    const parsed = JSON.parse(header as string)
    expect(parsed.type).toBe('partial_index')
    expect([ENTITY_A, ENTITY_B]).toContain(parsed.entity)
  })

  it('does not expose null-organization diagnostics to org-scoped callers (#3887)', async () => {
    const occurredAt = new Date('2026-07-08T12:00:00.000Z')
    const db = makeFakeDb({
      custom_field_defs: [
        { entity_id: ENTITY_A, is_active: true, tenant_id: null, organization_id: null },
      ],
      entity_index_jobs: [],
      indexer_error_logs: [
        {
          id: 'err-org-1',
          source: 'indexer',
          handler: 'query_index:test',
          entity_type: ENTITY_A,
          record_id: 'visible-record',
          tenant_id: 'tenant-1',
          organization_id: 'org-1',
          payload: { visible: true },
          message: 'org-scoped diagnostic',
          stack: null,
          occurred_at: occurredAt,
        },
        {
          id: 'err-global',
          source: 'indexer',
          handler: 'query_index:test',
          entity_type: ENTITY_A,
          record_id: 'leaked-record',
          tenant_id: 'tenant-1',
          organization_id: null,
          payload: { leaked: true },
          message: 'global diagnostic',
          stack: 'sensitive stack',
          occurred_at: occurredAt,
        },
        {
          id: 'err-org-2',
          source: 'indexer',
          handler: 'query_index:test',
          entity_type: ENTITY_A,
          record_id: 'other-record',
          tenant_id: 'tenant-1',
          organization_id: 'org-2',
          payload: { other: true },
          message: 'other org diagnostic',
          stack: null,
          occurred_at: occurredAt,
        },
      ],
      indexer_status_logs: [
        {
          id: 'log-org-1',
          source: 'indexer',
          handler: 'query_index:test',
          level: 'info',
          entity_type: ENTITY_A,
          record_id: 'visible-record',
          tenant_id: 'tenant-1',
          organization_id: 'org-1',
          message: 'org-scoped status',
          details: { visible: true },
          occurred_at: occurredAt,
        },
        {
          id: 'log-global',
          source: 'indexer',
          handler: 'query_index:test',
          level: 'warn',
          entity_type: ENTITY_A,
          record_id: 'leaked-record',
          tenant_id: 'tenant-1',
          organization_id: null,
          message: 'global status',
          details: { leaked: true },
          occurred_at: occurredAt,
        },
        {
          id: 'log-org-2',
          source: 'indexer',
          handler: 'query_index:test',
          level: 'info',
          entity_type: ENTITY_A,
          record_id: 'other-record',
          tenant_id: 'tenant-1',
          organization_id: 'org-2',
          message: 'other org status',
          details: { other: true },
          occurred_at: occurredAt,
        },
      ],
    })
    const em = { getKysely: () => db }
    mockCreateRequestContainer.mockResolvedValueOnce({
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'eventBus') return { emitEvent }
        if (name === 'searchModuleConfigs') return []
        if (name === 'searchStrategies') return []
        throw new Error(`Unexpected token: ${name}`)
      },
    })

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.errors.map((row: { id: string }) => row.id)).toEqual(['err-org-1'])
    expect(body.logs.map((row: { id: string }) => row.id)).toEqual(['log-org-1'])
  })
})
