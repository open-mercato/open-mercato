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

const mockReadCoverageSnapshots = jest.fn()
jest.mock('../lib/coverage', () => ({
  readCoverageSnapshot: jest.fn(),
  readCoverageSnapshots: (...args: unknown[]) => mockReadCoverageSnapshots(...args),
  refreshCoverageSnapshot: jest.fn(),
}))

import { GET } from '../api/status'

const CF_ENTITY = 'example:todo'
const SEARCH_ENTITY = 'sales:sales_order_line'
const COVERED_ENTITY = 'catalog:catalog_product_category'
const UNTOUCHED_ENTITY = 'auth:session'

const ALL_ENTITIES = [CF_ENTITY, SEARCH_ENTITY, COVERED_ENTITY, UNTOUCHED_ENTITY]

function snapshot(baseCount: number, indexedCount: number, vectorIndexedCount = 0) {
  return {
    base_count: baseCount,
    indexed_count: indexedCount,
    vector_indexed_count: vectorIndexedCount,
    refreshed_at: new Date(),
    baseCount,
    indexedCount,
    vectorIndexedCount,
  }
}

type FakeRow = Record<string, unknown>
type FakePredicate = (row: FakeRow) => boolean

function makeComparison(column: unknown, operator: unknown, value: unknown): FakePredicate {
  const key = String(column)
  if (operator === '=') return (row) => row[key] === value
  if (operator === 'in') return (row) => Array.isArray(value) && value.includes(row[key])
  if (operator === 'is') return (row) => (value == null ? row[key] == null : row[key] === value)
  return () => true
}

function makeFakeDb(tableRows: Record<string, FakeRow[]>, onSelect?: (table: string) => void) {
  const build = (table: string) => {
    onSelect?.(String(table))
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

type ContainerOverrides = {
  vectorAvailable?: boolean
  tenantAutoIndexEnabled?: boolean
  tableRows?: Record<string, FakeRow[]>
  onSelect?: (table: string) => void
}

function searchModuleConfigs() {
  return [
    {
      entities: [
        // Vector + fulltext configured, zero custom fields — the case that used to vanish.
        {
          entityId: SEARCH_ENTITY,
          buildSource: async () => null,
          fieldPolicy: { searchable: ['name'] },
        },
      ],
    },
  ]
}

function makeContainer(overrides: ContainerOverrides = {}) {
  const db = makeFakeDb(
    overrides.tableRows ?? {
      custom_field_defs: [{ entity_id: CF_ENTITY, is_active: true, tenant_id: null, organization_id: null }],
      entity_index_jobs: [],
      indexer_error_logs: [],
      indexer_status_logs: [],
    },
    overrides.onSelect,
  )
  const em = { getKysely: () => db }
  return {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'eventBus') return { emitEvent: jest.fn(async () => undefined) }
      if (name === 'searchModuleConfigs') return searchModuleConfigs()
      if (name === 'searchStrategies') {
        return [
          { id: 'vector', isAvailable: async () => overrides.vectorAvailable === true },
        ]
      }
      if (name === 'moduleConfigService') {
        return {
          getValue: async () => (overrides.tenantAutoIndexEnabled === false ? false : true),
        }
      }
      throw new Error(`Unexpected token: ${name}`)
    },
  }
}

function makeRequest() {
  return new Request('http://localhost/api/query_index/status')
}

async function readItems(res: Response) {
  const body = await res.json()
  return body.items as Array<Record<string, any>>
}

