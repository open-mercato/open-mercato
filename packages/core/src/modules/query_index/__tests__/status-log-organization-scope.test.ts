/**
 * Which `indexer_status_logs` / `indexer_error_logs` rows the indexer panel shows.
 *
 * Two cases, and only one of them was wrong.
 *
 * An org-SCOPED caller is filtered to `organization_id IN (...)` with no NULL branch. That
 * is deliberate (#3887): a null-organization diagnostic row carries a stack and a payload
 * from a platform-wide operation that may concern another organization.
 * `status-coverage-waterfall.test.ts` pins it and must keep passing.
 *
 * An UNRESTRICTED caller - `filterIds === null`, the all-organizations view - fell into an
 * `else` that returned ONLY rows with `organization_id IS NULL`. No isolation argument
 * applies there, so the effect was to make the panel's contents depend on whether a writer
 * happened to record the organization: `worker:vector-indexing:*` and `cli:search.reindex`
 * populate it and were invisible in that view, while the fulltext worker did not and was
 * visible. Recording it on the fulltext worker - the point of this change - would have
 * moved those rows from one blind spot into the other.
 */
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

jest.mock('../lib/coverage', () => ({
  readCoverageSnapshot: jest.fn(),
  readCoverageSnapshots: jest.fn(async () => new Map()),
  refreshCoverageSnapshot: jest.fn(),
}))

import { GET } from '../api/status'

type FakeRow = Record<string, unknown>
type FakePredicate = (row: FakeRow) => boolean

function makeComparison(column: unknown, operator: unknown, value: unknown): FakePredicate {
  const key = String(column)
  if (operator === '=') return (row) => row[key] === value
  if (operator === 'in') return (row) => Array.isArray(value) && value.includes(row[key])
  if (operator === 'is') return (row) => (value == null ? row[key] == null : row[key] === value)
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

const TENANT = 'tenant-1'

/** One row per (writer, organization) shape the two log tables really contain. */
function logRow(handler: string, organizationId: string | null): FakeRow {
  return {
    id: `${handler}:${organizationId ?? 'null'}`,
    source: 'fulltext',
    handler,
    message: 'indexed',
    level: 'info',
    tenant_id: TENANT,
    organization_id: organizationId,
    occurred_at: new Date(),
    details: null,
  }
}

function errorRow(handler: string, organizationId: string | null): FakeRow {
  return { ...logRow(handler, organizationId), stack: null, payload: null }
}

const ROWS: Record<string, FakeRow[]> = {
  custom_field_defs: [],
  entity_index_jobs: [],
  indexer_status_logs: [
    logRow('worker:fulltext:index', 'org-1'),
    logRow('worker:vector-indexing:index', 'org-2'),
    logRow('cli:query_index.reindex', null),
  ],
  indexer_error_logs: [
    errorRow('worker:fulltext:index', 'org-1'),
    errorRow('worker:vector-indexing:index', 'org-2'),
    errorRow('cli:query_index.reindex', null),
  ],
}

function makeContainer() {
  const db = makeFakeDb(ROWS)
  const em = { getKysely: () => db }
  return {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'eventBus') return { emitEvent: jest.fn(async () => undefined) }
      if (name === 'searchModuleConfigs') return []
      if (name === 'searchStrategies') return []
      if (name === 'moduleConfigService') return { getValue: async () => true }
      throw new Error(`Unexpected token: ${name}`)
    },
  }
}

async function readIds(res: Response) {
  const body = await res.json()
  return {
    logs: (body.logs as Array<Record<string, any>>).map((row) => row.id),
    errors: (body.errors as Array<Record<string, any>>).map((row) => row.id),
  }
}

describe('query_index status route — which log rows each scope sees', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ tenantId: TENANT, orgId: 'org-1', sub: 'user-1' })
    mockGetEntityIds.mockReturnValue({})
    mockFlattenSystemEntityIds.mockReturnValue([])
    mockCreateRequestContainer.mockResolvedValue(makeContainer())
  })

  it('shows every organization to the unrestricted, all-organizations view', async () => {
    // `filterIds: null` is the all-organizations view. It used to return ONLY the
    // NULL-organization rows, so an operator asking "did indexing run?" across the
    // installation saw the one writer that omits the organization and none of the ones
    // that record it.
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: TENANT,
    })

    const { logs, errors } = await readIds(await GET(new Request('http://localhost/api/query_index/status')))

    expect(logs).toEqual(expect.arrayContaining([
      'worker:fulltext:index:org-1',
      'worker:vector-indexing:index:org-2',
      'cli:query_index.reindex:null',
    ]))
    expect(errors).toHaveLength(3)
  })

  it('keeps a scoped view to its own organizations only, null-organization rows included (#3887)', async () => {
    // The half that must NOT change. A null-organization diagnostic carries a stack and a
    // payload from a platform-wide operation, so it stays out of a scoped caller's view -
    // stricter than `cfQuery` earlier in the same file, deliberately.
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: 'org-1',
      filterIds: ['org-1'],
      allowedIds: ['org-1'],
      tenantId: TENANT,
    })

    const { logs, errors } = await readIds(await GET(new Request('http://localhost/api/query_index/status')))

    expect(logs).toEqual(['worker:fulltext:index:org-1'])
    expect(errors).toEqual(['worker:fulltext:index:org-1'])
  })
})