describe('query_index status route — entity listing and coverage semantics', () => {
  const originalEnvDisable = process.env.OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING
  const originalLegacyDisable = process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING
    delete process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING
    mockGetAuthFromRequest.mockResolvedValue({ tenantId: 'tenant-1', orgId: 'org-1', sub: 'user-1' })
    mockGetEntityIds.mockReturnValue({})
    mockFlattenSystemEntityIds.mockReturnValue(ALL_ENTITIES)
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: 'org-1',
      filterIds: ['org-1'],
      allowedIds: ['org-1'],
      tenantId: 'tenant-1',
    })
    mockReadCoverageSnapshots.mockImplementation(async () => new Map([
      [CF_ENTITY, snapshot(3, 3)],
      [SEARCH_ENTITY, snapshot(44, 44)],
      [COVERED_ENTITY, snapshot(7, 7)],
      [UNTOUCHED_ENTITY, snapshot(0, 0)],
    ]))
    mockCreateRequestContainer.mockResolvedValue(makeContainer())
  })

  afterAll(() => {
    if (originalEnvDisable === undefined) delete process.env.OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING
    else process.env.OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING = originalEnvDisable
    if (originalLegacyDisable === undefined) delete process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING
    else process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING = originalLegacyDisable
  })

  it('lists entities without custom fields when a search backend or the query index covers them', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const entityIds = (await readItems(res)).map((item) => item.entityId)
    expect(entityIds).toContain(SEARCH_ENTITY)
    expect(entityIds).toContain(COVERED_ENTITY)
    expect(entityIds).toContain(CF_ENTITY)
  })

  it('omits entities that no backend covers and that have no custom fields', async () => {
    const res = await GET(makeRequest())
    const entityIds = (await readItems(res)).map((item) => item.entityId)
    expect(entityIds).not.toContain(UNTOUCHED_ENTITY)
  })

  it('reports hasCustomFields per row instead of using it as a listing gate', async () => {
    const res = await GET(makeRequest())
    const items = await readItems(res)
    const byId = new Map(items.map((item) => [item.entityId, item]))
    expect(byId.get(CF_ENTITY)?.hasCustomFields).toBe(true)
    expect(byId.get(SEARCH_ENTITY)?.hasCustomFields).toBe(false)
  })

  it('reports queryIndexOk when the query index matches the base table and vector is empty', async () => {
    mockCreateRequestContainer.mockResolvedValue(makeContainer({ vectorAvailable: true }))
    const res = await GET(makeRequest())
    const items = await readItems(res)
    const row = items.find((item) => item.entityId === SEARCH_ENTITY)
    expect(row?.baseCount).toBe(44)
    expect(row?.indexCount).toBe(44)
    expect(row?.vectorCount).toBe(0)
    // The narrow signal the status page renders.
    expect(row?.queryIndexOk).toBe(true)
  })

  it('preserves the published aggregate meaning of `ok` (index AND vector coverage)', async () => {
    mockCreateRequestContainer.mockResolvedValue(makeContainer({ vectorAvailable: true }))
    const res = await GET(makeRequest())
    const items = await readItems(res)
    const byId = new Map(items.map((item) => [item.entityId, item]))
    // Vector-configured with 0 of 44 embedded: the legacy aggregate stays false so existing
    // API consumers keep detecting vector drift.
    expect(byId.get(SEARCH_ENTITY)?.ok).toBe(false)
    // Not vector-configured: `ok` still tracks the query index alone.
    expect(byId.get(CF_ENTITY)?.ok).toBe(true)
    expect(byId.get(CF_ENTITY)?.queryIndexOk).toBe(true)
  })

  it('marks vector indexing inactive when no embedding provider is reachable', async () => {
    mockCreateRequestContainer.mockResolvedValue(makeContainer({ vectorAvailable: false }))
    const res = await GET(makeRequest())
    const row = (await readItems(res)).find((item) => item.entityId === SEARCH_ENTITY)
    // `vectorEnabled` keeps its published meaning: the entity declares buildSource.
    expect(row?.vectorEnabled).toBe(true)
    expect(row?.vectorIndexingActive).toBe(false)
    // The raw count stays on the wire; the UI decides not to render it.
    expect(row?.vectorCount).toBe(0)
  })

  it('marks vector indexing inactive when auto-indexing is disabled instance-wide', async () => {
    process.env.OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING = 'true'
    mockCreateRequestContainer.mockResolvedValue(makeContainer({ vectorAvailable: true }))
    const res = await GET(makeRequest())
    const row = (await readItems(res)).find((item) => item.entityId === SEARCH_ENTITY)
    expect(row?.vectorEnabled).toBe(true)
    expect(row?.vectorIndexingActive).toBe(false)
  })

  it('marks vector indexing inactive when the tenant switched auto-indexing off', async () => {
    mockCreateRequestContainer.mockResolvedValue(
      makeContainer({ vectorAvailable: true, tenantAutoIndexEnabled: false }),
    )
    const res = await GET(makeRequest())
    const row = (await readItems(res)).find((item) => item.entityId === SEARCH_ENTITY)
    expect(row?.vectorIndexingActive).toBe(false)
  })

  it('marks vector indexing active when the provider is reachable and auto-indexing is on', async () => {
    mockCreateRequestContainer.mockResolvedValue(makeContainer({ vectorAvailable: true }))
    const res = await GET(makeRequest())
    const row = (await readItems(res)).find((item) => item.entityId === SEARCH_ENTITY)
    expect(row?.vectorEnabled).toBe(true)
    expect(row?.vectorIndexingActive).toBe(true)
    expect(row?.vectorCount).toBe(0)
  })

  it('fetches job status for every listed entity in a single query', async () => {
    const selects: string[] = []
    mockCreateRequestContainer.mockResolvedValue(makeContainer({ onSelect: (table) => selects.push(table) }))
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(selects.filter((table) => table === 'entity_index_jobs')).toHaveLength(1)
  })
})
